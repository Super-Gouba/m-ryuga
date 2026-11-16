// M-Ryuga — RTP/RTCP 解析

const PAYLOAD_STATIC = {
  0: { name: 'PCMU', clock: 8000, ch: 1 },
  3: { name: 'GSM', clock: 8000, ch: 1 },
  4: { name: 'G723', clock: 8000, ch: 1 },
  8: { name: 'PCMA', clock: 8000, ch: 1 },
  9: { name: 'G722', clock: 8000, ch: 1 }, // 注意：G.722 RTP clock 按 RFC 是 8000，采样实际 16k
  18: { name: 'G729', clock: 8000, ch: 1 }
};

/** 解析 RTP 头 */
function parseRtp(payload) {
  if (!payload || payload.length < 12) return null;
  const b0 = payload[0];
  const version = b0 >> 6;
  if (version !== 2) return null;
  const padding = !!(b0 & 0x20);
  const ext = !!(b0 & 0x10);
  const csrc = b0 & 0x0f;
  const b1 = payload[1];
  const marker = !!(b1 & 0x80);
  const pt = b1 & 0x7f;
  const seq = payload.readUInt16BE(2);
  const ts = payload.readUInt32BE(4);
  const ssrc = payload.readUInt32BE(8);
  let off = 12 + csrc * 4;
  if (ext) {
    if (payload.length < off + 4) return null;
    const extLen = payload.readUInt16BE(off + 2) * 4;
    off += 4 + extLen;
  }
  if (off > payload.length) return null;
  let data = payload.slice(off);
  if (padding && data.length > 0) {
    const pad = data[data.length - 1];
    if (pad > 0 && pad <= data.length) data = data.slice(0, data.length - pad);
  }
  return { version, marker, pt, seq, ts, ssrc, data, payloadLen: data.length, headerLen: off };
}

/** 解析 RTCP（SR/RR 简版） */
function parseRtcp(payload) {
  if (!payload || payload.length < 4) return null;
  const pt = payload[1];
  if (pt === 200 && payload.length >= 28) {
    return { type: 'SR', ssrc: payload.readUInt32BE(4), ntpSec: payload.readUInt32BE(8), ntpFrac: payload.readUInt32BE(12), rtpTs: payload.readUInt32BE(16), pkts: payload.readUInt32BE(20), octets: payload.readUInt32BE(24) };
  }
  if (pt === 201) return { type: 'RR', ssrc: payload.readUInt32BE(4) };
  if (pt === 203) return { type: 'BYE', ssrc: payload.length >= 8 ? payload.readUInt32BE(4) : 0 };
  return { type: 'RTCP' + pt };
}

/** 流键（同方向 RTP 流） */
function flowKey({ srcIp, sport, dstIp, dport }) { return `${srcIp}:${sport}>${dstIp}:${dport}`; }

/** 静态 pt 名称 */
function staticPtName(pt) { return PAYLOAD_STATIC[pt]?.name || null; }

module.exports = { parseRtp, parseRtcp, flowKey, PAYLOAD_STATIC };
