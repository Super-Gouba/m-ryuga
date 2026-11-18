import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useStore, api, fmtTime, fmtDateTime, fmtTimeDay, fmtDur, fmtBytes, trunc, registerPages, EmptyDropHint, SevBadge, usePaneSize, Splitter, useMediaQuery } from '../App.jsx';
import { t } from '../i18n.js';
import { useAsrJobs, startAsr } from '../asrSession.js';

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

  // 大包（上千通通话）只渲染可视区，避免一次性挂载全部行导致卡顿
  const ROW_H = 76;
  const listBodyRef = useRef(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewH, setViewH] = useState(420);
  const rafRef = useRef(0);
  useEffect(() => {
    const el = listBodyRef.current;
    if (!el) return undefined;
    const ro = new ResizeObserver(() => setViewH(el.clientHeight));
    ro.observe(el);
    setViewH(el.clientHeight);
    return () => ro.disconnect();
  }, []);
  useEffect(() => {
    const el = listBodyRef.current;
    if (el) el.scrollTop = 0;
    setScrollTop(0);
  }, [q, onlyIssue, activeFile]);
  useEffect(() => () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); }, []);
  const onListScroll = (e) => {
    const top = e.currentTarget.scrollTop;
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => { rafRef.current = 0; setScrollTop(top); });
  };

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
  // 只渲染可视区 ±8 行，4500 通通话时 DOM 行数保持在 30 行左右
  const start = Math.max(0, Math.floor(scrollTop / ROW_H) - 8);
  const end = Math.min(list.length, Math.ceil((scrollTop + viewH) / ROW_H) + 8);
  const visible = list.slice(start, end);

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
        <div className="list-body" ref={listBodyRef} onScroll={onListScroll}>
          {list.length === 0 ? <div className="empty">{t('list.empty')}</div> : (
            <div style={{ position: 'relative', height: list.length * ROW_H }}>
              {visible.map((c, i) => {
                const idx = start + i;
                const s = c.summary || {};
                const sel = selCall?.callId === c.callId && selCall?.fileId === c.fileId;
                const ended = s.endStatus || (s.ended ? 'BYE' : null);
                return (
                  <div key={c.id} className="call-row" data-sel={sel || undefined} data-sev={s.sev || 'ok'}
                    style={{ position: 'absolute', top: idx * ROW_H, left: 0, right: 0, height: ROW_H }}
                    onClick={() => dispatch({ type: 'select', sel: { fileId: c.fileId, callId: c.callId } })}>
                    <div className="call-route">
                      <span className="who">{s.fromUser || '未知'}</span>
                      <span className="arrow">→</span>
                      <span className="who">{s.toUser || '未知'}</span>
                    </div>
                    <div className="call-meta">
                      <span className="mono">{fmtTimeDay(s.tStart)}</span>
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
            </div>
          )}
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
        <div className="dh-kv">{t('detail.start')} <b>{fmtDateTime(s.tStart)}</b></div>
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
          {tab === 'audio' && <AudioTab sel={sel} soloKey={audioSoloKey} call={call} />}
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
      <div className="ov-grid">
        <div className="card">
          <div className="card-title">{t('ov.file')}</div>
          <div className="kvl">
            <b>{t('ov.fileName')}</b>
            <span className="mono" style={{ wordBreak: 'break-all' }}>{file?.fileName || '—'}</span>
            <b>{t('ov.size')}</b><span className="mono">{fmtBytes(stats.bytes ?? file?.size)}</span>
            <b>{t('ov.packets')}</b><span className="mono">{total.toLocaleString()}</span>
            <b>{t('ov.first')}</b><span className="mono">{fmtDateTime(stats.firstUs)}</span>
            <b>{t('ov.last')}</b><span className="mono">{fmtDateTime(stats.lastUs)}</span>
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
            <b>{t('ov.start')}</b><span className="mono">{fmtDateTime(s.tStart)}</span>
            <b>{t('ov.end')}</b><span>{s.endStatus ? `SIP ${s.endStatus}` : s.ended ? 'BYE' : '—'}</span>
            <b>{t('ov.duration')}</b><span className="mono">{s.connDurationSec != null ? fmtDur(s.connDurationSec) : t('list.durationUnknown')}</span>
            <b>{t('ov.codec')}</b><span>{s.codecs?.join(' / ') || t('ov.noSdp')}</span>
            <b>{t('ov.sipMsgs')}</b><span className="mono">{msgs?.msgs?.length ?? '—'}</span>
            <b>{t('ov.dtmf')}</b>
            <span style={{ display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap' }}>
              {(msgs?.dtmf || []).length === 0
                ? <span style={{ color: 'var(--fg3)' }}>{t('ov.none')}</span>
                : (msgs.dtmf.map((d, i) => <span key={i} className="dtmf-pill" title={`${d.via} · ${fmtDateTime(d.startUs)}`}>{d.digit}</span>))}
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

      <div className="card ov-full">
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
      <LadderFlow msgs={data.msgs} />
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

/* 呼叫流程解读：按关键事件生成阶段条，帮助快速判断这通电话经历了什么 */
function LadderFlow({ msgs }) {
  const steps = useMemo(() => buildFlow(msgs), [msgs]);
  if (!steps.length) return null;
  return (
    <div className="ladder-flow">
      <span className="lf-cap">{t('ladder.flow')}</span>
      {steps.map((s, i) => (
        <React.Fragment key={i}>
          {i > 0 && <span className="lf-arrow">→</span>}
          <span className="lf-step" data-tone={s.tone}>
            <i />{s.text}<em>{s.at}</em>
          </span>
        </React.Fragment>
      ))}
    </div>
  );
}

function buildFlow(msgs) {
  const list = (msgs || []).filter(Boolean);
  if (!list.length) return [];
  const sorted = list.slice().sort((a, b) => a.tsUs - b.tsUs);
  const t0 = sorted[0].tsUs;
  const at = us => `+${Math.max(0, (us - t0) / 1e6).toFixed(2)} s`;
  const methodOf = m => String(m.cseqMethod || m.method || '').toUpperCase();
  const req = (m, name) => m.kind === 'request' && methodOf(m) === name;
  const res = (m, lo, hi) => m.kind === 'response' && m.status >= lo && m.status <= hi;

  const firstInvite = sorted.find(m => req(m, 'INVITE'));
  const early = sorted.find(m => res(m, 180, 183));
  const answer = sorted.find(m => res(m, 200, 299) && methodOf(m) === 'INVITE');
  const fail = sorted.find(m => res(m, 400, 699) && methodOf(m) === 'INVITE');
  const bye = sorted.find(m => req(m, 'BYE'));
  const byeOk = sorted.find(m => m.kind === 'response' && methodOf(m) === 'BYE' && m.status >= 200 && m.status < 300);
  const cancel = sorted.find(m => req(m, 'CANCEL'));
  const release = bye || cancel || byeOk;
  // 已建立通话后的 INVITE 都是 re-INVITE（会话更新）；排除首个 INVITE 的重传
  const updates = sorted.filter(m => req(m, 'INVITE') && m !== firstInvite && (!!m.toTag || (!!answer && m.tsUs >= answer.tsUs)));

  const steps = [];
  if (firstInvite) steps.push({ tone: 'req', text: t('ladder.stepInvite'), at: at(firstInvite.tsUs) });
  if (early) steps.push({ tone: 'warn', text: early.status === 183 ? t('ladder.stepEarly') : t('ladder.stepRinging'), at: at(early.tsUs) });
  if (answer) steps.push({ tone: 'ok', text: t('ladder.stepAnswer'), at: at(answer.tsUs) });
  const relEnd = release;
  for (const m of updates) {
    if (relEnd && m.tsUs >= relEnd.tsUs) continue;
    steps.push({ tone: 'info', text: t('ladder.stepUpdate'), at: at(m.tsUs) });
  }
  if (!answer && fail) steps.push({ tone: 'err', text: `${t('ladder.stepFail')} ${fail.status}`, at: at(fail.tsUs) });
  if (answer && relEnd) steps.push({ tone: 'info', text: t('ladder.stepTalk'), at: `${((relEnd.tsUs - answer.tsUs) / 1e6).toFixed(2)} s` });
  if (bye || byeOk) steps.push({ tone: 'bye', text: t('ladder.stepBye'), at: at((bye || byeOk).tsUs) });
  else if (cancel) steps.push({ tone: 'warn', text: t('ladder.stepCancel'), at: at(cancel.tsUs) });
  return steps;
}

/* SDP 方向属性：用于识别通话保持 / 恢复 */
function sdpDirection(m) {
  const body = String(m?.body || '');
  if (/^a=inactive\s*$/mi.test(body)) return 'inactive';
  if (/^a=sendonly\s*$/mi.test(body)) return 'sendonly';
  if (/^a=recvonly\s*$/mi.test(body)) return 'recvonly';
  if (/^a=sendrecv\s*$/mi.test(body)) return 'sendrecv';
  return null;
}

/* 逐条消息的白话注释：结合对话状态识别 re-INVITE / Hold / 重传 / 失败原因 */
function buildAnnos(msgs) {
  const out = new Map();
  const dialogs = new Map();
  const methodOf = m => String(m.cseqMethod || m.method || '').toUpperCase();

  for (const m of (msgs || [])) {
    if (!m) continue;
    const cid = m.callId || '';
    let d = dialogs.get(cid);
    if (!d) {
      d = { inviteSeen: false, answered: false, failed: false, held: false, reInvites: new Set(), requests: new Map(), responses: new Map() };
      dialogs.set(cid, d);
    }
    const method = methodOf(m);

    // 重传：同方向、同 CSeq、同方法/状态码，且在 64×T1（32 s）内重复出现
    const key = m.kind === 'request'
      ? `q|${method}|${m.cseq}|${m.src}|${m.dst}`
      : `s|${m.status}|${method}|${m.cseq}|${m.src}|${m.dst}`;
    const store = m.kind === 'request' ? d.requests : d.responses;
    const prev = store.get(key);
    store.set(key, m.tsUs);
    if (prev != null && m.tsUs - prev <= 32e6) {
      out.set(m, { tone: 'muted', text: m.kind === 'request' ? t('ladder.annoRetransReq') : t('ladder.annoRetransRes') });
      continue;
    }

    if (m.kind === 'request') {
      if (method === 'INVITE') {
        // To-tag 已出现或本 Call-ID 已发过 INVITE → 在已建立的对话内，属于 re-INVITE
        const inDialog = d.inviteSeen || !!m.toTag;
        const dir = sdpDirection(m);
        if (inDialog) {
          d.reInvites.add(m.cseq);
          if (dir === 'inactive') out.set(m, { tone: 'warn', text: t('ladder.annoHoldBoth') });
          else if (dir === 'sendonly' || dir === 'recvonly') out.set(m, { tone: 'warn', text: t('ladder.annoHold') });
          else if (dir === 'sendrecv' && d.held) out.set(m, { tone: 'ok', text: t('ladder.annoUnhold') });
          else out.set(m, { tone: 'info', text: dir ? t('ladder.annoReInviteSdp') : t('ladder.annoReInvite') });
          if (dir) d.held = dir !== 'sendrecv';
        } else {
          d.inviteSeen = true;
          out.set(m, { tone: 'req', text: msgLabel(m).includes('/ SDP') ? t('ladder.annoInviteSdp') : t('ladder.annoInvite') });
        }
      } else if (method === 'ACK') {
        if (d.reInvites.has(m.cseq)) out.set(m, { tone: 'ok', text: t('ladder.annoAckUpdate') });
        else if (d.answered) out.set(m, { tone: 'ok', text: t('ladder.annoAck') });
        else if (d.failed) out.set(m, { tone: 'info', text: t('ladder.annoAckFail') });
        else out.set(m, { tone: 'info', text: t('ladder.annoAckResponse') });
      } else if (method === 'BYE') out.set(m, { tone: 'bye', text: t('ladder.annoBye') });
      else if (method === 'CANCEL') out.set(m, { tone: 'warn', text: t('ladder.annoCancel') });
      else if (method === 'PRACK') out.set(m, { tone: 'info', text: t('ladder.annoPrack') });
      else if (method === 'UPDATE') out.set(m, { tone: 'info', text: t('ladder.annoUpdateReq') });
      else if (method === 'REFER') out.set(m, { tone: 'info', text: t('ladder.annoRefer') });
      else if (method === 'REGISTER') out.set(m, { tone: 'info', text: t('ladder.annoRegister') });
      else if (method === 'INFO') out.set(m, { tone: 'info', text: t('ladder.annoInfo') });
      else if (method === 'OPTIONS') out.set(m, { tone: 'info', text: t('ladder.annoOptions') });
      else if (method === 'MESSAGE') out.set(m, { tone: 'info', text: t('ladder.annoMessage') });
      else if (method === 'SUBSCRIBE' || method === 'NOTIFY') out.set(m, { tone: 'info', text: t('ladder.annoSubscribe') });
      else out.set(m, { tone: 'info', text: method });
      continue;
    }

    const s = Number(m.status) || 0;
    if (method === 'INVITE' && s >= 300) d.failed = true;

    if (s >= 200 && s < 300) {
      if (method === 'INVITE') {
        const re = d.reInvites.has(m.cseq);
        d.answered = true;
        out.set(m, { tone: 'ok', text: re ? t('ladder.annoUpdateOk') : t('ladder.annoAnswer') });
      } else if (method === 'BYE') out.set(m, { tone: 'bye', text: t('ladder.annoByeOk') });
      else if (method === 'CANCEL') out.set(m, { tone: 'warn', text: t('ladder.annoCancelOk') });
      else if (method === 'PRACK') out.set(m, { tone: 'ok', text: t('ladder.annoPrackOk') });
      else if (method === 'UPDATE') out.set(m, { tone: 'ok', text: t('ladder.annoUpdateOk') });
      else out.set(m, { tone: 'ok', text: s === 200 ? t('ladder.annoOk') : String(s) });
      continue;
    }
    if (s >= 300 && s < 400) { out.set(m, { tone: 'warn', text: t('ladder.annoRedirect') }); continue; }
    if (s === 401 || s === 407) { out.set(m, { tone: 'warn', text: t('ladder.annoAuth') }); continue; }
    if (s === 403 || s === 603) { out.set(m, { tone: 'err', text: t('ladder.annoForbidden') }); continue; }
    if (s === 404) { out.set(m, { tone: 'err', text: t('ladder.annoNotFound') }); continue; }
    if (s === 408) { out.set(m, { tone: 'err', text: t('ladder.annoTimeout') }); continue; }
    if (s === 480) { out.set(m, { tone: 'warn', text: t('ladder.annoUnavailable') }); continue; }
    if (s === 486) { out.set(m, { tone: 'warn', text: t('ladder.annoBusy') }); continue; }
    if (s === 487) { out.set(m, { tone: 'warn', text: t('ladder.annoCanceled') }); continue; }
    if (s === 488 || s === 606) { out.set(m, { tone: 'err', text: t('ladder.annoMediaFail') }); continue; }
    if (s === 503) { out.set(m, { tone: 'err', text: t('ladder.annoServiceUnavailable') }); continue; }
    if (s >= 400 && s < 500) { out.set(m, { tone: 'err', text: t('ladder.annoFail') }); continue; }
    if (s >= 500) { out.set(m, { tone: 'err', text: t('ladder.annoServerFail') }); continue; }
    if (s === 100) {
      out.set(m, { tone: 'info', text: d.reInvites.has(m.cseq) ? t('ladder.annoUpdateTrying') : t('ladder.annoTrying') });
      continue;
    }
    if (s === 180) { out.set(m, { tone: 'warn', text: t('ladder.annoRinging') }); continue; }
    if (s === 183) { out.set(m, { tone: 'warn', text: t('ladder.annoEarly') }); continue; }
    if (s >= 100 && s < 200) { out.set(m, { tone: 'info', text: t('ladder.annoProgress') }); continue; }
  }
  return out;
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
  // 注释需要跨消息状态（对话是否已建立、是否重传），先整体算一遍
  const annos = useMemo(() => buildAnnos(data.msgs), [data.msgs]);
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
  const annoTone = {
    req: 'var(--accent)', ok: 'var(--green)', warn: 'var(--amber)',
    err: 'var(--red)', bye: 'var(--violet)', info: 'var(--fg3)', muted: 'var(--fg3)'
  };

  return (
    <div ref={hostRef} style={{ width: '100%', minHeight: H }}>
      <svg width={W} height={H} style={{ display: 'block' }}>
        <text x={offX + 12} y={26} fontSize={10.5} fill="var(--fg3)" fontFamily="var(--font-mono)">相对时间 / 秒</text>
        <line x1={offX + GUTTER - 14} y1={4} x2={offX + GUTTER - 14} y2={H - 4} stroke="var(--line)" />

        {actors.map((a, i) => {
          const [host, port] = String(a.label).split(':');
          const boxW = Math.min(ACTOR_W - 24, 200);
          // 参与方只区分信令 / 媒体：出现在 SIP 报文里的是信令，只有 RTP 的才是媒体
          const role = a.kind === 'media' ? t('ladder.media') : t('ladder.sig');
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
                <title>{`DTMF 按键 ${d.digit} · ${d.via} · ${fmtDateTime(r.tsUs)}`}</title>
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
          const anno = annos.get(m);
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
              {anno ? (
                <text x={mid} y={y + 15} textAnchor="middle" fontSize={9.5} fontWeight={600}
                  fill={annoTone[anno.tone]} fontFamily="var(--font-ui)">
                  {anno.text}<tspan fill="var(--fg3)" fontWeight={400} fontFamily="var(--font-mono)"
                    fontSize={9}>{` · CSeq ${m.cseq}${m.kind === 'request' ? '' : ' ' + m.cseqMethod}`}</tspan>
                </text>
              ) : (
                <text x={mid} y={y + 15} textAnchor="middle" fontSize={9.5} fill="var(--fg3)"
                  fontFamily="var(--font-mono)">{m.kind === 'request' ? `CSeq ${m.cseq}` : `CSeq ${m.cseq} ${m.cseqMethod}`}</text>
              )}
              <text x={x1 + dir * -7} y={y + 3.5} textAnchor={dir === 1 ? 'end' : 'start'} fontSize={9}
                fill="var(--fg3)" fontFamily="var(--font-mono)">{m.src.split(':').pop()}</text>
              <text x={x2 + dir * 7} y={y + 3.5} textAnchor={dir === 1 ? 'start' : 'end'} fontSize={9}
                fill="var(--fg3)" fontFamily="var(--font-mono)">{m.dst.split(':').pop()}</text>
              <title>{`${msgLabel(m)}  ·  ${fmtDateTime(r.tsUs)}\n${m.src} → ${m.dst}\nCall-ID: ${m.callId || ''}`}</title>
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
          <div className="mp-row">时间：<b>{fmtDateTime(d.startUs)}</b></div>
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
        <div className="mp-row">时间：<b>{fmtDateTime(msg.tsUs)}</b> · UDP</div>
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

/* 放大查看：Homer 风格报文卡片弹窗；详情字段用协议原名 / 中文可读名，值可换行、可点击复制 */
const META_LABEL_KEY = {
  TIME: 'mm.time', SRC: 'mm.src', DST: 'mm.dst', STATUS: 'mm.status', METHOD: 'mm.method',
  CSEQ: 'mm.cseq', 'CALL-ID': 'mm.callid', FROM: 'mm.from', TO: 'mm.to', 'USER-AGENT': 'mm.ua',
  CHANNEL: 'mm.channel', DURATION: 'mm.duration', CODEC: 'mm.codec', PACKETS: 'mm.packets',
  START: 'mm.start', END: 'mm.end', SPAN: 'mm.span', LOST: 'mm.lost', JITTER: 'mm.jitter', DIGIT: 'mm.digit'
};
const metaLabel = k => (META_LABEL_KEY[k] ? t(META_LABEL_KEY[k]) : k);
const MONO_FIELDS = /^(TIME|START|END|CSEQ|PACKETS|STATUS|DIGIT|LOST|JITTER|SPAN|DURATION)$/;

function MessageModal({ item, onClose }) {
  const { showToast } = useStore();
  const [max, setMax] = useState(false);
  const [wrap, setWrap] = useState(true);
  const [copied, setCopied] = useState('');

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
    // 只保留有分辨价值的字段：类型/传输等已在标题与报文中体现
    if (m.kind !== 'request') {
      meta.push(['STATUS', `${m.status}${m.reason ? ' ' + m.reason : ''}`], ['METHOD', m.cseqMethod || '—']);
    }
    meta.push(
      ['TIME', fmtDateTime(m.tsUs)],
      ['SRC', m.src], ['DST', m.dst],
      ['CSEQ', String(m.cseq ?? '—')],
      ['CALL-ID', m.callId || '—'],
      ['FROM', m.fromUri || m.from?.uri || '—'],
      ['TO', m.toUri || m.to?.uri || '—'],
      ['USER-AGENT', m.ua || '—']
    );
    body = <div className="msg-text" style={{ whiteSpace: wrap ? 'pre-wrap' : 'pre' }}>{renderMsg(m)}</div>;
    raw = rawText(m);
  } else if (item.type === 'dtmf') {
    const d = item.event;
    title = `DTMF ${d.digit}`;
    meta.push(
      ['DIGIT', d.digit], ['TIME', fmtDateTime(d.startUs)],
      ['CHANNEL', d.via], ['DURATION', d.durationMs != null ? `${Math.round(d.durationMs)} ms` : '—'],
      ['SRC', d.src || '—'], ['DST', d.dst || '—']
    );
    body = <div style={{ fontSize: 13, color: 'var(--fg2)', lineHeight: 1.9 }}>{t('mm.dtmfNote')}</div>;
  } else {
    const md = item.media;
    title = `RTP ${md.codec}`;
    meta.push(
      ['CODEC', md.codec], ['PACKETS', String(md.packets)],
      ['SRC', md.src], ['DST', md.dst],
      ['START', fmtDateTime(md.startUs)], ['END', fmtDateTime(md.endUs)],
      ['SPAN', md.endUs ? `${((md.endUs - md.startUs) / 1e6).toFixed(1)} s` : '—'],
      ['LOST', String(md.lost || 0)],
      ['JITTER', md.jitterMs != null ? `${Number(md.jitterMs).toFixed(1)} ms` : '—']
    );
    body = <div style={{ fontSize: 13, color: 'var(--fg2)', lineHeight: 1.9 }}>{t('mm.rtpNote')}</div>;
  }

  const copy = async () => {
    if (!raw) return;
    try { await navigator.clipboard.writeText(raw); showToast('ok', t('msg.copied')); }
    catch { showToast('err', t('msg.copy')); }
  };

  const copyField = async (k, v) => {
    try {
      await navigator.clipboard.writeText(String(v));
      setCopied(k);
      setTimeout(() => setCopied(''), 1200);
    } catch { showToast('err', t('msg.copy')); }
  };

  const typeLabel = item.type === 'sip' ? t('mm.sipMsg') : item.type === 'dtmf' ? t('mm.dtmfEvent') : t('mm.rtpStream');

  return (
    <div className="modal-mask" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={`msg-modal ${max ? 'is-max' : ''}`} onMouseDown={e => e.stopPropagation()}>
        <div className="msg-modal-head">
          <span className="mm-title">{title}</span>
          <span className="mm-sub">{typeLabel}</span>
          <div style={{ flex: 1 }} />
          {item.type === 'sip' && (
            <button className="mm-btn" title={t('mm.wrap')} onClick={() => setWrap(w => !w)}>{wrap ? `⇥ ${t('mm.nowrap')}` : `↵ ${t('mm.wrap')}`}</button>
          )}
          {item.type === 'sip' && <button className="mm-btn" title={t('msg.copy')} onClick={copy}>⧉ {t('mm.copyShort') || t('msg.copy')}</button>}
          <button className="mm-btn" title={max ? t('mm.restore') : t('mm.maximize')} onClick={() => setMax(m => !m)}>{max ? '⇲' : '⤢'}</button>
          <button className="mm-btn" title={t('mm.close')} onClick={onClose}>✕</button>
        </div>

        <div className="msg-modal-body">
          <div className="mm-section">{t('mm.details')}</div>
          <div className="mm-meta">
            {meta.map(([k, v]) => (
              <div key={k} className="mm-cell" onClick={() => copyField(k, v)} title={`${metaLabel(k)}: ${v}\n${t('mm.copyHint')}`}>
                <div className={`mm-k ${copied === k ? 'is-copied' : ''}`}>{metaLabel(k)}{copied === k ? ' ✓' : ''}</div>
                <div className={`mm-v ${MONO_FIELDS.test(k) ? 'mono' : ''}`}>{String(v)}</div>
              </div>
            ))}
          </div>

          {item.type === 'sip' && (
            <>
              <div className="mm-section" style={{ marginTop: 14 }}>
                {t('mm.payload')}
                <span className="mm-hint">{t('mm.lines', { n: raw.split('\n').length })}</span>
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

const REQ_COLOR = { INVITE: 'var(--msg-uri)', ACK: 'var(--msg-key)', BYE: 'var(--msg-agent)', CANCEL: 'var(--msg-agent)', REGISTER: '#7a3fa8', OPTIONS: 'var(--msg-key)', INFO: 'var(--msg-sdp-o)', UPDATE: 'var(--msg-sdp-o)', PRACK: 'var(--msg-sdp-o)' };

/* 头部值的语义配色：URI 类、UA、数字类分别着色，便于快速扫读 */
const HDR_URI = new Set(['From', 'To', 'Contact', 'Call-ID', 'Remote-Party-ID', 'P-Asserted-Identity', 'P-Preferred-Identity', 'Refer-To', 'Referred-By', 'Subscription-State']);
const HDR_AGENT = new Set(['User-Agent', 'Server']);
const HDR_NUM = new Set(['Content-Length', 'CSeq', 'Max-Forwards', 'RSeq', 'Session-Expires', 'Min-SE', 'Expires']);

function hvalCls(k) {
  if (HDR_URI.has(k)) return 'hval hval-uri';
  if (HDR_AGENT.has(k)) return 'hval hval-agent';
  if (HDR_NUM.has(k)) return 'hval hval-num';
  return 'hval';
}

/* 带语法着色的报文渲染（Homer 风格：方法/URI、头名、头值、SDP 逐层分色） */
function renderMsg(m) {
  const nodes = [];
  const startLine = m.startLine || '';

  if (m.kind === 'request') {
    const method = startLine.split(/\s+/)[0] || '';
    nodes.push(
      <div key="sl" className="ln-start">
        <span className="ln-method" style={{ color: REQ_COLOR[method] || 'var(--msg-uri)' }}>{method}</span>
        <span className="ln-uri">{startLine.slice(method.length)}</span>
      </div>
    );
  } else {
    const cls = (m.status >= 200 && m.status < 300) ? 'ln-status-ok'
      : (m.status >= 400) ? 'ln-status-err' : 'ln-status-prov';
    nodes.push(<div key="sl" className={cls}>{startLine}</div>);
  }

  (m.hdrs || []).forEach(([k, v], i) => {
    nodes.push(
      <div key={`h${i}`}>
        <span className="hkey">{k}</span><span className="hsep">:</span> <span className={hvalCls(k)}>{v}</span>
      </div>
    );
  });

  if (m.body && String(m.body).trim()) {
    nodes.push(<div key="body-gap" className="dim">{'\u00a0'}</div>);
    String(m.body).split(/\r?\n/).forEach((line, i) => {
      if (!line) return;
      const sdp = /^([a-z])=([\s\S]*)$/.exec(line);
      if (sdp) {
        nodes.push(
          <div key={`b${i}`} className={`sdpline sdp-${sdp[1]}`}>
            <span className="sdp-k">{sdp[1]}=</span><span className="sdp-v">{sdp[2]}</span>
          </div>
        );
      } else {
        nodes.push(<div key={`b${i}`} className="sdp-v">{line}</div>);
      }
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
      <div className="list-body tbl-scroll">
        <table className="tbl msgs-table">
          <thead><tr><th style={{ width: 42 }}>#</th><th style={{ width: 168 }}>时间</th><th>信令 / 事件</th><th>源 → 目的</th></tr></thead>
          <tbody>
            {list.map(({ r, no }) => {
              const sel = pick?.type === r.type && pick?.idx === r.idx;
              if (r.type === 'dtmf') {
                const d = data.dtmf[r.idx];
                return (
                  <tr key={`d${no}`} className={sel ? 'sel' : ''} onClick={() => onPick({ type: 'dtmf', idx: r.idx })}>
                    <td className="mono" style={{ color: 'var(--fg3)' }}>{no}</td>
                    <td className="mono">{fmtDateTime(d.startUs)}</td>
                    <td><span className="dtmf-pill">DTMF 按键 {d.digit}</span> <span style={{ color: 'var(--fg3)', fontSize: 11.5 }}>{d.via}</span></td>
                    <td className="mono" style={{ color: 'var(--fg3)', fontSize: 11.5 }}>{d.src || '—'} → {d.dst || '—'}</td>
                  </tr>
                );
              }
              const m = data.msgs[r.idx];
              return (
                <tr key={`s${no}`} className={sel ? 'sel' : ''} onClick={() => onPick({ type: 'sip', idx: r.idx })}>
                  <td className="mono" style={{ color: 'var(--fg3)' }}>{no}</td>
                  <td className="mono">{fmtDateTime(m.tsUs)}</td>
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
  // 导入时不再为每通通话传输 diag，打开时按需拉取
  const [diag, setDiag] = useState(call.diag || {});
  useEffect(() => {
    if (call.diag) { setDiag(call.diag); return undefined; }
    let alive = true;
    api.callDiagnose(sel.fileId, sel.callId)
      .then(r => { if (alive && r?.ok && r.diag) setDiag(r.diag); })
      .catch(() => {});
    return () => { alive = false; };
  }, [sel, call]);
  const issues = [
    ...(diag.signalingIssues || []).map(i => ({ ...i, cat: '信令' })),
    ...(diag.mediaIssues || []).map(i => ({ ...i, cat: '媒体' }))
  ];

  return (
    <>
      <div className="card">
        <div className="card-title">{t('diag.timeline')}</div>
        <div className="kvl">
          <b>{t('ov.start')}</b><span className="mono">{fmtDateTime(s.tStart)}</span>
          <b>{t('diag.connect')}</b><span className="mono">{s.tConnect ? fmtDateTime(s.tConnect) : '—'}</span>
          <b>{t('ov.last')}</b><span className="mono">{s.tEnd ? fmtDateTime(s.tEnd) : '—'}</span>
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
        <div className="card-title">{t('diag.media')}</div>
        {!media && !mediaErr && <div className="empty" style={{ padding: 20 }}><div className="pulsing">{t('diag.decoding')}</div></div>}
        {mediaErr && <div style={{ color: 'var(--red)', fontSize: 12.5 }}>{mediaErr}</div>}
        {media && <MediaOverview media={media} />}
      </div>

      <div className="card ov-full">
        <div className="card-title">{t('diag.title')}</div>
        {issues.length === 0
          ? <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}><span className="badge ok">{t('sev.ok')}</span>{t('diag.pass')}</div>
          : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: 7 }}>
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
    </>
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
                <span key={i} className="badge info mono" title={`${fmtDateTime(d.startUs)} · ${d.via}`}>{d.digit}</span>
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
   转写：与音频分析合并展示，任务状态保存在模块级（切页不丢）
   ============================================================ */
function TranscriptPanel({ sel }) {
  const jobs = useAsrJobs();
  const key = `${sel.fileId}|${sel.callId}`;
  const job = jobs.get(key);
  const [st, setSt] = useState(null);
  const [mode, setMode] = useState(() => localStorage.getItem('mryuga:asrMode') || 'merge');
  const [q, setQ] = useState('');

  useEffect(() => { api.asrStatus().then(setSt).catch(() => {}); }, []);

  const busy = !!job?.busy;
  const res = job?.result;
  const ready = !!st?.ready;
  const pct = Math.round((job?.pct || 0) * 100);
  const segs = res?.ok ? (q ? res.segments.filter(s => (s.text || '').includes(q)) : res.segments) : [];

  const start = () => {
    localStorage.setItem('mryuga:asrMode', mode);
    startAsr({ fileId: sel.fileId, callId: sel.callId, mode });
  };

  return (
    <div className="audio-shell" style={{ marginTop: 12 }}>
      <React.Fragment>
        <div className="card">
          <div className="card-title" style={{ flexWrap: 'wrap', gap: 8 }}>
            语音转写
            <span className={`badge ${ready ? 'ok' : 'err'}`}>引擎 {ready ? '就绪' : '未配置'}</span>
            {st?.activeModel && <span className="badge mut">{String(st.activeModel).split(/[\\/]/).pop()}</span>}
            <div style={{ flex: 1 }} />
            <select className="input" style={{ width: 132, height: 28 }} value={mode} disabled={busy} onChange={e => setMode(e.target.value)}>
              <option value="merge">合并识别</option>
              <option value="split">按方向分轨</option>
            </select>
            <button className="btn primary sm" onClick={start} disabled={busy || !ready}>
              {busy ? (pct > 0 ? `识别中 ${pct}%` : '识别中…') : (res?.ok ? '重新转写' : '开始转写')}
            </button>
          </div>

          {!ready && (
            <div style={{ fontSize: 12, color: 'var(--fg3)', lineHeight: 1.8 }}>
              还没有可用的识别环境，请先到顶部「语音转写」菜单下载引擎与模型。
            </div>
          )}

          {busy && (
            <div style={{ marginTop: 10 }}>
              <div className="upd-prog" data-idle={pct < 2 || undefined}><i style={{ width: `${Math.max(4, pct)}%` }} /></div>
              <div style={{ fontSize: 11.5, color: 'var(--fg3)', marginTop: 5 }}>
                本机离线识别 · 已用 {fmtElapsed(job?.elapsed)} · 可切换页面，任务会继续
              </div>
            </div>
          )}

          {res && !res.ok && (
            <div style={{ marginTop: 8, fontSize: 12.5, color: 'var(--red)' }}>
              {res.error}
              {res.hint && <div style={{ color: 'var(--fg2)', marginTop: 4 }}>{res.hint}</div>}
            </div>
          )}
        </div>

        {res?.ok && (
          <div className="card">
            <div className="card-title" style={{ flexWrap: 'wrap' }}>
              识别结果
              <span className="badge ok">{res.model}</span>
              <span className="badge mut">{res.segments.length} 段</span>
              <div style={{ flex: 1 }} />
              <input className="input" style={{ width: 200, height: 28 }} placeholder="搜索文本…" value={q} onChange={e => setQ(e.target.value)} />
            </div>
            <div style={{ maxHeight: 420, overflow: 'auto' }}>
              {segs.map((s, i) => (
                <div key={i} style={{ display: 'flex', gap: 10, padding: '7px 2px', borderBottom: '1px solid var(--line)', fontSize: 13 }}>
                  <span className="mono" style={{ color: 'var(--accent)', minWidth: 68 }}>{s.startFmt || '00:00.0'}</span>
                  {s.ch && s.ch !== 'mix' && <span className="badge mut" style={{ minWidth: 46 }}>{s.ch === 'a' ? '主叫' : '被叫'}</span>}
                  <span style={{ flex: 1 }}>{s.text}</span>
                </div>
              ))}
              {segs.length === 0 && <div className="empty">无匹配文本</div>}
            </div>
          </div>
        )}
      </React.Fragment>
    </div>
  );
}

function fmtElapsed(sec) {
  const s = Math.max(0, Math.round(sec || 0));
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`;
}

/* ============================================================
   音频分析：方向统计 + 音轨 + 波形 / 丢包断流标记
   ============================================================ */
function AudioTab({ sel, soloKey, call }) {
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

  if (loading) return <div className="empty" style={{ flex: 1 }}><div className="pulsing">{t('audio.decoding')}</div></div>;
  if (err) return <div className="empty" style={{ flex: 1 }}>{err}</div>;
  if (!media?.streams?.a && !media?.streams?.b) {
    return (
      <div className="empty" style={{ flex: 1 }}>
        <div className="ico">◍</div>
        <div style={{ fontWeight: 600, color: 'var(--fg2)' }}>{t('audio.noMedia')}</div>
        <div style={{ fontSize: 12.5, maxWidth: 440, lineHeight: 1.8 }}>{t('audio.noMediaDesc')}</div>
      </div>
    );
  }
  return (
    <div className="detail-scroll">
      <AudioAnalysis media={media} soloKey={soloKey} call={call} sel={sel} />
      <TranscriptPanel sel={sel} />
    </div>
  );
}

function AudioAnalysis({ media, soloKey, call, sel }) {
  const { showToast } = useStore();
  const A = media.streams?.a, B = media.streams?.b;
  const initSolo = soloKey ? (A?.key === soloKey ? 'a' : B?.key === soloKey ? 'b' : null) : null;
  const [solo, setSolo] = useState(initSolo);
  // 从流序图点不同 RTP 行时同步独听方向
  useEffect(() => { if (soloKey) setSolo(initSolo); }, [soloKey]);
  const [mute, setMute] = useState({});
  const [rate, setRate] = useState(1);
  const [cur, setCur] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [dlWhich, setDlWhich] = useState('mix');
  const [dlBusy, setDlBusy] = useState(false);
  const nodesRef = useRef(null);

  // 直接导出 WAV：主进程重新解码并弹保存对话框，支持合并 / 单方向
  const downloadAudio = async () => {
    if (!sel?.fileId) return;
    setDlBusy(true);
    try {
      const r = await api.audioSaveWav({ fileId: sel.fileId, callId: sel.callId, which: dlWhich });
      if (r?.canceled) return;
      if (r?.ok) showToast('ok', t('audio.dlSaved', { path: r.file }));
      else showToast('err', r?.error || t('audio.dlFail'));
    } catch (e) {
      showToast('err', String(e.message || e));
    } finally {
      setDlBusy(false);
    }
  };

  const tracks = [['a', A], ['b', B]].filter(([, st]) => st);
  const colors = { a: '#2563eb', b: '#7c3aed' };

  const totalSec = useMemo(
    () => Math.max(0.01, ...tracks.map(([, st]) => (st?.pcm ? st.pcm.byteLength / 2 / st.sampleRate : 0))),
    [media]
  );

  const stats = useMemo(() => {
    const sts = tracks.map(([, s]) => s);
    const packets = sts.reduce((n, s) => n + (s.packets || 0), 0);
    const lost = sts.reduce((n, s) => n + (s.lost || 0), 0);
    const jitter = Math.max(0, ...sts.map(s => s.jitterMs || 0));
    const marks = [];
    const cap = Math.max(1, totalSec) * 1000;
    for (const [slot, s] of tracks) {
      for (const m of (s.marks || [])) {
        // 跳过 RTP 时间戳重置造成的伪断流，并按音频时长截断
        if ((m.ms || 0) > 10000) continue;
        marks.push({ ...m, ms: Math.min(Math.max(0, m.ms || 0), cap), slot });
      }
    }
    const stalls = marks.filter(m => (m.ms || 0) >= 200);
    const longest = marks.reduce((n, m) => Math.max(n, m.ms || 0), 0);
    const totalPkts = packets + lost;
    return { packets, lost, lostPct: totalPkts ? (lost / totalPkts) * 100 : 0, jitter, stalls: stalls.length, longest, marks };
  }, [media, totalSec]);

  const dtmfAll = media.dtmf || [];
  const dtmfOf = key => dtmfAll.filter(d => !d.src || String(key).startsWith(d.src + '>'));

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

  return (
    <div className="audio-shell">
      <div className="card">
        <div className="audio-head">
          <div style={{ minWidth: 0 }}>
            <div className="audio-route">
              {call?.summary?.fromUser || '—'} <span>→</span> {call?.summary?.toUser || '—'}
            </div>
            <div className="audio-sub mono" title={call?.callId}>Call-ID {trunc(call?.callId || '—', 56)}</div>
          </div>
          <div style={{ flex: 1 }} />
          <div className="audio-sub mono">{t('detail.start')} {fmtDateTime(call?.summary?.tStart)}</div>
        </div>
        <div className="audio-stats">
          <Stat label={t('audio.total')} value={`${totalSec.toFixed(2)} s`} />
          <Stat label={t('audio.received')} value={stats.packets.toLocaleString()} sub={`${t('diag.lost')} ${stats.lost} (${stats.lostPct.toFixed(1)}%)`} />
          <Stat label={t('diag.jitter')} value={`${stats.jitter.toFixed(1)} ms`} />
          <Stat label={t('audio.stalls')} value={String(stats.stalls)} sub="≥ 200 ms" />
          <Stat label={t('audio.maxGap')} value={`${Math.round(stats.longest)} ms`} />
        </div>
      </div>

      <div className="card">
        <div className="card-title">{t('audio.streamInfo')}</div>
        <div className="atracks">
          {tracks.map(([slot, st]) => (
            <div key={slot} className="atrack">
              <span className="adot" style={{ background: colors[slot] }} />
              <b className="aname">{slot === 'a' ? t('ov.caller') : t('ov.callee')}</b>
              <span className="badge mut">{st.codec || '—'}</span>
              <span className="atrack-addr mono" title={st.key}>{String(st.key).replace('>', ' → ')}</span>
              <input type="range" className="arange" min={0} max={Math.max(totalSec, 0.01)} step={0.01} value={cur}
                onChange={e => seekTo(+e.target.value)} title={t('audio.seek')} />
              <span className="mono atime">{fmtClock(cur)} / {fmtClock(totalSec)}</span>
              <button className={`btn sm ${solo === slot ? 'primary' : ''}`} onClick={() => setSolo(solo === slot ? null : slot)}>{t('audio.solo')}</button>
              <button className={`btn sm ${mute[slot] ? 'danger' : ''}`} onClick={() => setMute(m => ({ ...m, [slot]: !m[slot] }))}>{t('audio.mute')}</button>
            </div>
          ))}
        </div>
      </div>

      <div className="card">
        <div className="card-title" style={{ flexWrap: 'wrap' }}>
          {t('audio.legend')}
          <div style={{ flex: 1 }} />
          <span className="aleg"><i style={{ background: colors.a }} />{t('audio.amp')}</span>
          <span className="aleg"><i style={{ background: 'rgba(214,120,40,.55)' }} />{t('audio.lossMark')}</span>
          <span className="aleg"><i style={{ background: 'rgba(140,150,164,.35)' }} />{t('audio.silence')}</span>
          <span className="aleg"><i style={{ background: '#d9a441' }} />{t('audio.dtmfMark')}</span>
          <span className="aleg"><i style={{ background: '#dc2626' }} />{t('audio.playhead')}</span>
        </div>
        {tracks.map(([slot, st]) => (
          <div key={slot} className="awave-row">
            <div className="awave-side">
              <div className="awave-name">
                <span className="adot" style={{ background: colors[slot] }} />
                {slot === 'a' ? t('ov.caller') : t('ov.callee')}
                <span className="badge mut">{st.codec || '—'}</span>
              </div>
              <div className="mono awave-addr">{String(st.key).replace('>', ' → ')}</div>
              <div className="awave-meta">
                <span>{t('audio.received')} {st.packets ?? 0}</span>
                <span>{t('diag.lost')} {st.lost ?? 0}</span>
                <span>{t('diag.jitter')} {st.jitterMs != null ? Number(st.jitterMs).toFixed(1) : '—'} ms</span>
                {st.sampleRate ? <span>{st.sampleRate / 1000} kHz</span> : null}
              </div>
            </div>
            <AudioWave
              waveform={st.waveform} marks={st.marks} dtmf={dtmfOf(st.key)} firstUs={st.firstUs}
              dur={st.pcm ? st.pcm.byteLength / 2 / st.sampleRate : totalSec}
              totalSec={totalSec} cur={cur} color={colors[slot]} onSeek={seekTo}
            />
          </div>
        ))}
        <div className="awave-foot">{t('audio.waveHint')}</div>
      </div>

      <div className="card audio-transport">
        <button className="btn primary" onClick={() => (playing ? pause() : play())}>
          {playing ? `⏸ ${t('audio.pause')}` : `▶ ${t('audio.play')}`}
        </button>
        <span className="mono" style={{ fontSize: 12.5 }}>{fmtClock(cur)} / {fmtClock(totalSec)}</span>
        <input type="range" min={0} max={Math.max(totalSec, 0.01)} step={0.01} value={cur}
          onChange={e => seekTo(+e.target.value)}
          style={{ flex: 1, minWidth: 160, accentColor: 'var(--accent)' }} title={t('audio.seek')} />
        <select className="input" value={rate} onChange={e => setRate(+e.target.value)} style={{ width: 78 }}>
          {[0.5, 0.75, 1, 1.25, 1.5, 2].map(r => <option key={r} value={r}>{r}×</option>)}
        </select>
        <select className="input" value={dlWhich} onChange={e => setDlWhich(e.target.value)} style={{ width: 132 }} title={t('audio.download')}>
          <option value="mix">{t('audio.dlMix')}</option>
          {A?.pcm && <option value="a">{t('audio.dlCaller')}</option>}
          {B?.pcm && <option value="b">{t('audio.dlCallee')}</option>}
        </select>
        <button className="btn" onClick={downloadAudio} disabled={dlBusy}>{dlBusy ? t('audio.downloading') : `⤓ ${t('audio.download')}`}</button>
        <span className="mono" style={{ fontSize: 11.5, color: 'var(--fg3)' }}>{cur.toFixed(3)} / {totalSec.toFixed(3)} s</span>
      </div>
    </div>
  );
}

function Stat({ label, value, sub }) {
  return (
    <div className="astat">
      <div className="astat-k">{label}</div>
      <div className="astat-v mono">{value}</div>
      {sub && <div className="astat-s">{sub}</div>}
    </div>
  );
}

function fmtClock(s) {
  const m = Math.floor(s / 60), ss = Math.floor(s % 60), ms = Math.floor((s % 1) * 100);
  return `${String(m).padStart(2, '0')}:${String(ss).padStart(2, '0')}.${String(ms).padStart(2, '0')}`;
}

/* 波形：时间轴 + 振幅包络 + 静音区 + 丢包/断流标记 + DTMF 按键 + 播放头 */
function AudioWave({ waveform, marks = [], dtmf = [], firstUs, dur = 0, totalSec, cur, color, onSeek }) {
  const ref = useRef(null);
  const [hover, setHover] = useState(null);

  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const dpr = window.devicePixelRatio || 2;
    const W = cv.clientWidth || 640, H = 104;
    const LANE = 28; // 顶部按键轨道高度
    cv.width = W * dpr; cv.height = H * dpr;
    const ctx = cv.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    const span = Math.max(totalSec, 0.001);
    const xOf = sec => Math.max(0, Math.min(W, (sec / span) * W));

    // 背景：柔和渐变 + 按键轨道底色，避免大片纯白
    const bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, '#fbfdff');
    bg.addColorStop(1, '#f1f5fa');
    ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#eef3f9'; ctx.fillRect(0, 0, W, LANE);

    // 时间网格
    ctx.strokeStyle = '#e4ebf4'; ctx.lineWidth = 1;
    ctx.fillStyle = '#93a0b1';
    ctx.font = '10px "JetBrains Mono", Consolas, monospace';
    const step = axisStep(span);
    for (let sec = 0; sec <= span + 1e-6; sec += step) {
      const x = Math.round(xOf(sec)) + 0.5;
      ctx.beginPath(); ctx.moveTo(x, LANE); ctx.lineTo(x, H); ctx.stroke();
      if (sec + step <= span + 1e-6 && xOf(sec) < W - 32) ctx.fillText(axisLabel(sec), x + 3, H - 3);
    }
    // 按键轨道分隔线
    ctx.strokeStyle = '#dfe7f2';
    ctx.beginPath(); ctx.moveTo(0, LANE + 0.5); ctx.lineTo(W, LANE + 0.5); ctx.stroke();

    const cy = LANE + (H - LANE) / 2;
    const maxH = (H - LANE) * 0.44;

    // 静音区间：中线上的细灰条，替代整块灰底
    if (waveform?.length) {
      let runStart = null;
      for (let i = 0; i <= waveform.length; i++) {
        const quiet = i < waveform.length && waveform[i] < 0.006;
        if (quiet && runStart === null) runStart = i;
        if ((!quiet || i === waveform.length) && runStart !== null) {
          const s0 = runStart * 0.02, s1 = i * 0.02;
          if (s1 - s0 > 0.3) {
            ctx.fillStyle = 'rgba(148,163,184,.45)';
            ctx.fillRect(xOf(s0), cy - 1, Math.max(1, xOf(s1) - xOf(s0)), 2);
          }
          runStart = null;
        }
      }
    }

    // 丢包 / 断流标记（忽略时间戳重置造成的伪 gap）
    for (const m of marks) {
      if ((m.ms || 0) > 10000) continue;
      const sec = firstUs != null ? Math.max(0, (m.us - firstUs) / 1e6) : 0;
      const gapMs = Math.min(Math.max(0, m.ms || 0), span * 1000);
      const x0 = xOf(sec);
      const x1 = xOf(sec + Math.max(0.02, gapMs / 1000));
      ctx.fillStyle = 'rgba(214,120,40,.12)';
      ctx.fillRect(x0, LANE, Math.max(2, x1 - x0), H - LANE);
      ctx.strokeStyle = m.type === 'gap' ? 'rgba(190,90,30,.45)' : 'rgba(214,160,60,.5)';
      ctx.beginPath(); ctx.moveTo(x0 + 0.5, LANE); ctx.lineTo(x0 + 0.5, H); ctx.stroke();
    }

    // 振幅：镜像平滑包络（填充 + 上沿描边），比逐像素柱状更整洁
    if (waveform?.length) {
      const cols = Math.max(1, Math.floor(xOf(dur || span)));
      const amps = new Float32Array(cols);
      for (let i = 0; i < waveform.length; i++) {
        const px = Math.min(cols - 1, Math.floor((i / waveform.length) * cols));
        if (waveform[i] > amps[px]) amps[px] = waveform[i];
      }
      const hOf = x => Math.max(0.6, amps[x] * maxH);
      ctx.beginPath();
      ctx.moveTo(0, cy);
      for (let x = 0; x < cols; x++) ctx.lineTo(x, cy - hOf(x));
      for (let x = cols - 1; x >= 0; x--) ctx.lineTo(x, cy + hOf(x));
      ctx.closePath();
      ctx.fillStyle = color; ctx.globalAlpha = 0.32; ctx.fill();
      ctx.globalAlpha = 1;
      ctx.beginPath();
      for (let x = 0; x < cols; x++) {
        const y = cy - hOf(x);
        if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = color; ctx.globalAlpha = 0.85; ctx.lineWidth = 1; ctx.stroke();
      ctx.globalAlpha = 1;
    }

    // 中线
    ctx.strokeStyle = '#dbe4ef'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(0, cy + 0.5); ctx.lineTo(W, cy + 0.5); ctx.stroke();

    // DTMF 按键：独立轨道 + 真实时间虚线 + 防重叠横向排布
    let lastRight = -1;
    dtmf.forEach((d) => {
      if (firstUs == null || d.startUs == null) return;
      const sec = (d.startUs - firstUs) / 1e6;
      if (sec < 0 || sec > span) return;
      const tx = xOf(sec);
      let cx = Math.max(12, tx);
      if (cx < lastRight + 24) cx = lastRight + 24;
      if (cx > W - 12) cx = W - 12;
      lastRight = cx + 11;
      ctx.save();
      ctx.strokeStyle = 'rgba(190,140,40,.5)';
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]);
      ctx.beginPath(); ctx.moveTo(tx + 0.5, LANE - 8); ctx.lineTo(tx + 0.5, H); ctx.stroke();
      if (Math.abs(cx - tx) > 1) {
        ctx.setLineDash([]);
        ctx.beginPath(); ctx.moveTo(tx + 0.5, LANE - 8); ctx.lineTo(cx, 17); ctx.stroke();
      }
      ctx.restore();
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(cx - 10, 3, 20, 15, 7); else ctx.rect(cx - 10, 3, 20, 15);
      ctx.fillStyle = '#fffaf0'; ctx.fill();
      ctx.strokeStyle = '#e2c48b'; ctx.lineWidth = 1; ctx.stroke();
      ctx.fillStyle = '#7a4e0a';
      ctx.font = 'bold 10.5px "JetBrains Mono", Consolas, monospace';
      ctx.textAlign = 'center';
      ctx.fillText(String(d.digit), cx, 14);
      ctx.textAlign = 'start';
    });

    // 播放头
    const px = xOf(cur);
    ctx.strokeStyle = '#dc2626'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(px, LANE); ctx.lineTo(px, H); ctx.stroke();
    ctx.fillStyle = '#dc2626';
    ctx.beginPath(); ctx.arc(px, LANE + 3, 3, 0, Math.PI * 2); ctx.fill();
  }, [waveform, marks, dtmf, firstUs, dur, totalSec, cur, color]);

  const toSec = e => {
    const r = ref.current.getBoundingClientRect();
    return Math.max(0, Math.min(totalSec, ((e.clientX - r.left) / r.width) * totalSec));
  };

  return (
    <div className="awave">
      <canvas ref={ref} style={{ width: '100%', height: 104, display: 'block' }}
        onClick={e => onSeek?.(toSec(e))}
        onMouseMove={e => setHover(toSec(e))}
        onMouseLeave={() => setHover(null)} />
      {hover != null && (
        <>
          <div className="awave-hover" style={{ left: `${(hover / Math.max(totalSec, 0.001)) * 100}%` }} />
          <div className="awave-tip" style={{ left: `calc(${(hover / Math.max(totalSec, 0.001)) * 100}% + 6px)` }}>{fmtClock(hover)}</div>
        </>
      )}
    </div>
  );
}

function axisStep(span) {
  const raw = span / 8;
  return [0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600].find(s => s >= raw) || 900;
}
function axisLabel(sec) {
  if (sec < 60) {
    const v = Math.round(sec * 10) / 10;
    return `${v}s`;
  }
  const m = Math.floor(sec / 60), s = Math.round(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
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
  const { state, showToast } = useStore();
  const file = state.files.find(f => f.fileId === sel.fileId);
  const textOnly = file?.format === 'text';
  const [maskUser, setMaskUser] = useState(false);
  const [maskIp, setMaskIp] = useState(false);
  const [items, setItems] = useState({ pcapng: true, wav: true, report: true });
  const [results, setResults] = useState(null);
  const [busy, setBusy] = useState(false);

  // 文本信令日志没有原始报文与媒体，只允许导出报告
  const active = textOnly ? { pcapng: false, wav: false, report: items.report } : items;

  const run = async () => {
    setBusy(true); setResults(null);
    try {
      const outDir = await api.pickDir();
      if (!outDir) return;
      const safe = sel.callId.slice(0, 20).replace(/[^a-zA-Z0-9_-]/g, '_');
      const list = [];
      if (active.pcapng) list.push({ type: 'pcapng', outPath: `${outDir}/call_${safe}.pcapng` });
      if (active.wav) list.push({ type: 'wav', outPath: outDir });
      if (active.report) list.push({ type: 'report', outPath: `${outDir}/report_${safe}.html` });
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
          {textOnly && (
            <div style={{ fontSize: 12, color: 'var(--fg3)', marginBottom: 8, lineHeight: 1.7 }}>
              当前为文本信令日志：不含原始报文与 RTP 媒体，仅支持导出 HTML 分析报告。
            </div>
          )}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <label className="ck" style={textOnly ? { opacity: .5 } : undefined}>
              <input type="checkbox" checked={active.pcapng} disabled={textOnly} onChange={e => setItems(i => ({ ...i, pcapng: e.target.checked }))} />原始关联报文（PCAPNG，本通话 SIP + RTP）
            </label>
            <label className="ck" style={textOnly ? { opacity: .5 } : undefined}>
              <input type="checkbox" checked={active.wav} disabled={textOnly} onChange={e => setItems(i => ({ ...i, wav: e.target.checked }))} />分方向 WAV（主叫 / 被叫 / 混合）
            </label>
            <label className="ck"><input type="checkbox" checked={active.report} onChange={e => setItems(i => ({ ...i, report: e.target.checked }))} />HTML 分析报告（自包含单文件）</label>
          </div>
          <div className="card-title" style={{ marginTop: 14 }}>隐私遮蔽</div>
          <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap' }}>
            <label className="ck"><input type="checkbox" checked={maskUser} onChange={e => setMaskUser(e.target.checked)} />遮蔽号码（保留后 4 位）</label>
            <label className="ck"><input type="checkbox" checked={maskIp} onChange={e => setMaskIp(e.target.checked)} />遮蔽 IP（保留前 2 段）</label>
          </div>
          <div style={{ marginTop: 14 }}>
            <button className="btn primary" disabled={busy || (!active.pcapng && !active.wav && !active.report)} onClick={run}>
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
