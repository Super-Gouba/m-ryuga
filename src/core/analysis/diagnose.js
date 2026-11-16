// M-Ryuga — 通话体检：从聚合通话中推导时间线、结束发起侧、Reason/Q.850、信令与媒体问题证据
// 要求②：开始、接通、结束时间、时长、结束发起侧、Reason/Q.850；缺结束时完整时长与挂断方显示未知

const Q850_CAUSE = {
  1: '未分配号码', 2: '无路由至指定网络', 3: '无路由至目的地', 6: '通道不可接受', 7: '呼叫已提交并在指定通道传递',
  16: '正常呼叫清除', 17: '用户忙', 18: '无应答', 19: '无应答（用户告警）', 21: '呼叫拒绝', 22: '号码改变',
  27: '目的地不可达', 28: '格式无效', 29: '设施被拒绝', 31: '正常—未指明', 34: '无可用电路/通道',
  38: '网络故障', 41: '临时故障', 42: '设备拥塞', 44: '所请求的电路/通道不可用', 47: '资源不可用—未指明',
  49: '服务质量不可用', 50: '所请求的设施未签约', 55: '入向组内呼叫禁止', 57: '承载能力未授权', 58: '承载能力不可用',
  63: '业务或选项不可用—未指明', 65: '承载业务未实现', 66: '信道类型未实现', 69: '所请求的设施未实现',
  70: '仅受限数字信息承载能力可用', 79: '业务或选项未实现—未指明', 81: '无效呼叫参考值', 83: '呼叫参考值使用错误',
  87: '用户不属于 CUG', 88: '目标不兼容', 90: '不存在的 CUG', 91: '无效传输网络选择', 95: '无效消息—未指明',
  96: '强制信息单元缺失', 97: '消息类型不存在', 98: '消息与呼叫状态不兼容', 99: '信息单元不存在或未实现',
  100: '无效信息单元内容', 101: '消息与呼叫状态不兼容', 102: '定时器超时后恢复', 103: '参数传递错误',
  111: '协议错误—未指明', 127: '互通—未指明'
};

const SIP_STATUS_TEXT = {
  100: 'Trying', 180: 'Ringing', 183: 'Session Progress', 200: 'OK', 202: 'Accepted',
  301: 'Moved Permanently', 302: 'Moved Temporarily',
  400: 'Bad Request', 401: 'Unauthorized', 403: 'Forbidden', 404: 'Not Found', 408: 'Request Timeout',
  415: 'Unsupported Media Type', 480: 'Temporarily Unavailable', 481: 'Call Does Not Exist',
  483: 'Too Many Hops', 486: 'Busy Here', 487: 'Request Terminated', 488: 'Not Acceptable Here',
  500: 'Server Internal Error', 502: 'Bad Gateway', 503: 'Service Unavailable', 504: 'Server Time-out',
  600: 'Busy Everywhere', 603: 'Decline', 604: 'Does Not Exist Anywhere'
};

/** 单通话体检 */
function diagnoseCall(call, analyzer) {
  const msgs = call.msgs.slice().sort((a, b) => a.tsUs - b.tsUs);
  const d = {
    callId: call.callId,
    from: call.fromDisp ? `${call.fromDisp} ${call.fromUser}` : call.fromUser,
    to: call.toDisp ? `${call.toDisp} ${call.toUser}` : call.toUser,
    fromUser: call.fromUser, toUser: call.toUser,
    // 时间四元组
    tStart: null, tConnect: null, tEnd: null,
    durationSec: null, connDurationSec: null,
    ringingMs: null,
    // 结束
    ended: false, endBy: null,            // 'A' 主叫 | 'B' 被叫 | '未知'
    endMethod: null, endStatus: null, endReasonText: null, endCause: null, endCauseText: null,
    endByUser: null,
    incomplete: false,                     // 抓包缺结束
    // 质量证据
    signalingIssues: [], mediaIssues: [],
    dtmf: [], codecs: [],
    msgsCount: msgs.length
  };

  if (!msgs.length) return d;
  d.tStart = msgs[0].tsUs;

  const inv = msgs.find(m => m.method === 'INVITE');
  const ok200Inv = msgs.find(m => m.kind === 'response' && m.cseqMethod === 'INVITE' && m.status === 200);
  const bye = msgs.filter(m => m.method === 'BYE' || m.method === 'CANCEL');
  const finalResp = [...msgs].reverse().find(m => m.kind === 'response' && m.status >= 200 && m.cseqMethod === 'INVITE');

  // 接通：INVITE 的 200 OK
  if (ok200Inv) {
    d.tConnect = ok200Inv.tsUs;
    d.ringingMs = (ok200Inv.tsUs - d.tStart) / 1000;
  }
  // 结束：BYE 或非 200 的 INVITE final
  const byeMsg = msgs.find(m => m.method === 'BYE');
  if (byeMsg) {
    d.ended = true;
    d.tEnd = msgs.find(m => m.kind === 'response' && m.status === 200 && m.cseqMethod === 'BYE')?.tsUs || byeMsg.tsUs;
    d.endMethod = 'BYE';
    // 结束发起侧：BYE 的 From tag 对比 INVITE From tag
    const invFromTag = inv?.fromTag;
    d.endBy = byeMsg.fromTag && invFromTag && byeMsg.fromTag === invFromTag ? 'A' : (byeMsg.fromTag && inv?.toTag && byeMsg.fromTag === inv.toTag ? 'B' : null);
    d.endByUser = d.endBy === 'A' ? d.from : d.endBy === 'B' ? d.to : null;
  } else if (finalResp && finalResp.status !== 200) {
    d.ended = true;
    d.tEnd = finalResp.tsUs;
    d.endMethod = 'SIP';
    d.endStatus = finalResp.status;
    d.endReasonText = finalResp.reason || SIP_STATUS_TEXT[finalResp.status] || '';
    // 487 由 CANCEL 触发
    const cancel = msgs.find(m => m.method === 'CANCEL');
    if (cancel) { d.endMethod = 'CANCEL'; d.endBy = cancel.fromTag && inv && cancel.fromTag === inv.fromTag ? 'A' : 'B'; }
    else d.endBy = finalResp.fromTag && inv && finalResp.fromTag === inv.fromTag ? 'A' : 'B';
    d.endByUser = d.endBy === 'A' ? d.from : d.endBy === 'B' ? d.to : null;
    // Q.850 Reason 头
    if (finalResp.reasonPh) {
      const m = finalResp.reasonPh.match(/Q\.850[^;]*;\s*cause=(\d+)/i) || finalResp.reasonPh.match(/cause=(\d+)/i);
      if (m) { d.endCause = parseInt(m[1], 10); d.endCauseText = Q850_CAUSE[d.endCause] || `原因码 ${d.endCause}`; }
    }
  }
  if (!d.ended) {
    d.incomplete = true;
    if (d.tEnd === null && msgs.length) d.tEnd = null; // 明确显示未知
  }
  // 时长
  const endUs = d.tEnd ?? (analyzer?.stats?.lastUs ?? null);
  if (endUs !== null) {
    d.durationSec = (endUs - d.tStart) / 1e6;
    d.connDurationSec = d.tConnect ? (endUs - d.tConnect) / 1e6 : null;
  }

  // Reason 头收集（全部消息）
  for (const m of msgs) {
    if (m.reasonPh) {
      const m2 = m.reasonPh.match(/Q\.850[^;]*;\s*cause=(\d+)/i);
      if (m2 && d.endCause === null) { d.endCause = parseInt(m2[1], 10); d.endCauseText = Q850_CAUSE[+m2[1]] || `原因码 ${m2[1]}`; }
    }
  }

  // ---- 信令问题证据 ----
  const addSig = (sev, code, text, evidence) => d.signalingIssues.push({ sev, code, text, evidence });
  const retrans = detectRetransmissions(msgs);
  if (retrans.length) addSig('warn', 'RETRANS', `检测到 ${retrans.length} 组请求重传`, retrans.slice(0, 5));
  // 5xx / 6xx
  const serverErr = msgs.filter(m => m.kind === 'response' && m.status >= 500);
  if (serverErr.length) addSig('error', 'S5XX', `服务端错误 ${serverErr.map(m => m.status).join(', ')}`, serverErr.slice(0, 3).map(m => `${m.startLine} @ ${fmtT(m.tsUs)}`));
  const busy = msgs.filter(m => [486, 600, 603].includes(m.status));
  if (busy.length) addSig('info', 'BUSY', '对端忙 / 拒接', busy.slice(0, 3).map(m => `${m.startLine} @ ${fmtT(m.tsUs)}`));
  // CANCEL（未接听取消）
  if (msgs.some(m => m.method === 'CANCEL')) addSig('info', 'CANCEL', '呼叫在应答前被取消', null);
  // 无 ACK（200 OK 后未看到 ACK — 仅提示）
  if (ok200Inv && !msgs.some(m => m.method === 'ACK' && m.cseq === ok200Inv.cseq)) {
    addSig('warn', 'NO_ACK', '200 OK 后未见 ACK（可能被抓包点遗漏）', null);
  }
  // 407/401 认证
  const auth = msgs.filter(m => m.status === 401 || m.status === 407);
  if (auth.length) addSig('info', 'AUTH', `认证挑战 ${auth.length} 次`, null);

  // ---- 媒体问题证据 ----
  const streams = call.rtpStreams || [];
  if (streams.length === 0 && d.tConnect) {
    d.mediaIssues.push({ sev: 'error', code: 'NO_RTP', text: '已接通但未见 RTP 媒体流', evidence: null });
  } else {
    for (const st of streams) {
      const durMs = st.lastTsUs && st.firstTsUs ? (st.lastTsUs - st.firstTsUs) / 1000 : 0;
      const totalPkts = st.pkts.length + st.lost;
      const lossPct = totalPkts > 0 ? (st.lost / totalPkts) * 100 : 0;
      if (lossPct > 3) d.mediaIssues.push({ sev: lossPct > 10 ? 'error' : 'warn', code: 'LOSS', text: `${st.dir || st.key} 丢包 ${lossPct.toFixed(1)}%`, evidence: { dir: st.dir, lost: st.lost, total: totalPkts } });
      if (st.jitterMs > 30) d.mediaIssues.push({ sev: 'warn', code: 'JITTER', text: `${st.dir || st.key} 抖动 ${st.jitterMs.toFixed(1)}ms`, evidence: { dir: st.dir, jitterMs: st.jitterMs } });
      if (st.outOfOrder > 5) d.mediaIssues.push({ sev: 'warn', code: 'OOO', text: `${st.dir || st.key} 乱序 ${st.outOfOrder} 包`, evidence: { dir: st.dir, count: st.outOfOrder } });
      if (durMs > 5000 && st.pkts.length < 10) d.mediaIssues.push({ sev: 'error', code: 'RTP_SPARSE', text: `${st.dir || st.key} 长时间仅少量 RTP 包`, evidence: null });
      if (st.codecName) d.codecs.push(st.codecName);
    }
  }
  // 单向媒体（仅一个方向有流）
  if (streams.length === 1 && d.tConnect) {
    d.mediaIssues.push({ sev: 'error', code: 'ONEWAY', text: '仅检测到单方向媒体流', evidence: streams[0].key });
  }
  d.codecs = [...new Set(d.codecs)];
  return d;
}

/** 重传检测：同 method+cseq+branch 重复出现 */
function detectRetransmissions(msgs) {
  const seen = new Map();
  const groups = [];
  for (const m of msgs) {
    if (m.kind !== 'request' || m.method === 'ACK') continue;
    const key = `${m.method}|${m.cseq}|${m.branch || m.src}`;
    if (seen.has(key)) {
      const first = seen.get(key);
      if (m.tsUs - first.tsUs < 8e6) { groups.push({ first: fmtT(first.tsUs), dup: fmtT(m.tsUs), method: m.method }); continue; }
    }
    seen.set(key, m);
  }
  return groups;
}

function fmtT(us) {
  const ms = us / 1000;
  const s = Math.floor(ms / 1000);
  return `${String(Math.floor(s / 3600)).padStart(2, '0')}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}.${String(Math.floor(ms % 1000)).padStart(3, '0')}`;
}

/** 列表摘要（用于通话列表页） */
function callSummary(d) {
  return {
    callId: d.callId, from: d.from, to: d.to, fromUser: d.fromUser, toUser: d.toUser,
    tStart: d.tStart, tConnect: d.tConnect, tEnd: d.tEnd,
    durationSec: d.durationSec, connDurationSec: d.connDurationSec,
    ended: d.ended, incomplete: d.incomplete, endBy: d.endBy, endByUser: d.endByUser,
    endStatus: d.endStatus, endReasonText: d.endReasonText, endCause: d.endCause, endCauseText: d.endCauseText,
    sigCount: d.signalingIssues.length, mediaCount: d.mediaIssues.length,
    sev: worstSeverity(d), codecs: d.codecs, msgsCount: d.msgsCount
  };
}

function worstSeverity(d) {
  const has = (arr, sev) => arr.some(i => i.sev === sev);
  if (has(d.signalingIssues, 'error') || has(d.mediaIssues, 'error')) return 'error';
  if (has(d.signalingIssues, 'warn') || has(d.mediaIssues, 'warn')) return 'warn';
  if (d.signalingIssues.length || d.mediaIssues.length) return 'info';
  return 'ok';
}

module.exports = { diagnoseCall, callSummary, worstSeverity, Q850_CAUSE, SIP_STATUS_TEXT, fmtT };
