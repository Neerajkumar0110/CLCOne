import React, { useEffect, useState } from 'react';
import { Alert, Image, Modal, message } from 'antd';
import { BASE_URL } from '@/config/serverApiConfig';
import lmsApi from '../api';
import { request } from '@/request';
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
// live SLA clock: the server sends dueAt; the browser counts it down every
// second (state flips to risk / breached on its own, no reload needed)
const SLA_TOTAL_MS = 48 * 3600 * 1000;
const p2 = (n) => String(n).padStart(2, '0');
const clock = (ms) => {
  const sec = Math.floor(Math.abs(ms) / 1000);
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  return `${d ? `${d}d ` : ''}${p2(h)}h ${p2(Math.floor((sec % 3600) / 60))}m ${p2(sec % 60)}s`;
};
function liveSla(sla, now) {
  if (!sla || !sla.dueAt || ['done', 'paused'].includes(sla.state)) return sla;
  const left = new Date(sla.dueAt).getTime() - now;
  if (left < 0) return { ...sla, state: 'breached', label: `Breached ${clock(left)}` };
  return { ...sla, state: left < SLA_TOTAL_MS * 0.25 ? 'risk' : 'ok', label: `${clock(left)} left` };
}
function useNow(ms = 1000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return now;
}
const slaColor = (st) => (st === 'breached' ? '#991b1b' : st === 'risk' ? '#9a3412' : undefined);
// stored as "public/uploads/tickets/…" — relative to the backend, not the page
const fileUrl = (u) => (!u ? '' : /^(https?:|blob:|data:)/.test(u) ? u : `${BASE_URL}${String(u).replace(/^\//, '')}`);
const isImg = (a) => /\.(png|jpe?g|gif|webp|bmp)(\?|$)/i.test(String(a.url || '')) || /\.(png|jpe?g|gif|webp|bmp)$/i.test(String(a.name || ''));
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

function SlaLive({ sla, cell }) {
  const now = useNow(1000);
  const v = liveSla(sla, now);
  const hot = ['breached', 'risk'].includes(v.state);
  const style = { color: slaColor(v.state) || (cell ? undefined : '#0f172a'), fontWeight: hot || !cell ? 600 : 400, fontSize: 13, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' };
  return <span className={['paused', 'done'].includes(v.state) ? 'ld-muted' : ''} style={style}>{v.label}</span>;
}

function Detail({ t, owners, problems, onSaved }) {
  const [f, setF] = useState({});
  const [note, setNote] = useState('');
  const [reply, setReply] = useState('');
  const [files, setFiles] = useState([]);
  const [busy, setBusy] = useState('');
  useEffect(() => {
    setF({ category: t.category, priority: t.priority, ownerId: t.ownerId || '', nextActionAt: toLocal(t.nextActionAt), waiting: t.waiting || '' });
    setNote('');
    setReply(t.resolutionNote || '');
    setFiles([]);
  }, [t]);
  const attach = async (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file) return;
    const fd = new FormData();
    fd.append('file', file);
    setBusy('upload');
    const r = await request.post({ entity: 'lms/admin/sm/tickets/upload', jsonData: fd });
    setBusy('');
    if (r && r.success) setFiles((x) => [...x, r.result]);
  };
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
      if (files.length && (body.reply || key === 'files')) body.files = files;
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
    <div className="tk-modal" aria-label="Ticket detail">
      <header className="tk-head">
        <div className="tk-head-main">
          <div className="tk-tags">
            <span className="tk-code">{t.code}</span>
            <span className={`ld-chip ${PCHIP[t.p]}`}>{t.p}</span>
            <span className="ld-chip naya">{t.category}</span>
            <span className="ld-chip gray">{statusLabel(t)}</span>
          </div>
          <h2 className="tk-title">{t.subject}</h2>
          <div className="tk-meta">
            <span>👤 {t.learner}</span>
            {t.batch && <span>🎓 {t.batch}</span>}
            <span>🕒 Raised {fmtDayTime(t.created)}</span>
            {t.owner && <span>🧑‍💼 {t.owner}</span>}
          </div>
        </div>
        <SlaBadge sla={t.sla} />
      </header>

      <div className="tk-steps">
        {STAGES.map((s, k) => (
          <div key={s} className={`tk-step${k < i ? ' done' : ''}${k === i ? ' on' : ''}`}>
            <span className="tk-dot">{k < i ? '✓' : k + 1}</span>
            <span className="tk-step-l">{s}</span>
          </div>
        ))}
      </div>

      <div className="tk-grid">
        <div className="tk-col">
          <section className="tk-box">
            <div className="tk-cap">Learner's issue</div>
            {t.description ? <div className="tk-desc">{t.description}</div> : <div className="ld-muted">No description.</div>}
            {t.attachments.some(isImg) && (
              <div className="tk-shots">
                <Image.PreviewGroup>
                  {t.attachments.filter(isImg).map((a, k) => (
                    <figure key={k} className="tk-shot">
                      <Image src={fileUrl(a.url)} alt={a.name || 'Screenshot'} />
                      <figcaption title={a.name}>{a.name}</figcaption>
                    </figure>
                  ))}
                </Image.PreviewGroup>
              </div>
            )}
            <div className="tk-files">
              {t.attachments.filter((a) => !isImg(a)).map((a, k) => <a key={k} className="tk-file" href={fileUrl(a.url)} target="_blank" rel="noreferrer">📎 {a.name}</a>)}
              {!t.attachments.length && <span className="ld-muted" style={{ fontSize: 12 }}>No attachment</span>}
              {t.reference && <span className="tk-ref">{t.reference}</span>}
            </div>
          </section>

          {t.internalNotes.length > 0 && (
            <section className="tk-box">
              <div className="tk-cap">Internal notes</div>
              <div className="tk-notes">
                {t.internalNotes.slice(-3).map((n, k) => (
                  <div key={k} className="tk-note"><b>{n.byName}</b><span className="ld-muted"> · {fmtDayTime(n.at)}</span><div>{n.text}</div></div>
                ))}
              </div>
            </section>
          )}

          <section className="tk-box">
            <label className="ld-label">Reply to learner<textarea className="ld-inp tk-ta" placeholder="The learner sees this (with Resolve or separately)" value={reply} onChange={(e) => setReply(e.target.value)} /></label>
            <div className="tk-files">
              <label className="ld-btn2 tk-attach" style={{ cursor: busy === 'upload' ? 'wait' : 'pointer' }}>
                {busy === 'upload' ? 'Uploading…' : '📎 Attach file'}
                <input type="file" hidden accept=".pdf,.doc,.docx,.png,.jpg,.jpeg" disabled={!!busy} onChange={attach} />
              </label>
              {files.map((x, k) => (
                <span key={k} className="ld-chip gray">{x.name} <button type="button" onClick={() => setFiles(files.filter((_, j) => j !== k))} style={{ border: 0, background: 'none', cursor: 'pointer' }} aria-label={`Remove ${x.name}`}>×</button></span>
              ))}
              {files.length > 0 && !reply.trim() && <button type="button" className="ld-btn2 tk-attach" disabled={!!busy} onClick={() => save('files', {}, 'File sent to the learner.')}>Send file</button>}
              {(t.supportFiles || []).length > 0 && <span className="ld-muted" style={{ fontSize: 12 }}>Already shared: {t.supportFiles.map((x) => x.name).join(', ')}</span>}
            </div>
            <label className="ld-label">Internal note<textarea className="ld-inp tk-ta sm" placeholder="Staff only, not shown to the learner" value={note} onChange={(e) => setNote(e.target.value)} /></label>
          </section>
        </div>

        <aside className="tk-col">
          <section className="tk-box">
            <div className="tk-cap">Ticket details</div>
            <label className="ld-label">Category<select className="ld-inp" value={f.category || ''} onChange={(e) => setF({ ...f, category: e.target.value })}>{[...new Set([t.category, ...CATEGORIES])].map((c) => <option key={c}>{c}</option>)}</select></label>
            <label className="ld-label">Priority<select className="ld-inp" value={f.priority || ''} onChange={(e) => setF({ ...f, priority: e.target.value })}>{PRIORITIES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
            <label className="ld-label">Owner<select className="ld-inp" value={f.ownerId || ''} onChange={(e) => setF({ ...f, ownerId: e.target.value })}><option value="">— Unassigned</option>{owners.map((o) => <option key={o.id} value={o.id}>{o.name} ({o.role})</option>)}</select></label>
            <label className="ld-label">Next action due<input className="ld-inp" type="datetime-local" value={f.nextActionAt || ''} onChange={(e) => setF({ ...f, nextActionAt: e.target.value })} /></label>
            <label className="ld-label">Waiting on<select className="ld-inp" value={f.waiting || ''} onChange={(e) => setF({ ...f, waiting: e.target.value })}><option value="">— Not waiting (SLA running)</option><option value="learner">Learner</option><option value="tech">Tech team</option></select></label>
            {t.escalatedTo && <div className="tk-esc">⚠ Escalated to <b>{t.escalatedTo}</b></div>}
          </section>
          <section className="tk-box">
            <div className="tk-cap">Problem record</div>
            <ProblemLink t={t} problems={problems} onSaved={onSaved} />
          </section>
        </aside>
      </div>

      <footer className="tk-foot">
        <div className="tk-foot-l">
          <button type="button" className="ld-btn2" disabled={!!busy} onClick={() => save('save', {}, 'Saved.')}>Save</button>
          <button type="button" className="ld-btn2" disabled={!!busy || t.escalatedTo === 'LMS tech'} onClick={() => save('esc', { escalateTo: 'LMS tech', waiting: 'tech' }, 'Escalated to LMS tech.')}>Escalate to LMS tech</button>
        </div>
        <div className="tk-foot-l">
          <button type="button" className="ld-btn2" disabled={!!busy || !reply.trim()} onClick={() => save('reply', { reply: reply.trim() }, 'Reply sent to the learner.')}>Send reply</button>
          <button type="button" className="ld-btn" disabled={!!busy} onClick={move}>{next ? `Move to ${next} →` : 'Reopen'}</button>
        </div>
      </footer>
    </div>
  );
}

// big live SLA pill for the modal header
function SlaBadge({ sla }) {
  const now = useNow(1000);
  const v = liveSla(sla, now) || {};
  const text = String(v.label || '');
  const main = text.replace(/^Breached\s+/, '').replace(/\s+left$/, '');
  const cap = v.state === 'breached' ? 'SLA breached' : v.state === 'paused' ? 'SLA paused' : v.state === 'done' ? 'SLA' : v.state === 'risk' ? 'SLA at risk · left' : 'SLA · time left';
  return (
    <div className={`tk-sla ${v.state || 'ok'}`} role="timer" aria-live="off">
      <span className="tk-sla-cap">⏱ {cap}</span>
      <span className="tk-sla-v">{main}</span>
    </div>
  );
}

export default function SMTickets() {
  const [filter, setFilter] = useState('open');
  const [sel, setSel] = useState('');
  const [open, setOpen] = useState(false);
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
      <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
        <section className="ld-card" aria-label="Tickets">
          <div style={{ overflowX: 'auto' }}>
            <table className="ld-table">
              <thead><tr><th>ID</th><th>Learner / batch</th><th>Category</th><th>Pri</th><th>Owner</th><th>Status</th><th>SLA</th><th aria-label="Open" /></tr></thead>
              <tbody>
                {list.length === 0 && <tr><td colSpan={8} className="ld-muted">No ticket in this filter.</td></tr>}
                {list.map((t) => (
                  <tr key={t.id} className={`click${sel === t.id ? ' sm-rowsel' : ''}`} onClick={() => { setSel(t.id); setOpen(true); }} tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter') { setSel(t.id); setOpen(true); } }}>
                    <td style={{ whiteSpace: 'nowrap' }}><b>{t.code}</b></td>
                    <td>{shortName(t.learner)}{t.batch ? ` · ${t.batch}` : ''}</td>
                    <td>{t.category}</td>
                    <td><span className={`ld-chip ${PCHIP[t.p]}`}>{t.p}</span></td>
                    <td>{t.owner || '—'}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>{statusLabel(t)}</td>
                    <td><SlaLive sla={t.sla} cell /></td>
                    <td style={{ textAlign: 'right' }}><span className="ld-link" style={{ fontSize: 12, whiteSpace: 'nowrap' }}>Open →</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="ld-muted" style={{ fontSize: 12, marginTop: 'auto' }}>
            SLA targets (default until D-06): P0 {data.slaHours.Urgent}h · P1 {data.slaHours.High}h · P2 {data.slaHours.Medium}h · P3 {data.slaHours.Low}h · "Waiting" pauses the clock
          </div>
        </section>
        <Modal
          open={open && !!cur}
          onCancel={() => setOpen(false)}
          footer={null}
          width={1040}
          centered
          rootClassName="tk-modal-root"
          styles={{ body: { padding: 0 } }}
        >
          {cur && <Detail t={cur} owners={data.owners} problems={problems} onSaved={reloadAll} />}
        </Modal>
      </div>
      )}
    </SMPage>
  );
}
