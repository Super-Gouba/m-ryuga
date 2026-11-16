// M-Ryuga — 流式 pcap / pcapng 读取器（支持 1 GiB 大文件，不整载内存）
// 用法: for await (const { tsUs, data, ifaceId, link } of readCapture(filePath, { signal })) { ... }

const fs = require('fs');

const CHUNK = 8 * 1024 * 1024;

function isPcapMagic(m) {
  return m === 0xa1b2c3d4 || m === 0xd4c3b2a1 || m === 0xa1b23c4d || m === 0x4d3cb2a1;
}

/** 解析 PCAPNG 选项区 */
function parsePcapngOptions(buf, start, end) {
  const opts = {};
  let o = start;
  while (o + 4 <= end) {
    const code = buf.readUInt16LE(o); o += 2;
    const len = buf.readUInt16LE(o); o += 2;
    if (code === 0) break;
    if (o + len > end) break;
    if (code === 9 && len >= 1) { // if_tsresol
      const r = buf[o];
      opts.tsresol = (r & 0x80) ? Math.pow(2, r & 0x7f) : Math.pow(10, r & 0x7f);
    } else if (code === 2 && len >= 1) { // if_name
      opts.name = buf.slice(o, o + len).toString('utf8').replace(/\0+$/, '');
    } else if (code === 11 && len >= 8) { // if_hardware
      opts.hw = buf.slice(o, o + len).toString('utf8').replace(/\0+$/, '');
    }
    o += len;
    o += (4 - (o % 4)) % 4;
  }
  return opts;
}

async function* readPcapng(fh, signal) {
  const buf = Buffer.allocUnsafe(CHUNK);
  let bufStart = 0, bufEnd = 0, pos = 0;
  let littleEndian = true;
  let ifaces = [];

  const readMore = async () => {
    if (bufStart > 0) {
      buf.copy(buf, 0, bufStart, bufEnd);
      bufEnd -= bufStart; bufStart = 0;
    }
    if (bufEnd === CHUNK) return false;
    const { bytesRead } = await fh.read(buf, bufEnd, CHUNK - bufEnd, pos);
    pos += bytesRead; bufEnd += bytesRead;
    return bytesRead > 0;
  };

  while (true) {
    if (signal?.aborted) return;
    while (bufEnd - bufStart < 12) { if (!(await readMore())) return; }
    const p = bufStart;
    let bt = buf.readUInt32LE(p);
    if (bt !== 0x0A0D0D0A) {
      // 首块必须是 SHB；若读到别的内容则按当前字节序尝试
      bt = buf.readUInt32BE(p);
      if (bt === 0x0A0D0D0A) littleEndian = false;
    }
    const rd32 = (o) => littleEndian ? buf.readUInt32LE(o) : buf.readUInt32BE(o);

    if (bt === 0x0A0D0D0A) { // SHB
      const blen = rd32(p + 4);
      if (blen < 28 || blen > CHUNK) return;
      while (bufEnd - bufStart < blen) { if (!(await readMore())) return; }
      const bom = buf.readUInt32BE(p + 8);
      littleEndian = bom === 0x1A2B3C4D;
      bufStart += blen;
      continue;
    }
    const blen = rd32(p + 4);
    if (blen < 12 || blen > CHUNK) return;

    if (bt === 0x00000001) { // IDB
      while (bufEnd - bufStart < blen) { if (!(await readMore())) return; }
      const linkType = buf.readUInt16LE(p + 8) | (buf.readUInt16LE(p + 10) << 16);
      const opts = parsePcapngOptions(buf, p + 12, p + blen - 4);
      ifaces.push({ link: linkType, name: opts.name || `if${ifaces.length}`, tsresol: opts.tsresol || 1e6 });
      bufStart += blen;
      continue;
    }
    if (bt === 0x00000006) { // EPB
      while (bufEnd - bufStart < blen) { if (!(await readMore())) return; }
      const ifaceId = rd32(p + 8);
      const tsHigh = rd32(p + 12), tsLow = rd32(p + 16);
      const capLen = rd32(p + 20);
      const iface = ifaces[Math.min(ifaceId, ifaces.length - 1)] || { tsresol: 1e6, link: 1 };
      const tsUs = (tsHigh * 4294967296 + tsLow) / iface.tsresol * 1e6;
      const pktOff = p + 28;
      const data = Buffer.from(buf.slice(pktOff, Math.min(pktOff + capLen, p + blen - 4)));
      yield { tsUs, data, ifaceId, link: iface.link, ifaceName: iface.name };
      bufStart += blen;
      continue;
    }
    if (bt === 0x00000003) { // SPB
      while (bufEnd - bufStart < blen) { if (!(await readMore())) return; }
      const origLen = rd32(p + 8);
      const data = Buffer.from(buf.slice(p + 12, p + blen - 4));
      yield { tsUs: 0, data, ifaceId: 0, link: 1, ifaceName: ifaces[0]?.name || 'if0' };
      bufStart += blen;
      continue;
    }
    // 其他块（NRB/ISB/DHB等）：跳过
    while (bufEnd - bufStart < blen) { if (!(await readMore())) return; }
    bufStart += blen;
  }
}

async function* readPcap(fh, signal) {
  const buf = Buffer.allocUnsafe(CHUNK);
  let bufStart = 0, bufEnd = 0, pos = 0;
  let littleEndian = true, nano = false, link = 1;

  const readMore = async () => {
    if (bufStart > 0) {
      buf.copy(buf, 0, bufStart, bufEnd);
      bufEnd -= bufStart; bufStart = 0;
    }
    if (bufEnd === CHUNK) return false;
    const { bytesRead } = await fh.read(buf, bufEnd, CHUNK - bufEnd, pos);
    pos += bytesRead; bufEnd += bytesRead;
    return bytesRead > 0;
  };

  while (bufEnd - bufStart < 24) { if (!(await readMore())) return; }
  const magic = buf.readUInt32LE(0);
  if (magic === 0xa1b2c3d4) { littleEndian = true; nano = false; }
  else if (magic === 0xd4c3b2a1) { littleEndian = false; nano = false; }
  else if (magic === 0xa1b23c4d) { littleEndian = true; nano = true; }
  else if (magic === 0x4d3cb2a1) { littleEndian = false; nano = true; }
  else return;
  link = littleEndian ? buf.readUInt16LE(20) : buf.readUInt16BE(20);
  bufStart = 24;

  const rd32 = (o) => littleEndian ? buf.readUInt32LE(o) : buf.readUInt32BE(o);
  while (true) {
    if (signal?.aborted) return;
    while (bufEnd - bufStart < 16) { if (!(await readMore())) return; }
    const tsSec = rd32(bufStart);
    let frac = rd32(bufStart + 4);
    if (nano) frac = Math.floor(frac / 1000);
    const capLen = rd32(bufStart + 8);
    if (capLen === 0 || capLen > CHUNK - 64) return; // 损坏保护
    while (bufEnd - bufStart < 16 + capLen) {
      if (!(await readMore())) { if (bufEnd - bufStart < 16 + capLen) return; break; }
    }
    const data = Buffer.from(buf.slice(bufStart + 16, bufStart + 16 + Math.min(capLen, bufEnd - bufStart - 16)));
    yield { tsUs: tsSec * 1e6 + frac, data, ifaceId: 0, link, ifaceName: 'eth0' };
    bufStart += 16 + capLen;
    if (bufStart >= bufEnd && !data.length) return;
  }
}

/** 统一入口：按 magic 自动分派 */
async function* readCapture(filePath, signal) {
  const fh = await fs.promises.open(filePath, 'r');
  try {
    const head = Buffer.alloc(4);
    await fh.read(head, 0, 4, 0);
    const m = head.readUInt32LE(0);
    if (m === 0x0A0D0D0A) yield* readPcapng(fh, signal);
    else if (isPcapMagic(m)) yield* readPcap(fh, signal);
    else throw new Error('不是有效的 PCAP / PCAPNG 文件');
  } finally {
    await fh.close().catch(() => {});
  }
}

/** 格式嗅探 */
async function sniffFormat(filePath) {
  let fh;
  try {
    fh = await fs.promises.open(filePath, 'r');
    const head = Buffer.alloc(4);
    await fh.read(head, 0, 4, 0);
    const le = head.readUInt32LE(0);
    if (le === 0x0A0D0D0A) return { ok: true, format: 'pcapng' };
    if (isPcapMagic(le)) return { ok: true, format: 'pcap' };
    return { ok: false, error: '不是有效的 PCAP / PCAPNG 文件' };
  } catch (e) {
    return { ok: false, error: String(e.message || e) };
  } finally { if (fh) await fh.close().catch(() => {}); }
}

module.exports = { readCapture, sniffFormat, CHUNK };
