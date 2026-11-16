// M-Ryuga — RTP 流装配器：同 SSRC 聚合、丢包/乱序/抖动统计、音频装配（按抓包时间补间隔）
// 容忍 RTP 时间戳异常跳变或持续落后（要求⑥）

const { parseRtp } = require('../rtp/parser');
const { resolvePt, getDecoder } = require('./decoders');
const { extract2833 } = require('./dtmf');

/** 每方向 RTP 流原始报文收集器 */
class RtpStream {
  constructor(key, dir) {
    this.key = key;               // "ip:port>ip:port"
    this.dir = dir;               // 'A2B' | 'B2A'
    this.pkts = [];               // { tsUs, seq, ts, marker, pt, dataLen, data }
    this.ssrc = null;
    this.codecName = null;        // 经 rtpmap 解析
    this.pt = null;
    this.clock = 8000;
    this.firstTsUs = null;
    this.lastTsUs = null;
    this.seqWrap = 0;
    this._prevSeq = null;
    this.lost = 0;
    this.outOfOrder = 0;
    this.duplicates = 0;
    this.totalBytes = 0;
    this.jitterMs = null;         // RFC 3550
    this._lastArrival = null;
    this._lastTransit = null;
    this._jitterAvg = null;
    this._jitterN = 0;
    this.eventPt = null;          // 电话事件动态 pt（2833）
    this.rtpmaps = {};
  }

  addRtp(tsUs, pkt, rtpmaps) {
    this.rtpmaps = rtpmaps || this.rtpmaps;
    const pt = pkt.pt;
    if (pt >= 72 && pt <= 79) return false; // RFC 5761：72-79 为 RTCP 复用区间（动态 pt 如 telephone-event 101 不受影响）
    // 判定是否电话事件：由上层 rtpmap 声明 telephone-event
    const isEvent = this.eventPt != null && pt === this.eventPt;
    const rmThis = rtpmaps && rtpmaps[String(pt)];
    if (rmThis && rmThis.name.toUpperCase() === 'TELEPHONE-EVENT') this.eventPt = pt;
    // 静态 pt 名或 rtpmap
    const cname = resolvePt(pt, rtpmaps);
    if (!isEvent && cname) {
      if (!this.codecName) { this.codecName = cname; this.pt = pt; }
      const dec = getDecoder(cname);
      if (dec && dec.clock) this.clock = dec.clock;
    }
    if (cname === 'TELEPHONE-EVENT') {
      this.eventPt = pt;
    }
    // 丢包/乱序统计
    if (this._prevSeq !== null) {
      const delta = (pkt.seq - this._prevSeq + 65536) % 65536;
      if (delta === 0) this.duplicates++;
      else if (delta > 32768) { this.outOfOrder++; }
      else if (delta > 1) this.lost += delta - 1;
    }
    this._prevSeq = pkt.seq;
    // RFC3550 抖动：J += (|D| - J) / 16
    const clock = this.clock || 8000;
    const rtpTimeUs = (pkt.ts / clock) * 1e6;
    const arrival = tsUs;
    if (this._lastArrival !== null) {
      const transit = arrival - rtpTimeUs;
      if (this._lastTransit !== null) {
        const d = Math.abs(transit - this._lastTransit);
        this._jitterAvg = this._jitterAvg === null ? d : this._jitterAvg + (d - this._jitterAvg) / 16;
        this._jitterN++;
      }
      this._lastTransit = transit;
    }
    this._lastArrival = arrival;
    // 记录（保留数据仅当会被解码；2833 事件与音频都留）
    this.pkts.push({
      tsUs, seq: pkt.seq, ts: pkt.ts, marker: pkt.marker, pt,
      data: pkt.data && pkt.data.length ? Buffer.from(pkt.data) : Buffer.alloc(0)
    });
    this.totalBytes += pkt.data ? pkt.data.length : 0;
    if (this.firstTsUs === null) this.firstTsUs = tsUs;
    this.lastTsUs = tsUs;
    return true;
  }

  finalize() {
    this.jitterMs = this._jitterN > 1 ? Math.max(0, (this._jitterAvg || 0) / 1000) : 0;
    return this;
  }
}

/**
 * 装配一路 RTP 流为 PCM + 波形 + 标记。
 * opts: { codec: codecName, sampleRate, gapsFromCapture: true }
 * 返回 { pcm: Int16Array, sampleRate, waveform: Float32Array(每 20ms bin), marks: [{us, type, ms}] }
 * marks.type: 'loss'（丢包估算区间）| 'gap'（时间戳跳变/落后）| 'jitter'
 */
function assembleStream(stream, opts = {}) {
  const codecName = opts.codec || stream.codecName;
  const dec = getDecoder(codecName);
  const sampleRate = dec ? dec.sampleRate : 8000;
  const marks = [];
  if (!dec || !dec.available) {
    return { pcm: null, sampleRate, waveform: null, marks, unsupported: dec ? dec.label : codecName };
  }
  const pkts = stream.pkts.slice().sort((a, b) => a.tsUs - b.tsUs || a.seq - b.seq);
  // 分段策略：RTP ts 回退 → 开新段（录制重置/编解码器切换）；ts 跳变 > 3s → 补静音
  const segments = [];
  let cur = { pkts: [], prevTs: null, prevEndUs: null };
  for (const p of pkts) {
    if (p.pt !== stream.pt) continue; // 只装配音频 pt
    if (cur.prevTs !== null) {
      const tsDelta = (p.ts - cur.prevTs + 4294967296) % 4294967296;
      const backJump = (cur.prevTs - p.ts + 4294967296) % 4294967296;
      if (backJump > 8000 && backJump < 4294967296 - 8000 && backJump > tsDelta) {
        // ts 显著回退 → 新段
        segments.push(cur);
        cur = { pkts: [], prevTs: null, prevEndUs: null, tsReset: true, atUs: p.tsUs };
        marks.push({ us: p.tsUs, type: 'gap', ms: 0, note: 'RTP 时间戳重置' });
      } else if (tsDelta > 0 && tsDelta < 16000) {
        // 正常（含轻微乱序）
      } else if (tsDelta >= 16000) {
        const gapMs = (tsDelta / stream.clock) * 1000;
        marks.push({ us: p.tsUs, type: gapMs > 500 ? 'gap' : 'loss', ms: gapMs });
      }
    }
    cur.pkts.push(p);
    cur.prevTs = p.ts;
    cur.prevEndUs = p.tsUs;
  }
  if (cur.pkts.length) segments.push(cur);

  // 各段解码 → 插值补齐
  let pcmTotalLen = 0;
  const pieces = [];
  for (const seg of segments) {
    const state = dec.createState ? dec.createState() : undefined; // 每段独立解码器状态（G.722 ADPCM 连续性）
    const buf = [];
    let prevSeq = null, prevTs = null;
    for (const p of seg.pkts) {
      // 丢包插静音（按 seq 差估算帧数 × 帧时长）
      if (prevSeq !== null) {
        const d = (p.seq - prevSeq + 65536) % 65536;
        if (d > 1 && d < 128) {
          const frameSamples = (p.ts - prevTs) || 160;
          const missSamples = Math.min(frameSamples * (d - 1), sampleRate * 2);
          buf.push(new Int16Array(Math.round(missSamples))); // 静音补齐
        }
      }
      prevSeq = p.seq; prevTs = p.ts;
      const pcm = dec.decode(p.data, state);
      if (pcm && pcm.length) buf.push(pcm);
    }
    const total = buf.reduce((n, b) => n + b.length, 0);
    const merged = new Int16Array(total);
    let o = 0;
    for (const b of buf) { merged.set(b, o); o += b.length; }
    pieces.push(merged);
    pcmTotalLen += total;
  }
  const pcm = new Int16Array(pcmTotalLen);
  let po = 0;
  for (const piece of pieces) { pcm.set(piece, po); po += piece.length; }

  // 20ms bin 波形
  const binSamples = Math.round(sampleRate * 0.02);
  const nBins = Math.max(1, Math.ceil(pcm.length / binSamples));
  const waveform = new Float32Array(nBins);
  for (let b = 0; b < nBins; b++) {
    let peak = 0;
    const s0 = b * binSamples, s1 = Math.min(pcm.length, s0 + binSamples);
    for (let i = s0; i < s1; i++) { const a = Math.abs(pcm[i]); if (a > peak) peak = a; }
    waveform[b] = peak / 32768;
  }
  return { pcm, sampleRate, waveform, marks, unsupported: null };
}

/** WAV 封装（16bit PCM 单声道） */
function encodeWav(pcm, sampleRate) {
  const dataLen = pcm.length * 2;
  const buf = Buffer.alloc(44 + dataLen);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + dataLen, 4); buf.write('WAVE', 8);
  buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(sampleRate, 24); buf.writeUInt32LE(sampleRate * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
  buf.write('data', 36); buf.writeUInt32LE(dataLen, 40);
  for (let i = 0; i < pcm.length; i++) buf.writeInt16LE(pcm[i], 44 + i * 2);
  return buf;
}

module.exports = { RtpStream, assembleStream, encodeWav };
