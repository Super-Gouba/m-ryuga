import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useStore, api, fmtTime, fmtDur, fmtBytes, trunc, registerPages, EmptyDropHint, SevBadge, usePaneSize, Splitter, useMediaQuery } from '../App.jsx';
import { t } from '../i18n.js';

/* ============================================================
   通话分析页：左列表 + 右详情（流序图 / 报文 / 体检 / 试听 / 导出）
   ============================================================ */
function CallsPage() {
  const { state, dispatch } = useStore();
  const { calls, selCall, activeFile } = state;
  const [q, setQ] = useState('');
  const [onlyIssue, setOnlyIssue] = useState(false);
  const wrapRef = useRef(null);
  const [listW, listDrag, listCss] = usePaneSize(wrapRef, { key: 'mryuga:listW', initial: 300, min: 230, maxRatio: 0.36, side: 'left', reserve: 560, maxPx: 460 });

  const list = useMemo(() => calls.filter(c => {
    const s = c.summary || {};
    if (activeFile && c.fileId !== activeFile) return false;
    if (onlyIssue && s.sev === 'ok') return false;
    if (q) {
      const t = q.toLowerCase();
      const hay = `${s.fromUser || ''} ${s.toUser || ''} ${c.callId} ${s.endStatus || ''} ${c.fileName || ''}`.toLowerCase();
      if (!hay.includes(t)) return false;
    }
    return true;
  }), [calls, q, onlyIssue, activeFile]);

  // 过滤后若当前选中项不在列表内，自动选中第一条（进入页面即看到详情）
  const inList = !!selCall && list.some(c => c.callId === selCall.callId && c.fileId === selCall.fileId);
  useEffect(() => {
    if (list.length && !inList) {
      dispatch({ type: 'select', sel: { fileId: list[0].fileId, callId: list[0].callId } });
    }
  }, [list, inList]);

  if (!calls.length) {
    return <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><EmptyDropHint /></div>;
  }

  const issueCount = list.filter(c => c.summary?.sev !== 'ok').length;

  return (
    <div className="calls" ref={wrapRef}>
      <aside className="call-list" style={{ width: listCss }}>
        <div className="list-toolbar">
          <div className="row">
            <input className="input" placeholder={t('list.search')} value={q} onChange={e => setQ(e.target.value)} />
          </div>
          <div className="row">
            <span className="chip" data-on={!onlyIssue || undefined} onClick={() => setOnlyIssue(false)}>{t('list.all')}</span>
            <span className="chip" data-on={onlyIssue || undefined} onClick={() => setOnlyIssue(true)}>{t('list.issues')}</span>
            <div style={{ flex: 1 }} />
            <span style={{ fontSize: 11.5, color: 'var(--fg3)' }}>{list.length}</span>
          </div>
        </div>
        <div className="list-count">
          {t('list.matched')} {list.length} · {t('list.abnormal')} {issueCount}
        </div>
        <div className="list-body">
          {list.map(c => {
            const s = c.summary || {};
            const sel = selCall?.callId === c.callId && selCall?.fileId === c.fileId;
            const ended = s.endStatus || (s.ended ? 'BYE' : null);
            return (
              <div key={c.id} className="call-row" data-sel={sel || undefined} data-sev={s.sev || 'ok'}
                onClick={() => dispatch({ type: 'select', sel: { fileId: c.fileId, callId: c.callId } })}>
                <div className="call-route">
                  <span className="who">{s.fromUser || '未知'}</span>
                  <span className="arrow">→</span>
                  <span className="who">{s.toUser || '未知'}</span>
                </div>
                <div className="call-meta">
                  <span className="mono">{fmtTime(s.tStart).slice(0, 8)}</span>
                  <span className="m-sep mono">{s.connDurationSec != null ? fmtDur(s.connDurationSec) : t('list.durationUnknown')}</span>
                  <span className="m-sep">{ended || t('list.notEnded')}</span>
                </div>
                <div className="call-badges">
                  {(s.codecs || []).slice(0, 2).map(cd => <span key={cd} className="badge mut">{cd}</span>)}
                  {s.sev && s.sev !== 'ok' && <SevBadge sev={s.sev} />}
                </div>
              </div>
            );
          })}
          {list.length === 0 && <div className="empty">{t('list.empty')}</div>}
        </div>
      </aside>

      {selCall ? (
        <>
          <Splitter drag={listDrag} label="调整通话列表宽度" />
          <CallDetail key={selCall.fileId + selCall.callId} sel={selCall} />
        </>
      ) : <div className="detail"><div className="empty" style={{ flex: 1 }}><div className="ico">◧</div>{t('list.select')}</div></div>}
    </div>
  );
}

/* ============================================================
   通话详情
   ============================================================ */
function CallDetail({ sel }) {
  const { state } = useStore();
  const call = state.calls.find(c => c.callId === sel.callId && c.fileId === sel.fileId);
  const [tab, setTab] = useState('ladder');
  const [msgs, setMsgs] = useState(null);
  const [pick, setPick] = useState({ type: 'sip', idx: 0 });
  const [audioSoloKey, setAudioSoloKey] = useState(null);
  const bodyRef = useRef(null);
  const narrow = useMediaQuery('(max-width: 1040px)');
  const [msgW, msgDrag, msgCss] = usePaneSize(bodyRef, { key: 'mryuga:msgW3', initial: 460, min: 240, maxRatio: 0.5, side: 'right', reserve: 430, maxPx: 760 });

  useEffect(() => { api.callLadder(sel.fileId, sel.callId).then(r => setMsgs(r.ok ? r : null)); }, [sel]);

  if (!call) return null;
  const s = call.summary || {};
  const dtmfCount = msgs?.dtmf?.length || 0;
  const tabs = [
    ['overview', t('tab.overview'), null],
    ['ladder', t('tab.ladder'), (msgs?.msgs?.length || 0) + dtmfCount],
    ['msgs', t('tab.messages'), (msgs?.msgs?.length || 0) + dtmfCount],
    ['audio', t('tab.audio'), null],
    ['export', t('tab.export'), null]
  ];
  const splitTab = tab === 'ladder' || tab === 'msgs';
  const rows = useMemo(() => mergeRows(msgs), [msgs]);
  const pickItem = msgs ? resolvePick(msgs, rows, pick) : null;

  return (
    <section className="detail">
      <div className="detail-head">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
          <div className="dh-route">
            {s.fromUser || '未知'} <span className="arrow">→</span> {s.toUser || '未知'}
          </div>
          <div className="dh-kv" style={{ fontSize: 11 }}>
            Call-ID <b title={call.callId} style={{ maxWidth: 420, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{trunc(call.callId, 46)}</b>
          </div>
        </div>
        <div className="dh-kv">{t('detail.start')} <b>{fmtTime(s.tStart)}</b></div>
        <div className="dh-kv">{t('detail.duration')} <b>{s.connDurationSec != null ? fmtDur(s.connDurationSec) : t('list.durationUnknown')}</b></div>
        <div className="dh-kv">{t('detail.end')} <b>{s.endStatus ? `SIP ${s.endStatus}` : s.ended ? 'BYE' : '—'}</b></div>
        {(s.codecs || []).length > 0 && <div className="dh-kv">{t('detail.codec')} <b>{s.codecs.join(' / ')}</b></div>}
        <div className="dh-kv">{t('detail.messages')} <b>{(msgs?.msgs?.length || 0) + dtmfCount}</b></div>
        <div style={{ flex: 1 }} />
        <SevBadge sev={s.sev} />
      </div>

      <div className="detail-tabs">
        {tabs.map(([id, label, count]) => (
          <div key={id} className="tab" data-active={tab === id || undefined} onClick={() => setTab(id)}>
            {label}{count ? <span className="t-count">{count}</span> : null}
          </div>
        ))}
      </div>

      <div className="detail-body" ref={bodyRef} style={narrow ? { flexDirection: 'column' } : undefined}>
        <div style={{ flex: 1, minWidth: 0, minHeight: 0, display: 'flex' }}>
          {tab === 'overview' && <OverviewTab call={call} msgs={msgs} sel={sel} />}
          {tab === 'ladder' && (msgs
            ? (
              <LadderTab
                data={msgs} rows={rows} pick={pick}
                onPick={(p) => {
                  if (p.type === 'rtp') {
                    const media = msgs.media?.[p.idx];
                    setAudioSoloKey(media?.key || null);
                    setTab('audio');
                    return;
                  }
                  setPick(p);
                }}
              />
            )
            : <Loading />)}
          {tab === 'msgs' && (msgs ? <MsgsTab data={msgs} rows={rows} pick={pick} onPick={setPick} /> : <Loading />)}
          {tab === 'audio' && <AudioTab sel={sel} soloKey={audioSoloKey} />}
          {tab === 'export' && <ExportTab sel={sel} />}
        </div>
        {splitTab && msgs && !narrow && (
          <>
            <Splitter drag={msgDrag} label="调整报文面板宽度" />
            <div style={{ width: msgCss, flexShrink: 0, display: 'flex', minWidth: 0 }}>
              <MsgPane item={pickItem} />
            </div>
          </>
        )}
        {splitTab && msgs && narrow && (
          <div style={{ height: '44%', minHeight: 180, borderTop: '1px solid var(--line)', display: 'flex', minWidth: 0 }}>
            <MsgPane item={pickItem} />
          </div>
        )}
      </div>
    </section>
  );
}

/* 把 SIP 报文、DTMF 按键、RTP 媒体流按时序合并为统一行 */
function mergeRows(data) {
  if (!data) return [];
  const rows = [];
  (data.msgs || []).forEach((m, i) => rows.push({ type: 'sip', tsUs: m.tsUs, idx: i }));
  (data.dtmf || []).forEach((d, i) => rows.push({ type: 'dtmf', tsUs: d.startUs, idx: i }));
  (data.media || []).forEach((m, i) => rows.push({ type: 'rtp', tsUs: m.startUs, idx: i }));
  return rows.sort((a, b) => a.tsUs - b.tsUs);
}

function resolvePick(data, rows, pick) {
  const row = rows.find(r => r.type === pick.type && r.idx === pick.idx) || rows[0];
  if (!row) return null;
  if (row.type === 'sip') return { type: 'sip', idx: row.idx, msg: data.msgs[row.idx] };
  if (row.type === 'dtmf') return { type: 'dtmf', idx: row.idx, event: data.dtmf[row.idx] };
  return { type: 'rtp', idx: row.idx, media: data.media[row.idx] };
}

function Loading() {
  return <div className="empty" style={{ flex: 1 }}><div className="pulsing">加载中…</div></div>;
}

/* ============================================================
   概览：抓包基本信息 + 通话摘要 + 协议分布
   ============================================================ */
function OverviewTab({ call, msgs, sel }) {
  const { state } = useStore();
  const file = state.files.find(f => f.fileId === call.fileId);
  const stats = file?.stats || {};
  const s = call.summary || {};
  const total = stats.totalPkts || 0;
  const spanSec = stats.firstUs && stats.lastUs ? (stats.lastUs - stats.firstUs) / 1e6 : 0;
  const media = msgs?.media || [];
  const mediaPkts = media.reduce((n, m) => n + (m.packets || 0), 0);
  const days = spanSec > 86400 ? (spanSec / 86400).toFixed(1) : null;

  const proto = [
    [t('proto.sip'), stats.sipPkts || 0, 'var(--sig-inv)'],
    [t('proto.rtp'), stats.rtpPkts || 0, 'var(--orange)'],
    [t('proto.other'), stats.otherPkts || 0, 'var(--line2)']
  ];

  return (
    <div className="detail-scroll">
      <div className="diag-grid">
        <div className="card">
          <div className="card-title">{t('ov.file')}</div>
          <div className="kvl">
            <b>{t('ov.fileName')}</b>
            <span className="mono" style={{ wordBreak: 'break-all' }}>{file?.fileName || '—'}</span>
            <b>{t('ov.size')}</b><span className="mono">{fmtBytes(stats.bytes ?? file?.size)}</span>
            <b>{t('ov.packets')}</b><span className="mono">{total.toLocaleString()}</span>
            <b>{t('ov.first')}</b><span className="mono">{fmtTime(stats.firstUs)}</span>
            <b>{t('ov.last')}</b><span className="mono">{fmtTime(stats.lastUs)}</span>
            <b>{t('ov.span')}</b>
            <span className="mono">{spanSec ? (days ? `${days}d` : fmtDur(spanSec)) : '—'}</span>
            <b>{t('ov.state')}</b>
            <span>{file?.truncated ? <span className="badge warn">{t('ov.truncated')}</span> : <span className="badge ok">{t('ov.complete')}</span>}</span>
          </div>
        </div>

        <div className="card">
          <div className="card-title">{t('ov.call')}</div>
          <div className="kvl">
            <b>{t('ov.caller')}</b><span className="mono">{s.fromUser || '—'}</span>
            <b>{t('ov.callee')}</b><span className="mono">{s.toUser || '—'}</span>
            <b>{t('ov.start')}</b><span className="mono">{fmtTime(s.tStart)}</span>
            <b>{t('ov.end')}</b><span>{s.endStatus ? `SIP ${s.endStatus}` : s.ended ? 'BYE' : '—'}</span>
            <b>{t('ov.duration')}</b><span className="mono">{s.connDurationSec != null ? fmtDur(s.connDurationSec) : t('list.durationUnknown')}</span>
            <b>{t('ov.codec')}</b><span>{s.codecs?.join(' / ') || t('ov.noSdp')}</span>
            <b>{t('ov.sipMsgs')}</b><span className="mono">{msgs?.msgs?.length ?? '—'}</span>
            <b>{t('ov.dtmf')}</b>
            <span style={{ display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap' }}>
              {(msgs?.dtmf || []).length === 0
                ? <span style={{ color: 'var(--fg3)' }}>{t('ov.none')}</span>
                : (msgs.dtmf.map((d, i) => <span key={i} className="dtmf-pill" title={`${d.via} · ${fmtTime(d.startUs)}`}>{d.digit}</span>))}
              {(msgs?.dtmf || []).length > 0 && <span style={{ color: 'var(--fg3)', fontSize: 11.5 }}>×{msgs.dtmf.length}</span>}
            </span>
            <b>{t('ov.dtmfSeq')}</b>
            <span className="mono" style={{ wordBreak: 'break-all' }}>
              {(msgs?.dtmf || []).length ? msgs.dtmf.map(d => d.digit).join(' ') : '—'}
            </span>
            <b>{t('ov.media')}</b>
            <span className="mono">{media.length} {t('ov.streams')} · {mediaPkts.toLocaleString()} {t('ov.rtpPkts')}</span>
          </div>
        </div>
      </div>

      <div className="card" style={{ marginTop: 12 }}>
        <div className="card-title">{t('ov.proto')}</div>
        <div style={{ display: 'flex', height: 12, borderRadius: 6, overflow: 'hidden', background: 'var(--bg4)' }}>
          {proto.map(([label, n, color]) => (
            n > 0 && <div key={label} style={{ width: `${(n / Math.max(1, total)) * 100}%`, background: color }} title={`${label} ${n}`} />
          ))}
        </div>
        <div style={{ display: 'flex', gap: 18, marginTop: 10, flexWrap: 'wrap' }}>
          {proto.map(([label, n, color]) => (
            <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
              <i style={{ width: 9, height: 9, borderRadius: 2, background: color, display: 'inline-block' }} />
              <span style={{ color: 'var(--fg2)' }}>{label}</span>
              <span className="mono" style={{ color: 'var(--fg-mono)', fontWeight: 600 }}>{n.toLocaleString()}</span>
              <span style={{ color: 'var(--fg3)' }}>{total ? ((n / total) * 100).toFixed(1) + '%' : '0%'}</span>
            </div>
          ))}
        </div>
      </div>

      <CheckTab call={call} sel={sel} />
    </div>
  );
}

/* ============================================================
   流序图 + 报文详情
   ============================================================ */
function LadderTab({ data, rows, pick, onPick }) {
  return (
    <div className="ladder-wrap" style={{ display: 'flex', flexDirection: 'column' }}>
      <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
        <LadderDiagram data={data} rows={rows} pick={pick} onPick={onPick} />
      </div>
      <div className="ladder-legend">
        <span className="lg"><i style={{ background: 'var(--sig-inv)' }} />{t('legend.request')}</span>
        <span className="lg"><i style={{ background: 'var(--sig-ok)' }} />{t('legend.ok')}</span>
        <span className="lg"><i style={{ background: 'var(--sig-5xx)' }} />{t('legend.fail')}</span>
        <span className="lg"><i className="dash" style={{ borderColor: 'var(--orange)' }} />{t('legend.rtp')}</span>
        <span className="lg"><i className="pill" style={{ background: 'var(--warn-bg)', borderColor: '#ecd9b6' }} />{t('legend.dtmf')}</span>
        <span style={{ flex: 1 }} />
        <span style={{ color: 'var(--fg3)' }}>{t('legend.hint')}</span>
      </div>
    </div>
  );
}

/* 消息短标签：INVITE / SDP、200 OK / SDP … */
function msgLabel(m) {
  const hasSdp = !!(m.sdp?.media?.length || (m.contentType || '').toLowerCase().includes('sdp') || /^[a-z]=/m.test(m.body || ''));
  if (m.kind === 'request') return hasSdp ? `${m.method} / SDP` : m.method;
  const base = `${m.status}${m.reason ? ' ' + m.reason : ''}`;
  return hasSdp ? `${base} / SDP` : base;
}

function LadderDiagram({ data, rows, pick, onPick }) {
  const { actors, lanes } = data;
  const hostRef = useRef(null);
  const [cw, setCw] = useState(0);
  useEffect(() => {
    const el = hostRef.current;
    if (!el) return undefined;
    const ro = new ResizeObserver(() => setCw(el.clientWidth));
    ro.observe(el);
    setCw(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  const ROW_H = 44, DTMF_H = 34, HEAD_H = 70, GUTTER = 100, PAD_R = 28;
  const avail = Math.max(cw || 640, 420);
  // 参与方间距随容器伸缩（上限 600，避免超宽屏箭头过长），空间富余时整块居中
  const ACTOR_W = Math.max(140, Math.min(600, (avail - GUTTER - PAD_R) / Math.max(1, actors.length)));
  const blockW = GUTTER + ACTOR_W * actors.length + PAD_R;
  const offX = Math.max(0, Math.round((avail - blockW) / 2));
  const W = avail;
  const actorX = i => offX + GUTTER + ACTOR_W * i + ACTOR_W / 2;
  const t0 = rows[0]?.tsUs ?? 0;
  const callerIdx = lanes.find(l => l.cls === 'inv')?.from ?? 0;
  const calleeIdx = actors.length > 1 ? (callerIdx === 0 ? 1 : 0) : 0;

  // 逐行累加高度：DTMF / RTP 行更紧凑
  let acc = HEAD_H;
  const layout = rows.map(r => {
    const h = r.type === 'sip' ? ROW_H : DTMF_H;
    const y = acc + h * 0.55;
    acc += h;
    return { y, h };
  });
  const H = acc + 14;

  const color = cls => ({
    inv: 'var(--sig-inv)', ack: 'var(--sig-ack)', bye: 'var(--sig-bye)', reg: 'var(--sig-reg)',
    'other-req': 'var(--sig-ack)', ok: 'var(--sig-ok)', redirect: 'var(--amber)',
    c4xx: 'var(--sig-4xx)', c5xx: 'var(--sig-5xx)', prov: 'var(--sig-prov)'
  }[cls] || 'var(--fg2)');

  return (
    <div ref={hostRef} style={{ width: '100%', minHeight: H }}>
      <svg width={W} height={H} style={{ display: 'block' }}>
        <text x={offX + 12} y={26} fontSize={10.5} fill="var(--fg3)" fontFamily="var(--font-mono)">相对时间 / 秒</text>
        <line x1={offX + GUTTER - 14} y1={4} x2={offX + GUTTER - 14} y2={H - 4} stroke="var(--line)" />

        {actors.map((a, i) => {
          const [host, port] = String(a.label).split(':');
          const boxW = Math.min(ACTOR_W - 24, 200);
          const role = i === callerIdx ? '主叫' : (i === calleeIdx ? '被叫' : '媒体');
          return (
            <g key={i}>
              <rect x={actorX(i) - boxW / 2} y={6} width={boxW} height={52} rx={8}
                fill="var(--bg2)" stroke="var(--line2)" />
              <text x={actorX(i)} y={21} textAnchor="middle" fontSize={9} fill="var(--fg3)" letterSpacing="1">{role}</text>
              <text x={actorX(i)} y={38} textAnchor="middle" fontSize={11.5} fill="var(--fg)"
                fontFamily="var(--font-mono)" fontWeight="600">{trunc(host, 22)}</text>
              {port && <text x={actorX(i)} y={51} textAnchor="middle" fontSize={9.5} fill="var(--fg3)"
                fontFamily="var(--font-mono)">:{port}</text>}
              <line x1={actorX(i)} y1={HEAD_H} x2={actorX(i)} y2={H - 8} stroke="var(--line2)" strokeDasharray="4 5" />
            </g>
          );
        })}

        {rows.map((r, ri) => {
          const { y, h } = layout[ri];
          const active = pick?.type === r.type && pick?.idx === r.idx;
          const rel = ((r.tsUs - t0) / 1e6).toFixed(6);

          if (r.type === 'dtmf') {
            const d = data.dtmf[r.idx];
            const from = idxOfActor(actors, d.src, callerIdx);
            const to = idxOfActor(actors, d.dst, calleeIdx);
            const x1 = actorX(from), x2 = actorX(to);
            const mid = (x1 + x2) / 2;
            return (
              <g key={`d${ri}`} onClick={() => onPick({ type: 'dtmf', idx: r.idx })} style={{ cursor: 'pointer' }}>
                <rect className="ladder-row" x={0} y={y - h * 0.55} width={W} height={h} fill={active ? 'var(--warn-bg)' : 'transparent'} />
                {active && <rect x={0} y={y - h * 0.55} width={3} height={h} fill="var(--amber)" />}
                <text x={offX + 12} y={y + 3.5} fontSize={10.5} fill="var(--fg3)" fontFamily="var(--font-mono)">{rel}</text>
                <line x1={x1} y1={y} x2={x2} y2={y} stroke="var(--amber)" strokeWidth={1.4} strokeDasharray="5 4" opacity={.75} />
                <rect x={mid - 52} y={y - 10} width={104} height={20} rx={10} fill="var(--warn-bg)" stroke="#ecd9b6" />
                <text x={mid} y={y + 4} textAnchor="middle" fontSize={11} fontWeight="700" fill="var(--amber)"
                  fontFamily="var(--font-mono)">按键 {d.digit}</text>
                <title>{`DTMF 按键 ${d.digit} · ${d.via} · ${fmtTime(r.tsUs)}`}</title>
              </g>
            );
          }

          if (r.type === 'rtp') {
            const md = data.media[r.idx];
            const from = idxOfActor(actors, md.src, callerIdx);
            const to = idxOfActor(actors, md.dst, calleeIdx);
            const x1 = actorX(from), x2 = actorX(to);
            const mid = (x1 + x2) / 2;
            const dir = x2 >= x1 ? 1 : -1;
            const head = dir === 1
              ? `${x2 - 7},${y - 3} ${x2},${y} ${x2 - 7},${y + 3}`
              : `${x2 + 7},${y - 3} ${x2},${y} ${x2 + 7},${y + 3}`;
            return (
              <g key={`r${ri}`} onClick={() => onPick({ type: 'rtp', idx: r.idx })} style={{ cursor: 'pointer' }}>
                <rect className="ladder-row" x={0} y={y - h * 0.55} width={W} height={h} fill={active ? 'var(--warn-bg)' : 'transparent'} />
                {active && <rect x={0} y={y - h * 0.55} width={3} height={h} fill="var(--orange)" />}
                <text x={offX + 12} y={y + 3.5} fontSize={10.5} fill="var(--fg3)" fontFamily="var(--font-mono)">{rel}</text>
                <line x1={x1} y1={y} x2={x2} y2={y} stroke="var(--orange)" strokeWidth={1.5} strokeDasharray="6 4" />
                <polygon points={head} fill="var(--orange)" />
                <text x={mid} y={y - 8} textAnchor="middle" fontSize={11} fontWeight="600"
                  fill="var(--orange)" fontFamily="var(--font-mono)">
                  {`RTP (${md.codec}) · ${md.packets} 包`}
                </text>
                <title>{`RTP ${md.codec} · ${md.packets} 包\n${md.src} → ${md.dst}\n点击试听该方向音频`}</title>
              </g>
            );
          }

          const l = lanes[r.idx];
          const m = data.msgs[r.idx];
          const x1 = actorX(l.from), x2 = actorX(l.to);
          const c = color(l.cls);
          const dir = x2 >= x1 ? 1 : -1;
          const head = dir === 1
            ? `${x2 - 8},${y - 3.5} ${x2},${y} ${x2 - 8},${y + 3.5}`
            : `${x2 + 8},${y - 3.5} ${x2},${y} ${x2 + 8},${y + 3.5}`;
          const mid = (x1 + x2) / 2;
          return (
            <g key={`s${ri}`} onClick={() => onPick({ type: 'sip', idx: r.idx })} style={{ cursor: 'pointer' }}>
              {ri % 2 === 1 && <rect x={0} y={y - h * 0.55} width={W} height={h} fill="rgba(22,32,43,.016)" />}
              <rect className="ladder-row" x={0} y={y - h * 0.55} width={W} height={h}
                fill={active ? 'var(--accent-soft)' : 'transparent'} />
              {active && <rect x={0} y={y - h * 0.55} width={3} height={h} fill="var(--accent)" />}
              <text x={offX + 12} y={y + 3.5} fontSize={10.5} fill="var(--fg3)" fontFamily="var(--font-mono)">{rel}</text>
              <line x1={x1} y1={y} x2={x2} y2={y} stroke={c} strokeWidth={1.7} />
              <polygon points={head} fill={c} />
              <text x={mid} y={y - 9} textAnchor="middle" fontSize={12} fontWeight="700"
                fill={c} fontFamily="var(--font-mono)">{msgLabel(m)}</text>
              <text x={mid} y={y + 15} textAnchor="middle" fontSize={9.5} fill="var(--fg3)"
                fontFamily="var(--font-mono)">{m.kind === 'request' ? `CSeq ${m.cseq}` : `CSeq ${m.cseq} ${m.cseqMethod}`}</text>
              <text x={x1 + dir * -7} y={y + 3.5} textAnchor={dir === 1 ? 'end' : 'start'} fontSize={9}
                fill="var(--fg3)" fontFamily="var(--font-mono)">{m.src.split(':').pop()}</text>
              <text x={x2 + dir * 7} y={y + 3.5} textAnchor={dir === 1 ? 'start' : 'end'} fontSize={9}
                fill="var(--fg3)" fontFamily="var(--font-mono)">{m.dst.split(':').pop()}</text>
              <title>{`${msgLabel(m)}  ·  ${fmtTime(r.tsUs)}\n${m.src} → ${m.dst}\nCall-ID: ${m.callId || ''}`}</title>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function idxOfActor(actors, addr, fallback) {
  if (!addr) return fallback;
  const exact = actors.findIndex(a => a.label === addr);
  if (exact >= 0) return exact;
  // 同一 IP 的不同端口仍归属同一参与方（SIP 5060 与 RTP 高端口）
  const ip = String(addr).split(':')[0];
  const byIp = actors.findIndex(a => String(a.label).split(':')[0] === ip);
  return byIp >= 0 ? byIp : fallback;
}

/* 报文详情面板 */
function MsgPane({ item }) {
  const { showToast } = useStore();
  const [open, setOpen] = useState(false);
  if (!item) return <div className="msg-pane"><div className="empty" style={{ flex: 1 }}>选择一条信令</div></div>;

  const expandBtn = (
    <button className="btn sm ghost" title="放大查看" onClick={() => setOpen(true)} style={{ marginLeft: 'auto' }}>⤢ 放大</button>
  );
  const modal = open ? <MessageModal item={item} onClose={() => setOpen(false)} /> : null;

  if (item.type === 'dtmf') {
    const d = item.event;
    return (
      <>
      <div className="msg-pane">
        <div className="msg-pane-head">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div className="mp-title" style={{ color: 'var(--amber)' }}>DTMF 按键 {d.digit}</div>
            {expandBtn}
          </div>
          <div className="mp-row">时间：<b>{fmtTime(d.startUs)}</b></div>
          <div className="mp-row">通道：<b>{d.via}</b></div>
          {d.durationMs != null && <div className="mp-row">时长：<b>{Math.round(d.durationMs)} ms</b></div>}
          {d.src && <div className="mp-row">源：<b>{d.src}</b>　目的：<b>{d.dst}</b></div>}
        </div>
        <div className="msg-pane-body">
          <div style={{ fontSize: 12.5, color: 'var(--fg2)', lineHeight: 1.9 }}>
            该按键来自媒体侧 DTMF 事件（非 SIP 信令），因此在报文列表中只出现一行摘要。
            <br />· RFC2833/4733：RTP 电话事件包，独立 PT（通常 101）
            <br />· SIP INFO：随 INFO 报文下发，正文含 Signal / Duration
          </div>
        </div>
      </div>
      {modal}
      </>
    );
  }

  if (item.type === 'rtp') {
    const md = item.media;
    const dur = md.endUs && md.startUs ? (md.endUs - md.startUs) / 1e6 : null;
    return (
      <>
      <div className="msg-pane">
        <div className="msg-pane-head">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div className="mp-title" style={{ color: 'var(--orange)' }}>RTP 媒体流 · {md.codec}</div>
            {expandBtn}
          </div>
          <div className="mp-row">源：<b>{md.src}</b>　目的：<b>{md.dst}</b></div>
          <div className="mp-row">
            包数：<b>{md.packets}</b>
            {dur != null && <> · 跨度：<b>{dur.toFixed(1)}s</b></>}
            {md.lost > 0 && <> · 丢失：<b style={{ color: 'var(--amber)' }}>{md.lost}</b></>}
          </div>
          <div className="mp-actions">
            <span style={{ fontSize: 11.5, color: 'var(--fg3)' }}>点击该行即可自动切到「双向试听」并独听此方向</span>
          </div>
        </div>
        <div className="msg-pane-body">
          <div style={{ fontSize: 12.5, color: 'var(--fg2)', lineHeight: 1.9 }}>
            该行代表一条 RTP 媒体流（不是 SIP 信令）。在「双向试听」中可分别播放主叫 / 被叫方向。
          </div>
        </div>
      </div>
      {modal}
      </>
    );
  }

  const msg = item.msg;
  if (!msg) return <div className="msg-pane"><div className="empty" style={{ flex: 1 }}>无报文</div></div>;
  const copy = async () => {
    try { await navigator.clipboard.writeText(rawText(msg)); showToast('ok', '已复制原文'); }
    catch { showToast('err', '复制失败'); }
  };
  return (
    <>
    <div className="msg-pane">
      <div className="msg-pane-head">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div className="mp-title" style={{ color: clsColor(msg.cls) }}>{msgLabel(msg)}</div>
          {expandBtn}
        </div>
        <div className="mp-row">时间：<b>{fmtTime(msg.tsUs)}</b> · UDP</div>
        <div className="mp-row">源：<b>{msg.src}</b>　目的：<b>{msg.dst}</b></div>
        <div className="mp-actions">
          <button className="btn sm" onClick={copy}>复制原文</button>
        </div>
      </div>
      <div className="msg-pane-body">
        <div className="msg-text">{renderMsg(msg)}</div>
      </div>
    </div>
    {modal}
    </>
  );
}

/* 放大查看：Homer 风格报文卡片弹窗 */
function MessageModal({ item, onClose }) {
  const { showToast } = useStore();
  const [max, setMax] = useState(false);
  const [wrap, setWrap] = useState(true);

  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const meta = [];
  let title = '';
  let body = null;
  let raw = '';

  if (item.type === 'sip') {
    const m = item.msg;
    title = msgLabel(m);
    meta.push(
      ['TYPE', m.kind === 'request' ? 'REQUEST' : 'RESPONSE'],
      ['METHOD', m.kind === 'request' ? m.method : m.cseqMethod || '—'],
      ['STATUS', m.kind === 'request' ? '—' : `${m.status}${m.reason ? ' ' + m.reason : ''}`],
      ['TIME', fmtTime(m.tsUs)],
      ['SRC', m.src], ['DST', m.dst],
      ['CSEQ', String(m.cseq ?? '—')],
      ['CALL-ID', m.callId || '—'],
      ['FROM', m.fromUri || m.from?.uri || '—'],
      ['TO', m.toUri || m.to?.uri || '—'],
      ['USER-AGENT', m.ua || '—'],
      ['TRANSPORT', 'UDP']
    );
    body = <div className="msg-text" style={{ whiteSpace: wrap ? 'pre-wrap' : 'pre' }}>{renderMsg(m)}</div>;
    raw = rawText(m);
  } else if (item.type === 'dtmf') {
    const d = item.event;
    title = `DTMF ${d.digit}`;
    meta.push(
      ['TYPE', 'DTMF EVENT'], ['DIGIT', d.digit], ['TIME', fmtTime(d.startUs)],
      ['CHANNEL', d.via], ['DURATION', d.durationMs != null ? `${Math.round(d.durationMs)} ms` : '—'],
      ['SRC', d.src || '—'], ['DST', d.dst || '—']
    );
    body = (
      <div style={{ fontSize: 13, color: 'var(--fg2)', lineHeight: 1.9 }}>
        该按键来自媒体侧 DTMF 事件（非 SIP 信令）。<br />
        · RFC 2833/4733：RTP 电话事件包，独立 PT（通常 101）<br />
        · SIP INFO：随 INFO 报文下发，正文含 Signal / Duration<br />
        · 带内音频：按键音混在语音频带内，通过频域检测识别
      </div>
    );
  } else {
    const md = item.media;
    title = `RTP ${md.codec}`;
    meta.push(
      ['TYPE', 'RTP STREAM'], ['CODEC', md.codec], ['PACKETS', String(md.packets)],
      ['SRC', md.src], ['DST', md.dst],
      ['START', fmtTime(md.startUs)], ['END', fmtTime(md.endUs)],
      ['SPAN', md.endUs ? `${((md.endUs - md.startUs) / 1e6).toFixed(1)} s` : '—'],
      ['LOST', String(md.lost || 0)],
      ['JITTER', md.jitterMs != null ? `${Number(md.jitterMs).toFixed(1)} ms` : '—']
    );
    body = (
      <div style={{ fontSize: 13, color: 'var(--fg2)', lineHeight: 1.9 }}>
        该行代表一条 RTP 媒体流（不是 SIP 信令）。关闭弹窗后点击该行可跳到「双向试听」并独听此方向。
      </div>
    );
  }

  const copy = async () => {
    if (!raw) return;
    try { await navigator.clipboard.writeText(raw); showToast('ok', '已复制原文'); }
    catch { showToast('err', '复制失败'); }
  };

  return (
    <div className="modal-mask" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={`msg-modal ${max ? 'is-max' : ''}`} onMouseDown={e => e.stopPropagation()}>
        <div className="msg-modal-head">
          <span className="mm-title">{title}</span>
          <span className="mm-sub">{item.type === 'sip' ? 'SIP message' : item.type === 'dtmf' ? 'DTMF event' : 'RTP stream'}</span>
          <div style={{ flex: 1 }} />
          {item.type === 'sip' && (
            <button className="mm-btn" title="切换换行" onClick={() => setWrap(w => !w)}>{wrap ? '⇥ 不换行' : '↵ 换行'}</button>
          )}
          {item.type === 'sip' && <button className="mm-btn" title="复制原文" onClick={copy}>⧉ 复制</button>}
          <button className="mm-btn" title={max ? '还原' : '最大化'} onClick={() => setMax(m => !m)}>{max ? '⇲' : '⤢'}</button>
          <button className="mm-btn" title="关闭 (Esc)" onClick={onClose}>✕</button>
        </div>

        <div className="msg-modal-body">
          <div className="mm-section">DETAILS</div>
          <div className="mm-meta">
            {meta.map(([k, v]) => (
              <div key={k} className="mm-cell">
                <div className="mm-k">{k}</div>
                <div className={`mm-v ${/^(TIME|START|END|CSEQ|PACKETS|STATUS|DIGIT|LOST|JITTER|SPAN|DURATION)$/.test(k) ? 'mono' : ''}`} title={String(v)}>{String(v)}</div>
              </div>
            ))}
          </div>

          {item.type === 'sip' && (
            <>
              <div className="mm-section" style={{ marginTop: 14 }}>
                PAYLOAD
                <span className="mm-hint">共 {raw.split('\n').length} 行</span>
              </div>
              <div className="mm-payload">{body}</div>
            </>
          )}
          {item.type !== 'sip' && <div style={{ marginTop: 12 }}>{body}</div>}
        </div>
      </div>
    </div>
  );
}

function clsColor(cls) {
  return {
    inv: 'var(--sig-inv)', ack: 'var(--sig-ack)', bye: 'var(--sig-bye)', reg: 'var(--sig-reg)',
    'other-req': 'var(--sig-ack)', ok: 'var(--sig-ok)', redirect: '#ca8a04',
    c4xx: 'var(--sig-4xx)', c5xx: 'var(--sig-5xx)', prov: 'var(--sig-prov)'
  }[cls] || 'var(--fg2)';
}

const REQ_COLOR = { INVITE: 'var(--sig-inv)', ACK: 'var(--sig-ack)', BYE: 'var(--sig-bye)', CANCEL: 'var(--sig-bye)', REGISTER: 'var(--sig-reg)', OPTIONS: 'var(--sig-ack)', INFO: 'var(--blue)', UPDATE: 'var(--blue)', PRACK: 'var(--blue)' };

/* 带语法着色的报文渲染 */
function renderMsg(m) {
  const nodes = [];
  const startLine = m.startLine || '';
  const statusCls = m.kind === 'request' ? 'ln-method'
    : (m.status >= 200 && m.status < 300) ? 'ln-status-ok'
      : (m.status >= 400) ? 'ln-status-err' : 'ln-status-prov';
  nodes.push(<div key="sl" className={statusCls}>{startLine}</div>);

  (m.hdrs || []).forEach(([k, v], i) => {
    nodes.push(
      <div key={`h${i}`}>
        <span className="hkey">{k}</span>: <span className="hval">{v}</span>
      </div>
    );
  });

  if (m.body && String(m.body).trim()) {
    nodes.push(<div key="body-gap" className="dim">{'\u00a0'}</div>);
    String(m.body).split(/\r?\n/).forEach((line, i) => {
      if (!line) return;
      const isSdp = /^[a-z]=/.test(line);
      nodes.push(<div key={`b${i}`} className={isSdp ? 'sdp' : ''}>{line}</div>);
    });
  }
  return nodes;
}

function rawText(m) {
  const lines = [m.startLine || ''];
  (m.hdrs || []).forEach(([k, v]) => lines.push(`${k}: ${v}`));
  if (m.body && String(m.body).trim()) lines.push('', String(m.body).trimEnd());
  return lines.join('\n');
}

/* ============================================================
   报文明细（表格式）
   ============================================================ */
function MsgsTab({ data, rows, pick, onPick }) {
  const [q, setQ] = useState('');
  const kw = q.trim().toLowerCase();
  const list = rows.map((r, i) => ({ r, i, no: i + 1 })).filter(({ r }) => {
    if (!kw) return true;
    if (r.type === 'sip') return (data.msgs[r.idx].startLine || '').toLowerCase().includes(kw) || (data.msgs[r.idx].callId || '').toLowerCase().includes(kw);
    const d = data.dtmf[r.idx];
    return `按键 ${d.digit} ${d.via}`.toLowerCase().includes(kw);
  });
  return (
    <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: '7px 10px', borderBottom: '1px solid var(--line)', background: 'var(--bg1)', flexShrink: 0, display: 'flex', gap: 8, alignItems: 'center' }}>
        <input className="input" placeholder="过滤信令 / 按键" value={q}
          onChange={e => setQ(e.target.value)} style={{ width: 'min(260px, 100%)' }} />
        <span style={{ fontSize: 11.5, color: 'var(--fg3)' }}>{list.length} 条</span>
      </div>
      <div className="list-body">
        <table className="tbl">
          <thead><tr><th style={{ width: 42 }}>#</th><th style={{ width: 118 }}>时间</th><th>信令 / 事件</th><th>源 → 目的</th></tr></thead>
          <tbody>
            {list.map(({ r, no }) => {
              const sel = pick?.type === r.type && pick?.idx === r.idx;
              if (r.type === 'dtmf') {
                const d = data.dtmf[r.idx];
                return (
                  <tr key={`d${no}`} className={sel ? 'sel' : ''} onClick={() => onPick({ type: 'dtmf', idx: r.idx })}>
                    <td className="mono" style={{ color: 'var(--fg3)' }}>{no}</td>
                    <td className="mono">{fmtTime(d.startUs)}</td>
                    <td><span className="dtmf-pill">DTMF 按键 {d.digit}</span> <span style={{ color: 'var(--fg3)', fontSize: 11.5 }}>{d.via}</span></td>
                    <td className="mono" style={{ color: 'var(--fg3)', fontSize: 11.5 }}>{d.src || '—'} → {d.dst || '—'}</td>
                  </tr>
                );
              }
              const m = data.msgs[r.idx];
              return (
                <tr key={`s${no}`} className={sel ? 'sel' : ''} onClick={() => onPick({ type: 'sip', idx: r.idx })}>
                  <td className="mono" style={{ color: 'var(--fg3)' }}>{no}</td>
                  <td className="mono">{fmtTime(m.tsUs)}</td>
                  <td className={`cls-${m.cls}`} style={{ fontWeight: 600 }}>{m.startLine}</td>
                  <td className="mono" style={{ color: 'var(--fg3)', fontSize: 11.5 }}>{m.src} → {m.dst}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ============================================================
   通话体检
   ============================================================ */
function CheckTab({ call, sel }) {
  const [media, setMedia] = useState(null);
  const [mediaErr, setMediaErr] = useState(null);
  useEffect(() => {
    let alive = true;
    api.mediaAnalyze(sel.fileId, sel.callId).then(r => {
      if (!alive) return;
      if (r.ok) setMedia(r); else setMediaErr(r.error || '媒体分析失败');
    }).catch(e => alive && setMediaErr(String(e.message || e)));
    return () => { alive = false; };
  }, [sel]);

  const s = call.summary || {};
  const diag = call.diag || {};
  const issues = [
    ...(diag.signalingIssues || []).map(i => ({ ...i, cat: '信令' })),
    ...(diag.mediaIssues || []).map(i => ({ ...i, cat: '媒体' }))
  ];

  return (
    <div style={{ marginTop: 12 }}>
      <div className="diag-grid">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div className="card">
            <div className="card-title">{t('diag.timeline')}</div>
            <div className="kvl">
              <b>{t('ov.start')}</b><span className="mono">{fmtTime(s.tStart)}</span>
              <b>{t('diag.connect')}</b><span className="mono">{s.tConnect ? fmtTime(s.tConnect) : '—'}</span>
              <b>{t('ov.last')}</b><span className="mono">{s.tEnd ? fmtTime(s.tEnd) : '—'}</span>
              <b>{t('diag.ring')}</b><span className="mono">{s.ringingMs ? (s.ringingMs / 1000).toFixed(1) + 's' : '—'}</span>
              <b>{t('ov.duration')}</b><span className="mono">{s.connDurationSec != null ? fmtDur(s.connDurationSec) : t('list.durationUnknown')}</span>
              <b>{t('ov.end')}</b>
              <span>{s.endStatus ? `SIP ${s.endStatus} ${s.endReasonText || ''}` : s.ended ? 'BYE' : '—'}</span>
              <b>{t('diag.endBy')}</b><span>{s.endByUser ? `${s.endBy === 'A' ? t('ov.caller') : t('ov.callee')} ${trunc(s.endByUser, 16)}` : '—'}</span>
              {s.endCause && <><b>{t('diag.endCause')}</b><span>{s.endCause} — {s.endCauseText}</span></>}
              <b>{t('ov.codec')}</b><span>{s.codecs?.join(', ') || '—'}</span>
              <b>{t('ov.sipMsgs')}</b><span className="mono">{s.msgsCount ?? '—'}</span>
            </div>
          </div>

          <div className="card">
            <div className="card-title">{t('diag.title')}</div>
            {issues.length === 0
              ? <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}><span className="badge ok">{t('sev.ok')}</span>{t('diag.pass')}</div>
              : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                  {issues.map((i, k) => (
                    <div key={k} className="issue">
                      <span className={`badge ${i.sev === 'error' ? 'err' : i.sev === 'warn' ? 'warn' : 'info'}`}>{i.cat}</span>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontWeight: 600 }}>{i.text}</div>
                        {i.evidence && (
                          <div className="mono" style={{ color: 'var(--fg3)', fontSize: 11, marginTop: 2, wordBreak: 'break-all' }}>
                            {typeof i.evidence === 'string' ? i.evidence : JSON.stringify(i.evidence)}
                          </div>
                        )}
                      </div>
                      {i.code && <span className="badge mut mono">{i.code}</span>}
                    </div>
                  ))}
                </div>
              )}
          </div>
        </div>

        <div className="card">
          <div className="card-title">{t('diag.media')}</div>
          {!media && !mediaErr && <div className="empty" style={{ padding: 20 }}><div className="pulsing">{t('diag.decoding')}</div></div>}
          {mediaErr && <div style={{ color: 'var(--red)', fontSize: 12.5 }}>{mediaErr}</div>}
          {media && <MediaOverview media={media} />}
        </div>
      </div>
    </div>
  );
}

function MediaOverview({ media }) {
  const slots = [['a', t('diag.dirA'), 'var(--blue)'], ['b', t('diag.dirB'), 'var(--violet)']];
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {slots.map(([slot, label, color]) => {
        const st = media.streams?.[slot];
        return (
          <div key={slot} style={{ background: 'var(--bg3)', borderRadius: 9, padding: '9px 11px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
              <b style={{ fontSize: 12.5 }}>{label}</b>
              <span className="badge mut">{st ? (st.codec || '—') : t('ov.none')}</span>
            </div>
            {!st && <div style={{ color: 'var(--fg3)', fontSize: 12 }}>{t('diag.noStream')}</div>}
            {st && st.pcm && <MiniWave waveform={st.waveform} color={color} />}
            {st && !st.pcm && <div style={{ color: 'var(--amber)', fontSize: 12 }}>{st.codec} {t('audio.unsupported')}（{st.unsupported || 'wasm'}）</div>}
            {st && (
              <div style={{ fontSize: 11, color: 'var(--fg3)', marginTop: 5, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                <span>{t('diag.packets')} {st.packets ?? '—'}</span>
                {st.lost > 0 && <span style={{ color: 'var(--amber)' }}>{t('diag.lost')} {st.lost}</span>}
                {st.jitterMs != null && <span>{t('diag.jitter')} {Number(st.jitterMs).toFixed(1)}ms</span>}
                {st.sampleRate && <span>{st.sampleRate / 1000}kHz</span>}
              </div>
            )}
          </div>
        );
      })}
      <div>
        <div className="card-title" style={{ marginTop: 4 }}>{t('diag.keys')}</div>
        {media.dtmf?.length
          ? (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
              {media.dtmf.map((d, i) => (
                <span key={i} className="badge info mono" title={`${fmtTime(d.startUs)} · ${d.via}`}>{d.digit}</span>
              ))}
            </div>
          )
          : <div style={{ color: 'var(--fg3)', fontSize: 12 }}>{t('diag.noKeys')}</div>}
      </div>
    </div>
  );
}

function MiniWave({ waveform, color }) {
  const ref = useRef(null);
  useEffect(() => {
    const cv = ref.current;
    if (!cv || !waveform?.length) return;
    const dpr = 2;
    cv.width = cv.clientWidth * dpr; cv.height = 56 * dpr;
    const ctx = cv.getContext('2d');
    ctx.clearRect(0, 0, cv.width, cv.height);
    ctx.fillStyle = color;
    const n = waveform.length, step = cv.width / n;
    for (let i = 0; i < n; i++) {
      const h = Math.max(2, waveform[i] * cv.height * 0.9);
      ctx.fillRect(i * step, (cv.height - h) / 2, Math.max(1, step * 0.8), h);
    }
  }, [waveform, color]);
  return <canvas ref={ref} style={{ width: '100%', height: 56, display: 'block', background: '#fff', borderRadius: 6, border: '1px solid var(--line)' }} />;
}

/* ============================================================
   双向试听
   ============================================================ */
function AudioTab({ sel, soloKey }) {
  const [media, setMedia] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);
  useEffect(() => {
    setLoading(true);
    api.mediaAnalyze(sel.fileId, sel.callId)
      .then(r => { if (r.ok) setMedia(r); else setErr(r.error || '媒体分析失败'); })
      .catch(e => setErr(String(e.message || e)))
      .finally(() => setLoading(false));
  }, [sel]);

  if (loading) return <div className="empty" style={{ flex: 1 }}><div className="pulsing">解码媒体中…（大文件较慢）</div></div>;
  if (err) return <div className="empty" style={{ flex: 1 }}>{err}</div>;
  if (!media) return <div className="empty" style={{ flex: 1 }}>无媒体数据</div>;
  return <div className="detail-scroll"><WavePlayer media={media} soloKey={soloKey} /></div>;
}

function WavePlayer({ media, soloKey }) {
  const A = media.streams?.a, B = media.streams?.b;
  const initSolo = soloKey ? (A?.key === soloKey ? 'a' : B?.key === soloKey ? 'b' : null) : null;
  const [solo, setSolo] = useState(initSolo);
  // 从流序图点不同 RTP 行时同步独听方向
  useEffect(() => { if (soloKey) setSolo(initSolo); }, [soloKey]);
  const [mute, setMute] = useState({});
  const [rate, setRate] = useState(1);
  const [zoom, setZoom] = useState(1);
  const [cur, setCur] = useState(0);
  const [playing, setPlaying] = useState(false);
  const nodesRef = useRef(null);

  const totalSec = useMemo(() => {
    const durs = [A?.pcm ? A.pcm.byteLength / 2 / A.sampleRate : 0, B?.pcm ? B.pcm.byteLength / 2 / B.sampleRate : 0];
    return Math.max(...durs, 0);
  }, [media]);

  const buildAudio = async () => {
    if (nodesRef.current) return nodesRef.current;
    const ac = new AudioContext();
    const gA = ac.createGain(), gB = ac.createGain();
    gA.connect(ac.destination); gB.connect(ac.destination);
    const bufs = {};
    for (const [slot, st] of [['a', A], ['b', B]]) {
      if (!st?.pcm) continue;
      const wav = wavFromPcm(new Int16Array(st.pcm), st.sampleRate);
      try { bufs[slot] = await ac.decodeAudioData(wav.buffer); } catch { /* 忽略解码失败 */ }
    }
    nodesRef.current = { ac, gA, gB, bufs, srcs: {} };
    return nodesRef.current;
  };

  const stopSources = () => {
    const n = nodesRef.current;
    if (!n) return;
    Object.values(n.srcs).forEach(s => { try { s.stop(); } catch { /* 已停止 */ } });
    n.srcs = {};
  };

  const startAt = async (from) => {
    const n = await buildAudio();
    stopSources();
    const base = Math.max(0, Math.min(from, totalSec - 0.01));
    const t0 = n.ac.currentTime + 0.04;
    for (const slot of ['a', 'b']) {
      const buf = n.bufs[slot];
      if (!buf) continue;
      const off = Math.min(base, Math.max(0, buf.duration - 0.01));
      const src = n.ac.createBufferSource();
      src.buffer = buf; src.playbackRate.value = rate;
      src.connect(slot === 'a' ? n.gA : n.gB);
      try { src.start(t0, off); } catch { /* 越界忽略 */ }
      n.srcs[slot] = src;
    }
    setCur(base);
    setPlaying(true);
  };

  const play = () => startAt(cur);
  const pause = () => { stopSources(); setPlaying(false); };

  // 拖动进度条 / 点击波形：播放中也立即从新位置续播
  const seekTo = (sec) => {
    const t = Math.max(0, Math.min(totalSec, Number(sec) || 0));
    setCur(t);
    if (playing) startAt(t);
  };

  useEffect(() => {
    const n = nodesRef.current;
    if (!n) return;
    n.gA.gain.value = (solo === 'b' || mute.a) ? 0 : (solo === 'a' ? 1 : 0.9 * rate);
    n.gB.gain.value = (solo === 'a' || mute.b) ? 0 : (solo === 'b' ? 1 : 0.9 * rate);
  }, [solo, mute, rate]);

  useEffect(() => {
    if (!playing) return;
    const iv = setInterval(() => setCur(c => Math.min(totalSec, c + 0.1 * rate)), 100);
    return () => clearInterval(iv);
  }, [playing, rate, totalSec]);
  useEffect(() => { if (playing && cur >= totalSec) { pause(); setCur(0); } }, [cur, playing]);

  if (!A && !B) return <div className="empty">无 RTP 音频流</div>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div className="card" style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <button className="btn primary" onClick={() => playing ? pause() : play()}>{playing ? `⏸ ${t('audio.pause')}` : `▶ ${t('audio.play')}`}</button>
        <span className="mono" style={{ fontSize: 12.5, minWidth: 108 }}>{fmtClock(cur)} / {fmtClock(totalSec)}</span>
        <input
          type="range" min={0} max={Math.max(totalSec, 0.01)} step={0.01} value={cur}
          onChange={e => seekTo(+e.target.value)}
          style={{ flex: 1, minWidth: 160, accentColor: 'var(--accent)' }}
          title={t('audio.seek')}
        />
        <select className="input" value={rate} onChange={e => setRate(+e.target.value)} style={{ width: 78 }}>
          {[0.5, 0.75, 1, 1.25, 1.5, 2].map(r => <option key={r} value={r}>{r}×</option>)}
        </select>
        <span style={{ fontSize: 12, color: 'var(--fg3)' }}>{t('audio.zoom')}</span>
        <input type="range" min={1} max={8} step={1} value={zoom} onChange={e => setZoom(+e.target.value)}
          style={{ width: 90, accentColor: 'var(--accent)' }} />
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 11.5, color: 'var(--fg3)' }}>{t('audio.waveHint')}</span>
      </div>

      {['a', 'b'].map(slot => {
        const st = slot === 'a' ? A : B;
        if (!st) return null;
        return (
          <div key={slot} className="card" style={{ borderLeft: `3px solid ${slot === 'a' ? 'var(--blue)' : 'var(--violet)'}` }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <b style={{ fontSize: 12.5 }}>{slot === 'a' ? t('audio.caller') : t('audio.callee')}</b>
              <span className="badge mut">{st.codec || '—'}</span>
              <div style={{ flex: 1 }} />
              <button className={`btn sm ${solo === slot ? 'primary' : ''}`} onClick={() => setSolo(solo === slot ? null : slot)}>{t('audio.solo')}</button>
              <button className={`btn sm ${mute[slot] ? 'danger' : ''}`} onClick={() => setMute(m => ({ ...m, [slot]: !m[slot] }))}>{t('audio.mute')}</button>
            </div>
            <WaveCanvas waveform={st.waveform} color={slot === 'a' ? '#2563eb' : '#7c3aed'}
              cur={cur} totalSec={totalSec} zoom={zoom} onSeek={seekTo} />
          </div>
        );
      })}
    </div>
  );
}

function fmtClock(s) {
  const m = Math.floor(s / 60), ss = Math.floor(s % 60), ms = Math.floor((s % 1) * 100);
  return `${String(m).padStart(2, '0')}:${String(ss).padStart(2, '0')}.${String(ms).padStart(2, '0')}`;
}

function WaveCanvas({ waveform, color, cur, totalSec, zoom, onSeek }) {
  const ref = useRef(null);
  const [hover, setHover] = useState(null);

  useEffect(() => {
    const cv = ref.current;
    if (!cv || !waveform?.length) return;
    const dpr = 2;
    cv.width = cv.clientWidth * dpr; cv.height = 96 * dpr;
    const ctx = cv.getContext('2d');
    ctx.clearRect(0, 0, cv.width, cv.height);
    const vis = Math.max(1, Math.floor(waveform.length / zoom));
    const step = cv.width / vis;
    ctx.fillStyle = color;
    for (let i = 0; i < vis; i++) {
      const h = Math.max(2, waveform[i] * cv.height * 0.88);
      ctx.fillRect(i * step, (cv.height - h) / 2, Math.max(1, step * 0.7), h);
    }
    const px = (cur / Math.max(totalSec, 0.001)) * cv.width;
    ctx.strokeStyle = '#dc2626'; ctx.lineWidth = dpr;
    ctx.beginPath(); ctx.moveTo(px, 0); ctx.lineTo(px, cv.height); ctx.stroke();
  }, [waveform, cur, zoom, color, totalSec]);

  const toSec = e => {
    const r = ref.current.getBoundingClientRect();
    return Math.max(0, Math.min(totalSec, ((e.clientX - r.left) / r.width) * totalSec));
  };
  return (
    <div style={{ position: 'relative' }}>
      <canvas ref={ref} style={{ width: '100%', height: 96, display: 'block', background: '#fff', borderRadius: 7, border: '1px solid var(--line)', cursor: 'crosshair' }}
        onClick={e => onSeek?.(toSec(e))}
        onMouseMove={e => setHover(toSec(e))}
        onMouseLeave={() => setHover(null)} />
      {hover != null && (
        <div style={{ position: 'absolute', top: 4, left: `calc(${(hover / Math.max(totalSec, .001)) * 100}% + 6px)`, fontSize: 10.5, fontFamily: 'var(--font-mono)', color: 'var(--fg2)', pointerEvents: 'none', background: 'rgba(255,255,255,.9)', padding: '0 4px', borderRadius: 3 }}>
          {fmtClock(hover)}
        </div>
      )}
    </div>
  );
}

function wavFromPcm(int16, sampleRate) {
  const buf = new ArrayBuffer(44 + int16.length * 2);
  const v = new DataView(buf);
  const wstr = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  wstr(0, 'RIFF'); v.setUint32(4, 36 + int16.length * 2, true); wstr(8, 'WAVE');
  wstr(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, sampleRate, true); v.setUint32(28, sampleRate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  wstr(36, 'data'); v.setUint32(40, int16.length * 2, true);
  for (let i = 0; i < int16.length; i++) v.setInt16(44 + i * 2, int16[i], true);
  return new Uint8Array(buf);
}

/* ============================================================
   导出
   ============================================================ */
function ExportTab({ sel }) {
  const { showToast } = useStore();
  const [maskUser, setMaskUser] = useState(false);
  const [maskIp, setMaskIp] = useState(false);
  const [items, setItems] = useState({ pcapng: true, wav: true, report: true });
  const [results, setResults] = useState(null);
  const [busy, setBusy] = useState(false);

  const run = async () => {
    setBusy(true); setResults(null);
    try {
      const outDir = await api.pickDir();
      if (!outDir) return;
      const safe = sel.callId.slice(0, 20).replace(/[^a-zA-Z0-9_-]/g, '_');
      const list = [];
      if (items.pcapng) list.push({ type: 'pcapng', outPath: `${outDir}/call_${safe}.pcapng` });
      if (items.wav) list.push({ type: 'wav', outPath: outDir });
      if (items.report) list.push({ type: 'report', outPath: `${outDir}/report_${safe}.html` });
      const res = await api.exportRun({ fileId: sel.fileId, callId: sel.callId, items: list, opts: { maskUser, maskIp } });
      if (res.ok) { setResults(res.results); showToast('ok', '导出完成'); }
      else showToast('err', res.error);
    } finally { setBusy(false); }
  };

  return (
    <div className="detail-scroll">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 720 }}>
        <div className="card">
          <div className="card-title">导出内容</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <label className="ck"><input type="checkbox" checked={items.pcapng} onChange={e => setItems(i => ({ ...i, pcapng: e.target.checked }))} />原始关联报文（PCAPNG，本通话 SIP + RTP）</label>
            <label className="ck"><input type="checkbox" checked={items.wav} onChange={e => setItems(i => ({ ...i, wav: e.target.checked }))} />分方向 WAV（主叫 / 被叫 / 混合）</label>
            <label className="ck"><input type="checkbox" checked={items.report} onChange={e => setItems(i => ({ ...i, report: e.target.checked }))} />HTML 分析报告（自包含单文件）</label>
          </div>
          <div className="card-title" style={{ marginTop: 14 }}>隐私遮蔽</div>
          <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap' }}>
            <label className="ck"><input type="checkbox" checked={maskUser} onChange={e => setMaskUser(e.target.checked)} />遮蔽号码（保留后 4 位）</label>
            <label className="ck"><input type="checkbox" checked={maskIp} onChange={e => setMaskIp(e.target.checked)} />遮蔽 IP（保留前 2 段）</label>
          </div>
          <div style={{ marginTop: 14 }}>
            <button className="btn primary" disabled={busy || (!items.pcapng && !items.wav && !items.report)} onClick={run}>
              {busy ? '导出中…' : '选择目录并导出'}
            </button>
          </div>
        </div>

        {results && (
          <div className="card">
            <div className="card-title">导出结果</div>
            <table className="tbl">
              <thead><tr><th>项目</th><th>状态</th><th>详情</th><th></th></tr></thead>
              <tbody>
                {results.map((r, i) => (
                  <tr key={i}>
                    <td>{{ pcapng: 'PCAPNG 报文', wav: 'WAV 音频', report: 'HTML 报告' }[r.type] || r.type}</td>
                    <td>{r.ok ? <span className="badge ok">成功</span> : <span className="badge err">失败</span>}</td>
                    <td style={{ color: 'var(--fg3)', fontSize: 11.5 }}>{r.ok ? (r.file?.path || r.file?.files?.join(', ') || '') : r.error}</td>
                    <td>{r.ok && r.file?.path && <button className="btn sm ghost" onClick={() => api.showInFolder(r.file.path)}>打开目录</button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

registerPages({ CallsPage });
export { CallsPage };
