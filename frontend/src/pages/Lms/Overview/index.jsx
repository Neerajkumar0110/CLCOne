import React, { useEffect, useState } from 'react';
import { Empty, Skeleton, Alert } from 'antd';
import { useNavigate } from 'react-router-dom';
import lmsApi from '../api';
import '../components/LearnerDesign.css';

// My progress — design board L14: explainable scorecard + curriculum progress |
// quizzes & documents | my timeline. Read-only, from endpoints that already
// exist: /my/overview (eligibility, attendance, assessments, quizzes,
// projects, policies, certificates, notifications), /student/dashboard (batch)
// and the batch's curriculum sessions (/assessments/admin/curriculum/sessions,
// same call the Curriculum progress page makes).

const TEST_LABEL = { BASIC: 'Readiness test', MAJOR: 'Major test', MICRO: 'Micro test', NLP_MICRO: 'NLP micro test', NLP_MAJOR: 'NLP major test', LLM_MAJOR: 'LLM major test' };
const when = (v) => (v ? new Date(v).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: 'numeric', minute: '2-digit' }) : '');
// timeline stamp as on the board: "28 Oct 6:02"
const evWhen = (v) => {
  if (!v) return '';
  const x = new Date(v);
  return `${x.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })} ${x.getHours()}:${String(x.getMinutes()).padStart(2, '0')}`;
};
const asList =(v) => (Array.isArray(v) ? v : (v && v.result) || []);
const moduleOf = (s) => String(s.code || '').replace(/[-_\s]*\d+.*$/, '') || 'Sessions';

export default function LearnerOverview() {
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);
  const [d, setD] = useState(null);
  const [sessions, setSessions] = useState([]);
  const navigate = useNavigate();

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [res, dash] = await Promise.all([lmsApi.myOverview(), lmsApi.studentDashboard().catch(() => null)]);
        if (!alive) return;
        setD((res && res.result) || null);
        const enrolment = ((dash && dash.result && dash.result.courses) || []).find((c) => c.batch);
        if (enrolment) {
          const cs = await lmsApi.assessmentCurriculumSessions({ batch: enrolment.batch }).catch(() => null);
          if (alive) setSessions((cs && cs.result && cs.result.sessions) || []);
        }
      } catch (e) {
        if (alive) setErr('Could not load your progress.');
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  if (loading) return <Skeleton active paragraph={{ rows: 8 }} style={{ padding: 24 }} />;
  if (err) return <Alert type="error" showIcon message={err} style={{ margin: 24 }} />;
  if (!d) return <Empty style={{ marginTop: 80 }} description="Nothing to show yet." />;

  const elig = d.eligibility;
  const results = (d.assessments && d.assessments.results) || [];
  const quizzes = asList(d.quizzes);
  const projects = asList(d.projects);
  const policies = asList(d.policies);
  const certificates = asList(d.certificates);
  const notes = (d.notifications && d.notifications.notifications) || [];

  // curriculum delivered % per module (session code prefix)
  const modules = [];
  sessions.forEach((s) => {
    const key = moduleOf(s);
    let m = modules.find((x) => x.key === key);
    if (!m) modules.push((m = { key, total: 0, done: 0 }));
    m.total += 1;
    if (s.status === 'DELIVERED') m.done += 1;
  });

  // my timeline — built only from my own records
  const events = [];
  results.forEach((r) => r.submittedAt && events.push({ at: r.submittedAt, color: '#0e7490', text: `${TEST_LABEL[r.testType] || r.testType} attempt · ${r.score}/${r.totalCount}${r.qualified ? ' · qualified' : ''}` }));
  projects.forEach((p) =>
    (p.submissions || []).forEach((s) => {
      events.push({ at: s.submittedAt, color: '#c2410c', text: `Submitted ${p.title} · v${s.version}` });
      if (s.review && s.review.at) events.push({ at: s.review.at, color: '#c2410c', text: `Review: ${String(s.review.decision || '').replace('_', ' ')}` });
    })
  );
  policies.forEach((p) => p.acknowledgedAt && events.push({ at: p.acknowledgedAt, color: '#16a34a', text: `${p.title} v${p.version} accepted` }));
  certificates.forEach((c) => c.issuedOn && events.push({ at: c.issuedOn, color: '#b45309', text: `${c.title || c.course} certificate issued` }));
  notes.forEach((n) => n.created && events.push({ at: n.created, color: '#64748b', text: n.title }));
  events.sort((a, b) => new Date(b.at) - new Date(a.at));

  const allPassed = elig && (elig.items || []).filter((i) => i.applicable).every((i) => i.passed);

  return (
    <div className="ld-page" style={{ gap: 14 }}>
      <div className="ld-hd">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <h1>My progress</h1>
          <div className="ld-muted" style={{ fontSize: 14 }}>Explainable scorecard — har gate ka reason aur source dikhta hai · calculated {when(new Date())}</div>
        </div>
      </div>

      <div className="ld-grid" style={{ gridTemplateColumns: '1fr 1fr 1fr', gap: 14, flex: 1 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <section className="ld-card" aria-label="Scorecard">
            <div className="ld-hd"><b>Scorecard</b>{elig && <span className={`ld-chip ${allPassed ? 'hai' : 'adh'}`}>{allPassed ? 'All gates met' : 'Action required'}</span>}</div>
            {!elig && <div className="ld-muted" style={{ fontSize: 13 }}>No eligibility rule is set for your internship yet.</div>}
            {elig &&
              (elig.items || []).map((i) => (
                <div className="ld-li" key={i.key}>
                  <span>{i.label}{i.applicable && i.required ? ` ≥ ${i.required}${i.key === 'attendance' || i.key === 'curriculum' ? '%' : ''}` : ''}</span>
                  {!i.applicable ? <span className="ld-muted">n/a</span> : i.passed ? <b style={{ color: '#166534' }}>Pass{i.achieved != null && i.achieved !== '' && typeof i.achieved !== 'boolean' ? ` · ${i.achieved}` : ''}</b> : <b style={{ color: '#991b1b' }}>{i.achieved} · missing</b>}
                </div>
              ))}
            {elig && (
              <button type="button" className="ld-link" style={{ fontSize: 13 }} onClick={() => navigate('/learn/support', { state: { raise: { category: 'Other', subject: 'Eligibility review / appeal', description: `My scorecard shows ${elig.score}%. What looks wrong:` } } })}>
                Galat lag raha hai? Review / appeal request →
              </button>
            )}
          </section>
          <section className="ld-card" aria-label="Curriculum progress">
            <div className="ld-hd"><b>Curriculum progress</b><button type="button" className="ld-link" style={{ fontSize: 13 }} onClick={() => navigate('/learn/courses')}>Course content →</button></div>
            {modules.length === 0 && <div className="ld-muted" style={{ fontSize: 13 }}>Curriculum appears once your batch has sessions.</div>}
            {modules.map((m) => {
              const pct = Math.round((m.done / m.total) * 100);
              return (
                <div key={m.key} style={{ display: 'grid', gridTemplateColumns: '150px 1fr 44px', gap: 10, alignItems: 'center', fontSize: 13 }}>
                  <span>{m.key}</span>
                  <div style={{ height: 10, background: '#e2e8f0', borderRadius: 5 }}><div style={{ height: 10, borderRadius: 5, background: '#0e7490', width: `${pct}%` }} /></div>
                  <b>{pct}%</b>
                </div>
              );
            })}
          </section>
        </div>

        <section className="ld-card" aria-label="Quizzes and documents">
          <div className="ld-hd"><b>Quizzes &amp; surprise tests</b><button type="button" className="ld-link" style={{ fontSize: 13 }} onClick={() => navigate('/learn/results')}>All results →</button></div>
          {quizzes.length === 0 && results.length === 0 && <div className="ld-muted" style={{ fontSize: 13 }}>No quiz or test taken yet.</div>}
          {quizzes.map((q) => (
            <div className="ld-li" key={q.id || q._id || q.title}>
              <span>{q.title}</span>
              {q.attemptsUsed > 0 ? <b>{q.bestScore != null ? `${q.bestScore}${q.maxScore ? `/${q.maxScore}` : '%'}` : 'done'}</b> : <span className="ld-chip gray">{q.dueDate ? new Date(q.dueDate).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }) : 'pending'}</span>}
            </div>
          ))}
          {results.filter((r) => r.status === 'SUBMITTED').slice(0, 6).map((r, i) => (
            <div className="ld-li" key={`r${i}`}><span>{TEST_LABEL[r.testType] || r.testType}</span><b>{r.score}/{r.totalCount}</b></div>
          ))}
          <div className="ld-hd" style={{ marginTop: 8 }}><b>My documents</b></div>
          {policies.filter((p) => p.status === 'acknowledged').map((p) => (
            <div className="ld-li" key={p.id || p.policyId}><span>{p.title} v{p.version} (accepted)</span><button type="button" className="ld-link" onClick={() => navigate('/learn/policies')}>Open</button></div>
          ))}
          <div className="ld-li"><span>Fee receipts</span><button type="button" className="ld-link" onClick={() => navigate('/learn/fees')}>Open</button></div>
          {certificates.filter((c) => c.eligible || c.certificateId).map((c) => (
            <div className="ld-li" key={c.certificateId || c.course}><span>{c.title || c.course} certificate</span><button type="button" className="ld-link" onClick={() => navigate('/learn/certificates')}>Open</button></div>
          ))}
          <div className="ld-li"><span>Offer / internship letter</span><span className="ld-chip gray">Pending</span></div>
        </section>

        <section className="ld-card" aria-label="My timeline">
          <div className="ld-hd"><b>My timeline</b><span className="ld-muted" style={{ fontSize: 12 }}>sirf aapke events</span></div>
          {events.length === 0 && <div className="ld-muted" style={{ fontSize: 13 }}>Your activity will appear here.</div>}
          {events.slice(0, 14).map((e, i) => (
            <div key={i} className="ov-ev" style={{ display: 'grid', gridTemplateColumns: '96px 12px 1fr', gap: 8, fontSize: 13, lineHeight: '18px' }}>
              <span className="ld-muted">{evWhen(e.at)}</span>
              <div style={{ width: 10, height: 10, borderRadius: 5, marginTop: 4, background: e.color }} />
              <span>{e.text}</span>
            </div>
          ))}
        </section>
      </div>
    </div>
  );
}
