// M-Ryuga — 核心解析自测：构造合成 pcap（SIP 信令 + G.711u RTP + RFC2833 DTMF）
// 覆盖：pcap 读取 / 以太网-IP-UDP / SIP 解析 / RTP 解析 / 通话聚合 / 体检 / 媒体装配 / WAV / 流序图 / 对照
// 用法：npm run test
const fs = require('fs');
const path = require('path');
const os = require('os');

let pass = 0, fail = 0;
function ok(cond, name) {
  if (cond) { pass++; console.log(`  ✔ ${name}`); }
  else { fail++; console.error(`  ✘ ${name}`); }
}

/* ---------- 以太网/IP/UDP 帧构造 ---------- */
const MAC_A = [0x00, 0x11, 0x22, 0x33, 0x44, 0x55], MAC_B = [0x66, 0x77, 0x88, 0x99, 0xaa, 0xbb];
function ipv4(s) { return s.split('.').map(Number); }
function udpSum(b, off, len) { b[off + 6] = 0; b[off + 7] = 0; } // 校验和置 0（UDP over IPv4 允许）
function ethPkt(srcIp, sport, dstIp, dport, payload, tsUs) {
  const udpLen = 8 + payload.length;
  const ipLen = 20 + udpLen;
  const eth = Buffer.alloc(14);
  Buffer.from(MAC_A).copy(eth, 0); Buffer.from(MAC_B).copy(eth, 6);
  eth[12] = 0x08; eth[13] = 0x00;
  const ip = Buffer.alloc(20);
  ip[0] = 0x45; ip[1] = 0; ip.writeUInt16BE(ipLen, 2); ip[3] = 0;
  ip[4] = 0; ip[5] = 0x40; ip[6] = 0; ip[7] = 0; ip[8] = 64; ip[9] = 17;
  Buffer.from(ipv4(srcIp)).copy(ip, 12); Buffer.from(ipv4(dstIp)).copy(ip, 16);
  const udp = Buffer.alloc(8);
  udp.writeUInt16BE(sport, 0); udp.writeUInt16BE(dport, 2);
  udp.writeUInt16BE(udpLen, 4); udpSum(udp, 0, udpLen);
  const frame = Buffer.concat([eth, ip, udp, Buffer.from(payload)]);
  return { frame, tsUs };
}

/* ---------- SIP 报文 ---------- */
function sipMsg(methodOrStatus, headers, body = '', opts = {}) {
  const isReq = typeof methodOrStatus === 'string';
  const first = isReq
    ? `${methodOrStatus} sip:${opts.user || '1002'}@10.0.0.2 SIP/2.0`
    : `SIP/2.0 ${methodOrStatus}`;
  const h = {
    'Via': 'SIP/2.0/UDP 10.0.0.1:5060;branch=z9hG4bK' + (opts.branch || 'abc123'),
    'From': `<sip:${opts.from || '1001'}@pbx.local>;tag=${opts.ftag || 'tA1'}`,
    'To': `<sip:${opts.user || '1002'}@pbx.local>${opts.ttag ? `;tag=${opts.ttag}` : ''}`,
    'Call-ID': opts.callId,
    'CSeq': `${opts.cseq || 1} ${isReq ? methodOrStatus : opts.ackFor || 'INVITE'}`,
    'Content-Length': String(body.length),
    ...headers
  };
  const lines = [first, ...Object.entries(h).filter(([, v]) => v != null).map(([k, v]) => `${k}: ${v}`), '', body];
  return lines.join('\r\n');
}

const SDP_A = (ip, port, codec = 0) =>
  `v=0\r\no=- 1 1 IN IP4 ${ip}\r\ns=M-Ryuga test\r\nc=IN IP4 ${ip}\r\nt=0 0\r\nm=audio ${port} RTP/AVP ${codec} 101\r\na=rtpmap:0 PCMU/8000\r\na=rtpmap:101 telephone-event/8000\r\na=ptime:20\r\na=sendrecv\r\n`;

const CALL_ID = 'selftest-call-0001@pbx.local';

/* ---------- RTP 构造 ---------- */
let seq = 100, tsBase = 160;
function rtpPacket(pt, samples, payload) {
  const h = Buffer.alloc(12);
  h[0] = 0x80; h[1] = pt;
  h.writeUInt16BE(seq++ & 0xFFFF, 2);
  h.writeUInt32BE(tsBase, 4); tsBase += samples;
  h.writeUInt32BE(0x11223344, 8);
  return Buffer.concat([h, Buffer.from(payload)]);
}
function silencePayload(n) { return Buffer.alloc(n, 0x7f); } // μ律静音近似
function sinePayload(nSamples) { // 简易正弦 → μ律（快速近似编码）
  const out = Buffer.alloc(nSamples);
  for (let i = 0; i < nSamples; i++) {
    const s = Math.round(Math.sin(i / 8000 * 2 * Math.PI * 440) * 8000); // 440Hz
    // μ律编码（标准算法简化版）
    const sign = s < 0 ? 0x80 : 0x00;
    const a = Math.min(32767, Math.abs(s));
    let e = 7;
    const mask = 0x4000;
    while (e > 0 && !(a & mask >> (7 - e))) e--;
    e = Math.max(0, e);
    const m = (a >> (e === 0 ? 1 : e)) & 0x0F;
    out[i] = ~(sign | (e << 4) | m) & 0xFF;
  }
  return out;
}

/* ---------- 组装 pcap 文件 ---------- */
function buildPcap(pkts) { // pkts: [{frame, tsUs}]
  const hdr = Buffer.alloc(24);
  hdr.writeUInt32LE(0xa1b2c3d4, 0); hdr.writeUInt16LE(2, 4); hdr.writeUInt16LE(4, 6);
  hdr.writeInt32LE(0, 8); hdr.writeUInt32LE(0, 12); hdr.writeInt32LE(0xFFFF, 16); hdr.writeUInt32LE(1, 20);
  const blocks = [hdr];
  for (const p of pkts) {
    const rec = Buffer.alloc(16);
    const sec = Math.floor(p.tsUs / 1e6), usec = p.tsUs % 1e6;
    rec.writeUInt32LE(sec, 0); rec.writeUInt32LE(usec, 4);
    rec.writeUInt32LE(p.frame.length, 8); rec.writeUInt32LE(p.frame.length, 12);
    blocks.push(rec, p.frame);
  }
  return Buffer.concat(blocks);
}

const T0 = 1763000000; // 固定基准秒
const pkts = [];
let usOff = 0;
function push(srcIp, sport, dstIp, dport, payload) {
  pkts.push(ethPkt(srcIp, sport, dstIp, dport, payload, (T0 + Math.floor(usOff / 1e6)) * 1e6 + usOff % 1e6));
}

// 1) INVITE（A→B）
push('10.0.0.1', 5060, '10.0.0.2', 5060, sipMsg('INVITE', { 'Content-Type': 'application/sdp' }, SDP_A('10.0.0.1', 10000), { callId: CALL_ID, cseq: 101, user: '1002' })); usOff += 0.1e6;
// 2) 100 Trying
push('10.0.0.2', 5060, '10.0.0.1', 5060, sipMsg(100, {}, '', { callId: CALL_ID, cseq: 101, user: '1002' })); usOff += 0.1e6;
// 3) 180 Ringing（响铃 2.5s）
push('10.0.0.2', 5060, '10.0.0.1', 5060, sipMsg(180, {}, '', { callId: CALL_ID, cseq: 101, user: '1002' }));
usOff += 2.5e6;
// 4) 200 OK（B→A，带 SDP）
push('10.0.0.2', 5060, '10.0.0.1', 5060, sipMsg(200, { 'Content-Type': 'application/sdp' }, SDP_A('10.0.0.2', 20000), { callId: CALL_ID, cseq: 101, user: '1002', ttag: 'tB1' })); usOff += 0.1e6;
// 5) ACK
push('10.0.0.1', 5060, '10.0.0.2', 5060, sipMsg('ACK', {}, '', { callId: CALL_ID, cseq: 101, user: '1002' }));
const talkStart = usOff;
// 6) RTP：A→B 3 秒 PCMU（150 包 ×20ms）
const rtpPkts = [];
for (let i = 0; i < 150; i++) rtpPkts.push(rtpPacket(0, 160, sinePayload(160)));
for (const r of rtpPkts) { push('10.0.0.1', 10000, '10.0.0.2', 20000, r); usOff += 20000; }
// 7) RTP 2833 DTMF "5"（pt=101，3 个包：begin / 中间 / end）
function dtmf2833(digit, endFlag, dur, seqn, ts) {
  const h = Buffer.alloc(12); h[0] = 0x80; h[1] = 101;
  h.writeUInt16BE(seqn & 0xFFFF, 2); h.writeUInt32BE(ts, 4); h.writeUInt32BE(0x11223344, 8);
  const ev = Buffer.alloc(4); ev[0] = digit; ev[1] = 0x0A; ev[2] = 0; ev[3] = 0;
  ev.writeUInt16BE(dur, 2);
  if (endFlag) ev[1] |= 0x80;
  return Buffer.concat([h, ev]);
}
push('10.0.0.1', 10000, '10.0.0.2', 20000, dtmf2833(5, false, 160, seq++, tsBase));
usOff += 20000;
push('10.0.0.1', 10000, '10.0.0.2', 20000, dtmf2833(5, true, 320, seq++, tsBase + 160));
usOff += 0.5e6;
// 8) SIP INFO DTMF（带内对比）
push('10.0.0.1', 5060, '10.0.0.2', 5060, sipMsg('INFO', { 'Content-Type': 'application/dtmf-relay' }, 'Signal=8\r\nDuration=160\r\n', { callId: CALL_ID, cseq: 102, user: '1002' }));
// 9) B→A 反向 RTP 2 秒
for (let i = 0; i < 100; i++) {
  const h = Buffer.alloc(12); h[0] = 0x80; h[1] = 0;
  h.writeUInt16BE(200 + i, 2); h.writeUInt32BE(5000 + i * 160, 4); h.writeUInt32BE(0xaabbccdd, 8);
  push('10.0.0.2', 20000, '10.0.0.1', 10000, Buffer.concat([h, silencePayload(160)]));
  usOff += 20000;
}
const talkEnd = usOff;
// 10) BYE + 200
usOff += 0.2e6;
push('10.0.0.2', 5060, '10.0.0.1', 5060, sipMsg('BYE', {}, '', { callId: CALL_ID, cseq: 103, user: '1002', ttag: 'tB1' })); usOff += 0.1e6;
push('10.0.0.1', 5060, '10.0.0.2', 5060, sipMsg(200, {}, '', { callId: CALL_ID, cseq: 103, user: '1002', ackFor: 'BYE', ttag: 'tB1' }));

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mryuga-test-'));
const pcapFile = path.join(tmp, 'selftest.pcap');
fs.writeFileSync(pcapFile, buildPcap(pkts));
console.log(`合成抓包：${pkts.length} 包 → ${pcapFile}`);

/* ---------- 测试 1：pcap 读取 ---------- */
(async () => {
  console.log('\n[1] pcap 读取');
  const { readCapture, sniffFormat } = require('../src/core/pcap/reader');
  const fmt = await sniffFormat(pcapFile);
  ok(fmt && fmt.format === 'pcap', `sniffFormat → ${fmt?.format}`);
  const all = [];
  for await (const p of readCapture(pcapFile)) all.push(p);
  ok(all.length === pkts.length, `读取包数 ${all.length} === ${pkts.length}`);
  ok(all[0].tsUs > 1e12, `时间戳微秒级 ${all[0].tsUs}`);

  /* ---------- 测试 2：SIP/RTP 解码 ---------- */
  console.log('\n[2] 报文解码');
  const { decodePacket } = require('../src/core/pcap/packets');
  const d0 = decodePacket(all[0].data, all[0].link);
  ok(d0 && d0.proto === 'UDP' && d0.srcIp === '10.0.0.1' && d0.sport === 5060 && d0.dport === 5060, `UDP 5060→5060（${d0?.srcIp}→${d0?.dstIp} proto=${d0?.proto}）`);
  const { parseSip } = require('../src/core/sip/parser');
  const s0 = parseSip(d0.payload.toString('binary'), { srcIp: d0.srcIp, sport: d0.sport, dstIp: d0.dstIp, dport: d0.dport });
  ok(s0 && s0.kind === 'request' && s0.method === 'INVITE' && s0.callId === CALL_ID, `SIP INVITE 解析 callId`);
  ok(s0.sdp && s0.sdp.media?.[0]?.port === 10000, `SDP 媒体端口 10000`);

  /* ---------- 测试 3：通话聚合 ---------- */
  console.log('\n[3] 通话聚合与体检');
  const { analyzeFile, analyzeMedia, callLadder } = require('../src/core/analysis/pipeline');
  const analyzed = await analyzeFile(pcapFile, null, null);
  ok(analyzed.calls.length === 1, `通话数 ${analyzed.calls.length} === 1`);
  const c = analyzed.calls[0];
  ok(c.callId === CALL_ID, `Call-ID 匹配`);
  ok(c.summary.fromUser === '1001' || c.summary.fromUser === '1002', `主叫解析 ${c.summary.fromUser}`);
  console.log('  summary:', JSON.stringify(c.summary));

  /* ---------- 测试 4：体检 ---------- */
  console.log('\n[4] 体检');
  const dg = analyzed.calls[0].diag;
  ok(dg.tStart > 0 && dg.tEnd > dg.tStart, `开始/结束时间 tStart=${dg.tStart} tEnd=${dg.tEnd}`);
  ok(dg.ended && (dg.endBy === 'A' || dg.endBy === 'B'), `结束方 endBy=${dg.endBy} endMethod=${dg.endMethod}`);
  ok(Array.isArray(dg.signalingIssues) && Array.isArray(dg.mediaIssues), `体检证据列表齐备（信令 ${dg.signalingIssues.length} / 媒体 ${dg.mediaIssues.length}）`);
  console.log('  diag:', JSON.stringify({ tConnect: dg.tConnect, durationSec: dg.durationSec, endBy: dg.endBy, codecs: dg.codecs }));

  /* ---------- 测试 5：媒体装配 ---------- */
  console.log('\n[5] 媒体装配');
  const media = await analyzeMedia(analyzed, CALL_ID, null, null);
  const a = media.streams.a, b = media.streams.b;
  ok(a && a.pcm && a.pcm.length > 8000, `A 方向 PCM ${(a?.pcm?.length || 0) / 8000 | 0}s`);
  ok(b && b.pcm && b.pcm.length > 5000, `B 方向 PCM ${(b?.pcm?.length || 0) / 8000 | 0}s`);
  ok(media.dtmf.length >= 2, `DTMF 事件 ≥2（2833 '5' + INFO '8'）实际 ${media.dtmf.length}`);
  console.log('  DTMF:', media.dtmf.map(d => `${d.digit}(${d.via})`).join(' '));
  const { encodeWav } = require('../src/core/media/assembler');
  const wav = encodeWav(a.pcm, 8000);
  ok(wav.length > 44 && wav.slice(0, 4).toString() === 'RIFF', `WAV 头 ${wav.length}B`);

  /* ---------- 测试 6：流序图 ---------- */
  console.log('\n[6] 流序图');
  const ladder = callLadder(analyzed, CALL_ID);
  ok(ladder && ladder.msgs?.length >= 8, `流序图报文 ${ladder?.msgs?.length} 条`);
  ok(ladder && ladder.actors?.length >= 2, `参与者 ${ladder?.actors?.length}`);

  /* ---------- 测试 7：解码器注册表 ---------- */
  console.log('\n[7] 解码器注册表');
  const { getDecoder, DECODERS } = require('../src/core/media/decoders');
  const g711 = getDecoder('pcmu');
  ok(g711 && g711.available, `PCMU 可用`);
  const pcm = g711.decode(sinePayload(160));
  ok(pcm.length === 160 && Math.abs(pcm[80]) > 1000, `G.711u 解码非静音样本`);
  ok(DECODERS.G729.available === false, `G.729 wasm 槽优雅降级`);

  /* ---------- 测试 8：导出 ---------- */
  console.log('\n[8] 导出');
  const { runExport } = require('../src/core/export/exporter');
  const outDir = path.join(tmp, 'out');
  fs.mkdirSync(outDir, { recursive: true });
  const results = await runExport(analyzed, CALL_ID, [
    { type: 'pcapng', outPath: path.join(outDir, 'x.pcapng') },
    { type: 'wav', outPath: outDir },
    { type: 'report', outPath: path.join(outDir, 'r.html') }
  ], { maskUser: true, maskIp: false }, null, null);
  ok(results.every(r => r.ok), `导出全部成功 ${results.map(r => r.type).join('/')}`);
  ok(fs.existsSync(path.join(outDir, 'r.html')), `HTML 报告存在`);

  console.log(`\n========== 结果：${pass} 通过 / ${fail} 失败 ==========`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
