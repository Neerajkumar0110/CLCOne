import React, { lazy, useEffect, useState } from 'react';
import { Alert, Modal, Input, message } from 'antd';
import lmsApi from '../api';
import { PMPage, PMTabs, Legacy, Loading, useLoad, useTab, res, initials, errText } from './shared';

const CourseReport = lazy(() => import('../Learner360'));

// P5 — Learner 360 for one learner: profile + eligibility scorecard |
// filterable timeline | doubts (reply in place) + PM notes. Security / IP
// events are never sent to PMs. The course-wide report (export) is the
// "Course report" tab.

const FILTERS = [
  ['all', 'All'],
  ['attendance', 'Attendance'],
  ['assessment', 'Assessments'],
  ['project', 'Projects'],
  ['policy', 'Policies'],
  ['feedback', 'Feedback'],
  ['doubt', 'Doubts'],
];
const TONE = { green: '#16a34a', red: '#dc2626', amber: '#d97706', indigo: '#4f46e5', orange: '#c2410c', slate: '#64748b', cyan: '#0e7490' };
const evWhen = (v) => {
  if (!v) return '';
  const d = new Date(v);
  return `${d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })} ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
};
const STATUS_CHIP = { Active: 'hai', 'On Hold': 'adh', Dropped: 'gray', Completed: 'naya', Deferred: 'adh' };

function getEmail() {
  try {
    return new URLSearchParams(window.location.search).get('email') || '';
  } catch (e) {
    return '';
  }
}
function setEmailInUrl(email) {
  try {
    const u = new URL(window.location.href);
    if (email) u.searchParams.set('email', email);
    else u.searchParams.delete('email');
    window.history.replaceState(window.history.state, '', u.toString());
  } catch (e) {
    /* noop */
  }
}

function Profile({ email }) {
  const [filter, setFilter] = useState('all');
  const [reply, setReply] = useState('');
  const [doubtId, setDoubtId] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState('');
  const { data, loading, error, reload } = useLoad(async () => res(await lmsApi.pmLearner(email)), [email]);
  useEffect(() => {
    const open = data && (data.doubts || []).find((d) => d.status !== 'resolved');
    setDoubtId(open ? open.id : '');
  }, [data]);
  if (loading && !data) return <Loading />;
  if (error || !data) return <Alert type="error" showIcon message={error || 'Not found.'} />;
  const { learner: l, eligibility: e, project, events, doubts, notes } = data;
  const shown = events.filter((x) => filter === 'all' || x.kind === filter);
  const openDoubts = doubts.filter((d) => d.status !== 'resolved');
  const item = (key) => e && (e.items || []).find((i) => i.key === key);

  const run = async (key, fn, ok) => {
    setBusy(key);
    try {
      const r = await fn();
      if (r && r.success === false) throw new Error(r.message);
      message.success(ok);
      await reload();
      return true;
    } catch (err) {
      message.error(errText(err, 'Failed.'));
      return false;
    } finally {
      setBusy('');
    }
  };
  const sendReply = async () => {
    if (await run('reply', () => lmsApi.replyDoubt(doubtId, { body: reply.trim() }), 'Reply sent.')) setReply('');
  };
  const addNote = async () => {
    if (await run('note', () => lmsApi.pmLearnerNote(l.email, note.trim()), 'Note saved.')) setNote('');
  };
  const askReview = () => {
    let text = '';
    Modal.confirm({
      title: 'Attendance review request',
      content: <Input.TextArea rows={3} placeholder="Kaun si classes aur kyun (e.g. Safari issue, 3 classes partial)" onChange={(ev) => { text = ev.target.value; }} />,
      okText: 'Send to Support',
      onOk: () => run('att', () => lmsApi.pmAttendanceReview(l.email, text), 'Sent to Support / Ops.'),
    });
  };
  const row = (label, it, fmt) => {
    if (!it || !it.applicable) return <div className="ld-li"><span>{label}</span><span className="ld-muted">n/a</span></div>;
    return <div className="ld-li"><span>{label}</span><b style={{ color: it.passed ? '#166534' : '#991b1b' }}>{fmt(it)}</b></div>;
  };

  return (
    <>
      <h1 style={{ marginTop: -4 }}>Learner 360 · {l.name}</h1>
      <div className="pm-g" style={{ display: 'grid', gridTemplateColumns: '340px minmax(0, 1fr) 320px', gap: 14, flex: 1, minHeight: 0 }}>
        <section className="ld-card" aria-label="Profile">
          <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
            <div className="pm-av">{initials(l.name)}</div>
            <div><b style={{ fontSize: 16 }}>{l.name}</b><div className="ld-muted" style={{ fontSize: 13 }}>{l.enrollmentId || '—'} · {l.batch}</div></div>
          </div>
          <div className="ld-li"><span>Status</span><span className={`ld-chip ${STATUS_CHIP[l.status] || 'gray'}`}>{l.status}</span></div>
          <div className="ld-li"><span>Project Manager</span><b>{[].concat(l.pm || []).join(', ') || '—'}</b></div>
          <div className="ld-li"><span>Contact</span><span className="ld-muted">{l.contact || '—'}</span></div>
          <div className="ld-hd" style={{ marginTop: 6 }}><b>Eligibility scorecard</b>{e && <span className={`ld-chip ${e.eligible ? 'hai' : 'adh'}`}>{e.eligible ? 'ELIGIBLE' : 'ACTION REQUIRED'}</span>}</div>
          {!e && <div className="ld-empty">Is internship ka eligibility rule set nahi hai.</div>}
          {e && (
            <>
              {row('Policies', item('acknowledgement'), (i) => (i.passed ? '✓ accepted' : `${i.achieved}%`))}
              {row('Attendance', item('attendance'), (i) => `${i.achieved}% / ${i.required}%`)}
              {row('Curriculum', item('curriculum'), (i) => `${i.achieved}% / ${i.required}%`)}
              {row('Assessments', item('quiz') || item('assessment'), (i) => (i.passed ? '✓ Passed' : `${i.achieved}%`))}
              <div className="ld-li">
                <span>Project</span>
                {project ? <b style={{ color: project.overdueDays ? '#991b1b' : undefined }}>{project.overdueDays ? `overdue ${project.overdueDays} din` : project.status.replace('_', ' ')}</b> : <span className="ld-muted">none assigned</span>}
              </div>
              {row('Assignments', item('assignment'), (i) => (i.passed ? '✓' : `${i.achieved}%`))}
              <div className="ld-muted" style={{ fontSize: 12, marginTop: 'auto' }}>Score {e.score}% / {e.threshold}% · calculated {evWhen(e.calculatedAt)}</div>
            </>
          )}
        </section>

        <section className="ld-card pm-scroll" aria-label="Timeline">
          <div className="ld-hd"><b>Timeline</b><span className="ld-muted" style={{ fontSize: 12 }}>security / IP events PM ko nahi dikhte</span></div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {FILTERS.map(([k, label]) => (
              <button key={k} type="button" className={`ld-pill${filter === k ? ' on' : ''}`} style={{ height: 30, fontSize: 12 }} onClick={() => setFilter(k)}>{label}</button>
            ))}
          </div>
          {shown.length === 0 && <div className="ld-empty">Is filter mein koi event nahi.</div>}
          {shown.slice(0, 40).map((x, i) => (
            <div className="pm-ev" key={i}>
              <span className="ld-muted">{evWhen(x.at)}</span>
              <div className="pm-dot" style={{ background: TONE[x.tone] || '#64748b' }} />
              <span><b>{x.title}</b> <span className="ld-muted">· {x.src}</span></span>
            </div>
          ))}
        </section>

        <section className="ld-card" aria-label="Doubts and notes">
          <div className="ld-hd"><b>Doubts · {openDoubts.length} open</b></div>
          {doubts.length === 0 && <div className="ld-empty">Koi doubt nahi poocha.</div>}
          {doubts.slice(0, 3).map((d) => (
            <button key={d.id} type="button" className={`pm-q${doubtId === d.id ? ' on' : ''}`} onClick={() => setDoubtId(d.id)} style={{ background: '#f8fafc' }}>
              <b>"{d.title}"</b>
              <span className="ld-muted">{evWhen(d.created)} · {d.status === 'resolved' ? 'resolved' : d.replyCount ? `${d.replyCount} repl${d.replyCount > 1 ? 'ies' : 'y'}` : 'unanswered'}</span>
            </button>
          ))}
          {doubtId && (
            <>
              <textarea className="ld-inp" aria-label="Reply" placeholder="Reply…" style={{ height: 70, padding: 8, resize: 'none' }} value={reply} onChange={(ev) => setReply(ev.target.value)} />
              <button type="button" className="ld-btn2 sm" style={{ alignSelf: 'flex-end' }} disabled={!reply.trim() || busy === 'reply'} onClick={sendReply}>Send reply</button>
            </>
          )}
          <div className="ld-hd" style={{ marginTop: 6 }}><b>PM notes</b><span className="ld-muted" style={{ fontSize: 12 }}>learner ko nahi dikhte</span></div>
          {notes.slice(0, 3).map((n) => (
            <div key={n.id} className="ld-muted" style={{ fontSize: 13, lineHeight: '19px' }}>{n.text} <span style={{ fontSize: 11 }}>— {n.byName}, {evWhen(n.created)}</span></div>
          ))}
          <div style={{ display: 'flex', gap: 6 }}>
            <input className="ld-inp" style={{ flex: 1, minWidth: 0 }} aria-label="New note" placeholder="Add a note…" value={note} onChange={(ev) => setNote(ev.target.value)} onKeyDown={(ev) => ev.key === 'Enter' && note.trim() && addNote()} />
            <button type="button" className="ld-btn2 sm" disabled={!note.trim() || busy === 'note'} onClick={addNote}>Save</button>
          </div>
          <button type="button" className="ld-link" style={{ fontSize: 13, marginTop: 'auto' }} onClick={askReview}>Support Manager ko attendance review request →</button>
        </section>
      </div>
    </>
  );
}

function Picker({ onPick }) {
  const [q, setQ] = useState('');
  const { data, loading } = useLoad(async () => res(await lmsApi.pmCandidates()), []);
  const [batch, setBatch] = useState('');
  const { data: other } = useLoad(async () => (batch ? res(await lmsApi.pmCandidates({ batch })) : null), [batch]);
  const d = other || data;
  if (loading && !data) return <Loading />;
  const rows = ((d && d.rows) || []).filter((r) => !q || `${r.name} ${r.email} ${r.enrollmentId}`.toLowerCase().includes(q.toLowerCase()));
  return (
    <section className="ld-card">
      <div className="ld-hd"><b>Learner chunein</b>
        <div style={{ display: 'flex', gap: 8 }}>
          {d && d.batches && d.batches.length > 1 && (
            <select className="ld-inp" aria-label="Batch" value={d.batch || ''} onChange={(ev) => setBatch(ev.target.value)}>
              {d.batches.map((b) => <option key={b} value={b}>{b}</option>)}
            </select>
          )}
          <input className="ld-inp" style={{ width: 240 }} placeholder="Search name / ID" aria-label="Search" value={q} onChange={(ev) => setQ(ev.target.value)} />
        </div>
      </div>
      {rows.length === 0 && <div className="ld-empty">Koi learner nahi mila.</div>}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 8 }}>
        {rows.map((r) => (
          <button key={r.email} type="button" className="ld-qi" onClick={() => onPick(r.email)}>
            <b>{r.name}</b>
            <span className="ld-muted">{r.enrollmentId || r.email} · {r.attendancePct}% attendance</span>
          </button>
        ))}
      </div>
    </section>
  );
}

export default function PMLearner360() {
  const [tab, setTab] = useTab('learner');
  const [email, setEmail] = useState(getEmail);
  const pick = (e) => {
    setEmail(e);
    setEmailInUrl(e);
  };
  return (
    <PMPage
      title={tab === 'learner' && email ? '' : 'Learner 360'}
      right={
        <>
          {tab === 'learner' && email && <button type="button" className="ld-link" style={{ fontSize: 13 }} onClick={() => pick('')}>← All learners</button>}
          <PMTabs tabs={[['learner', 'Learner'], ['report', 'Course report']]} value={tab} onChange={setTab} />
        </>
      }
    >
      {tab === 'report' ? <Legacy><CourseReport /></Legacy> : email ? <Profile key={email} email={email} /> : <Picker onPick={pick} />}
    </PMPage>
  );
}
