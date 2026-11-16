import React, { useEffect, useMemo, useState } from 'react';
import { useStore, api, fmtTime, fmtBytes, trunc, registerPages } from '../App.jsx';

/* ============================================================
   语音转写：whisper.cpp 离线引擎 + GGML 模型
   模型与引擎就位即可直接识别，未就位时给出可执行的安装步骤
   ============================================================ */
function AsrPage() {
  const { state, showToast } = useStore();
  const { calls } = state;
  const [st, setSt] = useState(null);
  const [sel, setSel] = useState('');
  const [mode, setMode] = useState('merge');
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);

  const loadStatus = async () => setSt(await api.asrStatus().catch(() => null));
  useEffect(() => { loadStatus(); }, []);

  const pickModel = async () => {
    const r = await api.asrPickModel();
    if (r.ok) { showToast('ok', '已设为当前模型'); loadStatus(); }
  };

  const run = async () => {
    const c = calls.find(x => `${x.fileId}|${x.callId}` === sel);
    if (!c) return showToast('err', '请选择要转写的通话');
    setBusy(true); setResult(null);
    try { setResult(await api.asrTranscribe({ fileId: c.fileId, callId: c.callId, mode })); }
    finally { setBusy(false); }
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
              <span className="mono" style={{ wordBreak: 'break-all' }}>{st?.engine || '未找到 whisper-cli.exe'}</span>
              <b>当前模型</b>
              <span className="mono" style={{ wordBreak: 'break-all' }}>{st?.activeModel || '未选择'}</span>
              <b>模型目录</b>
              <span className="mono" style={{ wordBreak: 'break-all' }}>{st?.modelDir || '—'}</span>
            </div>

            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button className="btn sm" onClick={() => api.asrOpenModelsDir()}>打开模型目录</button>
              <button className="btn sm" onClick={pickModel}>选择模型文件…</button>
              <button className="btn sm ghost" onClick={() => api.updateOpenRelease('https://github.com/ggerganov/whisper.cpp/releases')}>下载 whisper.cpp</button>
            </div>

            {!ready && (
              <div style={{ marginTop: 12, background: 'var(--warn-bg)', border: '1px solid #ecd9b6', borderRadius: 8, padding: '10px 12px', fontSize: 12.3, lineHeight: 1.95, color: 'var(--fg2)' }}>
                <b>还没有可用的离线识别环境</b>，按下面 3 步准备（全部本机运行、音频不出机）：
                <div style={{ marginTop: 6 }}>
                  1. 下载 whisper.cpp Windows 发布包，把 <span className="mono">whisper-cli.exe</span> 及其依赖 dll 放进 <span className="mono">models\bin\</span><br />
                  2. 下载下面的 GGML 模型（推荐 <span className="mono">ggml-small.bin</span>），放进 <span className="mono">models\</span><br />
                  3. 回到本页点「重新检测」，状态变为「就绪」即可开始转写
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
            <span className="section-title">开始转写</span>
            <span className="section-desc">对已导入的通话解码音频后送入本地引擎</span>
          </div>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <select className="input" style={{ flex: 1, minWidth: 260 }} value={sel} onChange={e => setSel(e.target.value)}>
              <option value="">— 选择通话 —</option>
              {calls.map(c => (
                <option key={c.id} value={`${c.fileId}|${c.callId}`}>
                  {trunc(c.summary.fromUser || '?', 12)} → {trunc(c.summary.toUser || '?', 12)} · {fmtTime(c.summary.tStart)} · {(c.summary.codecs || []).join('/') || '未知编码'}
                </option>
              ))}
            </select>
            <select className="input" style={{ width: 150 }} value={mode} onChange={e => setMode(e.target.value)}>
              <option value="merge">合并识别</option>
              <option value="split">按方向分轨</option>
            </select>
            <button className="btn primary" onClick={run} disabled={busy || !sel || !ready}>{busy ? '识别中…' : '开始转写'}</button>
          </div>
          {!ready && <div style={{ fontSize: 11.5, color: 'var(--fg3)', marginTop: 8 }}>环境未就绪时按钮不可用，按左侧步骤准备后可立即使用。</div>}
        </section>

        {result && (
          <section className="section">
            {result.ok ? (
              <>
                <div className="section-head">
                  <span className="section-title">识别结果</span>
                  <span className="badge ok">{result.model}</span>
                  <span className="badge mut">{result.segments?.length || 0} 段</span>
                  <div className="grow" />
                  <input className="input" style={{ width: 220 }} placeholder="搜索文本…" value={q} onChange={e => setQ(e.target.value)} />
                </div>
                <TranscriptView segments={result.segments || []} q={q} />
              </>
            ) : (
              <>
                <div className="section-head">
                  <span className="section-title">无法转写</span>
                  <span className="badge warn">{result.code || 'error'}</span>
                </div>
                <div style={{ fontSize: 12.5, color: 'var(--red)' }}>{result.error}</div>
                {result.hint && <div style={{ fontSize: 12.3, color: 'var(--fg2)', marginTop: 6, lineHeight: 1.9 }}>{result.hint}</div>}
              </>
            )}
          </section>
        )}
      </div>
    </div>
  );
}

function TranscriptView({ segments, q }) {
  const hit = useMemo(() => (q ? segments.filter(s => (s.text || '').includes(q)) : segments), [segments, q]);
  return (
    <div style={{ maxHeight: 420, overflow: 'auto' }}>
      {hit.map((s, i) => (
        <div key={i} style={{ display: 'flex', gap: 10, padding: '7px 2px', borderBottom: '1px solid var(--line)', fontSize: 13 }}>
          <span className="mono" style={{ color: 'var(--accent)', minWidth: 68 }}>{s.startFmt || '00:00.0'}</span>
          {s.ch && s.ch !== 'mix' && <span className="badge mut" style={{ minWidth: 46 }}>{s.ch === 'a' ? '主叫' : '被叫'}</span>}
          <span style={{ flex: 1, color: 'var(--fg)' }}>{s.text}</span>
        </div>
      ))}
      {hit.length === 0 && <div className="empty">无匹配文本</div>}
    </div>
  );
}

registerPages({ AsrPage });
