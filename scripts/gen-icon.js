// M-Ryuga — 图标生成：SVG 源 → build/icon.ico（多尺寸）与 build/icon.png（512px）
// 用法：npm run icons（Node 内置模块实现 ICO 打包，无第三方依赖）
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'build');
fs.mkdirSync(OUT, { recursive: true });

// ---- SVG 源：黑曜石圆角方 + 示波器波形 + 青色信号点 ----
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
<defs>
<linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
<stop offset="0" stop-color="#101823"/><stop offset="1" stop-color="#05090f"/>
</linearGradient>
<linearGradient id="wave" x1="0" y1="0" x2="1" y2="0">
<stop offset="0" stop-color="#22d3ee"/><stop offset="1" stop-color="#0e7490"/>
</linearGradient>
</defs>
<rect x="16" y="16" width="480" height="480" rx="104" fill="url(#bg)" stroke="#22d3ee" stroke-width="10" stroke-opacity=".55"/>
<rect x="40" y="40" width="432" height="432" rx="86" fill="none" stroke="#1f2937" stroke-width="4"/>
<path d="M96 256 L150 256 L178 168 L214 344 L246 120 L282 392 L310 224 L336 256 L416 256"
 fill="none" stroke="url(#wave)" stroke-width="22" stroke-linecap="round" stroke-linejoin="round"/>
<circle cx="416" cy="256" r="26" fill="#f59e0b"/>
<circle cx="416" cy="256" r="44" fill="none" stroke="#f59e0b" stroke-width="8" stroke-opacity=".35"/>
</svg>`;

// ---- PNG 写出（无依赖：原始 IHDR/IDAT/IEND） ----
function crc32(buf) {
  let c, table = crc32.table;
  if (!table) {
    table = crc32.table = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c;
    }
  }
  c = -1;
  for (let i = 0; i < buf.length; i++) c = (c >>> 8) ^ table[(c ^ buf[i]) & 0xFF];
  return (c ^ -1) >>> 0;
}
function chunk(type, data) {
  const t = Buffer.from(type, 'ascii');
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t, data])));
  return Buffer.concat([len, t, data, crc]);
}
// 简易 SVG 光栅化：解析 path 太重，这里用「像素级重绘」——直接按矢量定义在 ABGR 缓冲画形状
function renderPng(size) {
  const S = size, cx = S / 2, k = S / 512;
  const px = Buffer.alloc(S * S * 4);
  const set = (x, y, r, g, b, a) => {
    if (x < 0 || y < 0 || x >= S || y >= S) return;
    const i = (y * S + x) * 4;
    // alpha 混合
    const na = a / 255, oa = px[i + 3] / 255;
    const outA = na + oa * (1 - na);
    if (outA <= 0) return;
    px[i] = Math.round((r * na + px[i] * oa * (1 - na)) / outA);
    px[i + 1] = Math.round((g * na + px[i + 1] * oa * (1 - na)) / outA);
    px[i + 2] = Math.round((b * na + px[i + 2] * oa * (1 - na)) / outA);
    px[i + 3] = Math.round(outA * 255);
  };
  const inRoundRect = (x, y, x0, y0, w, h, r) => {
    if (x < x0 || x >= x0 + w || y < y0 || y >= y0 + h) return false;
    const dx = Math.max(x0 + r - x, x - (x0 + w - r - 1), 0);
    const dy = Math.max(y0 + r - y, y - (y0 + h - r - 1), 0);
    return dx * dx + dy * dy <= r * r;
  };
  const inSeg = (x, y, x1, y1, x2, y2, w) => { // 线段距离
    const vx = x2 - x1, vy = y2 - y1, L2 = vx * vx + vy * vy;
    let t = L2 ? ((x - x1) * vx + (y - y1) * vy) / L2 : 0;
    t = Math.max(0, Math.min(1, t));
    const dx = x - (x1 + t * vx), dy = y - (y1 + t * vy);
    return dx * dx + dy * dy <= w * w;
  };
  // 波形折线节点（与 SVG path 一致，按 k 缩放）
  const P = [[96,256],[150,256],[178,168],[214,344],[246,120],[282,392],[310,224],[336,256],[416,256]];
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const X = x / k, Y = y / k;
      const onBg = inRoundRect(X, Y, 16, 16, 480, 480, 104);
      if (!onBg) continue;
      // 背景渐变（对角）
      const t = (X + Y) / 1024;
      let r = Math.round(16 + (5 - 16) * t), g = Math.round(24 + (9 - 24) * t), b = Math.round(35 + (15 - 35) * t);
      set(x, y, r, g, b, 255);
      // 内描边
      if (inRoundRect(X, Y, 40, 40, 432, 432, 86) && !inRoundRect(X, Y, 44, 44, 424, 424, 83)) set(x, y, 31, 41, 55, 255);
      // 外描边（青）
      if (onBg && !inRoundRect(X, Y, 21, 21, 470, 470, 100)) set(x, y, 34, 211, 238, 140);
      // 波形（半宽 11）
      for (let i = 0; i < P.length - 1; i++) {
        if (inSeg(X, Y, P[i][0], P[i][1], P[i + 1][0], P[i + 1][1], 11)) {
          const tt = (X - 96) / 320;
          set(x, y, Math.round(34 + (14 - 34) * tt), Math.round(211 + (116 - 211) * tt), Math.round(238 + (144 - 238) * tt), 255);
          break;
        }
      }
      // 琥珀端点
      const d = (X - 416) ** 2 + (Y - 256) ** 2;
      if (d <= 26 * 26) set(x, y, 245, 158, 11, 255);
      else if (d <= 44 * 44 && d >= 40 * 40) set(x, y, 245, 158, 11, 90);
    }
  }
  // 组装 PNG
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(S, 0); ihdr.writeUInt32BE(S, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8bit RGBA
  const raw = Buffer.alloc((S * 4 + 1) * S);
  for (let y = 0; y < S; y++) {
    raw[y * (S * 4 + 1)] = 0;
    px.copy(raw, y * (S * 4 + 1) + 1, y * S * 4, (y + 1) * S * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

// ---- ICO 打包（PNG-in-ICO：256/64/48/32/16） ----
const sizes = [256, 64, 48, 32, 16];
const pngs = sizes.map(s => ({ s, png: renderPng(s) }));
const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(sizes.length, 4);
const entries = [];
let offset = 6 + sizes.length * 16;
const datas = [];
for (const { s, png } of pngs) {
  const e = Buffer.alloc(16);
  e[0] = s === 256 ? 0 : s; e[1] = s === 256 ? 0 : s;
  e.writeUInt16LE(1, 4); e.writeUInt16LE(32, 6);
  e.writeUInt32LE(png.length, 8); e.writeUInt32LE(offset, 12);
  entries.push(e); datas.push(png); offset += png.length;
}
fs.writeFileSync(path.join(OUT, 'icon.ico'), Buffer.concat([header, ...entries, ...datas]));
fs.writeFileSync(path.join(OUT, 'icon.png'), renderPng(512));
console.log('icons written:', path.join(OUT, 'icon.ico'), '+', path.join(OUT, 'icon.png'));
