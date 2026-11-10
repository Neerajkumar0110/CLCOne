import React, { useState } from 'react';
import { Alert, message } from 'antd';
import { useNavigate } from 'react-router-dom';
import lmsApi from '../api';
import { SMPage, useLoad, Loading, res, fmtDay, errText, downloadCsv } from './shared';

// S7 — recording recovery for one batch + date range: every scheduled
// session with the sources checked (BBB / link / Drive backup), an evidence
// status, rename with audit (old title kept) and an inventory export. Drive
// import itself is the existing import on the Recordings page.

const STATE = {
  AVAILABLE: ['hai', 'Available'],
  RECOVERED: ['naya', 'Recovered'],
  PROCESSING: ['adh', 'Processing'],
  FAILED: ['red', 'Failed'],
  SOURCE_UNAVAILABLE: ['gray', 'Source unavailable'],
  RECORDING_OFF: ['gray', 'Recording was off'],
  NOT_RECORDED: ['gray', 'Not recorded'],
  SCHEDULED: ['gray', 'Scheduled'],
};
const ymd = (d) => new Date(d).toISOString().slice(0, 10);

export default function SMRecordingOps() {
  const navigate = useNavigate();
  const [batch, setBatch] = useState('');
  const [range, setRange] = useState(() => ({ from: ymd(Date.now() - 30 * 86400000), to: ymd(Date.now()) }));
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(null);
  const [title, setTitle] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const { data, loading, error, reload } = useLoad(async () => res(await lmsApi.smRecordings({ batch: batch || undefined, from: range.from, to: `${range.to}T23:59:59` })), [batch, range.from, range.to]);
  if (loading && !data) return <Loading />;
  if (error) return <Alert type="error" showIcon message={error} style={{ margin: 24 }} />;
  const rows = data.rows.filter((r) => !q || `${r.code} ${r.title}`.toLowerCase().includes(q.toLowerCase()));
  const s = data.stats;
  const pick = (r) => {
    setSel(r);
    setTitle(r.title);
    setReason('');
  };
  const rename = async () => {
    if (!sel) return;
    setBusy(true);
    try {
      const r = await lmsApi.smRecordingRename(sel.sessionId, { title: title.trim(), reason: reason.trim() });
      if (r && r.success === false) throw new Error(r.message);
      message.success('Renamed — old title kept in history.');
      setSel(null);
      reload();
    } catch (e) {
      message.error(errText(e, 'Could not rename.'));
    } finally {
      setBusy(false);
    }
  };
  const exportInv = () =>
    downloadCsv(`recordings-${data.batch}-${range.from}-to-${range.to}.csv`, data.rows.map((r) => ({
      Session: r.code,
      Date: ymd(r.date),
      Topic: r.title,
      Sources: r.sources.map((x) => `${x.src} ${x.ok ? 'ok' : 'missing'}`).join('; ') || 'none',
      Status: (STATE[r.state] || [0, r.state])[1],
      Reason: r.failReason,
      Views: r.views,
      Renamed: r.renamed.map((x) => `${x.from} → ${x.to} (${x.reason})`).join('; '),
    })));

  return (
    <SMPage
      title={`Recording recovery · ${data.batch} · ${fmtDay(data.from)} – ${fmtDay(data.to)}`}
      sub={"Every scheduled session's status with evidence · nothing is marked \"recovered\" without evidence"}
    >
      <div className="sm-g6" style={{ display: 'grid', gridTemplateColumns: 'repeat(6, minmax(0, 1fr))', gap: 10 }}>
        <div className="sm-st"><b>{s.scheduled}</b><span>Scheduled sessions</span></div>
        <div className="sm-st"><b style={{ color: '#166534' }}>{s.available}</b><span>Available (verified)</span></div>
        <div className="sm-st"><b style={{ color: '#1e40af' }}>{s.recovered}</b><span>Recovered (Drive / link)</span></div>
        <div className="sm-st"><b style={{ color: '#9a3412' }}>{s.processing}</b><span>Processing</span></div>
        <div className="sm-st"><b style={{ color: '#991b1b' }}>{s.failed}</b><span>Failed → retry</span></div>
        <div className="sm-st"><b>{s.unavailable}</b><span>Source unavailable</span></div>
      </div>
      <div className="sm-g" style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 340px', gap: 14, flex: 1, minHeight: 0 }}>
        <section className="ld-card" aria-label="Inventory">
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <input className="ld-inp" style={{ width: 200 }} placeholder="Search session / topic" aria-label="Search" value={q} onChange={(e) => setQ(e.target.value)} />
            <select className="ld-inp" aria-label="Batch" value={data.batch} onChange={(e) => { setSel(null); setBatch(e.target.value); }}>{data.batches.map((b) => <option key={b}>{b}</option>)}</select>
            <input className="ld-inp" type="date" aria-label="From" value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} />
            <input className="ld-inp" type="date" aria-label="To" value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} />
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table className="ld-table" style={{ fontSize: 12 }}>
              <thead><tr><th>Session</th><th>Date</th><th>Topic (LMS)</th><th>Sources checked</th><th>Status</th><th>Views</th><th>Action</th></tr></thead>
              <tbody>
                {rows.length === 0 && <tr><td colSpan={7} className="ld-muted">No session in this range.</td></tr>}
                {rows.map((r) => {
                  const [cls, label] = STATE[r.state] || ['gray', r.state];
                  return (
                    <tr key={r.sessionId} className={sel && sel.sessionId === r.sessionId ? 'sm-rowsel' : ''}>
                      <td>{r.code}</td>
                      <td>{fmtDay(r.date)}</td>
                      <td>{r.title}{r.renamed.length > 0 && <span className="ld-muted"> (was: {r.renamed[r.renamed.length - 1].from})</span>}</td>
                      <td>{r.sources.length ? r.sources.map((x) => `${x.src} ${x.ok ? '✓' : '✗'}`).join(' · ') : <span className="ld-muted">none</span>}</td>
                      <td><span className={`ld-chip ${cls}`}>{label}{r.failReason ? ` · ${r.failReason.slice(0, 12)}` : ''}</span></td>
                      <td>{r.views || '—'}</td>
                      <td style={{ whiteSpace: 'nowrap' }}>
                        <button type="button" className="ld-btn2 xs" onClick={() => pick(r)}>Rename</button>
                        {['FAILED', 'SOURCE_UNAVAILABLE'].includes(r.state) && <button type="button" className="ld-btn2 xs" style={{ marginLeft: 4 }} onClick={() => navigate('/lms/recordings')}>Retry / import</button>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="ld-muted" style={{ fontSize: 12, marginTop: 'auto' }}>A "Deleted" label is not taken as proof — the recording record + sources are checked</div>
        </section>
        <section className="ld-card" aria-label="Rename and import">
          <div className="ld-hd"><b style={{ fontSize: 15 }}>Rename with audit</b></div>
          {!sel && <div className="ld-empty">Click "Rename" on a session in the table.</div>}
          {sel && (
            <>
              <div style={{ fontSize: 13 }}><span className="ld-muted">{sel.code} · {fmtDay(sel.date)} · {data.batch}</span></div>
              <label className="ld-label">New title<input className="ld-inp" value={title} onChange={(e) => setTitle(e.target.value)} /></label>
              <label className="ld-label">Reason<input className="ld-inp" placeholder="Delivered topic differed from plan (PM confirmed)" value={reason} onChange={(e) => setReason(e.target.value)} /></label>
              <button type="button" className="ld-btn" disabled={busy || title.trim().length < 3 || reason.trim().length < 5 || title.trim() === sel.title} onClick={rename}>Save · old title kept in history</button>
            </>
          )}
          <div className="ld-hd" style={{ marginTop: 8 }}><b style={{ fontSize: 15 }}>Import from Drive</b></div>
          <button type="button" className="pm-drop" style={{ minHeight: 64, border: '2px dashed #cbd5e1', background: '#fff' }} onClick={() => navigate('/lms/recordings')}>
            <span className="ld-muted">Choose Drive folder · auto-map by date (Recordings page)</span>
          </button>
          <div className="sm-cap">Before marking Ready</div>
          <div style={{ fontSize: 13, display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span>✓ duplicate check on import</span>
            <span>✓ correct batch / session / date mapping</span>
            <span>✓ playback test from a learner account</span>
            <span>○ captions / transcript — not available yet</span>
          </div>
          <button type="button" className="ld-btn" style={{ marginTop: 'auto' }} onClick={exportInv}>Export inventory (evidence)</button>
        </section>
      </div>
    </SMPage>
  );
}
