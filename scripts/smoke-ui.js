// M-Ryuga — 打包后 UI 冒烟测试：通过 CDP 验证 React 真实挂载
// 用法: node scripts/smoke-ui.js <exePath>
const EXE = process.argv[2] || 'release/win-unpacked/M-Ryuga.exe';
const PORT = 9333;
const { spawn } = require('child_process');
const path = require('path');

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
async function getTargets() {
  const res = await fetch(`http://127.0.0.1:${PORT}/json`);
  return res.json();
}

async function main() {
  const cwd = path.dirname(path.resolve(EXE));
  const child = spawn(path.resolve(EXE), [`--remote-debugging-port=${PORT}`], { cwd, stdio: 'ignore' });

  // 等 CDP 与 app:// 页面就绪
  let page = null;
  for (let i = 0; i < 25; i++) {
    await sleep(1000);
    try {
      const list = await getTargets();
      page = list.find(t => t.type === 'page' && t.url.includes('app://'));
      if (page) break;
    } catch {}
  }
  if (!page) { console.log('SMOKE FAIL: app:// 页面未就绪'); child.kill(); process.exit(1); }

  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise(r => ws.onopen = r);

  // 轮询 React 挂载（最多 15 秒），同时收集异常
  const exceptions = [];
  let mid = 0;
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.method === 'Runtime.exceptionThrown') {
      exceptions.push((m.params.exceptionDetails?.exception?.description || m.params.exceptionDetails?.text || '').slice(0, 200));
    }
  };
  ws.send(JSON.stringify({ id: ++mid, method: 'Runtime.enable' }));

  let r = null;
  for (let i = 0; i < 15; i++) {
    await sleep(1000);
    const val = await new Promise(resolve => {
      const id = ++mid;
      const onMsg = (ev) => {
        const m = JSON.parse(ev.data);
        if (m.id === id) { ws.removeEventListener('message', onMsg); resolve(m.result?.result?.value); }
      };
      ws.addEventListener('message', onMsg);
      ws.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: {
        expression: `JSON.stringify({ rootChildren: document.getElementById('root')?.children.length ?? -1, nav: !!document.querySelector('.navitem'), tabs: document.querySelectorAll('.navitem').length, title: document.title, err: window.__lastErr || null })`,
        returnByValue: true
      }}));
    });
    try { r = JSON.parse(val); } catch { r = null; }
    if (r && r.rootChildren > 0 && r.nav) break;
  }
  ws.close();
  child.kill();

  if (exceptions.length) console.log('页面异常:', exceptions.slice(0, 3).join(' | '));
  const ok = r && r.rootChildren > 0 && r.nav;
  console.log(ok
    ? `SMOKE OK: React 已挂载（title=${r.title} root子节点=${r.rootChildren} 导航页签=${r.tabs}）`
    : `SMOKE FAIL: ${JSON.stringify(r || { timeout: true })}`);
  process.exit(ok ? 0 : 1);
}

main().catch(e => { console.log('SMOKE FAIL:', e.message); process.exit(1); });
