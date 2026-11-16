// M-Ryuga — 文件分析管线（worker 内执行）：流式读取 → SIP/RTP 收集 → 聚合 → 可选媒体深度分析
// 要求⑤：单文件至 1 GiB；先通话与 SIP，再后台分析媒体；分阶段进度；可停止；中断抓包处理已写入内容

const { readCapture } = require('../pcap/reader');
const { decodePacket } = require('../pcap/packets');
const { CallAnalyzer } = require('./calls');
const { diagnoseCall, callSummary } = require('./diagnose');
const { assembleStream, encodeWav } = require('../media/assembler');
const { extract2833, extractSipInfoDtmf, detectInbandDtmf, mergeDtmf } = require('../media/dtmf');
const { buildLadder, msgClass } = require('./ladder');
const fs = require('fs');
const path = require('path');

const MAX_FILE = 1024 * 1024 * 1024; // 1 GiB

/**
 * 阶段一：快速分析（通话 + SIP + RTP 概览）。
 * onProgress({ stage, pct, detail })；signal: AbortSignal
 */
async function analyzeFile(filePath, fileId, onProgress, signal) {
  const stat = await fs.promises.stat(filePath);
  if (stat.size > MAX_FILE) throw new Error(`文件超过 1 GiB 上限（${(stat.size / 1048576).toFixed(0)} MiB）`);
  const analyzer = new CallAnalyzer(fileId);
  let lastPct = -1;
  let abortedMidway = false;
  const t0 = Date.now();

  try {
    for await (const pkt of readCapture(filePath, signal)) {
      if (signal?.aborted) { abortedMidway = true; break; }
      const dec = decodePacket(pkt.data, pkt.link);
      if (dec) {
        analyzer.feed(pkt.tsUs, dec, { off: 0, ifaceId: pkt.ifaceId });
      }
      const pct = Math.min(99, Math.round((Date.now() - t0) / 50)); // 无法精确知道总包数，按时间估算展示
      // 用文件读取进度更准确：reader 内部 pos 不可见，这里用 stat.size 与估算吞吐
      if (pct !== lastPct) { lastPct = pct; onProgress?.({ stage: 'parse', pct, detail: `已解析 ${analyzer.stats.totalPkts} 包` }); }
    }
  } catch (e) {
    if (signal?.aborted) abortedMidway = true;
    else if (!/不是有效的/.test(e.message)) throw e;
    // 中断抓包（pcap 尾部不完整）：已解析部分继续有效
    analyzer.truncated = true;
  }
  if (abortedMidway) analyzer.truncated = true;

  // 聚合 + 体检
  onProgress?.({ stage: 'aggregate', pct: 99, detail: '聚合通话' });
  const callsRaw = analyzer.finalize();
  const calls = callsRaw.map(c => {
    const d = diagnoseCall(c, analyzer);
    return { id: `${fileId}:${sanitize(d.callId)}`, callId: d.callId, fileId, summary: callSummary(d), diag: d, raw: c };
  }).sort((a, b) => a.summary.tStart - b.summary.tStart);

  onProgress?.({ stage: 'done', pct: 100, detail: `${calls.length} 通通话` });
  return {
    fileId,
    filePath,
    truncated: !!analyzer.truncated,
    stats: analyzer.stats,
    calls: calls.map(c => ({ id: c.id, callId: c.callId, summary: c.summary, diag: c.diag })),
    sipMsgs: analyzer.sipMsgs,
    rtpStreams: [...analyzer.rtpStreams.values()].map(st => ({
      key: st.key, callId: st.callId, dir: st.dir, codecName: st.codecName, pt: st.pt,
      pktsCount: st.pkts.length, lost: st.lost, outOfOrder: st.outOfOrder, duplicates: st.duplicates,
      jitterMs: st.jitterMs, firstTsUs: st.firstTsUs, lastTsUs: st.lastTsUs, clock: st.clock,
      eventPt: st.eventPt, rtpmaps: st.rtpmaps,
      firstUs: st.firstUs, lastUs: st.lastUs
    })),
    sdpEndpoints: analyzer.sdpEndpoints
  };
}

/**
 * 阶段二：媒体深度分析（按需，后台）：解码 PCM、波形、丢包标记、DTMF。
 * 返回 { streams: { dir → { pcm, sampleRate, waveform, marks } }, dtmf: [...] }
 */
async function analyzeMedia(analyzed, callId, onProgress, signal) {
  const callRtp = analyzed.rtpStreams.filter(s => s.callId === callId);
  if (!callRtp.length) return { streams: {}, dtmf: [] };
  // 重新扫文件收集该通话的 RTP 原始数据（避免首扫常驻 1GiB 内存）
  const analyzer = new CallAnalyzer('media');
  const needFlows = new Set(callRtp.map(s => s.key));
  const t0 = Date.now();
  try {
    for await (const pkt of readCapture(analyzed.filePath, signal)) {
      if (signal?.aborted) break;
      const dec = decodePacket(pkt.data, pkt.link);
      if (!dec || dec.proto !== 'UDP' || dec.payload.length < 12) continue;
      const key = `${dec.srcIp}:${dec.sport}>${dec.dstIp}:${dec.dport}`;
      if (!needFlows.has(key)) continue;
      const { parseRtp } = require('../rtp/parser');
      const rtp = parseRtp(dec.payload);
      if (!rtp) continue;
      let st = analyzer.rtpStreams.get(key);
      if (!st) {
        const { RtpStream } = require('../media/assembler');
        st = new RtpStream(key, null);
        st.callId = callId;
        const known = callRtp.find(s => s.key === key);
        if (known) {
          st.dir = known.dir; st.codecName = known.codecName;
          st.pt = known.pt; st.clock = known.clock;
          if (known.eventPt != null) st.eventPt = known.eventPt;
          if (known.rtpmaps && Object.keys(known.rtpmaps).length) st.rtpmaps = known.rtpmaps;
        }
        analyzer.rtpStreams.set(key, st);
      }
      st.addRtp(pkt.tsUs, rtp, null);
      if (Date.now() - t0 > 200) {
        onProgress?.({ stage: 'media-collect', pct: null, detail: `收集 ${[...analyzer.rtpStreams.values()].reduce((n, s) => n + s.pkts.length, 0)} RTP 包` });
      }
    }
  } catch (e) { /* 中断抓包容忍 */ }

  const streams = {};
  const dirStreams = [...analyzer.rtpStreams.values()];
  // 用首扫确定的 dir 标注
  for (const st of dirStreams) {
    const known = callRtp.find(s => s.key === st.key);
    st.dir = known?.dir || null;
    st.codecName = known?.codecName || st.codecName;
  }

  // 方向归位：无 SDP 时首扫可能把两个方向的流都标成 A2B，直接按 dir 落槽会互相覆盖。
  // 这里改为「先用 dir，冲突/缺失时按包数补齐」，并丢弃 0 包的流（多为 RTCP 或误判）。
  const active = dirStreams.filter(st => st.pkts.length > 0);
  const bySlot = { a: null, b: null };
  for (const st of active) {
    const slot = st.dir === 'B2A' ? 'b' : 'a';
    if (!bySlot[slot]) bySlot[slot] = st;
  }
  const rest = active
    .filter(st => st !== bySlot.a && st !== bySlot.b)
    .sort((x, y) => y.pkts.length - x.pkts.length);
  if (!bySlot.a) bySlot.a = rest.shift() || null;
  if (!bySlot.b) bySlot.b = rest.shift() || null;

  let idx = 0;
  const dtmfParts = { e2833: [], info: [], inband: [] };
  const seen = new Set();
  for (const slot of ['a', 'b']) {
    const st = bySlot[slot];
    if (!st || seen.has(st.key)) continue;
    seen.add(st.key);
    if (signal?.aborted) break;
    idx++;
    onProgress?.({ stage: 'media-decode', pct: Math.round(idx / 2 * 100), detail: `解码 ${slot === 'a' ? '主叫' : '被叫'}方向` });
    const res = assembleStream(st, {});
    const desc = {
      key: st.key, dir: st.dir || (slot === 'a' ? 'A2B' : 'B2A'), codec: st.codecName,
      firstUs: st.firstUs || st.firstTsUs, lastUs: st.lastUs,
      packets: st.pkts.length, lost: st.lost, jitterMs: st.jitterMs, sampleRate: res.sampleRate
    };
    if (res.pcm) {
      streams[slot] = { ...res, ...desc };
      if (res.pcm.length < res.sampleRate * 300) {
        dtmfParts.inband.push(...detectInbandDtmf(res.pcm, res.sampleRate, st.firstUs));
      }
    } else {
      streams[slot] = { ...desc, pcm: null, waveform: null, marks: res.marks, unsupported: res.unsupported };
    }
    const eventPkts = st.pkts.filter(p => p.pt === st.eventPt);
    if (st.eventPt != null && eventPkts.length) {
      dtmfParts.e2833.push(...extract2833(eventPkts, 8000));
    }
  }
  // SIP INFO DTMF
  const infoMsgs = analyzed.sipMsgs.filter(m => m.callId === callId && m.method === 'INFO');
  if (infoMsgs.length) {
    // 需要原始 body：从完整解析再次提取（sipMsgs 存的是瘦身记录）——从文件重取 INFO body
    const infoBodies = await reparseInfoBodies(analyzed.filePath, infoMsgs, signal);
    dtmfParts.info.push(...extractSipInfoDtmf(infoBodies));
  }
  const dtmf = mergeDtmf(dtmfParts.e2833, dtmfParts.info, dtmfParts.inband);
  return { streams, dtmf };
}

/** 重扫文件获取 INFO 消息完整 body */
async function reparseInfoBodies(filePath, infoMsgs, signal) {
  const { parseSip } = require('../sip/parser');
  const out = [];
  const targets = infoMsgs.map(m => ({ tsUs: m.tsUs, src: m.src }));
  for await (const pkt of readCapture(filePath, signal)) {
    if (signal?.aborted || out.length >= targets.length) break;
    const dec = decodePacket(pkt.data, pkt.link);
    if (!dec || dec.proto !== 'UDP' || !dec.payload.length) continue;
    if (!looksLikeSipPayload(dec.payload)) continue;
    const msg = parseSip(dec.payload, { srcIp: dec.srcIp, sport: dec.sport, dstIp: dec.dstIp, dport: dec.dport });
    if (!msg || msg.method !== 'INFO') continue;
    const hit = targets.find(t => Math.abs(t.tsUs - pkt.tsUs) < 2e6 && t.src === `${dec.srcIp}:${dec.sport}`);
    if (hit) out.push({ tsUs: pkt.tsUs, body: msg.body || '', contentType: msg.contentType });
  }
  return out;
}

function looksLikeSipPayload(payload) {
  const head = payload.slice(0, 64).toString('latin1');
  return /^SIP\/2\.0 \d{3}/.test(head) || /^[A-Z]+ \S+ SIP\/2\.0\r?\n/.test(head);
}

/** 通话的 SIP 流序图 + 全部报文（前端详情页） */
/**
 * 扫描单个通话的 DTMF 事件（2833 + SIP INFO + 带内），供流序图与报文列表展示。
 * 不依赖首扫的 eventPt（很多抓包没有 SDP），必要时从音频里做带内检测。
 */
async function scanCallDtmf(analyzed, callId, signal) {
  analyzed._dtmfCache = analyzed._dtmfCache || {};
  if (analyzed._dtmfCache[callId]) return analyzed._dtmfCache[callId];

  const out = [];
  // 1) SIP INFO 通道
  for (const m of analyzed.sipMsgs) {
    if (m.callId !== callId || m.method !== 'INFO' || !m.body) continue;
    const hit = String(m.body).match(/Signal\s*=\s*([0-9*#ABCD])/i);
    if (hit) out.push({ digit: hit[1], startUs: m.tsUs, endUs: m.tsUs, durationMs: null, via: 'SIP INFO', src: m.src, dst: m.dst });
  }

  // 2) RTP 通道：2833/4733 + 带内
  const callStreams = analyzed.rtpStreams.filter(s => s.callId === callId);
  if (callStreams.length && analyzed.filePath) {
    const need = new Map(callStreams.map(s => [s.key, s]));
    const buckets = new Map();
    try {
      for await (const pkt of readCapture(analyzed.filePath, signal)) {
        const dec = decodePacket(pkt.data, pkt.link);
        if (!dec || dec.proto !== 'UDP' || dec.payload.length < 12) continue;
        const key = `${dec.srcIp}:${dec.sport}>${dec.dstIp}:${dec.dport}`;
        if (!need.has(key)) continue;
        const rtp = parseRtpLazy(dec.payload);
        if (!rtp) continue;
        if (!buckets.has(key)) buckets.set(key, []);
        buckets.get(key).push({ tsUs: pkt.tsUs, ...rtp });
      }
    } catch { /* 截断文件：返回已扫描到的部分 */ }

    const { RtpStream, assembleStream } = require('../media/assembler');
    const { detectInbandDtmf } = require('../media/dtmf');

    for (const [key, pkts] of buckets) {
      const known = need.get(key);
      const [fromAddr, toAddr] = key.split('>');

      // 2833：优先用已知 eventPt，否则按「动态 PT + 4 字节事件载荷」识别
      let eventPt = known.eventPt;
      if (eventPt == null) {
        const byPt = new Map();
        for (const p of pkts) {
          if (p.pt < 96 || !p.data || p.data.length !== 4 || p.data[0] > 15) continue;
          if (!byPt.has(p.pt)) byPt.set(p.pt, []);
          byPt.get(p.pt).push(p);
        }
        for (const [pt, arr] of byPt) { if (arr.length >= 2) { eventPt = pt; break; } }
      }
      if (eventPt != null) {
        const evPkts = pkts.filter(p => p.pt === eventPt);
        for (const e of extract2833(evPkts, 8000)) {
          out.push({ digit: e.digit, startUs: e.startUs, endUs: e.endUs, durationMs: e.durationMs, via: 'RFC2833/4733', src: fromAddr, dst: toAddr });
        }
      }

      // 带内：无 2833 事件时解码音频做频域检测（限制 5 分钟）
      const has2833 = out.some(e => e.src === fromAddr);
      if (!has2833 && pkts.length) {
        try {
          const st = new RtpStream(key, known.dir);
          st.callId = callId;
          st.codecName = known.codecName;
          st.pt = known.pt;
          st.clock = known.clock || 8000;
          if (known.rtpmaps) st.rtpmaps = known.rtpmaps;
          for (const p of pkts) st.addRtp(p.tsUs, p, null);
          const res = assembleStream(st, {});
          if (res.pcm && res.pcm.length < res.sampleRate * 300) {
            for (const e of detectInbandDtmf(res.pcm, res.sampleRate, st.firstUs || pkts[0].tsUs)) {
              out.push({ digit: e.digit, startUs: e.startUs, endUs: e.endUs, durationMs: e.durationMs, via: '带内音频', src: fromAddr, dst: toAddr });
            }
          }
        } catch { /* 解码失败则跳过带内检测 */ }
      }
    }
  }

  // 去重（同按键 500ms 内只保留一条）
  out.sort((a, b) => a.startUs - b.startUs);
  const merged = [];
  for (const e of out) {
    const prev = merged[merged.length - 1];
    if (prev && prev.digit === e.digit && e.startUs - prev.startUs < 500000) continue;
    merged.push(e);
  }
  analyzed._dtmfCache[callId] = merged;
  return merged;
}

let _parseRtp = null;
function parseRtpLazy(payload) {
  if (!_parseRtp) _parseRtp = require('../rtp/parser').parseRtp;
  return _parseRtp(payload);
}

function callLadder(analyzed, callId) {
  const msgs = analyzed.sipMsgs.filter(m => m.callId === callId).sort((a, b) => a.tsUs - b.tsUs);
  const { actors, lanes } = buildLadder(msgs);
  // 媒体流时间轴：供流序图绘制 RTP 长条（无 SDP 也能从 RTP 流本身得到）
  const media = analyzed.rtpStreams
    .filter(s => s.callId === callId && (s.pktsCount || 0) > 0)
    .map(s => {
      const [src, dst] = String(s.key).split('>');
      return {
        key: s.key, src, dst, dir: s.dir, codec: s.codecName || '未知编码',
        packets: s.pktsCount || 0, startUs: s.firstUs || s.firstTsUs, endUs: s.lastUs || s.lastTsUs,
        lost: s.lost || 0, jitterMs: s.jitterMs ?? null
      };
    })
    .sort((a, b) => a.startUs - b.startUs);

  // RTP 对端可能不在 SIP 参与方里（典型：媒体经 B2BUA 转到另一台媒体服务器），补成独立参与方
  const actorIps = new Set(actors.map(a => String(a.label).split(':')[0]));
  for (const m of media) {
    for (const addr of [m.src, m.dst]) {
      const ip = String(addr || '').split(':')[0];
      if (!ip || actorIps.has(ip)) continue;
      actorIps.add(ip);
      actors.push({ id: addr, label: addr, kind: 'media' });
    }
  }

  return { actors, lanes, msgs: msgs.map(m => ({ ...m, cls: msgClass(m) })), media };
}

function sanitize(s) { return String(s).replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64); }

module.exports = { analyzeFile, analyzeMedia, callLadder, scanCallDtmf, MAX_FILE };
