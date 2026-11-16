// M-Ryuga — 链路层 / 网络层 / 传输层解码（每包零拷贝尽量轻量）

const LINK_ETHERNET = 1;
const LINK_RAW_IP = 101; // LINKTYPE_RAW
const LINK_NULL = 0;    // LINKTYPE_NULL (4-byte family header)
const LINK_LINUX_SLL = 113;
const LINK_LINUX_SLL2 = 276;

function l3Offset(linkType, buf) {
  switch (linkType) {
    case LINK_ETHERNET: {
      if (buf.length < 14) return -1;
      const et = buf.readUInt16BE(12);
      if (et === 0x8100) { // VLAN
        if (buf.length < 18) return -1;
        const et2 = buf.readUInt16BE(16);
        if (et2 === 0x8100 && buf.length >= 22) return 22;
        return 18;
      }
      if (et === 0x88A8) return 18; // QinQ 单层
      return 14;
    }
    case LINK_RAW_IP: return 0;
    case LINK_NULL: return 4;
    case LINK_LINUX_SLL: return 16;
    case LINK_LINUX_SLL2: return 20;
    default: return 14;
  }
}

const PROTO = { ICMP: 1, TCP: 6, UDP: 17 };

/** 解出 { ipVersion, srcIp, dstIp, proto, l4Off, sport, dport, tcpSeq, tcpFlags, payload } */
function decodePacket(data, linkType) {
  const l3 = l3Offset(linkType, data);
  if (l3 < 0 || data.length < l3 + 1) return null;
  const ver = data[l3] >> 4;
  if (ver !== 4 && ver !== 6) return null;
  if (ver === 4) {
    if (data.length < l3 + 20) return null;
    const ihl = (data[l3] & 0x0f) * 4;
    const proto = data[l3 + 9];
    const srcIp = `${data[l3 + 12]}.${data[l3 + 13]}.${data[l3 + 14]}.${data[l3 + 15]}`;
    const dstIp = `${data[l3 + 16]}.${data[l3 + 17]}.${data[l3 + 18]}.${data[l3 + 19]}`;
    const l4 = l3 + ihl;
    return l4Info(data, l4, proto, srcIp, dstIp, ver);
  }
  // IPv6
  if (data.length < l3 + 40) return null;
  const proto = data[l3 + 6];
  const parts = [];
  for (let i = 0; i < 8; i++) parts.push(data.slice(l3 + 8 + i * 2, l3 + 8 + i * 2 + 2).toString('hex'));
  // IPv6 展示压缩
  const srcIp = compressV6(parts.map(h => h.match(/../g).join('')).join(':'));
  const dparts = [];
  for (let i = 0; i < 8; i++) dparts.push(data.slice(l3 + 24 + i * 2, l3 + 24 + i * 2 + 2).toString('hex'));
  const dstIp = compressV6(dparts.map(h => h.match(/../g).join('')).join(':'));
  return l4Info(data, l3 + 40, proto, srcIp, dstIp, ver);
}

function compressV6(addr) {
  const groups = addr.split(':');
  let bestStart = -1, bestLen = 0, curStart = -1, curLen = 0;
  groups.forEach((g, i) => {
    if (g === '0') { if (curStart < 0) curStart = i; curLen++; if (curLen > bestLen) { bestLen = curLen; bestStart = curStart; } }
    else { curStart = -1; curLen = 0; }
  });
  if (bestLen > 1) {
    return groups.slice(0, bestStart).join(':') + '::' + groups.slice(bestStart + bestLen).join(':');
  }
  return addr;
}

function l4Info(data, l4, proto, srcIp, dstIp, ver) {
  if (l4 < 0 || data.length < l4) return null;
  if (proto === PROTO.UDP) {
    if (data.length < l4 + 8) return null;
    return {
      ipVersion: ver, srcIp, dstIp, proto: 'UDP',
      sport: data.readUInt16BE(l4), dport: data.readUInt16BE(l4 + 2),
      payload: data.slice(l4 + 8), udpLen: data.readUInt16BE(l4 + 4)
    };
  }
  if (proto === PROTO.TCP) {
    if (data.length < l4 + 20) return null;
    const doff = (data[l4 + 12] >> 4) * 4;
    const flags = data[l4 + 13];
    return {
      ipVersion: ver, srcIp, dstIp, proto: 'TCP',
      sport: data.readUInt16BE(l4), dport: data.readUInt16BE(l4 + 2),
      tcpSeq: data.readUInt32BE(l4 + 4),
      tcpSyn: !!(flags & 0x02), tcpFin: !!(flags & 0x01), tcpRst: !!(flags & 0x04),
      tcpPsh: !!(flags & 0x08), tcpAck: !!(flags & 0x10),
      payload: data.slice(l4 + doff)
    };
  }
  return { ipVersion: ver, srcIp, dstIp, proto: `p${proto}`, payload: data.slice(l4) };
}

module.exports = { decodePacket, LINK_ETHERNET, LINK_RAW_IP, LINK_NULL, LINK_LINUX_SLL, LINK_LINUX_SLL2 };
