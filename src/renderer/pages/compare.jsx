import React, { useEffect, useState } from 'react';
import { useStore, api, fmtTime, trunc, registerPages } from '../App.jsx';

/* ============================================================
   抓包对照页（要求④）：双文件事务匹配 / 手动时间校准 /
   Replaces·Join·Refer-To 证据与候选段 确认/移除/定位
   ============================================================ */

function fmtOff(us) {
  const s = us >= 0 ? '+' : '−';
  const a = Math.abs(us);
  if (a < 2000) return `${s}${a} µs`;
  if (a < 2e6) return `${s}${(a / 1000).toFixed(1)} ms`;
  return `${s}${(a / 1e6).toFixed(2)} s`;
}

function ComparePage() {
  const { state, dispatch, showToast } = useStore();
  const { files, calls } = state;
  const [fa, setFa] = useState('');
  const [fb, setFb] = useState('');
  const [pairs, setPairs] = useState(null);
  const [busy, setBusy] = useState(false);
  const [evFile, setEvFile] = useState('');
  const [events, setEvents] = useState([]);
  const [confirmed, setConfirmed] = useState([]);   // [{ fromCallId, targetCallId, fileId }]
  const [removed, setRemoved] = useState(() => new Set());
  const [manualMs, setManualMs] = useState('');

  const loadTransfers = async (fid) => {
    setEvFile(fid || '');
    if (!fid) { setEvents([]); return; }
    const r = await api.compareTransfers(fid);
    setEvents(r.ok ? r.events || [] : []);
  };

  const runCompare = async () => {
    if (!fa || !fb) return showToast('err', '请选择两个抓包文件');
    if (fa === fb) return showToast('err', '请选择两个不同的文件');
    setBusy(true);
    try {
      const r = await api.compareRun(fa, fb);
      if (r.ok) {
        setPairs(r.pairs || []);
        showToast(r.pairs.length ? 'ok' : 'info', `匹配到 ${r.pairs.length} 个同事务 Call-ID`);
      } else showToast('err', r.error);
    } finally { setBusy(false); }
  };

  const calibrate = async (offsetUs, label) => {
    const r = await api.compareCalibrate(fb, offsetUs);
    if (r.ok) {
      showToast('ok', `已校准文件 B（${label}），重新匹配…`);
      const rr = await api.compareRun(fa, fb);
      if (rr.ok) setPairs(rr.pairs || []);
    }
  };

  const locateCall = (callId) => {
    const c = calls.find(x => x.callId === callId);
    if (c) dispatch({ type: 'select', sel: { fileId: c.fileId, callId } });
    else showToast('warn', `通话 ${trunc(callId, 24)} 不在已导入文件中`);
  };

  const confirmEv = (ev, cand) => {
    const key = `${ev.fromCallId}|${cand.callId}`;
    setConfirmed(cf => cf.some(x => x.key === key) ? cf : [...cf, { key, fromCallId: ev.fromCallId, targetCallId: cand.callId, type: ev.type }]);
    showToast('ok', '已确认关联');
  };
  const removeEv = (ev, cand) => setRemoved(rm => new Set(rm).add(`${ev.fromCallId}|${cand.callId}|${ev.tsUs}`));

  if (files.length < 2) {
    return (
      <div className="empty" style={{ flex: 1 }}>
        <div className="ico">⇄</div>
        <div style={{ fontSize: 16, color: 'var(--fg2)' }}>抓包对照需要至少两个已导入文件</div>
        <div style={{ color: 'var(--fg3)', fontSize: 12.5 }}>通过顶栏「导入抓包」加入多份 PCAP / PCAPNG 后开始匹配</div>
      </div>
    );
  }

  return (
    <div style={{ flex: 1, overflow: 'auto', padding: '18px 22px', display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* 匹配区 */}
      <div className="card" style={{ padding: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
          <span style={{ fontFamily: 'var(--font-disp)', fontWeight: 700, color: 'var(--cyan)', letterSpacing: 1 }}>事务匹配</span>
          <span style={{ color: 'var(--fg3)', fontSize: 12 }}>同一 SIP Call-ID + CSeq 锚点对齐，估算两文件时钟差</span>
          <div style={{ flex: 1 }} />
          <button className="btn primary" onClick={runCompare} disabled={busy}>{busy ? '匹配中…' : '开始匹配'}</button>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <select className="input" style={{ flex: 1 }} value={fa} onChange={e => setFa(e.target.value)}>
            <option value="">— 文件 A（基准）—</option>
            {files.map(f => <option key={f.fileId} value={f.fileId}>{f.fileName}</option>)}
          </select>
          <span style={{ color: 'var(--cyan)', fontSize: 16 }}>⇄</span>
          <select className="input" style={{ flex: 1 }} value={fb} onChange={e => setFb(e.target.value)}>
            <option value="">— 文件 B（待校准）—</option>
            {files.map(f => <option key={f.fileId} value={f.fileId}>{f.fileName}</option>)}
          </select>
        </div>
        {pairs && (
          <table className="tbl" style={{ marginTop: 12 }}>
            <thead><tr><th>Call-ID</th><th>匹配报文</th><th>置信度</th><th>时钟差（A − B）</th><th>操作</th></tr></thead>
            <tbody>
              {pairs.length === 0 && <tr><td colSpan={5} style={{ color: 'var(--fg3)' }}>无共同事务</td></tr>}
              {pairs.map(p => (
                <tr key={p.callId}>
                  <td className="mono" style={{ maxWidth: 320 }}>{trunc(p.callId, 40)}</td>
                  <td>{p.matchedMsgs}</td>
                  <td><span className={`badge ${p.confidence === 'high' ? 'ok' : p.confidence === 'medium' ? 'info' : 'mut'}`}>{p.confidence === 'high' ? '高' : p.confidence === 'medium' ? '中' : '低'}</span></td>
                  <td className="mono">{fmtOff(p.offsetUs)}</td>
                  <td>
                    <button className="btn sm" onClick={() => calibrate(p.offsetUs, `自动 ${fmtOff(p.offsetUs)}`)}>按此校准 B</button>{' '}
                    <button className="btn sm ghost" onClick={() => locateCall(p.callId)}>定位</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {pairs && (
          <div style={{ display: 'flex', gap: 8, marginTop: 10, alignItems: 'center' }}>
            <span style={{ color: 'var(--fg3)', fontSize: 12 }}>手动校准：B 时间加上</span>
            <input className="input" style={{ width: 120 }} placeholder="偏移 ms" value={manualMs}
              onChange={e => setManualMs(e.target.value.replace(/[^\d.-]/g, ''))} />
            <span style={{ color: 'var(--fg3)', fontSize: 12 }}>ms</span>
            <button className="btn sm" disabled={manualMs === '' || manualMs === '-'}
              onClick={() => calibrate(Math.round(parseFloat(manualMs) * 1000), `手动 ${manualMs} ms`)}>应用</button>
            <span style={{ color: 'var(--fg3)', fontSize: 11.5 }}>（正值 = B 时钟偏慢）</span>
          </div>
        )}
      </div>

      {/* 证据区 */}
      <div className="card" style={{ padding: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
          <span style={{ fontFamily: 'var(--font-disp)', fontWeight: 700, color: 'var(--amber)', letterSpacing: 1 }}>转移证据</span>
          <span style={{ color: 'var(--fg3)', fontSize: 12 }}>Replaces / Join / Refer-To 头域 · 候选通话段</span>
          <div style={{ flex: 1 }} />
          <select className="input" style={{ width: 240 }} value={evFile} onChange={e => loadTransfers(e.target.value)}>
            <option value="">— 选择文件扫描证据 —</option>
            {files.map(f => <option key={f.fileId} value={f.fileId}>{f.fileName}</option>)}
          </select>
        </div>
        {events.length === 0 && <div style={{ color: 'var(--fg3)', fontSize: 12.5, padding: '6px 2px' }}>未发现转移头域（选择文件后自动扫描）</div>}
        {events.map((ev, i) => {
          const evKey = `${ev.fromCallId}|${ev.targetCallId}|${ev.tsUs}`;
          return (
            <div key={i} style={{ borderTop: '1px dashed var(--line)', paddingTop: 10, marginTop: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <span className={`badge ${ev.type === 'REFER-TO' ? 'info' : 'warn'}`}>{ev.type}</span>
                <span className="mono" style={{ fontSize: 12 }}>{fmtTime(ev.tsUs)}</span>
                <span className="mono" style={{ fontSize: 12, color: 'var(--cyan)' }}>{trunc(ev.fromCallId, 28)}</span>
                <span style={{ color: 'var(--fg3)' }}>→</span>
                <span className="mono" style={{ fontSize: 12, color: 'var(--amber)' }}>{trunc(ev.targetCallId, 28)}</span>
                {ev.uri && <span className="mono" style={{ fontSize: 11, color: 'var(--fg3)' }}>{trunc(ev.uri, 44)}</span>}
              </div>
              <div style={{ marginTop: 6, paddingLeft: 4 }}>
                {(ev.candidates || []).map((cand, j) => {
                  const cKey = `${ev.fromCallId}|${cand.callId}`;
                  const isRemoved = removed.has(evKey);
                  const isConfirmed = confirmed.some(x => x.key === cKey);
                  return (
                    <div key={j} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0', opacity: isRemoved ? .45 : 1 }}>
                      <span className={`badge ${cand.exact ? 'ok' : 'mut'}`}>{cand.exact ? '精确' : '候选'}</span>
                      <span className="mono" style={{ fontSize: 12 }}>{trunc(cand.callId, 34)}</span>
                      <span style={{ color: 'var(--fg3)', fontSize: 11.5 }}>{fmtTime(cand.tStart)} ~ {cand.tEnd ? fmtTime(cand.tEnd) : '—'}</span>
                      <div style={{ flex: 1 }} />
                      <button className="btn sm" onClick={() => confirmEv(ev, cand)} disabled={isRemoved || isConfirmed}>{isConfirmed ? '已确认' : '确认关联'}</button>
                      <button className="btn sm ghost" onClick={() => removeEv(ev, cand)} disabled={isRemoved}>移除</button>
                      <button className="btn sm ghost" onClick={() => locateCall(cand.callId)}>定位</button>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
        {confirmed.length > 0 && (
          <div style={{ marginTop: 12, paddingTop: 10, borderTop: '1px solid var(--line)' }}>
            <div style={{ color: 'var(--fg2)', fontSize: 12.5, marginBottom: 6 }}>已确认关联（{confirmed.length}）</div>
            {confirmed.map(cf => (
              <div key={cf.key} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '3px 0' }}>
                <span className="badge ok">{cf.type}</span>
                <span className="mono" style={{ fontSize: 12 }}>{trunc(cf.fromCallId, 28)}</span>
                <span style={{ color: 'var(--fg3)' }}>→</span>
                <span className="mono" style={{ fontSize: 12 }}>{trunc(cf.targetCallId, 28)}</span>
                <div style={{ flex: 1 }} />
                <button className="btn sm ghost" onClick={() => locateCall(cf.targetCallId)}>定位</button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

registerPages({ ComparePage });
