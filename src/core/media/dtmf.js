// M-Ryuga — DTMF 三类检测：RFC 2833/4733（RTP 事件）、SIP INFO（keypad / dtmf）、In-band（音频频域）
// 均在分析管线内调用，输入为已解析的 RTP 报文列表或 SIP 消息列表

/* ============ 1. RFC 2833 / 4733 RTP 电话事件 ============ */
const EVENT_NAMES = { 0: '0', 1: '1', 2: '2', 3: '3', 4: '4', 5: '5', 6: '6', 7: '7', 8: '8', 9: '9', 10: '*', 11: '#', 12: 'A', 13: 'B', 14: 'C', 15: 'D' };

/**
 * 从 RTP 流中提取 2833 事件并聚合为按键。
 * rtpPkts: [{ tsUs, seq, ts, marker, pt, data, ... }]  已过滤 pt === 动态电话事件 pt
 * clock:   事件载荷时钟（通常 8000）
 * 返回 [{ digit, startUs, endUs, durationMs, volume, packets }]
 */
function extract2833(rtpPkts, clock = 8000) {
  if (!rtpPkts || rtpPkts.length === 0) return [];
  const events = [];
  let open = null; // { digit, startUs, startTs, volume, packets }
  for (const p of rtpPkts) {
    const d = p.data;
    if (!d || d.length < 4) continue;
    const event = d[0];
    const ebit = !!(d[1] & 0x80);      // End
    const rbit = !!(d[1] & 0x40);      // R
    const volume = d[1] & 0x3f;
    const duration = d.readUInt16BE(2); // 时钟 tick
    const digit = EVENT_NAMES[event] || `ev${event}`;
    if (!open) {
      open = { digit, startUs: p.tsUs, startTs: p.ts, volume, packets: 1, lastDur: duration };
    } else {
      open.packets++;
      open.lastDur = duration;
    }
    if (ebit) {
      const endUs = p.tsUs;
      events.push({
        digit: open.digit,
        startUs: open.startUs,
        endUs,
        durationMs: (open.lastDur / clock) * 1000,
        volume,
        packets: open.packets
      });
      open = null;
    }
  }
  if (open) { // 抓包截断
    events.push({ digit: open.digit, startUs: open.startUs, endUs: rtpPkts[rtpPkts.length - 1].tsUs, durationMs: (open.lastDur / clock) * 1000, volume: open.volume, packets: open.packets, truncated: true });
  }
  // 相邻同键合并（< 60ms 视为抖动重传/续传）
  const merged = [];
  for (const e of events) {
    const prev = merged[merged.length - 1];
    if (prev && prev.digit === e.digit && e.startUs - prev.endUs < 60000) {
      prev.endUs = e.endUs;
      prev.durationMs += e.durationMs;
      prev.packets += e.packets;
      continue;
    }
    merged.push(e);
  }
  return merged;
}

/* ============ 2. SIP INFO（application/dtmf-relay 与 keypad） ============ */
/**
 * sipInfos: SIP INFO 消息数组 [{ tsUs, body, contentType }]
 * 返回 [{ digit, tsUs, via }]
 */
function extractSipInfoDtmf(infos) {
  const out = [];
  for (const m of infos || []) {
    const body = m.body || '';
    let digit = null, duration = null;
    // Cisco dtmf-relay: Signal=2\r\nDuration=160
    const sig = body.match(/Signal\s*=\s*([0-9*#ABCD])/i);
    if (sig) { digit = sig[1]; const du = body.match(/Duration\s*=\s*(\d+)/i); if (du) duration = parseInt(du[1], 10); }
    else {
      // Asterisk: Digits=<n> / keypad 协议: <key> 单字符
      const dg = body.match(/Digits?\s*=\s*([0-9*#ABCD])/i);
      if (dg) digit = dg[1];
      else {
        const kb = body.trim().match(/^([0-9*#ABCD])$/);
        if (kb) digit = kb[1];
        else {
          const km = body.match(/keypad-facility\s*[:=]\s*([0-9*#ABCD])/i);
          if (km) digit = km[1];
        }
      }
    }
    if (digit) out.push({ digit, tsUs: m.tsUs, via: 'SIP INFO', durationMs: duration });
  }
  return out;
}

/* ============ 3. In-band 音频检测（Goertzel 双音对） ============ */
const DTMF_FREQS = {
  low: [697, 770, 852, 941],
  high: [1209, 1336, 1477, 1633]
};
const DTMF_MATRIX = [
  ['1', '2', '3', 'A'],
  ['4', '5', '6', 'B'],
  ['7', '8', '9', 'C'],
  ['*', '0', '#', 'D']
];

/** Goertzel 能量 */
function goertzel(samples, sampleRate, freq, start, len) {
  const k = Math.round((freq * len) / sampleRate);
  const w = (2 * Math.PI * k) / len;
  const cosw = Math.cos(w), sinw = Math.sin(w);
  const coeff = 2 * cosw;
  let s0 = 0, s1 = 0, s2 = 0;
  for (let i = start; i < start + len && i < samples.length; i++) {
    s0 = samples[i] + coeff * s1 - s2;
    s2 = s1; s1 = s0;
  }
  const real = s1 - s2 * cosw;
  const imag = s2 * sinw;
  return real * real + imag * imag;
}

/**
 * In-band DTMF 检测。
 * pcm: Int16Array；sampleRate: 8000；t0Us: PCM 起始抓包时间。
 * 返回 [{ digit, startUs, endUs, via: 'in-band' }]
 */
function detectInbandDtmf(pcm, sampleRate, t0Us) {
  if (!pcm || pcm.length < sampleRate) return [];
  const FRAME = 205;               // ~25.6ms，符合 ITU 评价
  const HOP = 160;                 // 20ms 步进
  const ENERGY_MIN = 4e9;          // 经验阈值（可调）
  const results = [];
  let active = null;
  for (let start = 0; start + FRAME < pcm.length; start += HOP) {
    let energy = 0;
    for (let i = start; i < start + FRAME; i++) energy += pcm[i] * pcm[i];
    if (energy < ENERGY_MIN) { if (active) close(active, start); continue; }
    let bestLow = 0, bestLowE = 0, bestHigh = 0, bestHighE = 0;
    DTMF_FREQS.low.forEach((f, i) => { const e = goertzel(pcm, sampleRate, f, start, FRAME); if (e > bestLowE) { bestLowE = e; bestLow = i; } });
    DTMF_FREQS.high.forEach((f, i) => { const e = goertzel(pcm, sampleRate, f, start, FRAME); if (e > bestHighE) { bestHighE = e; bestHigh = i; } });
    const total = bestLowE + bestHighE || 1;
    const lowRatio = bestLowE / total, highRatio = bestHighE / total;
    if (lowRatio > 0.12 && highRatio > 0.12) { // 两个频率均显著
      const digit = DTMF_MATRIX[bestLow][bestHigh];
      if (!active || active.digit !== digit) {
        if (active) close(active, start);
        active = { digit, start, end: start + FRAME };
      } else {
        active.end = start + FRAME;
      }
    } else if (active) close(active, start);
  }
  if (active) close(active, pcm.length);
  function close(a, endIdx) {
    const durMs = ((endIdx - a.start) / sampleRate) * 1000;
    if (durMs >= 40) { // 最短 40ms 才视为有效按键
      results.push({ digit: a.digit, startUs: t0Us + (a.start / sampleRate) * 1e6, endUs: t0Us + (endIdx / sampleRate) * 1e6, via: 'in-band', durationMs: durMs });
    }
    active = null;
  }
  return results;
}

/** 合并三类 DTMF（同键同时间窗去重，优先 2833 > INFO > in-band） */
function mergeDtmf(e2833, infoDtmf, inband) {
  const all = [
    ...(e2833 || []).map(e => ({ ...e, via: 'RFC 2833/4733' })),
    ...(infoDtmf || []),
    ...(inband || [])
  ].sort((a, b) => a.startUs - b.startUs);
  const out = [];
  for (const e of all) {
    const prev = out[out.length - 1];
    if (prev && prev.digit === e.digit && Math.abs((e.startUs || e.tsUs) - prev.startUs) < 250000) continue; // 250ms 内同键去重
    out.push({ ...e, startUs: e.startUs ?? e.tsUs });
  }
  return out;
}

module.exports = { extract2833, extractSipInfoDtmf, detectInbandDtmf, mergeDtmf, goertzel, DTMF_MATRIX };
