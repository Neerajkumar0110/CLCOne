import React, { useEffect, useState } from 'react';
import { Alert, message } from 'antd';
import lmsApi from '../api';
import { SMPage, useLoad, Loading, res, fmtDayTime, shortName, errText } from './shared';

// S3 — ticket queue with SLA: filter pills (open / SLA at risk / unassigned
// / waiting / restricted), table with P-level, owner, workflow status and SLA,
// detail with the 6-step workflow, category / priority / owner / next action,
// evidence, internal note, escalate, reply and "Move to <next step>".

const STAGES = ['New', 'Triaged', 'Assigned', 'In progress', 'Resolved', 'Closed'];
const PCHIP = { P0: 'red', P1: 'red', P2: 'gray', P3: 'gray' };
const PRIORITIES = [['Urgent', 'P0 — Critical'], ['High', 'P1 — High'], ['Medium', 'P2 — Normal'], ['Low', 'P3 — Low']];
const CATEGORIES = ['Live class / join', 'Login / Technical', 'Attendance', 'Assessment', 'Recording / material', 'Project', 'Payment / Fees', 'Certificate', 'How-to', 'Other'];
const FILTERS = [
  ['open', 'All open', (t) => !['Resolved', 'Closed'].includes(t.stage)],
  ['risk', 'SLA at risk', (t) => ['risk', 'breached'].includes(t.sla.state)],
  ['unassigned', 'Unassigned', (t) => !t.owner && !['Resolved', 'Closed'].includes(t.stage)],
  ['waiting', 'Waiting', (t) => !!t.waiting],
  ['restricted', 'Restricted (grievance/privacy)', (t) => t.restricted],
  ['done', 'Resolved', (t) => ['Resolved', 'Closed'].includes(t.stage)],
];
const statusLabel = (t) => (t.waiting ? `Waiting · ${t.waiting}` : t.stage);
const toLocal = (v) => {
  if (!v) return '';
  const d = new Date(v);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};

// §13.4 problem record on one ticket: linked PRB, or link to an open one /
// open a new one from this ticket
function ProblemLink({ t, problems, onSaved }) {
  const [pick, setPick] = useState('');
  const [busy, setBusy] = useState(false);
  const open = problems.filter((p) => p.status !== 'Resolved');
  const run = async (fn, ok) => {
    setBusy(true);
    try {
      const r = await fn();
      if (r && r.success === false) throw new Error(r.message);
      message.success((r && r.message) || ok);
      onSaved();
    } catch (e) {
      message.error(errText(e, 'Failed.'));
    } finally {
      setBusy(false);
    }
  };
  if (t.problem) {
    const p = problems.find((x) => x.id === t.problem.id);
    return (
      <div style={{ fontSize: 13, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        Problem record <b>{t.problem.code}</b>{p ? ` · ${p.title} · ${p.status}` : ''}
        <button type="button" className="ld-btn2 xs" disabled={busy} onClick={() => run(() => lmsApi.smProblemUpdate(t.problem.id, { unlinkTicket: t.id }), 'Unlinked.')}>Unlink</button>
      </div>
    );
  }
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', fontSize: 13 }}>
      <span className="ld-muted">Problem record (PRB):</span>
      <select className="ld-inp" style={{ maxWidth: 220 }} aria-label="Problem record" value={pick} onChange={(e) => setPick(e.target.value)}>
        <option value="">— link to an open problem</option>
        {open.map((p) => <option key={p.id} value={p.id}>{p.code} · {p.title}</option>)}
      </select>
      <button type="button" className="ld-btn2 xs" disabled={busy || !pick} onClick={() => run(() => lmsApi.smProblemUpdate(pick, { linkTicket: t.id }), 'Linked.')}>Link</button>
      <button type="button" className="ld-btn2 xs" disabled={busy} onClick={() => run(() => lmsApi.smProblemCreate({ title: t.subject, category: t.category, ticketIds: [t.id] }), 'Problem opened.')}>New problem from this ticket</button>
    </div>
  );
}

// §13.4 problems view: records, linked tickets, "3+ tickets same category"
// suggestions, and Resolve — which answers every linked open ticket
function Problems({ data, reload }) {
  const [sel, setSel] = useState('');
  const [f, setF] = useState({});
  const [answer, setAnswer] = useState('');
  const [busy, setBusy] = useState('');
  const cur = data.rows.find((p) => p.id === sel) || data.rows.find((p) => p.status !== 'Resolved') || data.rows[0];
  useEffect(() => {
    if (cur) setF({ rootCause: cur.rootCause, workaround: cur.workaround });
    setAnswer('');
  }, [cur && cur.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const run = async (key, fn, ok) => {
    setBusy(key);
    try {
      const r = await fn();
      if (r && r.success === false) throw new Error(r.message);
      message.success((r && r.message) || ok);
      reload();
    } catch (e) {
      message.error(errText(e, 'Failed.'));
    } finally {
      setBusy('');
    }
  };
  return (
    <div className="sm-g" style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 460px', gap: 14, flex: 1, minHeight: 0 }}>
      <section className="ld-card" aria-label="Problem records">
        {data.suggestions.length > 0 && (
          <div className="ld-warn" style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <b>Suggested problems (3+ open tickets, same category, 72h)</b>
            {data.suggestions.map((s) => (
              <span key={s.category} style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                {s.category} · {s.count} tickets ({s.subjects.join(' / ').slice(0, 80)})
                <button type="button" className="ld-btn2 xs" disabled={!!busy} onClick={() => run('sug', () => lmsApi.smProblemCreate({ title: `${s.category}: ${s.subjects[0] || 'repeated issue'}`.slice(0, 200), category: s.category, ticketIds: s.ticketIds }), 'Problem opened.')}>Open PRB + link {s.count}</button>
              </span>
            ))}
          </div>
        )}
        <div style={{ overflowX: 'auto' }}>
          <table className="ld-table">
            <thead><tr><th>PRB</th><th>Problem</th><th>Category</th><th>Tickets</th><th>Status</th></tr></thead>
            <tbody>
              {data.rows.length === 0 && <tr><td colSpan={5} className="ld-muted">No problem record yet · click "New problem from this ticket" on a ticket.</td></tr>}
              {data.rows.map((p) => (
                <tr key={p.id} className={`click${cur && cur.id === p.id ? ' sm-rowsel' : ''}`} onClick={() => setSel(p.id)}>
                  <td><b>{p.code}</b></td>
                  <td>{p.title}</td>
                  <td>{p.category || '—'}</td>
                  <td>{p.tickets.length} · {p.tickets.filter((x) => x.status !== 'Resolved').length} open</td>
                  <td><span className={`ld-chip ${p.status === 'Resolved' ? 'hai' : p.status === 'Known error' ? 'adh' : 'naya'}`}>{p.status}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="ld-muted" style={{ fontSize: 12, marginTop: 'auto' }}>One root cause, many tickets · resolving the PRB sends the same answer to every linked open ticket — the learner can still confirm / reopen</div>
      </section>
      {cur ? (
        <section className="ld-card" aria-label="Problem detail">
          <div className="ld-hd"><b style={{ fontSize: 15 }}>{cur.code} · {cur.title}</b><span className="ld-chip gray">{cur.status}</span></div>
          <label className="ld-label">Root cause<textarea className="ld-inp" style={{ height: 56, padding: 8, resize: 'none' }} disabled={cur.status === 'Resolved'} value={f.rootCause || ''} onChange={(e) => setF({ ...f, rootCause: e.target.value })} /></label>
          <label className="ld-label">Workaround (goes into the linked tickets' internal note)<textarea className="ld-inp" style={{ height: 56, padding: 8, resize: 'none' }} disabled={cur.status === 'Resolved'} value={f.workaround || ''} onChange={(e) => setF({ ...f, workaround: e.target.value })} /></label>
          {cur.status !== 'Resolved' && (
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" className="ld-btn2" disabled={!!busy} onClick={() => run('save', () => lmsApi.smProblemUpdate(cur.id, f), 'Saved.')}>Save</button>
              <button type="button" className="ld-btn2" disabled={!!busy || cur.status === 'Known error'} onClick={() => run('ke', () => lmsApi.smProblemUpdate(cur.id, { ...f, status: 'Known error' }), 'Marked known error.')}>Mark known error</button>
            </div>
          )}
          <div className="sm-cap">Linked tickets · {cur.tickets.length}</div>
          <div style={{ fontSize: 13, display: 'flex', flexDirection: 'column', gap: 3 }}>
            {cur.tickets.length === 0 && <span className="ld-muted">No ticket linked.</span>}
            {cur.tickets.map((x) => <span key={x.id}><b>{x.code}</b> · {shortName(x.learner)} · {x.subject} · <span className="ld-muted">{x.status}</span></span>)}
          </div>
          {cur.status === 'Resolved' ? (
            <div className="ld-soft"><b>Resolution:</b> {cur.resolution}<div className="ld-muted" style={{ fontSize: 12 }}>{fmtDayTime(cur.resolvedAt)}</div></div>
          ) : (
            <>
              <label className="ld-label">Answer to learners (sab linked tickets par)<textarea className="ld-inp" style={{ height: 64, padding: 8, resize: 'none' }} placeholder="Fixed: BBB server update — please rejoin with Chrome." value={answer} onChange={(e) => setAnswer(e.target.value)} /></label>
              <button type="button" className="ld-btn" style={{ marginTop: 'auto' }} disabled={!!busy || answer.trim().length < 5} onClick={() => run('res', () => lmsApi.smProblemUpdate(cur.id, { resolve: answer.trim() }), 'Resolved.')}>Resolve {cur.code} + {cur.tickets.filter((x) => x.status !== 'Resolved').length} linked tickets</button>
            </>
          )}
        </section>
      ) : <section className="ld-card"><div className="ld-empty">Pick a problem.</div></section>}
    </div>
  );
}

function Detail({ t, owners, problems, onSaved }) {
  const [f, setF] = useState({});
  const [note, setNote] = useState('');
  const [reply, setReply] = useState('');
  const [busy, setBusy] = useState('');
  useEffect(() => {
    setF({ category: t.category, priority: t.priority, ownerId: t.ownerId || '', nextActionAt: toLocal(t.nextActionAt), waiting: t.waiting || '' });
    setNote('');
    setReply(t.resolutionNote || '');
  }, [t]);
  const i = STAGES.indexOf(t.stage);
  const next = i >= STAGES.length - 1 ? null : STAGES[i + 1];
  const save = async (key, extra, ok) => {
    setBusy(key);
    try {
      const body = { ...extra };
      if (f.category !== t.category) body.category = f.category;
      if (f.priority !== t.priority) body.priority = f.priority;
      if ((f.ownerId || '') !== (t.ownerId || '')) body.ownerId = f.ownerId || null;
      if (f.nextActionAt !== toLocal(t.nextActionAt)) body.nextActionAt = f.nextActionAt ? new Date(f.nextActionAt).toISOString() : null;
      if ((f.waiting || '') !== (t.waiting || '')) body.waiting = f.waiting || null;
      if (note.trim()) body.note = note.trim();
      const r = await lmsApi.smTicketUpdate(t.id, body);
      if (r && r.success === false) throw new Error(r.message);
      message.success(ok);
      onSaved();
    } catch (e) {
      message.error(errText(e, 'Could not update.'));
    } finally {
      setBusy('');
    }
  };
  const move = () => {
    if (!next) return save('move', { stage: 'In progress' }, 'Reopened.');
    if (next === 'Assigned' && !f.ownerId) return message.warning('Pick an owner first.');
    if (next === 'Resolved' && !reply.trim()) return message.warning('Write a reply to the learner before resolving.');
    return save('move', { stage: next, ...(next === 'Resolved' ? { reply: reply.trim() } : {}) }, `Moved to ${next}.`);
  };
  return (
    <section className="ld-card" aria-label="Ticket detail">
      <div className="ld-hd"><b style={{ fontSize: 15 }}>{t.code} · {t.subject}</b><span className={`ld-chip ${PCHIP[t.p]}`}>{t.p}</span></div>
      <div className="ld-steps" style={{ gap: 4 }}>
        {STAGES.map((s, k) => <div key={s} className={`ld-stp${k < i ? ' done' : ''}${k === i ? ' on' : ''}`} style={{ minWidth: 0, height: 30, fontSize: 11 }}>{s}</div>)}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <label className="ld-label">Category<select className="ld-inp" value={f.category || ''} onChange={(e) => setF({ ...f, category: e.target.value })}>{[...new Set([t.category, ...CATEGORIES])].map((c) => <option key={c}>{c}</option>)}</select></label>
        <label className="ld-label">Priority<select className="ld-inp" value={f.priority || ''} onChange={(e) => setF({ ...f, priority: e.target.value })}>{PRIORITIES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
        <label className="ld-label">Owner<select className="ld-inp" value={f.ownerId || ''} onChange={(e) => setF({ ...f, ownerId: e.target.value })}><option value="">— Unassigned</option>{owners.map((o) => <option key={o.id} value={o.id}>{o.name} ({o.role})</option>)}</select></label>
        <label className="ld-label">Next action due<input className="ld-inp" type="datetime-local" value={f.nextActionAt || ''} onChange={(e) => setF({ ...f, nextActionAt: e.target.value })} /></label>
        <label className="ld-label">Waiting on<select className="ld-inp" value={f.waiting || ''} onChange={(e) => setF({ ...f, waiting: e.target.value })}><option value="">— Not waiting (SLA running)</option><option value="learner">Learner</option><option value="tech">Tech team</option></select></label>
        <div className="ld-label">SLA<b style={{ fontSize: 13, color: t.sla.state === 'breached' ? '#991b1b' : t.sla.state === 'risk' ? '#9a3412' : '#0f172a' }}>{t.sla.label}</b></div>
      </div>
      <div className="ld-soft">
        <b>Evidence:</b> {t.attachments.length ? t.attachments.map((a, k) => <a key={k} href={a.url} target="_blank" rel="noreferrer" style={{ marginRight: 6 }}>{a.name}</a>) : 'no attachment'}
        {t.reference ? ` · ${t.reference}` : ''}{t.batch ? ` · ${t.batch}` : ''} · raised {fmtDayTime(t.created)} by {t.learner}
        {t.description && <div style={{ marginTop: 6, whiteSpace: 'pre-wrap' }}>{t.description.slice(0, 400)}</div>}
      </div>
      {t.internalNotes.length > 0 && (
        <div style={{ fontSize: 12, display: 'flex', flexDirection: 'column', gap: 3 }}>
          {t.internalNotes.slice(-3).map((n, k) => <span key={k} className="ld-muted"><b>{n.byName}</b> · {fmtDayTime(n.at)}: {n.text}</span>)}
        </div>
      )}
      <label className="ld-label">Internal note<textarea className="ld-inp" style={{ height: 56, padding: 8, resize: 'none' }} placeholder="Staff only, not shown to the learner" value={note} onChange={(e) => setNote(e.target.value)} /></label>
      <label className="ld-label">Reply to learner<textarea className="ld-inp" style={{ height: 56, padding: 8, resize: 'none' }} placeholder="The learner sees this (with Resolve or separately)" value={reply} onChange={(e) => setReply(e.target.value)} /></label>
      {t.escalatedTo && <div style={{ fontSize: 13 }}>Escalated to <b>{t.escalatedTo}</b></div>}
      <ProblemLink t={t} problems={problems} onSaved={onSaved} />
      <div style={{ display: 'flex', gap: 8, marginTop: 'auto', flexWrap: 'wrap' }}>
        <button type="button" className="ld-btn2" disabled={!!busy} onClick={() => save('save', {}, 'Saved.')}>Save</button>
        <button type="button" className="ld-btn2" disabled={!!busy || t.escalatedTo === 'LMS tech'} onClick={() => save('esc', { escalateTo: 'LMS tech', waiting: 'tech' }, 'Escalated to LMS tech.')}>Escalate to LMS tech</button>
        <button type="button" className="ld-btn2" disabled={!!busy || !reply.trim()} onClick={() => save('reply', { reply: reply.trim() }, 'Reply sent to the learner.')}>Send reply</button>
        <button type="button" className="ld-btn" disabled={!!busy} onClick={move}>{next ? `Move to ${next}` : 'Reopen'}</button>
      </div>
    </section>
  );
}

export default function SMTickets() {
  const [filter, setFilter] = useState('open');
  const [sel, setSel] = useState('');
  const { data, loading, error, reload } = useLoad(async () => res(await lmsApi.smTickets()), []);
  const prb = useLoad(async () => res(await lmsApi.smProblems().catch(() => null)) || { rows: [], suggestions: [] }, []);
  const problems = (prb.data && prb.data.rows) || [];
  const reloadAll = () => {
    reload();
    prb.reload();
  };
  const rows = (data && data.rows) || [];
  const fn = (FILTERS.find((x) => x[0] === filter) || FILTERS[0])[2];
  const list = rows.filter(fn).sort((a, b) => ({ breached: 0, risk: 1, ok: 2, paused: 3, done: 4 }[a.sla.state] - { breached: 0, risk: 1, ok: 2, paused: 3, done: 4 }[b.sla.state]));
  useEffect(() => {
    if (list.length && !list.some((t) => t.id === sel)) setSel(list[0].id);
  }, [filter, data]); // eslint-disable-line react-hooks/exhaustive-deps
  if (loading && !data) return <Loading />;
  if (error) return <Alert type="error" showIcon message={error} style={{ margin: 24 }} />;
  const cur = rows.find((t) => t.id === sel);
  return (
    <SMPage title="Ticket queue">
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {FILTERS.map(([k, label, f]) => (
          <button key={k} type="button" className={`ld-pill${filter === k ? ' on' : ''}`} onClick={() => setFilter(k)}>{label} · {rows.filter(f).length}</button>
        ))}
        <button type="button" className={`ld-pill${filter === 'prb' ? ' on' : ''}`} onClick={() => setFilter('prb')}>Problems (PRB) · {problems.filter((p) => p.status !== 'Resolved').length}{prb.data && prb.data.suggestions.length ? ' · ⚠' : ''}</button>
      </div>
      {filter === 'prb' ? <Problems data={prb.data || { rows: [], suggestions: [] }} reload={reloadAll} /> : (
      <div className="sm-g" style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 460px', gap: 14, flex: 1, minHeight: 0 }}>
        <section className="ld-card" aria-label="Tickets">
          <div style={{ overflowX: 'auto' }}>
            <table className="ld-table">
              <thead><tr><th>ID</th><th>Learner / batch</th><th>Category</th><th>Pri</th><th>Owner</th><th>Status</th><th>SLA</th></tr></thead>
              <tbody>
                {list.length === 0 && <tr><td colSpan={7} className="ld-muted">No ticket in this filter.</td></tr>}
                {list.map((t) => (
                  <tr key={t.id} className={`click${sel === t.id ? ' sm-rowsel' : ''}`} onClick={() => setSel(t.id)}>
                    <td><b>{t.code}</b></td>
                    <td>{shortName(t.learner)}{t.batch ? ` · ${t.batch}` : ''}</td>
                    <td>{t.category}</td>
                    <td><span className={`ld-chip ${PCHIP[t.p]}`}>{t.p}</span></td>
                    <td>{t.owner || '—'}</td>
                    <td>{statusLabel(t)}</td>
                    <td style={{ color: t.sla.state === 'breached' ? '#991b1b' : t.sla.state === 'risk' ? '#9a3412' : undefined, fontWeight: ['breached', 'risk'].includes(t.sla.state) ? 600 : 400 }} className={['paused', 'done'].includes(t.sla.state) ? 'ld-muted' : ''}>{t.sla.label}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="ld-muted" style={{ fontSize: 12, marginTop: 'auto' }}>
            SLA targets (default until D-06): P0 {data.slaHours.Urgent}h · P1 {data.slaHours.High}h · P2 {data.slaHours.Medium}h · P3 {data.slaHours.Low}h · "Waiting" pauses the clock
          </div>
        </section>
        {cur ? <Detail t={cur} owners={data.owners} problems={problems} onSaved={reloadAll} /> : <section className="ld-card"><div className="ld-empty">Pick a ticket.</div></section>}
      </div>
      )}
    </SMPage>
  );
}
