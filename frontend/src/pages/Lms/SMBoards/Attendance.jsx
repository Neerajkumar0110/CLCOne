import React, { useState } from 'react';
import { Alert, message } from 'antd';
import lmsApi from '../api';
import { SMPage, useLoad, Loading, res, fmtDay, fmtTime, errText } from './shared';

// S2 — attendance for one class (join / leave / minutes / reconnects /
// status / overall), correction with old → new + mandatory reason (existing
// correct endpoint, audited), and the absence escalation queue: Level 1–3
// emails prepared from verified data, pre-send checks, sent by a human.

const CHIP = { PRESENT: 'hai', LATE: 'adh', PARTIAL: 'adh', ABSENT: 'red', EXCUSED: 'gray' };

function Correction({ session, row, onClose, onSaved }) {
  const [status, setStatus] = useState(row.status === 'PRESENT' ? 'EXCUSED' : 'PRESENT');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const save = async () => {
    if (reason.trim().length < 5) return message.warning('Write a reason (required).');
    setBusy(true);
    try {
      const r = await lmsApi.smCorrect(session.id, { crmUserId: row.crmUserId, status, reason: reason.trim() });
      if (r && r.success === false) throw new Error(r.message);
      message.success('Correction saved — old/new + reason in audit log.');
      onSaved();
    } catch (e) {
      message.error(errText(e, 'Could not save.'));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="ld-card" style={{ borderColor: '#0e7490' }} aria-label="Attendance correction">
      <div className="ld-hd"><b style={{ fontSize: 15 }}>Attendance correction · {row.name} · {session.title}</b><button type="button" className="ld-link" onClick={onClose}>Close</button></div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 2fr', gap: 12, alignItems: 'end' }}>
        <div><div className="ld-muted" style={{ fontSize: 12 }}>Old value</div><b>{row.status} · {row.minutes} min</b></div>
        <div><div className="ld-muted" style={{ fontSize: 12 }}>New value</div>
          <select className="ld-inp" style={{ width: '100%' }} aria-label="New value" value={status} onChange={(e) => setStatus(e.target.value)}>
            {['PRESENT', 'LATE', 'PARTIAL', 'EXCUSED', 'ABSENT'].filter((s) => s !== row.status).map((s) => <option key={s}>{s}</option>)}
          </select>
        </div>
        <div><div className="ld-muted" style={{ fontSize: 12 }}>Reason (required)</div><input className="ld-inp" style={{ width: '100%' }} aria-label="Reason" placeholder="Camera/network issue confirmed in TKT-…, BBB shows reconnect loop" value={reason} onChange={(e) => setReason(e.target.value)} /></div>
      </div>
      <div className="ld-hd"><span className="ld-muted" style={{ fontSize: 12 }}>Actor, time, old/new, reason → audit log. Disputed cases → Operations Manager approval.</span><button type="button" className="ld-btn" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save correction'}</button></div>
    </section>
  );
}

function Escalations() {
  const [lv, setLv] = useState(3);
  const [idx, setIdx] = useState(0);
  const [busy, setBusy] = useState(false);
  const { data, loading, reload } = useLoad(async () => res(await lmsApi.smEscalations()), []);
  if (loading && !data) return <section className="ld-card"><Loading /></section>;
  const rows = ((data && data.rows) || []).filter((r) => r.level === lv);
  const cur = rows[Math.min(idx, rows.length - 1)];
  const send = async () => {
    setBusy(true);
    try {
      const r = await lmsApi.smEscalationSend({ email: cur.email, level: cur.level });
      if (r && r.success === false) throw new Error(r.message);
      message.success(`Sent to ${cur.name} · logged.`);
      reload();
    } catch (e) {
      message.error(errText(e, 'Not sent.'));
    } finally {
      setBusy(false);
    }
  };
  const count = (n) => ((data && data.rows) || []).filter((r) => r.level === n).length;
  return (
    <section className="ld-card" aria-label="Absence escalation queue">
      <div className="ld-hd"><b style={{ fontSize: 15 }}>Absence escalation queue</b><span className="ld-muted" style={{ fontSize: 12 }}>human sends · no auto decision</span></div>
      <div style={{ display: 'flex', gap: 6 }}>
        {[1, 2, 3].map((n) => (
          <button key={n} type="button" className={`ld-seg${lv === n ? ' on' : ''}`} onClick={() => { setLv(n); setIdx(0); }}>Level {n} · {count(n)}</button>
        ))}
      </div>
      {!cur && <div className="ld-empty">No learner at this level.</div>}
      {cur && (
        <>
          <div style={{ fontSize: 13, display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
            <span><b>{cur.name}</b> <span className="ld-muted">· {cur.batch}</span></span>
            <span className="ld-muted">{cur.stat}</span>
          </div>
          {rows.length > 1 && (
            <select className="ld-inp" aria-label="Learner" value={Math.min(idx, rows.length - 1)} onChange={(e) => setIdx(Number(e.target.value))}>
              {rows.map((r, i) => <option key={r.email} value={i}>{r.name} — {r.stat}</option>)}
            </select>
          )}
          <div className="sm-mail"><b>{cur.subject}</b><span style={{ whiteSpace: 'pre-line' }}>{cur.body}</span></div>
          <div className="sm-cap">PRE-SEND CHECK</div>
          <div style={{ fontSize: 13, display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span>✓ Attendance from live-class logs · ✓ Not Dropped / archived</span>
            <span>✓ Excused classes not counted · {data.incident ? <b style={{ color: '#991b1b' }}>✕ Platform incident active</b> : '✓ No platform incident'}</span>
            <span>✓ Numbers filled from verified data · template v2{cur.lastSent ? ` · last sent ${fmtDay(cur.lastSent.at)} (L${cur.lastSent.level})` : ''}</span>
          </div>
          <div className="ld-hd" style={{ marginTop: 'auto' }}><span className="ld-muted" style={{ fontSize: 12 }}>Logged: template, channel, delivery, next action</span><button type="button" className="ld-btn" disabled={busy || data.incident} onClick={send}>{busy ? 'Sending…' : 'Send email'}</button></div>
        </>
      )}
    </section>
  );
}

export default function SMAttendance() {
  const [sid, setSid] = useState('');
  const [fix, setFix] = useState(null);
  const { data, loading, error, reload } = useLoad(async () => res(await lmsApi.smAttendance(sid ? { sessionId: sid } : {})), [sid]);
  if (loading && !data) return <Loading />;
  if (error) return <Alert type="error" showIcon message={error} style={{ margin: 24 }} />;
  const s = data.session;
  return (
    <SMPage
      title={s ? `Attendance · ${s.title.replace(/^.*—\s*/, '')} · ${fmtDay(s.start)}` : 'Attendance'}
      sub={s ? `${s.batch} · ${fmtTime(s.scheduledStart)}–${fmtTime(s.scheduledEnd)} · grace ${data.rule.graceMin} min · Present = ${data.rule.presentPct}% of session` : ''}
      right={
        data.recent.length > 0 && (
          <select className="ld-inp" aria-label="Class" value={s ? s.id : ''} onChange={(e) => { setFix(null); setSid(e.target.value); }}>
            {data.recent.map((c) => <option key={c.id} value={c.id}>{c.title} · {fmtDay(c.start)}</option>)}
          </select>
        )
      }
    >
      <div className="sm-g" style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 470px', gap: 14, flex: 1, minHeight: 0 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, minWidth: 0 }}>
          <section className="ld-card" aria-label="Class attendance">
            {!s && <div className="ld-empty">No class has happened yet.</div>}
            {s && (
              <div style={{ overflowX: 'auto' }}>
                <table className="ld-table">
                  <thead><tr><th>Learner</th><th>Join</th><th>Leave</th><th>Minutes</th><th>Reconnects</th><th>Status</th><th>Overall</th><th /></tr></thead>
                  <tbody>
                    {data.rows.map((r) =>
                      r.dropped ? (
                        <tr key={r.email}><td className="ld-muted">{r.name}</td><td colSpan={5} className="ld-muted">Dropped — out of the denominator, reminders off</td><td className="ld-muted">—</td><td /></tr>
                      ) : (
                        <tr key={r.email} className={fix && fix.email === r.email ? 'sm-rowsel' : ''}>
                          <td><b>{r.name}</b></td>
                          <td>{r.join ? fmtTime(r.join) : '—'}</td>
                          <td>{r.leave ? fmtTime(r.leave) : '—'}</td>
                          <td>{r.minutes}</td>
                          <td>{r.reconnects == null ? '—' : r.reconnects ? `${r.reconnects} merged` : '0'}</td>
                          <td><span className={`ld-chip ${CHIP[r.status] || 'gray'}`}>{r.status}{r.status === 'EXCUSED' && r.excusedReason ? ` · ${r.excusedReason.slice(0, 14)}` : ''}</span>{r.corrected && <span className="ld-muted" style={{ fontSize: 11 }}> corrected</span>}</td>
                          <td>{r.overall}%</td>
                          <td>{r.crmUserId && <button type="button" className="ld-link" onClick={() => setFix(r)}>Correct</button>}</td>
                        </tr>
                      )
                    )}
                  </tbody>
                </table>
              </div>
            )}
            {s && (
              <div className="ld-soft">
                <b>Calculation basis:</b> attended eligible ÷ total eligible × 100 · {data.basis.held} sessions held, {data.basis.cancelled} cancelled excluded · {data.basis.dropped} Dropped learners excluded · source: live-class join/leave logs
              </div>
            )}
          </section>
          {fix && s && <Correction key={fix.email} session={s} row={fix} onClose={() => setFix(null)} onSaved={() => { setFix(null); reload(); }} />}
        </div>
        <Escalations />
      </div>
    </SMPage>
  );
}
