import React, { useState } from 'react';
import { Alert, message, Modal } from 'antd';
import lmsApi from '../api';
import SlaTimer from '@/components/SlaTimer';
import { SMPage, useLoad, Loading, res, fmtDayTime, errText } from './shared';

// Staff escalations (LMS testing report #01): Support raises a ticket against
// the office staff member responsible for an incomplete / overdue task.
// Management sees every one; the task owner is not changed. Each row keeps
// raised / resolved timestamps, the time taken and the 48 h timer.

const hrs = (h) => (h == null ? '—' : h < 1 ? `${Math.round(h * 60)} min` : h < 48 ? `${h} h` : `${Math.round((h / 24) * 10) / 10} days`);

function RaiseForm({ staff, onDone }) {
  const [f, setF] = useState({ againstId: '', task: '', details: '', taskDueAt: '', priority: 'High' });
  const [busy, setBusy] = useState(false);
  const go = async () => {
    if (!f.againstId) return message.warning('Pick the responsible staff member.');
    if (f.task.trim().length < 3) return message.warning('Describe the pending task.');
    setBusy(true);
    try {
      const r = await lmsApi.smEscalationCreate({ ...f, taskDueAt: f.taskDueAt ? new Date(f.taskDueAt).toISOString() : undefined });
      if (r && r.success === false) throw new Error(r.message);
      message.success(r.message || 'Escalation raised.');
      setF({ againstId: '', task: '', details: '', taskDueAt: '', priority: 'High' });
      onDone();
    } catch (e) {
      message.error(errText(e, 'Could not raise it.'));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="ld-card" aria-label="Raise an escalation">
      <div className="ld-hd"><b style={{ fontSize: 14 }}>Raise an escalation</b><span className="ld-muted" style={{ fontSize: 12 }}>visible to management</span></div>
      <label className="ld-label">Responsible staff member
        <select className="ld-inp" value={f.againstId} onChange={(e) => setF({ ...f, againstId: e.target.value })}>
          <option value="">— Pick a staff member</option>
          {staff.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.role})</option>)}
        </select>
      </label>
      <label className="ld-label">Pending task<input className="ld-inp" value={f.task} maxLength={300} onChange={(e) => setF({ ...f, task: e.target.value })} placeholder="e.g. Upload Week 6 recordings for OCT262330PM" /></label>
      <label className="ld-label">Details / evidence<textarea className="ld-inp" style={{ height: 64, padding: 8, resize: 'vertical' }} value={f.details} onChange={(e) => setF({ ...f, details: e.target.value })} placeholder="What is missing, since when, what was tried" /></label>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <label className="ld-label">Task was due<input className="ld-inp" type="datetime-local" value={f.taskDueAt} onChange={(e) => setF({ ...f, taskDueAt: e.target.value })} /></label>
        <label className="ld-label">Priority<select className="ld-inp" value={f.priority} onChange={(e) => setF({ ...f, priority: e.target.value })}>{['Urgent', 'High', 'Medium', 'Low'].map((p) => <option key={p}>{p}</option>)}</select></label>
      </div>
      <button type="button" className="ld-btn" disabled={busy} onClick={go}>{busy ? 'Raising…' : 'Raise escalation'}</button>
    </section>
  );
}

export default function SMEscalations() {
  const [status, setStatus] = useState('open');
  const [open, setOpen] = useState(null);
  const { data, loading, error, reload } = useLoad(async () => res(await lmsApi.smEscalations(status)), [status]);
  if (loading && !data) return <Loading />;
  if (error) return <Alert type="error" showIcon message={error} style={{ margin: 24 }} />;
  const act = async (r, body, ok) => {
    try {
      const out = await lmsApi.smEscalationUpdate(r.id, body);
      if (out && out.success === false) throw new Error(out.message);
      message.success(ok);
      setOpen(null);
      reload();
    } catch (e) {
      message.error(errText(e, 'Could not update.'));
    }
  };
  const resolve = (r) => {
    let note = '';
    Modal.confirm({
      title: `Resolve ${r.code}?`,
      content: <textarea className="ld-inp" style={{ width: '100%', height: 70, padding: 8 }} placeholder="What was done (kept in the history)" onChange={(e) => { note = e.target.value; }} />,
      okText: 'Resolve',
      onOk: () => act(r, { resolve: true, note }, 'Resolved.'),
    });
  };
  const k = data.kpis;
  return (
    <SMPage title="Staff escalations" sub="Internal accountability — tasks that are incomplete, overdue or breached">
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12 }}>
        {[['Open', k.open], ['Task overdue', k.overdue], ['48 h breached', k.breached], ['Resolved', k.resolved]].map(([l, v]) => (
          <div key={l} className="ld-card" style={{ padding: 14 }}><span className="ld-muted" style={{ fontSize: 12 }}>{l}</span><b style={{ fontSize: 22 }}>{v}</b></div>
        ))}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 340px', gap: 14, alignItems: 'start' }} className="sm-g">
        <section className="ld-card" aria-label="Escalations">
          <div className="ld-hd">
            <b style={{ fontSize: 14 }}>Escalations</b>
            <span style={{ display: 'flex', gap: 6 }}>
              {['open', 'resolved', 'all'].map((s) => (
                <button key={s} type="button" className={status === s ? 'ld-btn' : 'ld-btn2'} style={{ height: 30, padding: '0 12px', textTransform: 'capitalize' }} onClick={() => setStatus(s)}>{s}</button>
              ))}
            </span>
          </div>
          {data.rows.length === 0 && <div className="ld-empty">No escalations here.</div>}
          <div style={{ overflowX: 'auto' }}>
            <table className="ld-table" style={{ width: '100%', fontSize: 13 }}>
              <thead><tr><th>Ticket</th><th>Against</th><th>Task</th><th>Task due</th><th>Raised</th><th>Timer</th><th>Resolved</th><th>Time taken</th><th /></tr></thead>
              <tbody>
                {data.rows.map((r) => (
                  <React.Fragment key={r.id}>
                    <tr>
                      <td><button type="button" className="ld-link" onClick={() => setOpen(open === r.id ? null : r.id)}>{r.code}</button></td>
                      <td><b>{r.against}</b></td>
                      <td style={{ maxWidth: 240 }}>{r.task}</td>
                      <td>{r.taskDueAt ? <span style={{ color: r.taskOverdue ? '#b91c1c' : undefined }}>{fmtDayTime(r.taskDueAt)}{r.taskOverdue ? ' · overdue' : ''}</span> : '—'}</td>
                      <td>{fmtDayTime(r.raisedAt)}<div className="ld-muted" style={{ fontSize: 11 }}>by {r.raisedBy}</div></td>
                      <td><SlaTimer created={r.raisedAt} slaDueAt={r.slaDueAt} status={r.status} /></td>
                      <td>{r.resolvedAt ? <>{fmtDayTime(r.resolvedAt)}<div className="ld-muted" style={{ fontSize: 11 }}>by {r.resolvedBy}</div></> : '—'}</td>
                      <td>{hrs(r.elapsedHours)}</td>
                      <td>
                        {r.status === 'Resolved' ? (
                          <button type="button" className="ld-btn2" style={{ height: 28 }} onClick={() => act(r, { reopen: true }, 'Reopened.')}>Reopen</button>
                        ) : (
                          <button type="button" className="ld-btn" style={{ height: 28 }} onClick={() => resolve(r)}>Resolve</button>
                        )}
                      </td>
                    </tr>
                    {open === r.id && (
                      <tr>
                        <td colSpan={9} style={{ background: '#f8fafc' }}>
                          {r.details && <div style={{ whiteSpace: 'pre-wrap', marginBottom: 6 }}>{r.details}</div>}
                          <ol style={{ margin: 0, paddingLeft: 18 }}>
                            {r.history.map((h, i) => <li key={i}><b>{h.action}</b> · {fmtDayTime(h.at)} · {h.by}{h.note ? ` — ${h.note}` : ''}</li>)}
                          </ol>
                          {r.resolution && <div style={{ marginTop: 6 }}><span className="ld-muted">Resolution: </span>{r.resolution}</div>}
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </section>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <RaiseForm staff={data.staff} onDone={reload} />
          {data.byStaff.length > 0 && (
            <section className="ld-card" aria-label="Open by staff member">
              <div className="ld-hd"><b style={{ fontSize: 14 }}>Open by staff member</b></div>
              {data.byStaff.map((s) => (
                <div key={s.name} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, padding: '4px 0', borderTop: '1px solid #eef2f7' }}>
                  <span>{s.name}</span>
                  <span>{s.open} open{s.overdue ? ` · ${s.overdue} overdue` : ''}{s.breached ? ` · ${s.breached} over 48 h` : ''}</span>
                </div>
              ))}
            </section>
          )}
        </div>
      </div>
    </SMPage>
  );
}
