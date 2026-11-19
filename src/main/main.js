// M-Ryuga — Electron 主进程：窗口/托盘/关闭三选/单实例/协议注册
const { app, BrowserWindow, Tray, Menu, ipcMain, dialog, shell, powerSaveBlocker, protocol, net, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const { registerIpc } = require('./ipc');

app.setName('M-Ryuga');
// 移除 Electron 默认英文菜单（文件/编辑/视图…），应用内导航自行实现
Menu.setApplicationMenu(null);

// 自定义 app:// 协议：file:// 下 ES module + crossorigin 会被 CORS 拦截导致白屏
protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }
]);
const distDir = path.join(__dirname, '../../dist');

// 数据目录：portable 与安装版共用 %APPDATA%/M-Ryuga
const userData = path.join(app.getPath('appData'), 'M-Ryuga');
app.setPath('userData', userData);
fs.mkdirSync(userData, { recursive: true });
fs.mkdirSync(path.join(userData, 'cache'), { recursive: true });
fs.mkdirSync(path.join(userData, 'exports'), { recursive: true });

let win = null;
let tray = null;
let quitConfirmed = false;
let psBlockerId = null;

// ---- 单实例 ----
// 支持把 .pcap / 文本信令日志拖到 exe 图标 / 命令行带文件启动
const PCAP_EXT = /\.(pcap|pcapng|cap|txt|log)$/i;
function argvPcaps(argv) {
  return (argv || []).filter(a => typeof a === 'string' && PCAP_EXT.test(a) && fs.existsSync(a));
}
let pendingOpen = argvPcaps(process.argv.slice(1));

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) { app.quit(); } else {
  app.on('second-instance', (_e, argv) => {
    if (win) { if (win.isMinimized()) win.restore(); win.show(); win.focus(); }
    const files = argvPcaps(argv.slice(1));
    if (files.length && win) win.webContents.send('app:open-files', files);
  });
}

// ---- 窗口 ----
const uiStateFile = path.join(userData, 'ui-state.json');
const readUiState = () => { try { return JSON.parse(fs.readFileSync(uiStateFile, 'utf8')); } catch { return {}; } };
const saveUiState = (patch) => {
  try { fs.writeFileSync(uiStateFile, JSON.stringify({ ...readUiState(), ...patch }, null, 2)); } catch { /* 忽略 */ }
};
let zoomFactor = Math.min(1.6, Math.max(0.7, Number(readUiState().zoom) || 1));

// 关闭行为记忆：写入 ui-state.json，重启后仍生效（ask | tray | exit）
const savedClose = readUiState().closeAction;
let closeAction = savedClose === 'tray' || savedClose === 'exit' ? savedClose : 'ask';

function applyZoom(delta) {
  if (delta === 0) zoomFactor = 1;
  else zoomFactor = Math.min(1.6, Math.max(0.7, Math.round((zoomFactor + delta) * 100) / 100));
  if (win && !win.isDestroyed()) win.webContents.setZoomFactor(zoomFactor);
  saveUiState({ zoom: zoomFactor });
}

function createWindow() {
  win = new BrowserWindow({
    width: 1440, height: 900, minWidth: 940, minHeight: 600,
    show: false,
    backgroundColor: '#f2f3f1',
    title: 'M-Ryuga',
    icon: path.join(__dirname, '../../build/icon.png'),
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: false
    }
  });

  // 缩放：Ctrl+= / Ctrl+- / Ctrl+0，比例持久化（菜单已移除，需自行接管）
  win.webContents.on('before-input-event', (e, input) => {
    if (!input.control || input.type !== 'keyDown') return;
    if (input.key === '=' || input.key === '+') { e.preventDefault(); applyZoom(0.1); }
    else if (input.key === '-') { e.preventDefault(); applyZoom(-0.1); }
    else if (input.key === '0') { e.preventDefault(); applyZoom(0); }
  });
  win.webContents.on('did-finish-load', () => win.webContents.setZoomFactor(zoomFactor));

  if (process.env.VITE_DEV) {
    win.loadURL('http://localhost:5173');
    win.webContents.openDevTools({ mode: 'detach' });
  } else {
    win.loadURL('app://local/index.html');
  }

  win.once('ready-to-show', () => win.show());

  // 启动时命令行携带的抓包文件：页面就绪后交给渲染层导入
  win.webContents.once('did-finish-load', () => {
    if (pendingOpen.length) {
      win.webContents.send('app:open-files', pendingOpen);
      pendingOpen = [];
    }
  });

  // 关闭 → 询问（要求⑪）
  win.on('close', (e) => {
    if (quitConfirmed || closeAction === 'exit') return; // 直接退出
    e.preventDefault();
    if (closeAction === 'tray') { win.hide(); return; }
    // 询问渲染层弹窗
    win.webContents.send('app:close-request');
  });

  win.on('closed', () => { win = null; });
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
}

function createTray() {
  const iconPath = path.join(__dirname, '../../build/icon.png');
  const icon = nativeImage.createFromPath(iconPath);
  if (icon.isEmpty()) return; // 图标缺失不致命
  tray = new Tray(icon);
  tray.setToolTip('M-Ryuga — 运行中');
  const menu = Menu.buildFromTemplate([
    { label: '打开主界面', click: () => { restoreWin(); } },
    { type: 'separator' },
    { label: '退出 M-Ryuga', click: () => doQuit() }
  ]);
  tray.setContextMenu(menu);
  tray.on('double-click', () => restoreWin());
}

function restoreWin() {
  if (!win) { createWindow(); return; }
  if (win.isMinimized()) win.restore();
  win.show(); win.focus();
}

function doQuit() {
  quitConfirmed = true;
  app.quit();
}

// ---- 托盘相关 IPC ----
function setupTrayIpc() {
  ipcMain.handle('app:resolve-close', (_e, action, remember) => {
    // action: 'tray' | 'exit'
    if (remember) { closeAction = action; saveUiState({ closeAction: action }); }
    if (action === 'tray') { if (win) win.hide(); }
    else doQuit();
    return true;
  });
  ipcMain.handle('app:cancel-close', () => { return true; });
  ipcMain.handle('app:get-close-action', () => closeAction);
  // 设置页可随时改回询问（避免「退出 + 记住」后再也看不到弹窗）
  ipcMain.handle('app:set-close-action', (_e, action) => {
    if (action !== 'ask' && action !== 'tray' && action !== 'exit') return closeAction;
    closeAction = action;
    saveUiState({ closeAction: action });
    return closeAction;
  });
}

// ---- 启动检查更新（要求⑨，实现见 updater.js） ----
const { Updater } = require('./updater');
let updater = null;

// ---- app://local 协议：映射 dist 目录（支持 ES module 与子资源） ----
function registerAppProtocol() {
  protocol.handle('app', (request) => {
    try {
      const u = new URL(request.url);
      // app://local/index.html → host=local, pathname=/index.html
      let rel = decodeURIComponent(u.pathname).replace(/^\/+/, '');
      if (!rel) rel = 'index.html';
      const fp = path.join(distDir, rel);
      if (!fp.startsWith(distDir)) return new Response('forbidden', { status: 403 });
      return net.fetch('file://' + fp.split('\\').join('/'));
    } catch (e) {
      return new Response(String(e.message || e), { status: 500 });
    }
  });
}

app.whenReady().then(() => {
  registerAppProtocol();
  // 渲染层挂载后主动领取命令行携带的文件（避免 did-finish-load 早于监听注册而丢失）
  ipcMain.handle('app:take-open-files', () => { const f = pendingOpen; pendingOpen = []; return f; });
  createWindow();
  createTray();
  setupTrayIpc();
  registerIpc(app, win);
  updater = new Updater(app, win, userData);
  globalThis.__mryugaUpdater = updater;
  updater.scheduleStartupCheck();

  // 防休眠（抓包/分析期间）
  app.on('browser-window-created', () => {});
});

app.on('window-all-closed', (e) => {
  // 托盘模式下不退出
  if (closeAction === 'exit' || quitConfirmed) app.quit();
});

app.on('before-quit', () => { quitConfirmed = true; });
app.on('activate', () => { if (!win) createWindow(); else restoreWin(); });
