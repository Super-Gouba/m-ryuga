// M-Ryuga — 抓包对照与关联（要求④）：跨抓包 SIP 事务匹配 + 手动时间校准 + Replaces/Join/Refer-To 证据

/**
 * 匹配两个抓包中的同一 SIP 事务。
 * 返回 pairs: [{ callId, offsetUs, matchedMsgs, confidence }]
 */
function matchTransactions(msgsA, msgsB) {
  const byCall = (msgs) => {
    const map = new Map();
    for (const m of msgs) {
      if (!map.has(m.callId)) map.set(m.callId, []);
      map.get(m.callId).push(m);
    }
    return map;
  };
  const callsA = byCall(msgsA);
  const callsB = byCall(msgsB);
  const pairs = [];
  for (const [callId, listB] of callsB) {
    const listA = callsA.get(callId);
    if (!listA || !listA.length) continue;
    const key = (m) => `${m.method || m.kind}|${m.cseq}`;
    const mapA = new Map();
    for (const m of listA) { const k = key(m); if (!mapA.has(k)) mapA.set(k, m); }
    let sumDelta = 0, n = 0;
    for (const m of listB) {
      const a = mapA.get(key(m));
      if (a) { sumDelta += a.tsUs - m.tsUs; n++; }
    }
    if (n > 0) {
      pairs.push({
        callId,
        offsetUs: Math.round(sumDelta / n),
        matchedMsgs: n,
        confidence: n >= 8 ? 'high' : (n >= 3 ? 'medium' : 'low')
      });
    }
  }
  return pairs;
}

/** Replaces / Join / Refer-To 证据提取 */
function extractTransfers(calls) {
  const evs = [];
  const callIdMap = new Map(calls.map(c => [c.callId, c]));
  for (const c of calls) {
    for (const m of c.msgs) {
      for (const field of ['replaces', 'join', 'referTo']) {
        const ref = m[field];
        if (ref && ref.callId) {
          evs.push({
            type: field.toUpperCase(),
            tsUs: m.tsUs,
            fromCallId: c.callId,
            targetCallId: ref.callId,
            uri: ref.uri,
            targetCall: callIdMap.get(ref.callId) || null,
            candidates: findCandidates(calls, ref.callId, m.tsUs)
          });
        }
      }
    }
  }
  return evs;
}

/** 时间就近候选 */
function findCandidates(calls, callId, tsUs) {
  const direct = calls.filter(c => c.callId === callId);
  if (direct.length) {
    return direct.map(c => ({ callId: c.callId, tStart: c.firstUs, tEnd: c.lastUs, exact: true }));
  }
  return calls
    .filter(c => c.firstUs - 2e6 <= tsUs && c.lastUs + 2e6 >= tsUs)
    .sort((a, b) => Math.abs(a.firstUs - tsUs) - Math.abs(b.firstUs - tsUs))
    .slice(0, 5)
    .map(c => ({ callId: c.callId, tStart: c.firstUs, tEnd: c.lastUs, exact: false }));
}

/** 手动时间校准：给 B 抓包全部消息加 offsetUs */
function applyCalibration(msgsB, offsetUs) {
  return msgsB.map(m => ({ ...m, tsUs: m.tsUs + offsetUs }));
}

module.exports = { matchTransactions, extractTransfers, findCandidates, applyCalibration };
