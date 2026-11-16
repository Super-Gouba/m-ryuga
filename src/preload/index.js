// M-Ryuga — preload：安全的 IPC 桥
const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('mryuga', {
  // 文件
  pickFiles: (opts) => ipcRenderer.invoke('file:pick', opts || {}),
  pickDir: () => ipcRenderer.invoke('file:dirPick'),
  // Electron 32+ 已移除 File.path：拖拽落地文件必须经 webUtils 取真实路径
  getPathForFile: (file) => {
    try { return webUtils.getPathForFile(file); } catch { return (file && file.path) || ''; }
  },
  sniff: (p) => ipcRenderer.invoke('file:sniff', p),
  analyzeStart: (p) => ipcRenderer.invoke('analyze:start', { filePath: p }),
  // 任务
  cancelTask: (id) => ipcRenderer.invoke('task:cancel', { id }),
  taskList: () => ipcRenderer.invoke('task:list'),
  // 通话
  callLadder: (fileId, callId) => ipcRenderer.invoke('call:ladder', { fileId, callId }),
  callDiagnose: (fileId, callId) => ipcRenderer.invoke('call:diagnose', { fileId, callId }),
  mediaAnalyze: (fileId, callId) => ipcRenderer.invoke('media:analyze', { fileId, callId }),
  // 导出
  exportSaveDialog: (opts) => ipcRenderer.invoke('export:saveDialog', opts),
  exportRun: (payload) => ipcRenderer.invoke('export:run', payload),
  showInFolder: (p) => ipcRenderer.invoke('shell:showInFolder', p),
  // 对照
  compareRun: (a, b) => ipcRenderer.invoke('compare:run', { fileA: a, fileB: b }),
  compareTransfers: (fileId) => ipcRenderer.invoke('compare:transfers', { fileId }),
  compareCalibrate: (fileId, offsetUs) => ipcRenderer.invoke('compare:calibrate', { fileId, offsetUs }),
  // 更新
  updateCheck: () => ipcRenderer.invoke('update:check'),
  updateIgnore: (v) => ipcRenderer.invoke('update:ignore', v),
  updateSetStartup: (on) => ipcRenderer.invoke('update:setStartup', on),
  updateClearPending: () => ipcRenderer.invoke('update:clearPending'),
  updateOpenRelease: (url) => ipcRenderer.invoke('update:openRelease', url),
  updateGetSettings: () => ipcRenderer.invoke('update:getSettings'),
  // 设置
  settingsGet: () => ipcRenderer.invoke('settings:get'),
  settingsSet: (patch) => ipcRenderer.invoke('settings:set', patch),
  // 转写
  asrStatus: () => ipcRenderer.invoke('asr:status'),
  asrTranscribe: (payload) => ipcRenderer.invoke('asr:transcribe', payload),
  asrPickModel: () => ipcRenderer.invoke('asr:pickModel'),
  asrOpenModelsDir: () => ipcRenderer.invoke('asr:openModelsDir'),
  // 实时
  liveNpcapStatus: () => ipcRenderer.invoke('live:npcapStatus'),
  liveStart: (cfg) => ipcRenderer.invoke('live:start', cfg),
  liveStop: (jobId) => ipcRenderer.invoke('live:stop', { jobId }),
  liveSave: (jobId) => ipcRenderer.invoke('live:save', { jobId }),
  liveDiscard: (jobId) => ipcRenderer.invoke('live:discard', { jobId }),
  liveJobs: () => ipcRenderer.invoke('live:jobs'),
  // 应用
  takeOpenFiles: () => ipcRenderer.invoke('app:take-open-files'),
  resolveClose: (action, remember) => ipcRenderer.invoke('app:resolve-close', action, remember),
  cancelClose: () => ipcRenderer.invoke('app:cancel-close'),
  version: () => ipcRenderer.invoke('app:version'),
  paths: () => ipcRenderer.invoke('app:paths'),
  // 事件
  on: (channel, fn) => {
    const allowed = ['task:started', 'task:progress', 'task:done', 'task:error', 'app:close-request', 'app:open-files', 'update:available', 'live:stats', 'live:snapshot', 'live:log', 'live:stopped'];
    if (allowed.includes(channel)) {
      const listener = (_e, payload) => fn(payload);
      ipcRenderer.on(channel, listener);
      return () => ipcRenderer.removeListener(channel, listener);
    }
    return () => {};
  }
});
