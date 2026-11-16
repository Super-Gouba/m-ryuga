// M-Ryuga — 导出中心（要求③）：原始关联 PCAPNG、分方向 WAV、HTML 报告
// 单项失败后继续导出其余内容并列出结果；号码 / IP 分别可选遮蔽

const fs = require('fs');
const path = require('path');
const { assembleStream, encodeWav } = require('../media/assembler');
const { fmtT } = require('../analysis/diagnose');
const { analyzeMedia } = require('../analysis/pipeline');

/** 遮蔽工具：号码遮蔽（保留后 4 位）、IP 遮蔽（保留前 2 段） */
function maskUser(u, on) {
  if (!on || !u) return u;
  const s = String(u);
  if (s.length <= 4) return '****';
  return '*'.repeat(Math.max(0, s.length - 4)) + s.slice(-4);
}
function maskIp(ip, on) {
  if (!on || !ip) return ip;
  const parts = String(ip).split('.');
  if (parts.length !== 4) return ip;
  return `${parts[0]}.${parts[1]}.*.*`;
}

/**
 * 导出单项执行器。items: [{ type: 'pcapng'|'wav'|'report', ... }]
 * 返回 results: [{ type, file, ok, error }]
 */
async function runExport(analyzed, callId, items, opts, onItem, signal) {
  const results = [];
  for (const item of items) {
    if (signal?.aborted) break;
    try {
      let file = null;
      if (item.type === 'pcapng') file = await exportPcapng(analyzed, callId, item.outPath, signal);
      else if (item.type === 'wav') file = await exportWavs(analyzed, callId, item.outPath, opts, signal);
      else if (item.type === 'report') file = await exportReport(analyzed, callId, item.outPath, opts, signal);
      results.push({ type: item.type, file, ok: true });
    } catch (e) {
      results.push({ type: item.type, file: null, ok: false, error: String(e.message || e) });
    }
    onItem?.(results[results.length - 1], results.length, items.length);
  }
  return results;
}

/** 切出与通话关联的原始报文为 PCAPNG（按 callId 的 SIP + RTP 5 元组过滤） */
async function exportPcapng(analyzed, callId, outPath, signal) {
  const msgs = analyzed.sipMsgs.filter(m => m.callId === callId);
  const flows = analyzed.rtpStreams.filter(s => s.callId === callId).map(s => s.key);
  const flowSet = new Set(flows);
  // 反向流键（B→A）
  for (const f of flows) {
    const m = f.match(/^([^:]+):(\d+)>([^:]+):(\d+)$/);
    if (m) flowSet.add(`${m[3]}:${m[4]}>${m[1]}:${m[2]}`);
  }
  const sipFlows = new Set(msgs.map(m => `${m.src}|${m.dst}`));
  const { readCapture } = require('../pcap/reader');
  const { decodePacket } = require('../pcap/packets');

  // PCAPNG 写出（EPB 块，简化 SHB+IDB）
  const blocks = [];
  // SHB
  const shb = Buffer.alloc(28);
  shb.writeUInt32LE(0x0A0D0D0A, 0); shb.writeUInt32LE(28, 4);
  shb.writeUInt32BE(0x1A2B3C4D, 8); shb.writeUInt32LE(0xFFFFFFFF, 12); shb.writeUInt32LE(0xFFFFFFFF, 16);
  shb.writeUInt32LE(28, 20); shb.writeUInt32LE(0x0A0D0D0A, 24);
  blocks.push(shb);
  // IDB（Ethernet）— 20 字节：type/len/linktype/reserved/snaplen/len
  const idb = Buffer.alloc(20);
  idb.writeUInt32LE(0x00000001, 0);  // block type
  idb.writeUInt32LE(20, 4);          // total length
  idb.writeUInt16LE(1, 8);           // linktype = Ethernet
  idb.writeUInt16LE(0, 10);          // reserved
  idb.writeUInt32LE(0x40000, 12);    // snaplen 256KiB
  idb.writeUInt32LE(20, 16);         // total length (trailer)
  blocks.push(idb);

  let count = 0, t0 = null, t1 = null;
  for await (const pkt of readCapture(analyzed.filePath, signal)) {
    if (signal?.aborted) break;
    const dec = decodePacket(pkt.data, pkt.link);
    if (!dec) continue;
    const key = `${dec.srcIp}:${dec.sport}>${dec.dstIp}:${dec.dport}`;
    const revKey = `${dec.dstIp}:${dec.dport}>${dec.srcIp}:${dec.sport}`;
    const isSip = sipFlows.has(`${dec.srcIp}:${dec.sport}|${dec.dstIp}:${dec.dport}`);
    const isRtp = flowSet.has(key) || flowSet.has(revKey);
    if (!isSip && !isRtp) continue;
    // EPB
    if (t0 === null) t0 = pkt.tsUs;
    t1 = pkt.tsUs;
    const ts = Math.round(pkt.tsUs); // 1e-6 res
    const tsHigh = Math.floor(ts / 4294967296), tsLow = ts >>> 0;
    const capLen = pkt.data.length;
    const pad = (4 - (capLen % 4)) % 4;
    const total = 32 + capLen + pad;
    const blk = Buffer.alloc(total);
    blk.writeUInt32LE(0x00000006, 0); blk.writeUInt32LE(total, 4);
    blk.writeUInt32LE(0, 8); // iface 0
    blk.writeUInt32LE(tsHigh, 12); blk.writeUInt32LE(tsLow, 16);
    blk.writeUInt32LE(capLen, 20); blk.writeUInt32LE(capLen, 24);
    pkt.data.copy(blk, 28);
    blk.writeUInt32LE(total, total - 4);
    blocks.push(blk);
    count++;
    if (blocks.length > 20000) { /* flush later */ }
  }
  const buf = Buffer.concat(blocks);
  await fs.promises.writeFile(outPath, buf);
  return { path: outPath, packets: count, tStart: t0, tEnd: t1 };
}

/** 分方向 WAV 导出：a（主叫→被叫 采集方向）/ b；混合 mono 可选 */
async function exportWavs(analyzed, callId, outDir, opts, signal) {
  await fs.promises.mkdir(outDir, { recursive: true });
  const media = await analyzeMedia(analyzed, callId, null, signal);
  const out = [];
  const base = sanitizeName(callId);
  if (media.streams.a?.pcm) {
    const f = path.join(outDir, `${base}_主叫方向.wav`);
    await fs.promises.writeFile(f, encodeWav(media.streams.a.pcm, media.streams.a.sampleRate));
    out.push(f);
  }
  if (media.streams.b?.pcm) {
    const f = path.join(outDir, `${base}_被叫方向.wav`);
    await fs.promises.writeFile(f, encodeWav(media.streams.b.pcm, media.streams.b.sampleRate));
    out.push(f);
  }
  // 混合（对齐时间）
  const A = media.streams.a, B = media.streams.b;
  if (A?.pcm && B?.pcm) {
    const sr = A.sampleRate;
    const t0 = Math.min(A.firstUs ?? 0, B.firstUs ?? 0);
    const offA = Math.round(((A.firstUs ?? t0) - t0) / 1e6 * sr);
    const offB = Math.round(((B.firstUs ?? t0) - t0) / 1e6 * sr);
    const len = Math.max(offA + A.pcm.length, offB + B.pcm.length);
    const mix = new Int16Array(len);
    for (let i = 0; i < A.pcm.length; i++) {
      const j = offA + i; if (j < len) mix[j] = Math.max(-32768, Math.min(32767, mix[j] + (A.pcm[i] >> 1)));
    }
    for (let i = 0; i < B.pcm.length; i++) {
      const j = offB + i; if (j < len) mix[j] = Math.max(-32768, Math.min(32767, mix[j] + (B.pcm[i] >> 1)));
    }
    const f = path.join(outDir, `${base}_混合.wav`);
    await fs.promises.writeFile(f, encodeWav(mix, sr));
    out.push(f);
  }
  if (!out.length) throw new Error('无可导出音频（编码不支持或无 RTP）');
  return { files: out };
}

/** HTML 报告（自包含单文件） */
async function exportReport(analyzed, callId, outPath, opts, signal) {
  const { diagnoseCall } = require('../analysis/diagnose');
  const call = analyzed.callsRaw?.find(c => c.callId === callId);
  const msgs = analyzed.sipMsgs.filter(m => m.callId === callId).sort((a, b) => a.tsUs - b.tsUs);
  const media = await analyzeMedia(analyzed, callId, null, signal);
  const mU = opts.maskUser, mIp = opts.maskIp;
  const ipM = (s) => maskIp(s, mIp);
  const rows = msgs.map(m => `<tr class="c-${msgClassSafe(m)}"><td>${fmtT(m.tsUs)}</td><td>${ipM(m.src)}</td><td>${ipM(m.dst)}</td><td>${esc(m.startLine)}</td></tr>`).join('');
  const streams = Object.entries(media.streams).map(([slot, s]) =>
    `<div class="stream"><b>${slot === 'a' ? '主叫方向' : '被叫方向'}</b> ${esc(s.codec || '?')} ${s.pcm ? `${(s.pcm.length / s.sampleRate).toFixed(1)}s` : `未解码（${esc(s.unsupported || '')}）`} 丢包/间隔标记 ${s.marks?.length || 0} 处</div>`
  ).join('') || '<div class="stream">无媒体流</div>';
  const dtmfRows = media.dtmf.map(d => `<tr><td>${fmtT(d.startUs)}</td><td>${esc(d.digit)}</td><td>${esc(d.via)}</td><td>${d.durationMs?.toFixed ? d.durationMs.toFixed(0) + 'ms' : '-'}</td></tr>`).join('') || '<tr><td colspan=4>无</td></tr>';
  const html = `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><title>M-Ryuga 通话报告 ${esc(callId)}</title>
<style>
:root{--bg:#0a0e14;--card:#111823;--fg:#dbe4ee;--mut:#6b7a8d;--cy:#22d3ee;--am:#f59e0b;--rd:#ef4444;--gr:#34d399}
*{box-sizing:border-box}body{background:var(--bg);color:var(--fg);font:14px/1.6 'Segoe UI',system-ui;margin:0;padding:40px}
h1{font-size:22px;letter-spacing:.5px}.card{background:var(--card);border:1px solid #1f2937;border-radius:12px;padding:20px;margin:16px 0}
.kv{display:grid;grid-template-columns:140px 1fr;gap:6px 16px}.kv b{color:var(--mut);font-weight:500}
table{width:100%;border-collapse:collapse;font:12px/1.5 Consolas,monospace}th{color:var(--mut);text-align:left;font-weight:500;border-bottom:1px solid #243244;padding:6px}
td{border-bottom:1px solid #182230;padding:5px 6px}.c-ok{color:var(--gr)}.c-inv{color:var(--cy)}.c-bye{color:var(--am)}.c-c4xx{color:#fb923c}.c-c5xx{color:var(--rd)}.c-prov{color:#67e8f9}
.badge{display:inline-block;padding:1px 8px;border-radius:99px;font-size:12px;margin-right:6px}.b-err{background:#3b1113;color:#fca5a5}.b-warn{background:#3a2b10;color:#fcd34d}.b-info{background:#0e2a3b;color:#7dd3fc}
.stream{padding:6px 0;border-bottom:1px dashed #1f2937}
</style></head><body>
<h1>M-Ryuga 通话报告</h1>
<div class="card"><div class="kv">
<b>Call-ID</b><span>${esc(callId)}</span>
<b>主叫</b><span>${esc(maskUser(callId && (msgs[0]?.fromUser || ''), mU))}</span>
<b>被叫</b><span>${esc(maskUser(msgs[0]?.toUser || '', mU))}</span>
<b>开始</b><span>${msgs[0] ? fmtT(msgs[0].tsUs) : '-'}</span>
<b>结束</b><span>${msgs.length ? fmtT(msgs[msgs.length - 1].tsUs) : '-'}</span>
<b>报文数</b><span>${msgs.length}</span>
<b>编码</b><span>${esc([...new Set(analyzed.rtpStreams.filter(s => s.callId === callId).map(s => s.codecName).filter(Boolean))].join(', ') || '-')}</span>
</div></div>
<div class="card"><h3>媒体</h3>${streams}</div>
<div class="card"><h3>DTMF 按键</h3><table><tr><th>时间</th><th>按键</th><th>方式</th><th>时长</th></tr>${dtmfRows}</table></div>
<div class="card"><h3>SIP 报文</h3><table><tr><th>时间</th><th>源</th><th>目的</th><th>首行</th></tr>${rows}</table></div>
<div style="color:var(--mut);font-size:12px">由 M-Ryuga 生成 · ${new Date().toLocaleString('zh-CN')}</div>
</body></html>`;
  await fs.promises.writeFile(outPath, html, 'utf8');
  return { path: outPath };
}

function msgClassSafe(m) {
  if (m.kind === 'request') return m.method === 'INVITE' ? 'inv' : (m.method === 'BYE' || m.method === 'CANCEL' ? 'bye' : 'ok');
  if (m.status >= 500) return 'c5xx';
  if (m.status >= 400) return 'c4xx';
  if (m.status >= 200) return 'ok';
  return 'prov';
}
function esc(s) { return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
function sanitizeName(s) { return String(s).replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 48); }

module.exports = { runExport, maskUser, maskIp };
