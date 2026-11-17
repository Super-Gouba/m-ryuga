// M-Ryuga — 更新检查（要求⑨）：启动后每 24h 最多一次 GitHub 正式版查询 + 手动检查
// 显示更新说明；稍后提醒 / 忽略此版本 / 关闭启动检查；下载通过浏览器打开官方发布页

const https = require('https');
const fs = require('fs');
const path = require('path');

const REPO = 'Super-Gouba/m-ryuga'; // GitHub owner/repo（发布页）
const CHECK_INTERVAL = 24 * 3600 * 1000;

class Updater {
  constructor(app, win, userData) {
    this.app = app; this.win = win;
    this.settingsFile = path.join(userData, 'update-settings.json');
    this.settings = this.loadSettings();
    this.timer = null;
  }

  loadSettings() {
    try { return JSON.parse(fs.readFileSync(this.settingsFile, 'utf8')); } catch { return {}; }
  }
  saveSettings() {
    try { fs.writeFileSync(this.settingsFile, JSON.stringify(this.settings, null, 2)); } catch {}
  }

  get lastCheck() { return this.settings.lastCheck || 0; }
  get enabled() { return this.settings.startupCheck !== false; }
  get ignoredVer() { return this.settings.ignoredVersion || null; }

  scheduleStartupCheck() {
    if (!this.enabled) return;
    if (Date.now() - this.lastCheck < CHECK_INTERVAL) {
      // 24h 内已查过 → 静默跳过；但若上次查到新版本且用户选了稍后提醒，启动时再提示
      if (this.settings.pendingRelease) this.notify(this.settings.pendingRelease, true);
      return;
    }
    setTimeout(() => this.check(false), 8000); // 启动 8s 后后台检查
  }

  async check(manual = true) {
    if (!manual && !this.enabled) return { ok: false, reason: 'disabled' };
    this.settings.lastCheck = Date.now();
    this.saveSettings();
    try {
      const rel = await fetchLatestRelease(REPO);
      if (!rel || !rel.tag_name) return { ok: false, reason: '无发布数据' };
      const latest = rel.tag_name.replace(/^v/i, '');
      const current = this.app.getVersion();
      const isNewer = compareVer(latest, current) > 0;
      const result = {
        ok: true, manual,
        current, latest,
        isNewer: isNewer && latest !== this.ignoredVer,
        notes: rel.body_markdown || rel.body || '',
        url: rel.html_url || `https://github.com/${REPO}/releases/latest`,
        publishedAt: rel.published_at,
        assets: (rel.assets || []).map(a => ({ name: a.name, size: a.size, url: a.browser_download_url }))
      };
      if (isNewer && !manual) {
        // 非手动且新版 → 记录 pendingRelease 用于稍后提醒
        this.settings.pendingRelease = { latest, notes: result.notes, url: result.url, assets: result.assets };
        if (latest !== this.ignoredVer) this.notify(result, false);
        else this.settings.pendingRelease = null;
        this.saveSettings();
      }
      return result;
    } catch (e) {
      return { ok: false, manual, reason: String(e.message || e) };
    }
  }

  notify(result, fromPending) {
    if (!this.win || this.win.isDestroyed()) return;
    this.win.webContents.send('update:available', { ...result, fromPending });
  }

  setIgnored(ver) { this.settings.ignoredVersion = ver; this.settings.pendingRelease = null; this.saveSettings(); }
  setStartupCheck(on) { this.settings.startupCheck = !!on; if (!on) this.settings.pendingRelease = null; this.saveSettings(); }
  clearPending() { this.settings.pendingRelease = null; this.saveSettings(); }

  /** 下载安装包到临时目录，onProgress({got,total,pct}) */
  async download(assets, onProgress) {
    const portable = !!process.env.PORTABLE_EXECUTABLE_DIR;
    const exes = (assets || []).filter(a => /\.exe$/i.test(a.name || ''));
    const asset = exes.find(a => (portable ? /Portable/i.test(a.name) : /Setup/i.test(a.name))) || exes[0];
    if (!asset?.url) throw new Error('该版本没有可下载的安装包');
    const dir = path.join(this.app.getPath('temp'), 'mryuga-update');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, path.basename(asset.name));
    await downloadFile(asset.url, file, onProgress);
    return { file, name: asset.name, size: asset.size, portable };
  }

  /** 启动安装器并退出应用（NSIS 安装版使用 /S 静默升级） */
  install(file) {
    const { spawn } = require('child_process');
    const silent = /Setup/i.test(path.basename(file));
    const child = spawn(file, silent ? ['/S'] : [], { detached: true, stdio: 'ignore' });
    child.unref();
    setTimeout(() => this.app.quit(), 600);
    return true;
  }
}

function fetchLatestRelease(repo) {
  return new Promise((resolve, reject) => {
    const req = https.request({
      host: 'api.github.com',
      path: `/repos/${repo}/releases/latest`,
      headers: { 'User-Agent': 'M-Ryuga-Updater', 'Accept': 'application/vnd.github+json' },
      timeout: 10000
    }, (res) => {
      if (res.statusCode === 404) { resolve(null); res.resume(); return; }
      let data = '';
      res.on('data', (c) => data += c);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
      });
    });
    req.on('timeout', () => { req.destroy(new Error('查询超时')); });
    req.on('error', reject);
    req.end();
  });
}

/** 流式下载，跟随 GitHub → objects.githubusercontent.com 跳转 */
function downloadFile(url, dest, onProgress) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': 'M-Ryuga-Updater' }, timeout: 30000 }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        const next = res.headers.location.startsWith('http') ? res.headers.location : `https://github.com${res.headers.location}`;
        downloadFile(next, dest, onProgress).then(resolve, reject);
        return;
      }
      if (res.statusCode !== 200) { res.resume(); reject(new Error(`下载失败（HTTP ${res.statusCode}）`)); return; }
      const total = Number(res.headers['content-length'] || 0);
      let got = 0;
      const out = fs.createWriteStream(dest);
      res.on('data', (c) => {
        got += c.length;
        onProgress?.({ got, total, pct: total ? got / total : 0 });
      });
      res.on('error', reject);
      out.on('error', reject);
      out.on('finish', () => out.close(() => resolve(dest)));
      res.pipe(out);
    });
    req.on('timeout', () => req.destroy(new Error('下载超时')));
    req.on('error', reject);
  });
}

function compareVer(a, b) {
  const pa = String(a).split('.').map(Number), pb = String(b).split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const x = pa[i] || 0, y = pb[i] || 0;
    if (x !== y) return x - y;
  }
  return 0;
}

module.exports = { Updater, compareVer };
