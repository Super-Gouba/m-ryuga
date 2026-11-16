import React, { useEffect, useRef, useState } from 'react';
import { useStore, api, fmtBytes, fmtDur, fmtTime, trunc, registerPages } from '../App.jsx';

/* ============================================================
   实时抓包：开始 → 边抓边看 → 停止后决定「保存 / 丢弃」
   不默认落盘到用户目录，也不强制导入分析
   ============================================================ */
function LivePage() {
  const { dispatch, showToast } = useStore();
  const [env, setEnv] = useState(null);
  const [selIf, setSelIf] = useState([]);
  const [filter, setFilter] = useState('udp');
  const [mode, setMode] = useState('single');
  const [volSize, setVolSize] = useState('50');
  const [durSec, setDurSec] = useState('');
  const [phase, setPhase] = useState('idle');   // idle | running | stopped
  const [jobId, setJobId] = useState(null);
  const [snap, setSnap] = useState(null);
  const [stopped, setStopped] = useState(null); // { files, totalBytes, preview }
  const [logs, setLogs] = useState([]);
  const [busy, setBusy] = useState(false);
  const [history, setHistory] = useState([]);
  const jobRef = useRef(null);

  const loadEnv = async () => setEnv(await api.liveNpcapStatus().catch(() => null));

  useEffect(() => {
    loadEnv();
    const offs = [
      api.on('live:snapshot', s => {
        if (s.jobId !== jobRef.current) return;
        setSnap(s);
        if (s.preview?.packets != null) setLogs(ls => ls); // 保持引用稳定
      }),
      api.on('live:log', l => {
        if (l.jobId !== jobRef.current) return;
        setLogs(ls => [...ls.slice(-120), String(l.line || '').trim()].filter(Boolean));
      }),
      api.on('live:stopped', async s => {
        if (s.jobId !== jobRef.current) return;
        // dumpcap 自行退出（达到时长/大小上限）也走「保存或丢弃」
        setStopped({ files: s.files || [], totalBytes: s.totalBytes || 0 });
        setPhase('stopped');
      })
    ];
    return () => offs.forEach(f => f());
  }, []);

  const toggleIf = idx => setSelIf(s => s.includes(idx) ? s.filter(x => x !== idx) : (s.length >= 8 ? s : [...s, idx]));

  const start = async () => {
    if (!selIf.length) return showToast('err', '请先选择网卡（最多 8 张）');
    setBusy(true);
    try {
      const cfg = { ifIdxs: selIf, filter: filter.trim(), mode, volSizeMB: +volSize || 50, keepFiles: 10 };
      if (durSec) cfg.durationSec = +durSec;
      const r = await api.liveStart(cfg);
      if (!r.ok) return showToast('err', r.error || '启动失败');
      jobRef.current = r.jobId;
      setJobId(r.jobId);
      setPhase('running');
      setSnap(null); setStopped(null); setLogs([]);
      showToast('ok', '开始抓包，数据先写入临时文件');
    } finally { setBusy(false); }
  };

  const stop = async () => {
    setBusy(true);
    try {
      const r = await api.liveStop(jobId);
      if (!r.ok) return showToast('err', r.error || '停止失败');
      setStopped({ files: r.files || [], totalBytes: r.totalBytes || 0, preview: r.preview });
      setSnap(s => s ? { ...s, preview: r.preview || s.preview } : s);
      setPhase('stopped');
    } finally { setBusy(false); }
  };

  const save = async () => {
    const r = await api.liveSave(jobId);
    if (r.canceled) return;
    if (!r.ok) return showToast('err', r.error || '保存失败');
    showToast('ok', `已保存到 ${r.path}`);
    setHistory(h => [{ jobId, path: r.path, size: r.size, at: Date.now() }, ...h].slice(0, 8));
    await api.liveDiscard(jobId);
    reset();
  };

  const discard = async () => {
    await api.liveDiscard(jobId);
    showToast('info', '已丢弃本次抓包');
    reset();
  };

  const analyzeSaved = async () => {
    const r = await api.liveSave(jobId);
    if (canceledOrFail(r)) return;
    const sniff = await api.sniff(r.path);
    if (!sniff.ok) return showToast('err', sniff.error);
    const res = await api.analyzeStart(r.path);
    if (!res.ok) return showToast('err', res.error);
    dispatch({ type: 'fileAdded', file: { fileId: res.fileId, fileName: res.fileName, path: r.path, stats: res.stats, truncated: res.truncated, calls: res.calls } });
    showToast('ok', `已导入分析：${res.calls.length} 通通话`);
    await api.liveDiscard(jobId);
    reset();
    dispatch({ type: 'page', page: 'calls' });
  };

  const canceledOrFail = r => {
    if (r.canceled) return true;
    if (!r.ok) { showToast('err', r.error || '保存失败'); return true; }
    return false;
  };

  const reset = () => {
    jobRef.current = null;
    setJobId(null); setPhase('idle'); setSnap(null); setStopped(null); setLogs([]);
  };

  const ready = !!(env?.npcap?.installed && env?.dumpcap);
  const view = snap?.preview || stopped?.preview || null;

  if (phase === 'running' || phase === 'stopped') {
    const up = snap?.uptimeSec ?? 0;
    const size = stopped?.totalBytes ?? snap?.totalBytes ?? 0;
    return (
      <div className="page">
        <div className="page-inner wide">
          <div className="metrics">
            <div className="metric accent">
              <div className="m-label">状态</div>
              <div className="m-value" style={{ fontSize: 15 }}>
                {phase === 'running' ? <span className="pulsing" style={{ color: 'var(--red)' }}>● 抓包中</span> : '已停止'}
                <small>{fmtDur(up)}</small>
              </div>
            </div>
            <div className="metric"><div className="m-label">报文</div><div className="m-value">{view?.packets ?? 0}</div></div>
            <div className="metric"><div className="m-label">SIP 信令</div><div className="m-value">{view?.sip ?? 0}</div></div>
            <div className="metric"><div className="m-label">RTP 包</div><div className="m-value">{view?.rtp ?? 0}</div></div>
            <div className="metric"><div className="m-label">通话</div><div className="m-value">{view?.calls?.length ?? 0}</div></div>
            <div className="metric"><div className="m-label">按键</div><div className="m-value">{view?.dtmf?.length ?? 0}</div></div>
            <div className="metric"><div className="m-label">临时文件</div><div className="m-value">{fmtBytes(size)}</div></div>
          </div>

          <section className="section">
            <div className="section-head">
              <span className="section-title">实时通话</span>
              <span className="section-desc">抓包尚未保存，停止后可选择保存或丢弃</span>
              <div className="grow" />
              {(view?.dtmf || []).slice(-8).map((d, i) => (
                <span key={i} className="dtmf-pill">按键 {d.digit}</span>
              ))}
            </div>
            <div style={{ maxHeight: 420, overflow: 'auto' }}>
              <table className="tbl">
                <thead><tr><th>主叫</th><th>被叫</th><th>开始</th><th>信令数</th><th>状态</th></tr></thead>
                <tbody>
                  {(view?.calls || []).map(c => (
                    <tr key={c.callId} style={{ cursor: 'default' }}>
                      <td className="mono">{c.from || '—'}</td>
                      <td className="mono">{c.to || '—'}</td>
                      <td className="mono">{fmtTime(c.tStart)}</td>
                      <td className="mono">{c.msgs}</td>
                      <td>{c.status ? <span className={`badge ${c.status >= 400 ? 'err' : c.status >= 200 ? 'ok' : 'info'}`}>{c.status}</span> : <span className="badge info">进行中</span>}</td>
                    </tr>
                  ))}
                  {!(view?.calls || []).length && (
                    <tr><td colSpan={5} style={{ color: 'var(--fg3)', padding: 16 }}>
                      {phase === 'running' ? '等待 SIP 报文…（确认过滤条件包含 5060 端口）' : '本次没有捕获到通话'}
                    </td></tr>
                  )}
                </tbody>
              </table>
            </div>
            {logs.length > 0 && <div className="logbox" style={{ maxHeight: 74, marginTop: 10 }}>{logs.slice(-4).map((l, i) => <div key={i}>{l}</div>)}</div>}
          </section>

          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
            {phase === 'running' ? (
              <button className="btn danger" onClick={stop} disabled={busy}>■ 停止抓包</button>
            ) : (
              <>
                <button className="btn primary" onClick={save}>保存抓包文件…</button>
                <button className="btn" onClick={analyzeSaved}>保存并导入分析</button>
                <button className="btn ghost" onClick={discard}>丢弃</button>
              </>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      <div className="page-inner wide">
        <div className="page-grid2" style={{ gridTemplateColumns: 'minmax(0, 1.15fr) minmax(0, 0.85fr)' }}>
          <section className="section">
            <div className="section-head">
              <span className="section-title">抓包环境</span>
              <span className={`badge ${env?.npcap?.installed ? 'ok' : 'err'}`}>npcap {env?.npcap?.installed ? '已安装' : '未安装'}</span>
              <span className={`badge ${env?.dumpcap ? 'ok' : 'err'}`}>dumpcap {env?.dumpcap ? '可用' : '缺失'}</span>
              <div className="grow" />
              <button className="btn sm ghost" onClick={loadEnv}>重新检测</button>
            </div>
            {!ready && (
              <div style={{ fontSize: 12.5, lineHeight: 1.9, color: 'var(--fg2)', background: 'var(--warn-bg)', border: '1px solid #ecd9b6', borderRadius: 8, padding: '10px 12px', marginBottom: 12 }}>
                实时抓包需要 <b>npcap</b> 与 <b>dumpcap.exe</b>（随 Wireshark 安装）。
                <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
                  <button className="btn sm" onClick={() => api.updateOpenRelease('https://npcap.com/#download')}>下载 npcap</button>
                  <button className="btn sm" onClick={() => api.updateOpenRelease('https://www.wireshark.org/download.html')}>下载 Wireshark</button>
                </div>
              </div>
            )}

            <div style={{ fontSize: 12, color: 'var(--fg3)', marginBottom: 6 }}>选择网卡（可多选，最多 8 张）</div>
            <div style={{ maxHeight: 280, overflow: 'auto', border: '1px solid var(--line)', borderRadius: 8 }}>
              {(env?.ifaces || []).length === 0 && <div style={{ padding: 12, color: 'var(--fg3)', fontSize: 12.5 }}>未枚举到接口</div>}
              {(env?.ifaces || []).map(ifc => (
                <label key={ifc.idx} className="ck" style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', borderBottom: '1px solid var(--line)', cursor: 'pointer' }}>
                  <input type="checkbox" checked={selIf.includes(ifc.idx)} onChange={() => toggleIf(ifc.idx)} />
                  <span className="badge mut" style={{ minWidth: 24, textAlign: 'center' }}>{ifc.idx}</span>
                  <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 12.5 }} title={ifc.device}>{trunc(ifc.desc, 68)}</span>
                </label>
              ))}
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 120px', gap: 8, marginTop: 12 }}>
              <div>
                <div style={{ fontSize: 12, color: 'var(--fg3)', marginBottom: 4 }}>过滤（BPF）</div>
                <input className="input mono" style={{ width: '100%' }} value={filter} onChange={e => setFilter(e.target.value)}
                  placeholder="udp port 5060 or udp portrange 10000-20000" />
              </div>
              <div>
                <div style={{ fontSize: 12, color: 'var(--fg3)', marginBottom: 4 }}>自动停止</div>
                <input className="input" style={{ width: '100%' }} placeholder="秒（可空）" value={durSec}
                  onChange={e => setDurSec(e.target.value.replace(/\D/g, ''))} />
              </div>
            </div>

            <div style={{ marginTop: 10 }}>
              <div style={{ fontSize: 12, color: 'var(--fg3)', marginBottom: 4 }}>写出模式</div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <select className="input" style={{ width: 130 }} value={mode} onChange={e => setMode(e.target.value)}>
                  <option value="single">单文件</option>
                  <option value="multi">分卷</option>
                  <option value="ring">循环覆盖</option>
                </select>
                {mode !== 'single' && (
                  <>
                    <input className="input" style={{ width: 70 }} value={volSize} onChange={e => setVolSize(e.target.value.replace(/\D/g, ''))} />
                    <span style={{ fontSize: 12, color: 'var(--fg3)' }}>MB / 卷</span>
                  </>
                )}
              </div>
            </div>

            <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
              <button className="btn primary" onClick={start} disabled={!ready || busy}>⏺ 开始抓包</button>
              <span style={{ fontSize: 11.5, color: 'var(--fg3)', alignSelf: 'center' }}>数据先写入临时目录，停止后再决定是否保存</span>
            </div>
          </section>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <section className="section">
              <div className="section-head"><span className="section-title">工作方式</span></div>
              <div style={{ fontSize: 12.5, color: 'var(--fg2)', lineHeight: 2 }}>
                · 抓包期间实时汇总通话、信令、按键，不必等结束<br />
                · 结束时弹出选择：<b>保存</b>到指定位置 / <b>丢弃</b>不留下文件<br />
                · 需要深入分析时再点「保存并导入分析」，不会自动占用文件<br />
                · 断电或异常退出时，临时文件仍在缓存目录可恢复
              </div>
            </section>
            {history.length > 0 && (
              <section className="section">
                <div className="section-head"><span className="section-title">已保存</span></div>
                {history.map(h => (
                  <div key={h.at} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 0', borderBottom: '1px dashed var(--line)', fontSize: 12 }}>
                    <span className="mono" style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{h.path}</span>
                    <span style={{ color: 'var(--fg3)' }}>{fmtBytes(h.size)}</span>
                    <button className="btn sm ghost" onClick={() => api.showInFolder(h.path)}>打开</button>
                  </div>
                ))}
              </section>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

registerPages({ LivePage });
