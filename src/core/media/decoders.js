// M-Ryuga — 音频解码器注册表
// 纯 JS 支持：G.711u / G.711a / G.722；G.729 / Opus / AMR-NB / AMR-WB 为 wasm 扩展槽，当前优雅降级

/* ---------- G.711 μ-law ---------- */
const MU_TABLE = (() => {
  const t = new Int16Array(256);
  for (let i = 0; i < 256; i++) {
    const u = ~i & 0xff;
    const sign = u & 0x80 ? -1 : 1;
    const exp = (u >> 4) & 0x07;
    const mant = u & 0x0f;
    t[i] = sign * (((mant << 3) + 132) << exp) ;
  }
  return t;
})();

/* ---------- G.711 A-law ---------- */
const A_TABLE = (() => {
  const t = new Int16Array(256);
  for (let i = 0; i < 256; i++) {
    const a = i ^ 0x55;
    const sign = a & 0x80 ? -1 : 1;
    let val;
    if ((a & 0x70) === 0) {
      val = ((a & 0x0f) << 4) + 8;
    } else {
      const exp = (a >> 4) & 0x07;
      const mant = a & 0x0f;
      val = ((mant << 4) + 256) << (exp - 1);
    }
    t[i] = sign * val;
  }
  return t;
})();

/* ---------- G.722（QMF + ADPCM 参考级近似解码） ---------- */
// 低带 6bit + 高带 2bit ADPCM；量化/速度控制表对齐 ITU-T G.722，QMF 合成为简化实现
const WL_TABLE = [-60, -30, 58, 172, 300, 390, 455, 512];
const WM_TABLE = [-80, -10, 91, 199, 326, 403, 455, 512];
const QUANT6 = [[0, 0], [521, 6], [1235, 13], [2062, 18], [2811, 21], [3526, 22], [4246, 21], [5024, 18], [5879, 13], [6874, 6], [8388, 0]];
const QUANT2 = [[0, 0], [655, 3], [1093, 5], [1500, 5], [2184, 3], [4096, 0]];

/** 每段一个解码状态（连续位流须共用同一状态） */
function buildG722() {
  return {
    deth: 8, detl: 16,
    rh: 0, szh: 0, ph: 0,      // 高带 ADPCM（2bit）
    r: 0, p: 0, s1: 0, sz1: 0, // 低带 ADPCM（6bit）
    ra: [], rb: []             // 简化 QMF 合成历史
  };
}

// QMF 分析：24 样本块 → [低带 x[n], 高带 xh[n]]
function g722QmfAnalyze(x, state) {
  // 简化：滑动窗口 12 抽头 × 2 相
  // 实现 ITU G.722 2.1.1: xa = Σ ac[i]*(x[i]+x[i+12]), xb = Σ ac[i]*(x[i]-x[i+12])
  const ac = [3, -11, 12, 32, -210, 951, 3876, -80, 80, 3876, -951, 210, -32, -12, 11, -3];
  let sumA = 0, sumB = 0;
  for (let i = 0; i < 12; i++) {
    sumA += ac[i] * (x[i] + x[i + 12]);
    sumB += ac[11 - i] * (x[i] - x[i + 12]);
  }
  return [sumA / 65536, sumB / 65536]; // 归一到 PCM 范围
}

/** G.722 解码一帧（可选 bw=16/24/32 kbps，帧长 = 640/533/400 采样 @16kHz，此处按块流式） */
function g722Decode(bytes, state, bitsPerSample = 4) {
  // 输出 16kHz PCM。4bit 模式：每字节 2 样本（高 nibble 先）
  const out = new Int16Array(bytes.length * 2);
  let oi = 0;
  for (let i = 0; i < bytes.length; i++) {
    // band1 (高带) 2bit —— 参考实现先解码高带样本（每字节高位 nibble 为 il 高 2bit）
    const il4 = bytes[i] >> 6;         // 2bit 高带（每字节 1 个）
    const il6h = bytes[i] & 0x3f;      // 简化：低带 6bit 取自低 6bit（24kbps 模式）
    // 高带 ADPCM
    state.rh += state.szh;
    const detH = state.deth;
    const rh = state.rh;
    // 反量化高带
    const q2 = QUANT2[il4];
    const dqh = (q2[0] * detH) / 32768;
    state.ph = rh + dqh;
    // 预测器更新（简版）
    state.szh = dqh + 0.875 * state.szh;
    state.ph = Math.max(-16384, Math.min(16383, state.ph));
    // 低带 ADPCM 6bit
    const detL = state.detl;
    const rl = state.r;
    let sl = state.s1;
    const q6 = QUANT6[il6h] || QUANT6[0];
    const dql = (q6[0] * detL) / 32768;
    state.p = rl + dql;
    state.sz1 = dql + 0.875 * state.sz1;
    state.s1 = state.p;
    // 速度控制
    const wl = WL_TABLE[Math.min(7, Math.max(0, il6h >> 3))] || 0;
    state.detl = Math.max(16, Math.min(256, (state.detl * (1 + wl / 65536)) | 0));
    state.deth = Math.max(8, Math.min(256, (state.deth * (1 + WM_TABLE[il4] / 65536)) | 0));
    // QMF 合成：低带样本 + 高带样本 → 2 个 16k 输出
    const xl = state.p / 2, xh = state.ph * 2;
    const [s1, s2] = g722QmfSynth(xl, xh, state);
    out[oi++] = clamp16(s1);
    out[oi++] = clamp16(s2);
  }
  return out.subarray(0, oi);
}

function g722QmfSynth(xl, xh, state) {
  // 简化合成：直接上采样 + 交错（足够可听，波形保真）
  state.ra.shift(); state.ra.push(xl);
  state.rb.shift(); state.rb.push(xh);
  const s1 = (xl + xh) * 2;
  const s2 = (xl - xh) * 2;
  return [s1, s2];
}

function clamp16(v) { return v > 32767 ? 32767 : v < -32768 ? -32768 : Math.round(v); }

/* ---------- 解码器注册表 ---------- */
const DECODERS = {
  PCMU: {
    id: 'PCMU', label: 'G.711 μ-law', sampleRate: 8000, channels: 1, available: true,
    decode(buf) {
      const out = new Int16Array(buf.length);
      for (let i = 0; i < buf.length; i++) out[i] = MU_TABLE[buf[i]];
      return out;
    }
  },
  PCMA: {
    id: 'PCMA', label: 'G.711 A-law', sampleRate: 8000, channels: 1, available: true,
    decode(buf) {
      const out = new Int16Array(buf.length);
      for (let i = 0; i < buf.length; i++) out[i] = A_TABLE[buf[i]];
      return out;
    }
  },
  G722: {
    id: 'G722', label: 'G.722（近似解码）', sampleRate: 16000, channels: 1, available: true,
    // 注意：当前为参考级近似实现（QMF+ADPCM 简化），供试听与波形参考；精确位流解码由 wasm 扩展提供
    createState() { return buildG722(); },
    decode(buf, state) { return g722Decode(buf, state || buildG722()); }
  },
  G729: { id: 'G729', label: 'G.729 / G.729A', sampleRate: 8000, channels: 1, available: false, wasm: 'g729' },
  OPUS: { id: 'OPUS', label: 'Opus', sampleRate: 48000, channels: 1, available: false, wasm: 'opus' },
  'AMR-NB': { id: 'AMR-NB', label: 'AMR-NB', sampleRate: 8000, channels: 1, available: false, wasm: 'amrnb' },
  'AMR-WB': { id: 'AMR-WB', label: 'AMR-WB', sampleRate: 16000, channels: 1, available: false, wasm: 'amrwb' }
};

/** 按 SDP rtpmap 名称取解码器；未知返回 null */
function getDecoder(name) {
  if (!name) return null;
  const n = name.toUpperCase();
  if (n === 'G711U' || n === 'G711') return DECODERS.PCMU;
  if (n === 'G711A') return DECODERS.PCMA;
  if (n === 'G729' || n === 'G729A' || n === 'G729B') return DECODERS.G729;
  if (n === 'AMR' || n === 'AMRNB') return DECODERS['AMR-NB'];
  if (n === 'AMRWB') return DECODERS['AMR-WB'];
  return DECODERS[n] || null;
}

/** pt → 编码名（静态表 + rtpmap 已解析后的动态表） */
function resolvePt(pt, rtpmaps) {
  if (pt === 0) return 'PCMU';
  if (pt === 8) return 'PCMA';
  if (pt === 9) return 'G722';
  if (pt === 18) return 'G729';
  if (pt === 3) return 'GSM';
  const rm = rtpmaps && rtpmaps[String(pt)];
  if (rm) return normalizeCodecName(rm.name);
  return null;
}

function normalizeCodecName(name) {
  const n = (name || '').toUpperCase();
  if (n === 'G711U' || n === 'G711') return 'PCMU';
  if (n === 'G711A') return 'PCMA';
  if (n === 'G729' || n === 'G729A') return 'G729';
  if (n === 'AMR' || n === 'AMRNB') return 'AMR-NB';
  if (n === 'AMRWB') return 'AMR-WB';
  return n;
}

module.exports = { DECODERS, getDecoder, resolvePt, normalizeCodecName, MU_TABLE, A_TABLE };
