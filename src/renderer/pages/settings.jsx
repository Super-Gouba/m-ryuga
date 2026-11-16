import React, { useEffect, useState } from 'react';
import { useStore, api, registerPages, fmtBytes } from '../App.jsx';
import { t, getLang, setLang } from '../i18n.js';

/* ============================================================
   设置：左侧分类导航 + 右侧纵向分组（参考成熟桌面产品的设置范式）
   ============================================================ */

const GROUPS = [
  {
    titleKey: 'set.group.general',
    items: [
      { id: 'language', icon: '文', key: 'set.language' },
      { id: 'storage', icon: '▤', key: 'set.storage' }
    ]
  },
  {
    titleKey: 'set.group.engine',
    items: [
      { id: 'decode', icon: '◈', key: 'set.decode' },
      { id: 'asr', icon: '⌨', key: 'set.asr' }
    ]
  },
  {
    titleKey: 'set.group.about',
    items: [{ id: 'about', icon: 'ⓘ', key: 'set.about' }]
  }
];

const REPO_URL = 'https://github.com/Super-Gouba/m-ryuga';

function SettingsPage() {
  const { dispatch, showToast } = useStore();
  const [pane, setPane] = useState('language');
  const [upd, setUpd] = useState(null);
  const [paths, setPaths] = useState(null);
  const [ver, setVer] = useState('');
  const [checking, setChecking] = useState(false);
  const [asr, setAsr] = useState(null);

  const loadUpd = () => api.updateGetSettings?.().then(setUpd).catch(() => {});
  useEffect(() => {
    loadUpd();
    api.paths().then(setPaths).catch(() => {});
    api.version().then(setVer).catch(() => {});
    api.asrStatus?.().then(setAsr).catch(() => {});
  }, []);

  const manualCheck = async () => {
    setChecking(true);
    try {
      const r = await api.updateCheck();
      if (r.ok && r.isNewer) dispatch({ type: 'update', info: r });
      else if (r.ok) { showToast('ok', `${t('set.upToDate')}（v${r.current}）`); loadUpd(); }
      else showToast('err', `${t('set.checkFail')}：${r.reason || 'network unreachable'}`);
    } finally { setChecking(false); }
  };

  return (
    <div className="settings-shell">
      <aside className="settings-nav">
        <div className="sn-head">
          <button className="sn-back" title={t('common.back')} onClick={() => dispatch({ type: 'page', page: 'calls' })}>←</button>
          {t('set.title')}
        </div>
        {GROUPS.map(g => (
          <div key={g.titleKey}>
            <div className="sn-group">{t(g.titleKey)}</div>
            {g.items.map(it => (
              <div key={it.id} className="sn-item" data-active={pane === it.id || undefined} onClick={() => setPane(it.id)}>
                <span className="sn-ico">{it.icon}</span>{t(it.key)}
              </div>
            ))}
          </div>
        ))}
        <div style={{ flex: 1 }} />
        <div className="sn-foot mono">v{ver || '—'}</div>
      </aside>

      <div className="settings-content">
        <div className="settings-inner">
          {pane === 'language' && (
            <>
              <div className="settings-title">{t('set.language')}</div>
              <section className="section">
                <div className="set-row">
                  <div>
                    <div className="set-label">{t('set.language')}</div>
                    <div className="set-desc">{t('set.languageDesc')}</div>
                  </div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button className={`btn sm ${getLang() === 'en' ? 'primary' : ''}`} onClick={() => { setLang('en'); dispatch({ type: 'toast', toast: { kind: 'ok', text: 'Language: English' } }); }}>English</button>
                    <button className={`btn sm ${getLang() === 'zh' ? 'primary' : ''}`} onClick={() => { setLang('zh'); dispatch({ type: 'toast', toast: { kind: 'ok', text: '界面语言：简体中文' } }); }}>简体中文</button>
                  </div>
                </div>
              </section>
            </>
          )}
          {pane === 'storage' && (
            <>
              <div className="settings-title">{t('set.storage')}</div>
              <section className="section">
                {paths && [['应用数据', paths.userData], ['导出目录', paths.exports], ['缓存目录', paths.cache]].map(([label, p]) => (
                  <div key={label} className="set-row">
                    <div style={{ minWidth: 0 }}>
                      <div className="set-label">{label}</div>
                      <div className="set-desc mono" style={{ wordBreak: 'break-all' }}>{p}</div>
                    </div>
                    <button className="btn sm" onClick={() => api.showInFolder(p)}>打开</button>
                  </div>
                ))}
                <div className="set-row">
                  <div>
                    <div className="set-label">模型目录</div>
                    <div className="set-desc mono" style={{ wordBreak: 'break-all' }}>{asr?.modelDir || '—'}</div>
                  </div>
                  <button className="btn sm" onClick={() => api.asrOpenModelsDir()}>打开</button>
                </div>
              </section>
            </>
          )}

          {pane === 'decode' && (
            <>
              <div className="settings-title">{t('set.decode')}</div>
              <section className="section">
                <div className="set-row">
                  <div><div className="set-label">内置音频解码</div><div className="set-desc">G.711 μ / A 律、G.722</div></div>
                  <span className="badge ok">可用</span>
                </div>
                <div className="set-row">
                  <div><div className="set-label">扩展解码</div><div className="set-desc">G.729 / Opus / AMR 需加载 wasm 扩展槽，缺失时提示不支持</div></div>
                  <span className="badge mut">按需加载</span>
                </div>
                <div className="set-row">
                  <div><div className="set-label">实时抓包</div><div className="set-desc">npcap + dumpcap，支持多网卡与 BPF 过滤</div></div>
                  <span className="badge mut">外部依赖</span>
                </div>
                <div className="set-row">
                  <div><div className="set-label">DTMF 识别</div><div className="set-desc">RFC 2833/4733、SIP INFO、带内音频三通道</div></div>
                  <span className="badge ok">已启用</span>
                </div>
              </section>
            </>
          )}

          {pane === 'asr' && (
            <>
              <div className="settings-title">{t('set.asr')}</div>
              <section className="section">
                <div className="set-row">
                  <div><div className="set-label">识别引擎</div>
                    <div className="set-desc mono" style={{ wordBreak: 'break-all' }}>{asr?.engine || '未找到 whisper-cli.exe'}</div>
                  </div>
                  <span className={`badge ${asr?.engineOk ? 'ok' : 'err'}`}>{asr?.engineOk ? '就绪' : '缺失'}</span>
                </div>
                <div className="set-row">
                  <div><div className="set-label">当前模型</div>
                    <div className="set-desc mono" style={{ wordBreak: 'break-all' }}>{asr?.activeModel || '未选择'}</div>
                  </div>
                  <span className={`badge ${asr?.activeModel ? 'ok' : 'err'}`}>{asr?.activeModel ? '已加载' : '缺失'}</span>
                </div>
                <div className="set-row">
                  <div><div className="set-label">模型管理</div><div className="set-desc">在「语音转写」页查看推荐模型、下载链接与安装步骤</div></div>
                  <button className="btn sm" onClick={() => dispatch({ type: 'page', page: 'asr' })}>前往设置</button>
                </div>
              </section>
            </>
          )}

          {pane === 'about' && (
            <>
              <div className="settings-title">{t('set.about')}</div>
              <section className="section">
                <div className="about-head">
                  <div className="brandmark" style={{ width: 44, height: 44, fontSize: 20 }}>M</div>
                  <div style={{ minWidth: 0 }}>
                    <div className="about-name">M-Ryuga</div>
                    <div className="set-desc">{t('set.aboutDesc')} · v{ver || '—'}</div>
                  </div>
                  <div style={{ flex: 1 }} />
                  <div className="about-links">
                    <button className="linkbtn" title={REPO_URL} onClick={() => api.updateOpenRelease(REPO_URL)}>GitHub ↗</button>
                    <button className="linkbtn" onClick={() => api.updateOpenRelease(`${REPO_URL}/blob/main/LICENSE`)}>MIT ↗</button>
                  </div>
                </div>
                <div className="set-row">
                  <div><div className="set-label">{t('set.localFirst')}</div><div className="set-desc">{t('set.localFirstDesc')}</div></div>
                </div>
                <div className="set-row">
                  <div><div className="set-label">{t('set.flavors')}</div><div className="set-desc">{t('set.flavorsDesc')}</div></div>
                </div>
                <div className="set-row">
                  <div><div className="set-label">{t('set.shortcuts')}</div><div className="set-desc">{t('set.shortcutsDesc')}</div></div>
                </div>
                <div className="set-row">
                  <div>
                    <div className="set-label">{t('set.openSource')}</div>
                    <div className="set-desc mono" style={{ wordBreak: 'break-all' }}>{REPO_URL}</div>
                  </div>
                  <button className="btn sm" onClick={() => api.updateOpenRelease(REPO_URL)}>{t('set.open')}</button>
                </div>
                <div className="set-row">
                  <div><div className="set-label">{t('set.appData')}</div><div className="set-desc mono">%APPDATA%\M-Ryuga</div></div>
                  <button className="btn sm ghost" onClick={() => api.showInFolder(paths?.userData || '')}>{t('set.open')}</button>
                </div>
              </section>

              <div className="settings-subtitle">{t('set.update')}</div>
              <section className="section">
                <div className="set-row">
                  <div>
                    <div className="set-label">{t('set.current')}</div>
                    <div className="set-desc">{t('set.channel')}</div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span className="badge mut">v{ver || '—'}</span>
                    <button className="btn primary" onClick={manualCheck} disabled={checking}>{checking ? t('set.checking') : t('set.check')}</button>
                  </div>
                </div>
                <div className="set-row">
                  <div>
                    <div className="set-label">{t('set.autoCheck')}</div>
                    <div className="set-desc">{t('set.autoCheckDesc')}</div>
                  </div>
                  <div className={`switch ${upd?.startupCheck ? 'on' : ''}`} role="switch" aria-checked={!!upd?.startupCheck}
                    onClick={() => api.updateSetStartup(!upd?.startupCheck).then(loadUpd)} />
                </div>
                {upd?.ignoredVersion && (
                  <div className="set-row">
                    <div>
                      <div className="set-label">{t('set.ignored')}</div>
                      <div className="set-desc">v{upd.ignoredVersion} · {t('set.ignoredDesc')}</div>
                    </div>
                    <button className="btn sm ghost" onClick={() => api.updateIgnore(null).then(loadUpd)}>{t('set.unignore')}</button>
                  </div>
                )}
                {upd?.pending && (
                  <div className="set-row">
                    <div>
                      <div className="set-label">{t('set.pending')}</div>
                      <div className="set-desc">{t('set.pendingDesc')}</div>
                    </div>
                    <button className="btn sm ghost" onClick={() => api.updateClearPending().then(loadUpd)}>{t('set.clear')}</button>
                  </div>
                )}
              </section>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/* ---------- 更新弹窗 ---------- */
function UpdateModal({ info, onClose }) {
  return (
    <Overlay>
      <div className="card" style={{ width: 560, maxWidth: '92vw', maxHeight: '72vh', display: 'flex', flexDirection: 'column', padding: 20 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
          <span style={{ fontSize: 17, fontWeight: 700, color: 'var(--fg)' }}>发现新版本</span>
          <span className="badge ok">v{info.latest}</span>
          {info.current && <span style={{ color: 'var(--fg3)', fontSize: 12 }}>当前 v{info.current}</span>}
          <div style={{ flex: 1 }} />
          <button className="btn sm ghost" onClick={onClose}>✕</button>
        </div>
        <div style={{ flex: 1, overflow: 'auto', margin: '12px 0', background: 'var(--bg3)', borderRadius: 8, padding: 14, whiteSpace: 'pre-wrap', fontSize: 12.5, lineHeight: 1.8, color: 'var(--fg2)' }}>
          {info.notes || '（发布说明为空）'}
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="btn primary" onClick={() => { api.updateOpenRelease(info.url); onClose(); }}>浏览器打开发布页</button>
          <button className="btn" onClick={onClose}>稍后提醒</button>
          <button className="btn ghost" onClick={() => { api.updateIgnore(info.latest); onClose(); }}>忽略此版本</button>
          <button className="btn ghost" onClick={() => { api.updateSetStartup(false); onClose(); }}>关闭启动检查</button>
        </div>
      </div>
    </Overlay>
  );
}

/* ---------- 关闭弹窗 ---------- */
function CloseModal({ onClose }) {
  const [remember, setRemember] = useState(false);
  const act = (a) => api.resolveClose(a, remember);
  return (
    <Overlay>
      <div className="card" style={{ width: 420, maxWidth: '90vw', padding: 22 }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--fg)', marginBottom: 6 }}>关闭 M-Ryuga</div>
        <div style={{ fontSize: 12.5, color: 'var(--fg2)', marginBottom: 14 }}>选择窗口关闭行为（隐藏到托盘后分析与抓包任务将继续运行）</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <button className="btn" onClick={() => act('tray')}>⇲ 隐藏到托盘并继续运行</button>
          <button className="btn danger" onClick={() => act('exit')}>⏻ 退出应用</button>
          <button className="btn ghost" onClick={async () => { await api.cancelClose(); onClose(); }}>取消</button>
        </div>
        <label className="ck" style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 14, fontSize: 12.5, cursor: 'pointer' }}>
          <input type="checkbox" checked={remember} onChange={e => setRemember(e.target.checked)} />
          记住我的选择，下次不再询问
        </label>
      </div>
    </Overlay>
  );
}

function Overlay({ children }) {
  return <div className="modal-mask">{children}</div>;
}

registerPages({ SettingsPage, UpdateModal, CloseModal });
