// M-Ryuga — 本机实时抓包：npcap/dumpcap 检测、网卡枚举、临时录制 + 实时速览 + 按需保存
const { execSync, spawn } = require('child_process');
const { dialog } = require('electron');
const path = require('path');
const fs = require('fs');

const LIVE_JOBS = new Map();
let jobSeq = 0;

/** 检测 npcap 是否安装 */
function detectNpcap() {
  try {
    const out = execSync('sc query npcap', { encoding: 'utf8', timeout: 3000 });
    return { installed: /RUNNING|STOPPED/.test(out), running: /RUNNING/.test(out) };
  } catch {
    try {
      const out2 = execSync('sc query npf', { encoding: 'utf8', timeout: 3000 });
      return { installed: /RUNNING|STOPPED/.test(out2), running: /RUNNING/.test(out2) };
    } catch { return { installed: false, running: false }; }
  }
}

/** 枚举网卡（ipconfig 解析，避免原生依赖） */
function listAdapters() {
  const out = execSync('ipconfig /all', { encoding: 'utf8', timeout: 5000 });
  const adapters = [];
  let cur = null;
  for (const line of out.split(/\r?\n/)) {
    if (/^[^\s]/.test(line) && line.includes(':')) {
      if (cur) adapters.push(cur);
      cur = { name: line.replace(/[:\s]+$/, ''), ips: [], mac: null, gateway: null, status: 'unknown' };
    } else if (cur) {
      const mIp = line.match(/IPv4[^\d]*(\d+\.\d+\.\d+\.\d+)/);
      if (mIp) cur.ips.push(mIp[1]);
      const mMac = line.match(/([0-9A-Fa-f]{2}[-:]){5}[0-9A-Fa-f]{2}/);
      if (mMac && !cur.mac) cur.mac = mMac[0];
      const mGw = line.match(/Default Gateway[^\d]*(\d+\.\d+\.\d+\.\d+)/) || line.match(/默认网关[^\d]*(\d+\.\d+\.\d+\.\d+)/);
      if (mGw) cur.gateway = mGw[1];
      if (/媒体状态.*已断开|Media State.*disconnected/i.test(line)) cur.status = 'down';
      else if (cur.ips.length) cur.status = 'up';
    }
  }
  if (cur) adapters.push(cur);
  return adapters.filter(a => a.ips.length || a.status === 'up');
}

function findDumpcap() {
  const candidates = [
    'C:\\Program Files\\Wireshark\\dumpcap.exe',
    'C:\\Program Files (x86)\\Wireshark\\dumpcap.exe'
  ];
  for (const c of candidates) { if (fs.existsSync(c)) return c; }
  try {
    const p = execSync('where dumpcap', { encoding: 'utf8', timeout: 3000 }).split(/\r?\n/)[0];
    if (p && fs.existsSync(p.trim())) return p.trim();
  } catch { /* 未安装 */ }
  return null;
}

function dumpcapInterfaces(dumpcapPath) {
  const out = execSync(`"${dumpcapPath}" -D`, { encoding: 'utf8', timeout: 6000 });
  return out.split(/\r?\n/).filter(Boolean).map(l => {
    const m = l.match(/^(\d+)\.\s+(.+?)(?:\s+\((.+)\))?$/);
    return m ? { idx: +m[1], device: m[2], desc: m[3] || m[2] } : { idx: null, device: l, desc: l };
  });
}

const DIGITS = '0123456789*#ABCD';

/** 解析当前正在写入的抓包文件，产出实时速览（遇到不完整记录即停止） */
async function quickPreview(filePath) {
  const { readCapture } = require('../core/pcap/reader');
  const { decodePacket } = require('../core/pcap/packets');
  const { parseSip } = require('../core/sip/parser');
  const { parseRtp } = require('../core/rtp/parser');
  const res = { packets: 0, sip: 0, rtp: 0, dtmf: [], calls: [] };
  const calls = new Map();
  try {
    for await (const p of readCapture(filePath)) {
      res.packets++;
      let dec;
      try { dec = decodePacket(p.data, p.link); } catch { continue; }
      if (!dec || dec.proto !== 'UDP') continue;

      if (dec.payload.length >= 24) {
        let sip = null;
        try { sip = parseSip(dec.payload.toString('latin1'), { srcIp: dec.srcIp, sport: dec.sport, dstIp: dec.dstIp, dport: dec.dport }); } catch { sip = null; }
        if (sip && sip.isSip && sip.callId) {
          res.sip++;
          const body = String(sip.body || '');
          const hit = body.match(/Signal\s*=\s*([0-9*#ABCD])/i);
          if (hit) res.dtmf.push({ digit: hit[1], via: 'INFO', tsUs: p.tsUs });
          let c = calls.get(sip.callId);
          if (!c) {
            c = { callId: sip.callId, from: sip.from?.user || '', to: sip.to?.user || '', tStart: p.tsUs, msgs: 0, status: null };
            calls.set(sip.callId, c);
          }
          c.msgs++;
          if (sip.status) c.status = sip.status;
          continue;
        }
      }

      const rtp = parseRtp(dec.payload);
      if (!rtp) continue;
      res.rtp++;
      // RFC2833 事件粗判：动态 pt + 4 字节载荷 + 事件号合法
      if (rtp.pt >= 96 && rtp.data && rtp.data.length >= 4 && rtp.data[0] <= 15) {
        res.dtmf.push({ digit: DIGITS[rtp.data[0]], via: '2833', tsUs: p.tsUs });
      }
    }
  } catch { /* 文件仍在写入，读到不完整记录即停止 */ }

  res.calls = [...calls.values()].sort((a, b) => b.tStart - a.tStart).slice(0, 40);
  const dedup = [];
  for (const d of res.dtmf.sort((a, b) => a.tsUs - b.tsUs)) {
    const prev = dedup[dedup.length - 1];
    if (prev && prev.digit === d.digit && d.tsUs - prev.tsUs < 400000) continue;
    dedup.push(d);
  }
  res.dtmf = dedup.slice(-40);
  return res;
}

function dirSize(dir) {
  let total = 0;
  for (const f of safeReaddir(dir)) {
    if (/\.(pcapng|pcap)$/i.test(f)) {
      try { total += fs.statSync(path.join(dir, f)).size; } catch { /* 忽略 */ }
    }
  }
  return total;
}

function safeReaddir(dir) {
  try { return fs.readdirSync(dir); } catch { return []; }
}

function captureFiles(dir) {
  return safeReaddir(dir)
    .filter(f => /\.(pcapng|pcap)$/i.test(f))
    .map(f => {
      const p = path.join(dir, f);
      let size = 0;
      try { size = fs.statSync(p).size; } catch { /* 忽略 */ }
      return { file: p, name: f, size };
    });
}

let lastTrafficSample = null;

/** 读取各网卡累计字节数并换算成速率（Windows PowerShell，无原生依赖） */
function adapterTraffic() {
  const script = [
    '[Console]::OutputEncoding=[System.Text.Encoding]::UTF8;',
    '$st=@{};',
    'Get-NetAdapterStatistics -ErrorAction SilentlyContinue | ForEach-Object { $st[$_.Name]=@{rx=[double]$_.ReceivedBytes;tx=[double]$_.SentBytes} };',
    "Get-NetAdapter -ErrorAction SilentlyContinue | Select-Object Name,InterfaceDescription,Status,LinkSpeed,@{n='rx';e={$st[$_.Name].rx}},@{n='tx';e={$st[$_.Name].tx}} | ConvertTo-Json -Compress"
  ].join(' ');
  let arr = [];
  try {
    const out = execSync(`powershell -NoProfile -NonInteractive -Command "${script}"`, { encoding: 'utf8', timeout: 8000 }).trim();
    if (out) {
      const parsed = JSON.parse(out);
      arr = Array.isArray(parsed) ? parsed : [parsed];
    }
  } catch { return { ok: false, items: [] }; }

  const now = Date.now();
  const prev = lastTrafficSample;
  lastTrafficSample = { t: now, map: new Map(arr.map(a => [a.Name, { rx: a.rx || 0, tx: a.tx || 0 }])) };
  const dt = prev ? Math.max(0.2, (now - prev.t) / 1000) : 0;
  const items = arr.map(a => {
    const p = prev ? prev.map.get(a.Name) : null;
    return {
      name: a.Name, desc: a.InterfaceDescription || a.Name, status: a.Status || '',
      linkSpeed: a.LinkSpeed || '',
      rxBps: p ? Math.max(0, (a.rx - p.rx) / dt) : 0,
      txBps: p ? Math.max(0, (a.tx - p.tx) / dt) : 0
    };
  });
  return { ok: true, items };
}

function registerLiveIpc(ipcMain, send, newTask, finishTask, getUserData) {
  ipcMain.handle('live:npcapStatus', async () => {
    const npcap = detectNpcap();
    const dumpcap = findDumpcap();
    let ifaces = [];
    if (dumpcap) {
      try { ifaces = dumpcapInterfaces(dumpcap); } catch { /* 忽略 */ }
    }
    return { npcap, dumpcap: !!dumpcap, dumpcapPath: dumpcap, ifaces, adapters: safeList() };
  });

  // 网卡实时速率（用于在网卡列表上标注哪张卡有流量）
  ipcMain.handle('live:traffic', () => adapterTraffic());

  ipcMain.handle('live:start', async (_e, cfg) => {
    const dumpcap = findDumpcap();
    if (!dumpcap) return { ok: false, error: '未找到 dumpcap（请安装 Wireshark/npcap）' };
    const { id, ac } = newTask('实时抓包');
    const jobId = `L${++jobSeq}`;
    // 先写临时目录：不落用户目录，停止后再决定保存或丢弃
    const tmpDir = path.join(getUserData(), 'live-tmp', jobId);
    fs.mkdirSync(tmpDir, { recursive: true });

    const idxs = Array.isArray(cfg.ifIdxs) && cfg.ifIdxs.length ? cfg.ifIdxs.slice(0, 8) : [cfg.ifIdx ?? 0];
    if (idxs.length > 8) return { ok: false, error: '最多同时抓取 8 张网卡' };
    const args = [];
    for (const ix of idxs) args.push('-i', String(ix));
    const outFile = path.join(tmpDir, 'capture.pcapng');
    args.push('-w', outFile);
    if (cfg.filter) args.push('-f', cfg.filter);
    if (cfg.mode === 'ring') { args.push('-b', `filesize:${cfg.volSizeMB * 1024}`, '-b', `files:${cfg.keepFiles}`); }
    else if (cfg.mode === 'multi') { args.push('-b', `filesize:${cfg.volSizeMB * 1024}`); }
    if (cfg.durationSec) args.push('-a', `duration:${cfg.durationSec}`);
    if (cfg.sizeMB) args.push('-a', `filesize:${cfg.sizeMB * 1024}`);

    const child = spawn(dumpcap, args, { windowsHide: true });
    const job = { jobId, taskId: id, child, dir: tmpDir, startedAt: Date.now(), cfg, stopped: false, files: [], snapshot: null };
    LIVE_JOBS.set(jobId, job);

    child.stderr.on('data', d => { send('live:log', { jobId, line: d.toString().trim() }); });
    child.on('exit', code => {
      job.exitCode = code;
      job.stopped = true;
      if (job.timer) clearInterval(job.timer);
      finishTask(id, code === 0 ? 'done' : 'stopped');
      send('live:stopped', { jobId, code, files: captureFiles(job.dir), totalBytes: dirSize(job.dir) });
    });
    ac.signal.addEventListener('abort', () => { try { child.kill(); } catch { /* 忽略 */ } });

    // 每 2 秒解析临时文件 → 推送实时速览
    const tick = async () => {
      if (job.stopped) return;
      const files = captureFiles(job.dir);
      job.files = files;
      const size = dirSize(job.dir);
      let preview = null;
      if (size < 300 * 1024 * 1024 && files.length) {
        try { preview = await quickPreview(files[files.length - 1].file); } catch { preview = null; }
      }
      const snap = {
        jobId,
        uptimeSec: Math.round((Date.now() - job.startedAt) / 1000),
        totalBytes: size,
        files,
        preview
      };
      job.snapshot = snap;
      send('live:snapshot', snap);
    };
    job.timer = setInterval(tick, 2000);
    setTimeout(tick, 700);
    return { ok: true, jobId, dir: tmpDir };
  });

  ipcMain.handle('live:stop', async (_e, { jobId }) => {
    const job = LIVE_JOBS.get(jobId);
    if (!job) return { ok: false, error: '任务不存在' };
    try { job.child.kill(); } catch { /* 忽略 */ }
    // 等 dumpcap 落盘
    for (let i = 0; i < 40 && !job.stopped; i++) await new Promise(r => setTimeout(r, 100));
    const files = captureFiles(job.dir);
    const totalBytes = dirSize(job.dir);
    let preview = job.snapshot?.preview || null;
    if (!preview && files.length && totalBytes < 300 * 1024 * 1024) {
      try { preview = await quickPreview(files[files.length - 1].file); } catch { /* 忽略 */ }
    }
    return { ok: true, jobId, files, totalBytes, preview };
  });

  // 保存：弹出另存对话框后把临时文件复制过去
  ipcMain.handle('live:save', async (_e, { jobId }) => {
    const job = LIVE_JOBS.get(jobId);
    if (!job) return { ok: false, error: '任务不存在' };
    const files = captureFiles(job.dir);
    if (!files.length) return { ok: false, error: '没有可保存的数据（未捕获到报文）' };
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const res = await dialog.showSaveDialog({
      title: '保存抓包文件',
      defaultPath: path.join(getUserData(), 'captures', `live-${stamp}.pcapng`),
      filters: [{ name: '抓包文件', extensions: ['pcapng'] }]
    });
    if (res.canceled || !res.filePath) return { ok: false, canceled: true };
    fs.mkdirSync(path.dirname(res.filePath), { recursive: true });
    const src = files[files.length - 1];
    fs.copyFileSync(src.file, res.filePath);
    return { ok: true, path: res.filePath, size: src.size };
  });

  ipcMain.handle('live:discard', async (_e, { jobId }) => {
    const job = LIVE_JOBS.get(jobId);
    if (!job) return { ok: false };
    try { job.child.kill(); } catch { /* 忽略 */ }
    if (job.timer) clearInterval(job.timer);
    try { fs.rmSync(job.dir, { recursive: true, force: true }); } catch { /* 忽略 */ }
    LIVE_JOBS.delete(jobId);
    return { ok: true };
  });

  ipcMain.handle('live:jobs', () => [...LIVE_JOBS.values()].map(j => ({
    jobId: j.jobId, cfg: j.cfg, startedAt: j.startedAt, stopped: !!j.stopped,
    files: captureFiles(j.dir), totalBytes: dirSize(j.dir)
  })));
}

function safeList() {
  try { return listAdapters(); } catch { return []; }
}

module.exports = { registerLiveIpc, detectNpcap, listAdapters, findDumpcap };
