import React, { useEffect, useState, useReducer, useRef, createContext, useContext } from 'react';
import { t, useI18n } from './i18n.js';

/* ============================================================
   全局状态
   ============================================================ */
const StoreCtx = createContext(null);

const initialState = {
  files: [],            // [{ fileId, fileName, path, stats, truncated, calls }]
  calls: [],            // [{ id, callId, fileId, fileName, summary, diag }]
  selCall: null,        // { fileId, callId }
  activeFile: '',       // '' = 全部文件
  tasks: [],
  page: 'calls',        // calls | compare | live | asr | settings
  updateInfo: null,
  closeRequest: false,
  toast: null
};

function reducer(state, a) {
  switch (a.type) {
    case 'fileAdded': {
      const files = [...state.files.filter(f => f.fileId !== a.file.fileId), a.file];
      const calls = [...state.calls.filter(c => c.fileId !== a.file.fileId),
        ...a.file.calls.map(c => ({ ...c, fileId: a.file.fileId, fileName: a.file.fileName }))];
      return { ...state, files, calls };
    }
    case 'fileRemoved': {
      const files = state.files.filter(f => f.fileId !== a.fileId);
      const calls = state.calls.filter(c => c.fileId !== a.fileId);
      return {
        ...state, files, calls,
        activeFile: state.activeFile === a.fileId ? '' : state.activeFile,
        selCall: state.selCall?.fileId === a.fileId ? null : state.selCall
      };
    }
    case 'activeFile': return { ...state, activeFile: a.fileId };
    case 'select': return { ...state, selCall: a.sel, page: a.sel ? 'calls' : state.page };
    case 'page': return { ...state, page: a.page };
    case 'taskStarted': return { ...state, tasks: [...state.tasks, a.task] };
    case 'taskProgress': return { ...state, tasks: state.tasks.map(t => t.id === a.id ? { ...t, ...a } : t) };
    case 'taskDone': return { ...state, tasks: state.tasks.filter(t => t.id !== a.id) };
    case 'taskError': return { ...state, tasks: state.tasks.filter(t => t.id !== a.id), toast: { kind: 'err', text: a.error } };
    case 'update': return { ...state, updateInfo: a.info };
    case 'closeReq': return { ...state, closeRequest: a.on };
    case 'toast': return { ...state, toast: a.toast };
    default: return state;
  }
}

export function useStore() { return useContext(StoreCtx); }

export let api = typeof window !== 'undefined' && window.mryuga;
if (!api) {
  // 浏览器开发模式 mock
  api = new Proxy({}, { get: () => async () => ([]) });
}

/* ============================================================
   工具
   ============================================================ */
export function fmtTime(us) {
  if (us == null) return '--:--:--';
  const d = new Date(us / 1000);
  const p = (n, w = 2) => String(n).padStart(w, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`;
}
export function fmtDur(sec) {
  if (sec == null) return '未知';
  const s = Math.round(sec);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m${String(s % 60).padStart(2, '0')}s`;
}
export function fmtBytes(n) {
  if (n == null) return '-';
  if (n > 1048576) return (n / 1048576).toFixed(1) + ' MB';
  if (n > 1024) return (n / 1024).toFixed(1) + ' KB';
  return n + ' B';
}
export function trunc(s, n = 42) { s = String(s ?? ''); return s.length > n ? s.slice(0, n - 1) + '…' : s; }

/* ============================================================
   文件导入（按钮选择 + 拖拽共用）
   ============================================================ */
const ACCEPT_EXT = /\.(pcap|pcapng|cap)$/i;

export function useImporter() {
  const { dispatch, showToast } = useStore();
  const busy = useRef(false);

  const importPaths = async (paths) => {
    const list = (paths || []).filter(Boolean);
    if (!list.length) return;
    if (busy.current) { showToast('info', '正在导入，请等待当前任务完成'); return; }
    busy.current = true;
    let okCount = 0, failCount = 0;
    try {
      for (const p of list) {
        const base = String(p).split(/[\\/]/).pop();
        if (!ACCEPT_EXT.test(p)) { showToast('err', `跳过 ${base}：仅支持 .pcap / .pcapng / .cap`); failCount++; continue; }
        const sniff = await api.sniff(p);
        if (!sniff.ok) { showToast('err', `${base}: ${sniff.error}`); failCount++; continue; }
        const res = await api.analyzeStart(p);
        if (res.ok) {
          dispatch({
            type: 'fileAdded',
            file: { fileId: res.fileId, fileName: res.fileName || base, path: p, stats: res.stats, truncated: res.truncated, calls: res.calls }
          });
          okCount++;
        } else { showToast('err', `${base}: ${res.error}`); failCount++; }
      }
      if (okCount) showToast('ok', `已导入 ${okCount} 个文件${failCount ? `，${failCount} 个失败` : ''}`);
    } finally { busy.current = false; }
  };

  const pick = async () => {
    const paths = await api.pickFiles({
      title: '选择 PCAP / PCAPNG 抓包文件（可多选）',
      filters: [{ name: '抓包文件', extensions: ['pcap', 'pcapng', 'cap'] }]
    });
    await importPaths(paths);
  };

  // 拖拽落地：Electron 32+ 需经 webUtils 取真实路径
  const fromDrop = (fileList) => {
    const arr = Array.from(fileList || []);
    return arr.map(f => (api.getPathForFile ? api.getPathForFile(f) : f.path)).filter(Boolean);
  };

  return { pick, importPaths, fromDrop };
}

/* ============================================================
   根组件
   ============================================================ */
export default function App() {
  const [state, dispatch] = useReducer(reducer, initialState);
  const toastTimer = useRef(null);
  useI18n(); // 订阅语言切换，触发整棵树重渲染

  useEffect(() => {
    const unsubs = [
      api.on('task:started', t => dispatch({ type: 'taskStarted', task: t })),
      api.on('task:progress', p => dispatch({ type: 'taskProgress', ...p })),
      api.on('task:done', d => dispatch({ type: 'taskDone', ...d })),
      api.on('task:error', e => dispatch({ type: 'taskError', ...e })),
      api.on('update:available', info => dispatch({ type: 'update', info })),
      api.on('app:close-request', () => dispatch({ type: 'closeReq', on: true }))
    ];
    return () => unsubs.forEach(u => u());
  }, []);

  const showToast = (kind, text) => {
    clearTimeout(toastTimer.current);
    dispatch({ type: 'toast', toast: { kind, text } });
    toastTimer.current = setTimeout(() => dispatch({ type: 'toast', toast: null }), 3800);
  };

  return (
    <StoreCtx.Provider value={{ state, dispatch, showToast }}>
      <Shell />
    </StoreCtx.Provider>
  );
}

/* ============================================================
   应用壳
   ============================================================ */
function Shell() {
  const { state, dispatch } = useStore();
  const { files, calls, activeFile, page, updateInfo, closeRequest, toast, tasks } = state;
  const { pick, importPaths, fromDrop } = useImporter();
  const [dragging, setDragging] = useState(false);

  // 全局拖拽导入
  useEffect(() => {
    let depth = 0;
    const hasFiles = e => Array.from(e.dataTransfer?.types || []).includes('Files');
    const onEnter = e => { if (!hasFiles(e)) return; e.preventDefault(); depth++; setDragging(true); };
    const onOver = e => { if (!hasFiles(e)) return; e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; };
    const onLeave = e => { if (!hasFiles(e)) return; depth = Math.max(0, depth - 1); if (!depth) setDragging(false); };
    const onDrop = e => {
      if (!hasFiles(e)) return;
      e.preventDefault(); depth = 0; setDragging(false);
      importPaths(fromDrop(e.dataTransfer.files));
    };
    window.addEventListener('dragenter', onEnter);
    window.addEventListener('dragover', onOver);
    window.addEventListener('dragleave', onLeave);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('dragenter', onEnter);
      window.removeEventListener('dragover', onOver);
      window.removeEventListener('dragleave', onLeave);
      window.removeEventListener('drop', onDrop);
    };
  }, []);

  // 命令行 / 文件关联打开：先领取启动参数，再监听后续实例推送
  useEffect(() => {
    let alive = true;
    Promise.resolve(api.takeOpenFiles?.()).then(paths => {
      if (alive && Array.isArray(paths) && paths.length) importPaths(paths);
    }).catch(() => {});
    const off = api.on('app:open-files', paths => importPaths(paths));
    return () => { alive = false; off && off(); };
  }, []);

  const analyzing = tasks.some(t => t.stage === 'parse' || t.stage === 'aggregate');
  const shownCalls = activeFile ? calls.filter(c => c.fileId === activeFile) : calls;

  return (
    <div className="app">
      <AppBar
        page={page}
        setPage={p => dispatch({ type: 'page', page: p })}
        callCount={calls.length}
        onImport={pick}
        busy={analyzing}
      />
      <FileTabs
        files={files}
        activeFile={activeFile}
        calls={shownCalls}
        onPick={id => dispatch({ type: 'activeFile', fileId: id })}
        onRemove={id => dispatch({ type: 'fileRemoved', fileId: id })}
        onImport={pick}
      />

      <main style={{ flex: 1, minHeight: 0, display: 'flex' }}>
        {page === 'calls' && <CallsPage />}
        {page === 'compare' && <ComparePage />}
        {page === 'live' && <LivePage />}
        {page === 'asr' && <AsrPage />}
        {page === 'settings' && <SettingsPage />}
      </main>

      <StatusBar files={files} calls={calls} analyzing={analyzing} taskCount={tasks.length} />

      {dragging && (
        <div className="dropmask">
          <div className="dropzone">
            <div className="dz-ico">⇩</div>
            <div className="dz-title">{t('drop.drag')}</div>
            <div className="dz-sub">{t('drop.dragSub')}</div>
          </div>
        </div>
      )}

      {updateInfo && <UpdateModal info={updateInfo} onClose={() => dispatch({ type: 'update', info: null })} />}
      {closeRequest && <CloseModal onClose={() => dispatch({ type: 'closeReq', on: false })} />}
      {toast && <Toast toast={toast} />}
    </div>
  );
}

/* ============================================================
   顶部栏
   ============================================================ */
const NAV = [
  ['calls', '◧'],
  ['compare', '⇄'],
  ['live', '⏺'],
  ['asr', '⌨'],
  ['settings', '⚙']
];

function AppBar({ page, setPage, callCount, onImport, busy }) {
  return (
    <header className="appbar">
      <div className="brand">
        <div className="brandmark">M</div>
        <div className="brandtext">
          <span className="brandname">M-RYUGA</span>
          <span className="brandsub">{t('brand.sub')}</span>
        </div>
      </div>

      <nav className="mainnav">
        {NAV.map(([id, ico]) => (
          <div key={id} className="navitem" data-active={page === id || undefined} onClick={() => setPage(id)}>
            <span className="n-ico">{ico}</span>{t(`nav.${id}`)}
            {id === 'calls' && callCount > 0 && <span className="n-count">{callCount > 999 ? '999+' : callCount}</span>}
          </div>
        ))}
      </nav>

      <div className="spacer" />

      <SearchBar />
      <button className="btn primary" onClick={onImport} title={t('btn.import')}>
        {busy ? t('status.analyzing') : `＋ ${t('btn.import')}`}
      </button>
    </header>
  );
}

function SearchBar() {
  const { state, dispatch } = useStore();
  const [q, setQ] = useState('');
  const hits = q.trim()
    ? state.calls.filter(c =>
      (c.summary.fromUser || '').includes(q) || (c.summary.toUser || '').includes(q) ||
      c.callId.includes(q) || String(c.summary.endStatus || '').includes(q))
    : [];

  return (
    <div className="appbar-search">
      <span className="s-ico">⌕</span>
      <input className="input" placeholder={t('search.placeholder')} value={q}
        onChange={e => setQ(e.target.value)} />
      {q && (
        <div className="searchpop">
          {hits.length === 0 && <div className="sp-empty">{t('list.empty')}</div>}
          {hits.slice(0, 30).map(c => (
            <div key={c.id} className="sp-row"
              onClick={() => { dispatch({ type: 'select', sel: { fileId: c.fileId, callId: c.callId } }); setQ(''); }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
                <span className="mono" style={{ fontSize: 12.5, fontWeight: 600 }}>{trunc(c.callId, 28)}</span>
                <SevBadge sev={c.summary.sev} />
              </div>
              <div style={{ fontSize: 11.5, color: 'var(--fg3)', marginTop: 2 }}>
                {trunc(`${c.summary.fromUser || '?'} → ${c.summary.toUser || '?'} · ${c.fileName}`, 46)}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ============================================================
   文件页签条
   ============================================================ */
function FileTabs({ files, activeFile, calls, onPick, onRemove, onImport }) {
  if (!files.length) return null;
  const totalSip = calls.reduce((n, c) => n + (c.summary?.msgsCount || 0), 0);
  const maxDiff = calls.reduce((m, c) => Math.max(m, c.summary?.mediaCount || 0), 0);
  return (
    <div className="filetabs">
      <div className="filetab" data-active={!activeFile || undefined} onClick={() => onPick('')}>
        <span className="ft-ico">▦</span>{t('tabs.all')}
      </div>
      {files.map(f => (
        <div key={f.fileId} className="filetab" data-active={activeFile === f.fileId || undefined}
          onClick={() => onPick(f.fileId)} title={f.path}>
          <span className="ft-ico">◧</span>
          <span className="ft-name">{f.fileName}</span>
          <button className="ft-close" title={t('tabs.closeFile') || 'Close'}
            onClick={e => { e.stopPropagation(); onRemove(f.fileId); }}>×</button>
        </div>
      ))}
      <button className="btn ghost sm" onClick={onImport} title={t('btn.import')}>＋</button>
      <div className="spacer" style={{ flex: 1 }} />
      <div className="filestats">
        <span><b>{files.length}</b> {t('tabs.files')}</span>
        <span><b>{calls.length}</b> {t('tabs.calls')}</span>
        <span><b>{totalSip}</b> {t('tabs.msgs')}</span>
        {maxDiff > 0 && <span><b>{maxDiff}</b> {t('tabs.anomalies')}</span>}
      </div>
    </div>
  );
}

/* ============================================================
   状态栏
   ============================================================ */
function StatusBar({ files, calls, analyzing, taskCount }) {
  return (
    <footer className="statusbar">
      <span className={analyzing ? 'sb-dot busy pulsing' : 'sb-dot'}>●</span>
      <span>{analyzing ? `${t('status.analyzing')} · ${taskCount} ${t('status.tasks')}` : t('status.ready')}</span>
      <span>{t('status.files')} {files.length}</span>
      <span>{t('status.calls')} {calls.length}</span>
      {files.some(f => f.truncated) && <span style={{ color: 'var(--amber)' }}>⚠ {t('status.truncated')}</span>}
      <div style={{ flex: 1 }} />
      <VersionTag />
    </footer>
  );
}

function VersionTag() {
  const [v, setV] = useState('');
  useEffect(() => { Promise.resolve(api.version?.()).then(x => setV(x || '')).catch(() => {}); }, []);
  return <span className="mono">M-Ryuga {v}</span>;
}

/* ============================================================
   提示 / 弹层占位
   ============================================================ */
export function SevBadge({ sev }) {
  if (sev === 'ok') return <span className="badge ok">{t('sev.ok')}</span>;
  if (sev === 'error') return <span className="badge err">{t('sev.error')}</span>;
  if (sev === 'warn') return <span className="badge warn">{t('sev.warn')}</span>;
  return <span className="badge info">{t('sev.info')}</span>;
}

function Toast({ toast }) {
  const err = toast.kind === 'err';
  return (
    <div style={{
      position: 'fixed', bottom: 38, left: '50%', transform: 'translateX(-50%)', zIndex: 300,
      background: '#fff', border: `1px solid ${err ? '#fbd5d5' : 'var(--line2)'}`,
      borderLeft: `3px solid ${err ? 'var(--red)' : 'var(--green)'}`,
      boxShadow: 'var(--shadow-3)', borderRadius: 9, padding: '10px 16px',
      display: 'flex', gap: 9, alignItems: 'center', fontSize: 13, maxWidth: 620
    }}>
      <span style={{ color: err ? 'var(--red)' : 'var(--green)', fontWeight: 700 }}>{err ? '⚠' : '✓'}</span>
      <span>{toast.text}</span>
    </div>
  );
}

/* 页面由各模块 registerPages 注入 */
let CallsPage = () => (
  <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
    <EmptyDropHint />
  </div>
);
let ComparePage = () => null, LivePage = () => null, AsrPage = () => null, SettingsPage = () => null;
let UpdateModal = () => null, CloseModal = () => null;

export function registerPages(pages) {
  if (pages.CallsPage) CallsPage = pages.CallsPage;
  if (pages.ComparePage) ComparePage = pages.ComparePage;
  if (pages.LivePage) LivePage = pages.LivePage;
  if (pages.AsrPage) AsrPage = pages.AsrPage;
  if (pages.SettingsPage) SettingsPage = pages.SettingsPage;
  if (pages.UpdateModal) UpdateModal = pages.UpdateModal;
  if (pages.CloseModal) CloseModal = pages.CloseModal;
}

/* ============================================================
   响应式：媒体查询订阅
   ============================================================ */
export function useMediaQuery(query) {
  const get = () => (typeof window !== 'undefined' ? window.matchMedia(query).matches : false);
  const [hit, setHit] = useState(get);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const on = e => setHit(e.matches);
    setHit(mq.matches);
    if (mq.addEventListener) mq.addEventListener('change', on);
    else mq.addListener(on);
    return () => {
      if (mq.removeEventListener) mq.removeEventListener('change', on);
      else mq.removeListener(on);
    };
  }, [query]);
  return hit;
}

/* ============================================================
   可拖拽分栏：宽度随窗口自适应、记忆到本地
   ============================================================ */
export function usePaneSize(containerRef, { key, initial, min = 220, maxRatio = 0.5, side = 'left', reserve = 380, maxPx = 720 }) {
  const [size, setSizeState] = useState(() => {
    try {
      const saved = Number(localStorage.getItem(key));
      if (Number.isFinite(saved) && saved > 0) return saved;
    } catch { /* 忽略 */ }
    return initial;
  });
  const sizeRef = useRef(size);
  sizeRef.current = size;

  // 与 CSS 的 clamp() 保持同一套边界：下限固定，上限取「绝对上限 / 比例 / 给另一侧留白」的最小值
  const clamp = (v, w) => {
    const hi = Math.max(min, Math.min(maxPx, Math.floor(w * maxRatio), w - reserve));
    return Math.max(min, Math.min(Math.round(v), hi));
  };
  const commit = v => {
    const w = containerRef.current?.clientWidth || window.innerWidth;
    const c = clamp(v, w);
    setSizeState(c);
    try { localStorage.setItem(key, String(c)); } catch { /* 忽略 */ }
  };

  // 宽度由 CSS clamp() 在缩放时即时收敛，无需额外监听；这里只需处理用户显式拖拽
  const startDrag = e => {
    e.preventDefault();
    const el = containerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const move = ev => {
      const raw = side === 'left' ? ev.clientX - rect.left : rect.right - ev.clientX;
      commit(raw);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      document.body.style.cursor = '';
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    document.body.style.cursor = 'col-resize';
  };

  const step = dir => commit(sizeRef.current + dir * 24);
  const reset = () => commit(initial);
  // CSS 侧再夹一次：窗口缩放时浏览器即时重排，不依赖 JS 观测
  const cssWidth = `clamp(${min}px, ${size}px, min(${maxPx}px, ${Math.round(maxRatio * 100)}%, calc(100% - ${reserve}px)))`;
  return [size, { startDrag, step, reset }, cssWidth];
}

export function Splitter({ drag, label = '调整宽度' }) {
  return (
    <div
      className="splitter"
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      tabIndex={0}
      onPointerDown={drag.startDrag}
      onDoubleClick={drag.reset}
      onKeyDown={e => {
        if (e.key === 'ArrowLeft') { e.preventDefault(); drag.step(-1); }
        if (e.key === 'ArrowRight') { e.preventDefault(); drag.step(1); }
      }}
      title="拖动调整宽度（双击恢复默认）"
    />
  );
}

/* ============================================================
   空态：整窗拖放引导
   ============================================================ */
export function EmptyDropHint() {
  const { pick } = useImporter();
  return (
    <div className="dropzone" onClick={pick} style={{ cursor: 'pointer' }}>
      <div className="dz-ico">⇩</div>
      <div className="dz-title">{t('drop.title')}</div>
      <div className="dz-sub">
        {t('drop.sub')}
      </div>
    </div>
  );
}
