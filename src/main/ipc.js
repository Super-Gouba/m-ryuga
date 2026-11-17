// M-Ryuga — IPC 注册：文件分析/媒体/导出/对照/更新/设置/实时抓包/转写
const { ipcMain, dialog, shell, app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const { analyzeFile, analyzeMedia, callLadder, scanCallDtmf } = require('../core/analysis/pipeline');
const { runExport } = require('../core/export/exporter');
const { matchTransactions, extractTransfers, applyCalibration, findCandidates } = require('../core/analysis/compare');
const { sniffFormat } = require('../core/pcap/reader');

// 会话内存：fileId → analyzed 结果（sipMsgs / rtpStreams 概览 / calls 摘要）
const sessions = new Map();
// 任务注册（进度/取消）
const tasks = new Map();
let taskSeq = 0;

function send(channel, payload) {
  const wins = BrowserWindow.getAllWindows();
  for (const w of wins) { if (!w.isDestroyed()) w.webContents.send(channel, payload); }
}

function newTask(label) {
  const id = `t${++taskSeq}`;
  const ac = new AbortController();
  tasks.set(id, { id, label, ac, startedAt: Date.now(), done: false });
  return { id, ac, task: tasks.get(id) };
}
function finishTask(id, status) {
  const t = tasks.get(id);
  if (t) { t.done = true; t.status = status; t.endedAt = Date.now(); }
}

function registerIpc(app, win) {
  /* ---------- 文件导入与分析 ---------- */
  ipcMain.handle('file:pick', async (_e, { filters, title, defaultPath }) => {
    const res = await dialog.showOpenDialog(win, { title: title || '选择文件', properties: ['openFile', 'multiSelections'], filters: filters || [{ name: '抓包文件', extensions: ['pcap', 'pcapng', 'cap'] }] });
    return res.canceled ? [] : res.filePaths;
  });

  ipcMain.handle('file:dirPick', async () => {
    const res = await dialog.showOpenDialog(win, { properties: ['openDirectory', 'createDirectory'] });
    return res.canceled ? null : res.filePaths[0];
  });

  ipcMain.handle('file:sniff', async (_e, filePath) => {
    const st = await fs.promises.stat(filePath).catch(() => null);
    if (!st) return { ok: false, error: '文件不存在' };
    if (st.size > 1024 * 1024 * 1024) return { ok: false, error: '文件超过 1 GiB 上限' };
    const fmt = await sniffFormat(filePath);
    if (!fmt.ok) return fmt;
    return { ok: true, format: fmt.format, size: st.size, path: filePath };
  });

  ipcMain.handle('analyze:start', async (_e, { filePath }) => {
    // 必须对完整路径取哈希：base64 截断会让同目录下的多个文件算出同一个 id 而互相覆盖
    const abs = path.resolve(filePath);
    const st = await fs.promises.stat(abs).catch(() => null);
    const fileId = 'f' + crypto.createHash('sha1')
      .update(`${abs}|${st ? st.size : 0}|${st ? st.mtimeMs : 0}`)
      .digest('hex').slice(0, 12);
    const { id, ac } = newTask(`分析 ${path.basename(filePath)}`);
    send('task:started', { id, label: tasks.get(id).label });
    const onProgress = (p) => send('task:progress', { id, ...p });
    try {
      const result = await analyzeFile(filePath, fileId, onProgress, ac.signal);
      result.id = id;
      result.fileName = path.basename(filePath);
      sessions.set(fileId, result);
      finishTask(id, 'done');
      send('task:done', { id, result: { fileId, calls: result.calls, stats: result.stats, truncated: result.truncated, fileName: result.fileName, format: result.format } });
      return { ok: true, fileId, taskId: id, calls: result.calls, stats: result.stats, truncated: result.truncated, fileName: result.fileName, format: result.format };
    } catch (e) {
      finishTask(id, 'error');
      send('task:error', { id, error: String(e.message || e) });
      return { ok: false, error: String(e.message || e) };
    }
  });

  ipcMain.handle('task:cancel', (_e, { id }) => {
    const t = tasks.get(id);
    if (t) { t.ac.abort(); return true; }
    return false;
  });
  ipcMain.handle('task:list', () => [...tasks.values()].map(t => ({ id: t.id, label: t.label, done: t.done, status: t.status, startedAt: t.startedAt })));

  /* ---------- 通话详情 ---------- */
  ipcMain.handle('call:ladder', async (_e, { fileId, callId }) => {
    const s = sessions.get(fileId);
    if (!s) return { ok: false, error: '会话不存在' };
    let dtmf = [];
    try { dtmf = await scanCallDtmf(s, callId); } catch { dtmf = []; }
    return { ok: true, ...callLadder(s, callId), dtmf };
  });

  ipcMain.handle('call:diagnose', (_e, { fileId, callId }) => {
    const s = sessions.get(fileId);
    if (!s) return { ok: false };
    const c = s.calls.find(c => c.callId === callId);
    return { ok: true, diag: c?.summary ? c.diag ?? c.summary : null, summary: c?.summary };
  });

  ipcMain.handle('media:analyze', async (_e, { fileId, callId }) => {
    const s = sessions.get(fileId);
    if (!s) return { ok: false, error: '会话不存在' };
    const { id, ac } = newTask(`媒体分析 ${callId.slice(0, 24)}`);
    send('task:started', { id, label: tasks.get(id).label });
    try {
      const onProgress = (p) => send('task:progress', { id, ...p });
      const media = await analyzeMedia(s, callId, onProgress, ac.signal);
      // PCM 转 ArrayBuffer 传渲染层（限制 60MB 防溢出）
      const streams = {};
      for (const [slot, st] of Object.entries(media.streams)) {
        if (st.pcm) {
          const bytes = st.pcm.length * 2;
          if (bytes > 60 * 1024 * 1024) {
            streams[slot] = { ...st, pcm: null, waveform: st.waveform ? Array.from(st.waveform) : null, tooLarge: true };
          } else {
            streams[slot] = { ...st, pcm: st.pcm.buffer.slice(st.pcm.byteOffset, st.pcm.byteOffset + bytes), waveform: st.waveform ? Array.from(st.waveform) : null };
          }
        } else {
          streams[slot] = { ...st, waveform: st.waveform ? Array.from(st.waveform) : null };
        }
      }
      finishTask(id, 'done');
      send('task:done', { id });
      return { ok: true, streams, dtmf: media.dtmf };
    } catch (e) {
      finishTask(id, 'error');
      send('task:error', { id, error: String(e.message || e) });
      return { ok: false, error: String(e.message || e) };
    }
  });

  /* ---------- 导出 ---------- */
  ipcMain.handle('export:saveDialog', async (_e, { title, defaultName, filters }) => {
    const res = await dialog.showSaveDialog(win, { title: title || '导出', defaultPath: defaultName, filters });
    return res.canceled ? null : res.filePath;
  });
  ipcMain.handle('export:run', async (_e, { fileId, callId, items, opts }) => {
    const s = sessions.get(fileId);
    if (!s) return { ok: false, error: '会话不存在' };
    const { id, ac } = newTask('导出');
    send('task:started', { id, label: '导出' });
    try {
      const results = await runExport(s, callId, items, opts, (r, i, n) => send('task:progress', { id, pct: Math.round(i / n * 100), detail: r.ok ? r.type + ' 完成' : r.type + ' 失败: ' + r.error }), ac.signal);
      finishTask(id, 'done');
      send('task:done', { id });
      return { ok: true, results };
    } catch (e) {
      finishTask(id, 'error');
      return { ok: false, error: String(e.message || e) };
    }
  });
  ipcMain.handle('shell:showInFolder', (_e, p) => { shell.showItemInFolder(p); return true; });

  /* ---------- 对照 ---------- */
  ipcMain.handle('compare:run', async (_e, { fileA, fileB }) => {
    const sa = sessions.get(fileA), sb = sessions.get(fileB);
    if (!sa || !sb) return { ok: false, error: '请先导入并分析两个抓包' };
    const pairs = matchTransactions(sa.sipMsgs, sb.sipMsgs);
    return { ok: true, pairs };
  });
  ipcMain.handle('compare:transfers', (_e, { fileId }) => {
    const s = sessions.get(fileId);
    if (!s) return { ok: false };
    // 从会话构建通话视图
    const callsView = [...new Set(s.sipMsgs.map(m => m.callId))].map(callId => ({
      callId, firstUs: Math.min(...s.sipMsgs.filter(m => m.callId === callId).map(m => m.tsUs)),
      lastUs: Math.max(...s.sipMsgs.filter(m => m.callId === callId).map(m => m.tsUs)),
      msgs: s.sipMsgs.filter(m => m.callId === callId)
    }));
    return { ok: true, events: extractTransfers(callsView) };
  });
  ipcMain.handle('compare:calibrate', (_e, { fileId, offsetUs }) => {
    const s = sessions.get(fileId);
    if (!s) return { ok: false };
    s.sipMsgs = applyCalibration(s.sipMsgs, offsetUs);
    return { ok: true };
  });

  /* ---------- 更新 ---------- */
  ipcMain.handle('update:check', async () => {
    const { Updater } = require('./updater');
    // Updater 实例由 main 持有，此处通过全局引用
    return globalThis.__mryugaUpdater ? globalThis.__mryugaUpdater.check(true) : { ok: false, reason: '未初始化' };
  });
  ipcMain.handle('update:ignore', (_e, ver) => { globalThis.__mryugaUpdater?.setIgnored(ver); return true; });
  ipcMain.handle('update:setStartup', (_e, on) => { globalThis.__mryugaUpdater?.setStartupCheck(on); return true; });
  ipcMain.handle('update:clearPending', () => { globalThis.__mryugaUpdater?.clearPending(); return true; });
  ipcMain.handle('update:openRelease', (_e, url) => { shell.openExternal(url || 'https://github.com/m-ryuga/m-ryuga/releases/latest'); return true; });
  ipcMain.handle('update:getSettings', () => {
    const u = globalThis.__mryugaUpdater;
    return u ? { startupCheck: u.enabled, ignoredVersion: u.ignoredVer, lastCheck: u.lastCheck, pending: !!u.settings.pendingRelease } : null;
  });

  /* ---------- 设置 ---------- */
  const settingsFile = path.join(app.getPath('userData'), 'settings.json');
  const readSettings = () => { try { return JSON.parse(fs.readFileSync(settingsFile, 'utf8')); } catch { return {}; } };
  ipcMain.handle('settings:get', () => readSettings());
  ipcMain.handle('settings:set', (_e, patch) => {
    const cur = readSettings();
    const merged = { ...cur, ...patch };
    fs.writeFileSync(settingsFile, JSON.stringify(merged, null, 2));
    return merged;
  });

  /* ---------- 离线语音转写（whisper.cpp 引擎 + GGML 模型） ---------- */
  const ASR_RECOMMENDED = [
    { file: 'ggml-base.bin', name: 'Whisper base', size: '142 MB', note: '体积小，适合快速试用', url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin' },
    { file: 'ggml-small.bin', name: 'Whisper small', size: '466 MB', note: '质量与速度均衡，推荐', url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.bin' },
    { file: 'ggml-medium.bin', name: 'Whisper medium', size: '1.5 GB', note: '识别质量最高，占用大', url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-medium.bin' }
  ];

  const asrRoot = () => path.join(app.getPath('userData'), 'models');

  const findAsrEngine = () => {
    const names = ['whisper-cli.exe', 'main.exe', 'whisper.exe'];
    for (const n of names) {
      const local = path.join(asrRoot(), 'bin', n);
      if (fs.existsSync(local)) return local;
    }
    for (const n of names) {
      try {
        const out = require('child_process').execSync(`where ${n}`, { encoding: 'utf8', timeout: 2000 }).split(/\r?\n/)[0].trim();
        if (out && fs.existsSync(out)) return out;
      } catch { /* 未找到 */ }
    }
    return null;
  };

  const findAsrModels = () => {
    const list = [];
    const scan = (dir, depth) => {
      if (depth > 2) return;
      let ents = [];
      try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
      for (const e of ents) {
        const p = path.join(dir, e.name);
        if (e.isFile() && /\.(bin|gguf)$/i.test(e.name)) {
          let size = 0;
          try { size = fs.statSync(p).size; } catch { /* 忽略 */ }
          list.push({ path: p, name: e.name, size, kind: /^ggml-/i.test(e.name) ? 'Whisper GGML' : 'GGML/GGUF' });
        } else if (e.isDirectory()) {
          if (/vosk/i.test(e.name) && fs.existsSync(path.join(p, 'am', 'final.mdl'))) list.push({ path: p, name: e.name, kind: 'Vosk', size: 0 });
          else if (fs.existsSync(path.join(p, 'tokens.txt'))) list.push({ path: p, name: e.name, kind: 'sherpa-onnx', size: 0 });
          else scan(p, depth + 1);
        }
      }
    };
    scan(asrRoot(), 0);
    return list;
  };

  const fmtSec = s => {
    const v = Math.max(0, Number(s) || 0);
    const m = Math.floor(v / 60);
    const ss = (v % 60).toFixed(1).padStart(4, '0');
    return `${String(m).padStart(2, '0')}:${ss}`;
  };

  const readWhisperSegments = (outBase) => {
    const jp = `${outBase}.json`;
    if (fs.existsSync(jp)) {
      try {
        const j = JSON.parse(fs.readFileSync(jp, 'utf8'));
        const arr = j.transcription || j.segments || [];
        return arr.map(s => {
          const from = s.offsets ? s.offsets.from / 1000 : (s.start || 0);
          const to = s.offsets ? s.offsets.to / 1000 : (s.end || 0);
          return { start: from, end: to, startFmt: fmtSec(from), text: String(s.text || '').trim() };
        }).filter(x => x.text);
      } catch { /* 回落到 txt */ }
    }
    const tp = `${outBase}.txt`;
    if (fs.existsSync(tp)) {
      const txt = fs.readFileSync(tp, 'utf8').replace(/\s+/g, ' ').trim();
      return txt ? [{ start: 0, end: 0, startFmt: '00:00.0', text: txt }] : [];
    }
    return [];
  };

  const runWhisper = (engine, model, wav, outBase) => new Promise((resolve, reject) => {
    const legacy = /main\.exe$/i.test(engine);
    const args = legacy
      ? ['-m', model, '-f', wav, '-l', 'zh', '--output-txt', '--output-json', '--output-file', outBase]
      : ['-m', model, '-f', wav, '-l', 'zh', '-otxt', '-oj', '-of', outBase, '-np'];
    const p = require('child_process').spawn(engine, args, { windowsHide: true });
    let err = '';
    p.stderr.on('data', d => { err = (err + d.toString()).slice(-2000); });
    p.stdout.on('data', d => { err = (err + d.toString()).slice(-2000); });
    const timer = setTimeout(() => { try { p.kill(); } catch { /* 忽略 */ } reject(new Error('识别超时（10 分钟）')); }, 10 * 60 * 1000);
    p.on('error', e => { clearTimeout(timer); reject(e); });
    p.on('exit', code => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`识别引擎退出码 ${code}${err ? '：' + err.trim().slice(-300) : ''}`));
    });
  });

  ipcMain.handle('asr:status', async () => {
    const dir = asrRoot();
    fs.mkdirSync(dir, { recursive: true });
    const engine = findAsrEngine();
    const models = findAsrModels();
    const settings = readSettings();
    const active = settings.asrModelPath && fs.existsSync(settings.asrModelPath)
      ? settings.asrModelPath
      : (models.find(m => /^ggml-/i.test(m.name)) || {}).path || '';
    return {
      modelDir: dir,
      engine,
      engineOk: !!engine,
      models,
      activeModel: active,
      ready: !!engine && !!active,
      recommended: ASR_RECOMMENDED,
      binDir: path.join(dir, 'bin')
    };
  });

  ipcMain.handle('asr:pickModel', async () => {
    const res = await dialog.showOpenDialog(win, {
      title: '选择 Whisper GGML 模型文件（ggml-*.bin）',
      properties: ['openFile'],
      filters: [{ name: '模型文件', extensions: ['bin', 'gguf'] }]
    });
    if (res.canceled) return { ok: false };
    const p = res.filePaths[0];
    fs.writeFileSync(settingsFile, JSON.stringify({ ...readSettings(), asrModelPath: p }, null, 2));
    return { ok: true, path: p };
  });

  ipcMain.handle('asr:openModelsDir', async () => {
    const dir = asrRoot();
    fs.mkdirSync(path.join(dir, 'bin'), { recursive: true });
    shell.openPath(dir);
    return true;
  });

  ipcMain.handle('asr:transcribe', async (_e, { fileId, callId, localFile, mode }) => {
    const engine = findAsrEngine();
    if (!engine) {
      return {
        ok: false, code: 'engine',
        error: '未找到离线识别引擎（whisper-cli.exe）',
        hint: '把 whisper.cpp 的 whisper-cli.exe 放到 models\\bin\\ 目录，或加入 PATH。可在设置页打开模型目录。'
      };
    }
    const settings = readSettings();
    const models = findAsrModels();
    const model = (settings.asrModelPath && fs.existsSync(settings.asrModelPath))
      ? settings.asrModelPath
      : ((models.find(m => /^ggml-/i.test(m.name)) || {}).path || '');
    if (!model) {
      return {
        ok: false, code: 'model',
        error: '未找到识别模型（ggml-*.bin）',
        hint: '下载 ggml-small.bin 等模型放到 models\\ 目录，或点「选择模型文件」指定。'
      };
    }

    const tmpDir = path.join(app.getPath('userData'), 'cache');
    fs.mkdirSync(tmpDir, { recursive: true });
    const jobs = [];
    const temps = [];
    try {
      if (localFile) {
        const wav = path.join(tmpDir, `asr-src-${Date.now()}.wav`);
        fs.copyFileSync(localFile, wav);
        jobs.push({ ch: 'mix', wav }); temps.push(wav);
      } else {
        const s = sessions.get(fileId);
        if (!s) return { ok: false, code: 'session', error: '会话不存在，请重新导入文件' };
        const { encodeWav } = require('../core/media/assembler');
        const media = await analyzeMedia(s, callId);
        const plan = mode === 'split'
          ? [['a', media.streams.a], ['b', media.streams.b]]
          : [['mix', media.streams.a || media.streams.b]];
        for (const [ch, st] of plan) {
          if (!st?.pcm) continue;
          const wav = path.join(tmpDir, `asr-${Date.now()}-${ch}.wav`);
          fs.writeFileSync(wav, encodeWav(st.pcm, st.sampleRate));
          jobs.push({ ch, wav }); temps.push(wav);
        }
        if (!jobs.length) {
          return { ok: false, code: 'audio', error: '该通话没有可解码的音频（编码暂不支持或未捕获 RTP）' };
        }
      }

      const segments = [];
      for (const job of jobs) {
        const base = job.wav.replace(/\.wav$/i, '');
        await runWhisper(engine, model, job.wav, base);
        for (const sg of readWhisperSegments(base)) segments.push({ ch: job.ch, ...sg });
      }
      segments.sort((a, b) => a.start - b.start);
      return { ok: true, segments, engine: path.basename(engine), model: path.basename(model) };
    } catch (e) {
      return { ok: false, code: 'run', error: String(e.message || e) };
    } finally {
      for (const t of temps) { try { fs.unlinkSync(t); } catch { /* 忽略 */ } }
    }
  });

  /* ---------- 实时抓包 ---------- */
  const live = require('./live');
  live.registerLiveIpc(ipcMain, send, newTask, finishTask, () => app.getPath('userData'));

  /* ---------- 应用关闭流程 ---------- */
  ipcMain.handle('app:version', () => app.getVersion());
  ipcMain.handle('app:paths', () => ({
    userData: app.getPath('userData'),
    exports: path.join(app.getPath('userData'), 'exports'),
    cache: path.join(app.getPath('userData'), 'cache')
  }));
}

module.exports = { registerIpc };
