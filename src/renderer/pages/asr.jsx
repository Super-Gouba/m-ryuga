import React, { useEffect, useState } from 'react';
import { api, fmtBytes, registerPages, useStore } from '../App.jsx';

/* ============================================================
   语音转写（配置页）：引擎 / 模型 / 识别参数
   实际的转写入口在「通话分析 → 转写」页签
   ============================================================ */
function AsrPage() {
  const { showToast } = useStore();
  const [st, setSt] = useState(null);
  const [lang, setLang] = useState('zh');
  const [mode, setMode] = useState(() => localStorage.getItem('mryuga:asrMode') || 'merge');
  const [engineBusy, setEngineBusy] = useState(false);
  const [pct, setPct] = useState(0);

  const loadStatus = async () => setSt(await api.asrStatus().catch(() => null));
  useEffect(() => {
    loadStatus();
    api.settingsGet().then(s => { if (s?.asrLang) setLang(s.asrLang); }).catch(() => {});
    return api.on('asr:engine-progress', p => setPct(p?.pct || 0));
  }, []);

  const installEngine = async () => {
    setEngineBusy(true); setPct(0);
    try {
      const r = await api.asrInstallEngine();
      if (r.ok) { showToast('ok', '识别引擎已安装'); loadStatus(); }
      else showToast('err', r.error || '引擎安装失败');
    } finally { setEngineBusy(false); }
  };

  const pickEngine = async () => {
    const r = await api.asrPickEngine();
    if (r.ok) { showToast('ok', '已指定识别程序'); loadStatus(); }
  };

  const pickModel = async () => {
    const r = await api.asrPickModel();
    if (r.ok) { showToast('ok', '已设为当前模型'); loadStatus(); }
  };

  const changeLang = async (v) => {
    setLang(v);
    await api.settingsSet({ asrLang: v });
    showToast('ok', '已保存识别语言');
  };
  const changeMode = (v) => {
    setMode(v);
    localStorage.setItem('mryuga:asrMode', v);
  };

  const ready = !!st?.ready;

  return (
    <div className="page">
      <div className="page-inner">
        <div className="page-grid2">
          <section className="section">
            <div className="section-head">
              <span className="section-title">离线识别环境</span>
              <span className={`badge ${st?.engineOk ? 'ok' : 'err'}`}>引擎 {st?.engineOk ? '就绪' : '缺失'}</span>
              <span className={`badge ${st?.activeModel ? 'ok' : 'err'}`}>模型 {st?.activeModel ? '已加载' : '缺失'}</span>
              <div className="grow" />
              <button className="btn sm ghost" onClick={loadStatus}>重新检测</button>
            </div>

            <div className="kvl" style={{ marginBottom: 12 }}>
              <b>识别引擎</b>
              <span className="mono" style={{ wordBreak: 'break-all' }}>{st?.engine || '未找到（可一键下载）'}</span>
              <b>当前模型</b>
              <span className="mono" style={{ wordBreak: 'break-all' }}>{st?.activeModel || '未选择'}</span>
              <b>模型目录</b>
              <span className="mono" style={{ wordBreak: 'break-all' }}>{st?.modelDir || '—'}</span>
            </div>

            {engineBusy && (
              <div style={{ marginBottom: 10 }}>
                <div className="upd-prog"><i style={{ width: `${Math.round(pct * 100)}%` }} /></div>
                <div style={{ fontSize: 11.5, color: 'var(--fg3)', marginTop: 4 }}>
                  正在下载 whisper.cpp Windows 引擎 {Math.round(pct * 100)}%
                </div>
              </div>
            )}

            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button className="btn sm primary" onClick={installEngine} disabled={engineBusy}>
                {engineBusy ? `下载中 ${Math.round(pct * 100)}%` : '下载 Windows 引擎'}
              </button>
              <button className="btn sm" onClick={pickEngine} disabled={engineBusy}>选择程序文件…</button>
              <button className="btn sm" onClick={() => api.asrOpenModelsDir()}>打开模型目录</button>
              <button className="btn sm" onClick={pickModel}>选择模型文件…</button>
              <button className="btn sm ghost" onClick={() => api.updateOpenRelease(st?.engineDownload?.page || 'https://github.com/ggerganov/whisper.cpp/releases')}>官方 Releases ↗</button>
            </div>

            {!ready && (
              <div style={{ marginTop: 12, background: 'var(--warn-bg)', border: '1px solid #ecd9b6', borderRadius: 8, padding: '10px 12px', fontSize: 12.3, lineHeight: 1.95, color: 'var(--fg2)' }}>
                <b>环境未就绪</b>，按下面 3 步准备（全部本机运行、音频不出机）：
                <div style={{ marginTop: 6 }}>
                  1. 点「下载 Windows 引擎」自动获取 whisper.cpp 官方预编译版（约 {st?.engineDownload?.size || '8.5 MB'}，解压到 <span className="mono">models\bin\</span>）<br />
                  2. 下载 GGML 模型（推荐 <span className="mono">ggml-small.bin</span>，medium 在 CPU 上明显更慢），放进 <span className="mono">models\</span><br />
                  3. 点「重新检测」，两个徽标都变「就绪」即可去通话页转写
                </div>
                <div style={{ fontSize: 11.5, color: 'var(--fg3)', marginTop: 6 }}>
                  说明：官方 GitHub 的 latest 发布有时只带源码；本页固定使用带 Windows 二进制的构建版本。
                </div>
              </div>
            )}
          </section>

          <section className="section">
            <div className="section-head">
              <span className="section-title">推荐模型</span>
              <span className="section-desc">均为开源离线模型，下载后放入模型目录</span>
            </div>
            <table className="tbl">
              <thead><tr><th>模型</th><th>体积</th><th>说明</th><th></th></tr></thead>
              <tbody>
                {(st?.recommended || []).map(m => (
                  <tr key={m.file} style={{ cursor: 'default' }}>
                    <td className="mono">{m.file}</td>
                    <td style={{ color: 'var(--fg2)' }}>{m.size}</td>
                    <td style={{ color: 'var(--fg3)', fontSize: 12 }}>{m.note}</td>
                    <td style={{ textAlign: 'right' }}>
                      <button className="btn sm ghost" onClick={() => api.updateOpenRelease(m.url)}>下载</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!!st?.models?.length && (
              <>
                <div className="section-head" style={{ marginTop: 14 }}><span className="section-title">已检测到的模型</span></div>
                {st.models.map(m => (
                  <div key={m.path} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '5px 0', borderBottom: '1px dashed var(--line)', fontSize: 12 }}>
                    <span className="badge mut">{m.kind}</span>
                    <span className="mono" style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.name}</span>
                    <span style={{ color: 'var(--fg3)' }}>{m.size ? fmtBytes(m.size) : '—'}</span>
                  </div>
                ))}
              </>
            )}
          </section>
        </div>

        <section className="section">
          <div className="section-head">
            <span className="section-title">识别参数</span>
            <span className="section-desc">作为「通话分析 → 转写」的默认参数</span>
          </div>
          <div style={{ display: 'flex', gap: 18, alignItems: 'center', flexWrap: 'wrap' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5 }}>
              识别语言
              <select className="input" style={{ width: 150, height: 30 }} value={lang} onChange={e => changeLang(e.target.value)}>
                <option value="zh">中文</option>
                <option value="auto">自动检测</option>
                <option value="en">English</option>
              </select>
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5 }}>
              默认模式
              <select className="input" style={{ width: 150, height: 30 }} value={mode} onChange={e => changeMode(e.target.value)}>
                <option value="merge">合并识别</option>
                <option value="split">按方向分轨</option>
              </select>
            </label>
            <span style={{ fontSize: 11.5, color: 'var(--fg3)' }}>
              CPU 模式下 medium 较慢；追求速度可选 small / base。识别全程本机运行，切换页面不会中断。
            </span>
          </div>
          <div style={{ marginTop: 10, fontSize: 12, color: 'var(--fg2)' }}>
            转写入口已移到「通话分析 → 转写」页签：选中通话后即可开始识别、查看分段文本。
          </div>
        </section>
      </div>
    </div>
  );
}

registerPages({ AsrPage });
