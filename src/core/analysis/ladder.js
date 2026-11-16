// M-Ryuga — SIP 流序图（Ladder）数据构建 + 报文彩色分类 + 查找（按号码/时间/IP）

const { SIP_STATUS_TEXT } = require('./diagnose');

/** 消息颜色类别（前端渲染着色） */
function msgClass(m) {
  if (m.kind === 'request') {
    if (m.method === 'INVITE') return 'inv';
    if (m.method === 'ACK') return 'ack';
    if (m.method === 'BYE' || m.method === 'CANCEL') return 'bye';
    if (m.method === 'REGISTER') return 'reg';
    return 'other-req';
  }
  if (m.status >= 200 && m.status < 300) return 'ok';
  if (m.status >= 300 && m.status < 400) return 'redirect';
  if (m.status >= 400 && m.status < 500) return 'c4xx';
  if (m.status >= 500) return 'c5xx';
  return 'prov';
}

/**
 * 构建流序图数据。
 * actors: 参与方（host:port），lanes: [{ tsUs, from, to, label, cls, msgIdx }]
 */
function buildLadder(msgs) {
  const actors = [];
  const actorIdx = new Map();
  const addActor = (ipPort) => {
    if (!ipPort) return null;
    if (!actorIdx.has(ipPort)) {
      actorIdx.set(ipPort, actors.length);
      actors.push({ id: ipPort, label: ipPort, kind: 'endpoint' });
    }
    return actorIdx.get(ipPort);
  };
  const lanes = [];
  msgs.forEach((m, i) => {
    const fi = addActor(m.src);
    const ti = addActor(m.dst);
    let label;
    if (m.kind === 'request') {
      label = `${m.method} (${m.cseq})`;
    } else {
      const r = m.reason ? ` ${m.reason}` : '';
      label = `${m.status}${r} (${m.cseqMethod} ${m.cseq})`;
    }
    lanes.push({ tsUs: m.tsUs, from: fi, to: ti, label, cls: msgClass(m), msgIdx: i, callId: m.callId });
  });
  return { actors, lanes };
}

/** 查找通话：按号码 / IP / 时间范围 */
function findCalls(calls, { user, ip, timeFrom, timeTo }) {
  return calls.filter(c => {
    if (user && !(c.fromUser?.includes(user) || c.toUser?.includes(user))) return false;
    if (ip && !(c.srcIp?.includes(ip) || c.dstIp?.includes(ip))) return false;
    if (timeFrom && c.tStart < timeFrom) return false;
    if (timeTo && c.tStart > timeTo) return false;
    return true;
  });
}

module.exports = { buildLadder, msgClass, findCalls };
