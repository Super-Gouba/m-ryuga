// M-Ryuga — SIP 报文解析（请求/响应/头域/SDP），紧凑且容错

const KNOWN_SIP_METHODS = ['INVITE', 'ACK', 'BYE', 'CANCEL', 'REGISTER', 'OPTIONS', 'INFO', 'PRACK', 'UPDATE', 'REFER', 'SUBSCRIBE', 'NOTIFY', 'MESSAGE', 'PUBLISH'];

/**
 * 解析 UDP/TCP 载荷为 SIP 消息。
 * 返回 { isSip, kind: 'request'|'response'|null, method, cseq, callId, from, to, fromUser, toUser,
 *         status, reason, via, contact, userAgent, sdp, hdrs: [{name,value}], startLine }
 */
function parseSip(payload, { srcIp, sport, dstIp, dport } = {}) {
  if (!payload || payload.length < 24) return null;
  const text = payload.toString('latin1');
  const firstLineEnd = text.indexOf('\n');
  if (firstLineEnd < 0) return null;
  const startLine = text.slice(0, firstLineEnd).replace(/\r$/, '');
  if (!startLine || startLine.length > 4096) return null;

  let kind = null, method = null, status = 0, reason = '';
  if (startLine.startsWith('SIP/2.0 ')) {
    kind = 'response';
    // 状态行可能不带原因短语（"SIP/2.0 100"），不能按空格粗暴切分
    const sm = startLine.match(/^SIP\/2\.0\s+(\d{3})\s*(.*)$/);
    if (!sm) return null;
    status = parseInt(sm[1], 10);
    reason = sm[2] || '';
    if (!status) return null;
  } else {
    const m = startLine.match(/^([A-Za-z]+)\s+(\S+)\s+SIP\/(\d\.\d)/);
    if (m && KNOWN_SIP_METHODS.includes(m[1].toUpperCase())) {
      kind = 'request';
      method = m[1].toUpperCase();
    } else return null;
  }

  // 头域切分（支持合并行 continuation）
  const hdrs = [];
  let body = null;
  let i = firstLineEnd + 1;
  let curName = null, curVal = '';
  while (i < text.length) {
    const nl = text.indexOf('\n', i);
    const line = nl < 0 ? text.slice(i) : text.slice(i, nl);
    i = nl < 0 ? text.length : nl + 1;
    const l = line.replace(/\r$/, '');
    if (l === '') { body = text.slice(i); break; }
    if (l[0] === ' ' || l[0] === '\t') { curVal += ' ' + l.trim(); continue; } // continuation
    if (curName) hdrs.push([curName, curVal]);
    const ci = l.indexOf(':');
    if (ci <= 0) { curName = null; curVal = ''; continue; }
    curName = l.slice(0, ci).trim();
    curVal = l.slice(ci + 1).trim();
  }
  if (curName) hdrs.push([curName, curVal]);

  const get = (name) => {
    const n = name.toLowerCase();
    const h = hdrs.find(([k]) => k.toLowerCase() === n);
    return h ? h[1] : '';
  };
  const getAll = (name) => {
    const n = name.toLowerCase();
    return hdrs.filter(([k]) => k.toLowerCase() === n).map(([, v]) => v);
  };

  const callId = get('Call-ID') || get('i');
  if (!callId) return { isSip: true, kind, malformed: true, startLine, method, status, reason, callId: '', hdrs, body };

  let cseqNum = 0, cseqMethod = method;
  const cseqRaw = get('CSeq');
  if (cseqRaw) {
    const parts = cseqRaw.trim().split(/\s+/);
    cseqNum = parseInt(parts[0], 10) || 0;
    if (parts[1]) cseqMethod = parts[1].toUpperCase();
  }

  const parseAddr = (v) => {
    if (!v) return { disp: '', uri: '', user: '', host: '' };
    const m1 = v.match(/^"([^"]*)"\s*<([^>]+)>/);
    const uri = m1 ? m1[2] : (v.match(/<([^>]+)>/)?.[1] || v.trim());
    const disp = m1 ? m1[1] : '';
    const um = uri.match(/^([a-zA-Z]+):(?:([^;@]*)@)?([^;:]+)(?::(\d+))?/);
    return { disp, uri, user: um ? decodeUser(um[2] || '') : '', host: um ? um[3] : '', port: um && um[4] ? parseInt(um[4]) : null, params: uri.split(';').slice(1) };
  };
  const from = parseAddr(get('From') || get('f'));
  const to = parseAddr(get('To') || get('t'));

  // SDP
  let sdp = null;
  if (body && body.startsWith('v=')) {
    sdp = parseSdp(body);
  }

  // RSeq / PRACK 相关
  const rseq = parseInt(get('RSeq'), 10) || 0;
  const reasonPh = get('Reason');
  const warns = getAll('Warning');

  return {
    isSip: true, kind, method, cseq: cseqNum, cseqMethod, status, reason,
    callId, from, to, fromTag: extractTag(get('From')), toTag: extractTag(get('To')),
    via: get('Via'), branch: (get('Via').match(/branch=([^;\s]+)/) || [])[1] || '',
    contact: get('Contact'), userAgent: get('User-Agent'), server: get('Server'),
    subject: get('Subject'),
    contentType: get('Content-Type'),
    callInfo: get('Call-Info'),
    div: get('Diversion'), pai: get('P-Asserted-Identity'), ppi: get('P-Preferred-Identity'),
    rpid: get('Remote-Party-ID'),
    replaces: extractReferUri(get('Replaces')),
    join: extractReferUri(get('Join')),
    referTo: extractReferUri(get('Refer-To')),
    referredBy: get('Referred-By'),
    event: get('Event'),
    rseq, reasonPh, warns,
    maxForwards: parseInt(get('Max-Forwards'), 10) || 0,
    sessionExpires: get('Session-Expires'),
    sdp,
    startLine, hdrs, body,
    // 网络侧
    srcIp, sport, dstIp, dport
  };
}

function decodeUser(u) { try { return decodeURIComponent(u); } catch { return u; } }

function extractTag(v) {
  if (!v) return '';
  const m = v.match(/tag=([^;\s]+)/);
  return m ? m[1] : '';
}
function extractReferUri(v) {
  if (!v) return null;
  const m = v.match(/<([^>]+)>/);
  const uri = m ? m[1] : v.trim();
  const callIdM = v.match(/call-id=([^;\s>]+)/i) || uri.match(/;call-id=([^;\s>]+)/i);
  return { uri, callId: callIdM ? callIdM[1] : '', raw: v };
}

/** 最小 SDP 解析 */
function parseSdp(text) {
  const lines = text.split(/\r?\n/);
  const sdp = { version: '', sessionName: '', media: [], connection: '', timing: '' };
  let cur = null;
  for (const l of lines) {
    if (!l || l.length < 2 || l[1] !== '=') continue;
    const t = l[0], val = l.slice(2);
    switch (t) {
      case 'v': sdp.version = val; break;
      case 's': sdp.sessionName = val; break;
      case 'c': if (cur) cur.connection = val; else sdp.connection = val; break;
      case 't': sdp.timing = val; break;
      case 'm': {
        const p = val.split(/\s+/);
        cur = { type: p[0], port: parseInt(p[1], 10) || 0, proto: p[2] || '', formats: p.slice(3).join(' '), rtpmaps: {}, fmtp: {}, ptime: '', maxptime: '', direction: '' };
        sdp.media.push(cur);
        break;
      }
      case 'a': {
        if (!cur) break;
        const rm = val.match(/^rtpmap:(\d+)\s+([^\s/]+)(?:\/(\d+))?(?:\/(\d+))?/);
        if (rm) cur.rtpmaps[rm[1]] = { name: rm[2].toUpperCase(), clock: parseInt(rm[3], 10) || 8000, ch: parseInt(rm[4], 10) || 1 };
        const fm = val.match(/^fmtp:(\d+)\s+(.*)/);
        if (fm) cur.fmtp[fm[1]] = fm[2];
        const pm = val.match(/^(ptime|maxptime):(\d+)/);
        if (pm) cur[pm[1]] = parseInt(pm[2], 10);
        const dm = val.match(/^(sendrecv|sendonly|recvonly|inactive)$/);
        if (dm) cur.direction = dm[1];
        const am = val.match(/^setup:(\w+)/);
        if (am) cur.setup = am[1];
        break;
      }
    }
  }
  return sdp;
}

const SIP_PORTS_DEFAULT = [5060, 5061, 5080, 6060, 7060, 8060, 9060, 50600];

/** 启发式：payload 是否像 SIP */
function looksLikeSip(payload) {
  if (!payload || payload.length < 16) return false;
  const head = payload.slice(0, 64).toString('latin1');
  if (/^SIP\/2\.0 \d{3}/.test(head)) return true;
  const m = head.match(/^([A-Z]+)\s+\S+\s+SIP\/2\.0\s*$/);
  return !!(m && KNOWN_SIP_METHODS.includes(m[1]));
}

module.exports = { parseSip, parseSdp, looksLikeSip, KNOWN_SIP_METHODS, SIP_PORTS_DEFAULT };
