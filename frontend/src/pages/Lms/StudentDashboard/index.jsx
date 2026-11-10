import React, { useEffect, useState } from 'react';
import { Empty, Skeleton, Alert } from 'antd';
import { useNavigate } from 'react-router-dom';
import lmsApi from '../api';
import '../components/LearnerDesign.css';

// Learner Home — design board L3, same layout and order. Everything here is read from endpoints that
// already exist — /student/dashboard (classes, recordings, certificates),
// /my/overview (eligibility, attendance, assessments, projects, policies,
// notifications) and /my/tickets — so no new business logic lives on this
// page. The full breakdown of each stays on its own page (My Overview,
// Attendance, Results…); Home only summarises and links there.

const TEST_TYPE_LABELS = { BASIC: 'Basic Test', MAJOR: 'Major Test', MICRO: 'Micro Test', NLP_MICRO: 'NLP Micro Test', NLP_MAJOR: 'NLP Major Test', LLM_MAJOR: 'LLM Major Test' };

const fmtTime = (v) => {
  if (!v) return '—';
  try {
    return new Date(v).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  } catch (e) {
    return '—';
  }
};
const fmtDay = (v) => (v ? new Date(v).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : '');
const fmtClock = (v) => (v ? new Date(v).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' }) : '');
const asList = (v) => (Array.isArray(v) ? v : (v && v.result) || []);
const settledResult = (s) => (s.status === 'fulfilled' && s.value && s.value.result) || null;

function gateChip(item) {
  if (!item.applicable) return <span className="ld-chip gray">N/A</span>;
  if (item.passed) return <span className="ld-chip hai">Done</span>;
  return <span className="ld-chip red">Gap</span>;
}

export default function StudentDashboard() {
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);
  const [d, setD] = useState(null);
  const [ov, setOv] = useState(null);
  const [tickets, setTickets] = useState([]);
  const [onboarding, setOnboarding] = useState(null);
  const [feedback, setFeedback] = useState(null);
  const navigate = useNavigate();

  useEffect(() => {
    let alive = true;
    (async () => {
      // Each source is optional except the dashboard itself — a failure in
      // one (say tickets) just leaves its card empty instead of blanking Home.
      const [dash, overview, tk, ob, fb] = await Promise.allSettled([lmsApi.studentDashboard(), lmsApi.myOverview(), lmsApi.myTickets(), lmsApi.myOnboarding(), lmsApi.myFeedback()]);
      if (!alive) return;
      if (dash.status !== 'fulfilled') setErr('Could not load your dashboard.');
      setD(settledResult(dash));
      setOv(settledResult(overview));
      setTickets((settledResult(tk) || {}).tickets || []);
      setOnboarding(settledResult(ob));
      setFeedback(settledResult(fb));
      setLoading(false);
    })();
    return () => {
      alive = false;
    };
  }, []);

  if (loading) return <Skeleton active paragraph={{ rows: 8 }} style={{ padding: 24 }} />;
  if (err) return <Alert type="error" showIcon message={err} style={{ margin: 24 }} />;
  if (!d) return <Empty style={{ marginTop: 80 }} description="You are not enrolled in any internship yet." />;

  const k = d.kpis || {};
  const o = ov || {};
  const elig = o.eligibility;
  const att = o.attendance && o.attendance.summary;
  const results = (o.assessments && o.assessments.results) || [];
  const attemptsByType = (o.assessments && o.assessments.attemptsByType) || {};
  const projects = asList(o.projects);
  const policies = asList(o.policies);
  const pendingPolicies = policies.filter((p) => p.status !== 'acknowledged');
  const notif = o.notifications || {};
  const openTickets = tickets.filter((t) => t.status !== 'Resolved');
  const batch = (d.courses || []).map((c) => c.batch).filter(Boolean)[0];
  const course = (d.courses || []).map((c) => c.course).filter(Boolean)[0];

  // Latest attempt per test type — results come newest first.
  const latestByType = {};
  results.forEach((r) => {
    if (r.status === 'SUBMITTED' && !latestByType[r.testType]) latestByType[r.testType] = r;
  });
  const testTypes = Object.keys(attemptsByType).filter((t) => attemptsByType[t].unlocked || latestByType[t]);

  const actions = [];
  (d.liveNow || []).forEach((c) => actions.push({ key: `live-${c.id}`, label: `Join live class now · ${c.title}`, tag: 'Live', to: '/learn/classes' }));
  if (!(d.liveNow || []).length) {
    (d.todaysClasses || []).slice(0, 1).forEach((c) => actions.push({ key: `today-${c.id}`, label: `Today's class · ${fmtClock(c.scheduledStart)}`, to: '/learn/classes' }));
  }
  if (pendingPolicies.length) actions.push({ key: 'pol', label: `Accept ${pendingPolicies.length} pending polic${pendingPolicies.length === 1 ? 'y' : 'ies'}`, to: '/learn/policies' });
  testTypes.forEach((t) => {
    const a = attemptsByType[t];
    const last = latestByType[t];
    if ((last && last.qualified) || !a.unlocked || !a.remaining) return;
    const when = a.nextEligibleAt ? `from ${fmtDay(a.nextEligibleAt)}` : 'available now';
    actions.push({ key: `test-${t}`, label: `${TEST_TYPE_LABELS[t] || t} ${last ? 're-attempt' : 'attempt'} · ${when}`, to: '/learn/assessment-dashboard' });
  });
  projects
    .filter((p) => p.status !== 'approved')
    .slice(0, 2)
    .forEach((p) => actions.push({ key: `prj-${p.id || p._id}`, label: `${p.title}${p.dueDate ? ` · due ${fmtDay(p.dueDate)}` : ''}`, to: '/learn/projects' }));
  openTickets.slice(0, 1).forEach((t) => actions.push({ key: `tk-${t._id}`, label: `${t.ticketNo} · ${t.status}`, to: '/learn/support' }));

  const project = projects[0];
  const latestNotif = (notif.notifications || []).slice(0, 3);
  const doneGates = elig ? (elig.items || []).filter((i) => i.applicable && i.passed).length : 0;
  const totalGates = elig ? (elig.items || []).filter((i) => i.applicable).length : 0;

  const feedbackWin = feedback && feedback.enrolled ? feedback.window || {} : null;
  const feedbackPending = feedbackWin && (feedbackWin.open || feedbackWin.late) && !(feedback.submitted && feedback.submitted.weekly);
  const go = (to) => () => navigate(to);

  return (
    <div className="ld-page">
      <div className="ld-hd">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <h1>Namaste, {(d.student?.name || 'there').split(' ')[0]}</h1>
          <div className="ld-muted" style={{ fontSize: 14 }}>
            {[batch && `${batch} batch`, onboarding && onboarding.pmName && `Project Manager: ${onboarding.pmName}`].filter(Boolean).join(' · ') || course || 'Your internship'} · last updated {fmtTime(new Date())}
          </div>
        </div>
        {k.liveNow > 0 && (
          <button type="button" className="ld-btn md" onClick={go('/learn/classes')}>Join live class</button>
        )}
      </div>

      <div className="ld-grid" style={{ gridTemplateColumns: '1.3fr 1fr 1fr' }}>
        <section className="ld-card" aria-label="Overall eligibility">
          <div className="ld-hd"><b>Overall eligibility</b>{elig && <span className={`ld-chip ${elig.eligible ? 'hai' : 'adh'}`}>{elig.score}%</span>}</div>
          {elig ? (
            <>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
                <span className="ld-big" style={{ color: elig.eligible ? '#166534' : '#9a3412' }}>{elig.eligible ? 'Eligible' : 'Not yet eligible'}</span>
                <span className="ld-muted" style={{ fontSize: 14 }}>{doneGates} of {totalGates} gates done</span>
              </div>
              <div>
                {(elig.items || []).map((item) => (
                  <div className="ld-gate" key={item.key}>
                    <span>{item.label} {item.applicable && !item.passed && <span className="ld-muted">{item.achieved} / {item.required} needed</span>}</span>
                    {gateChip(item)}
                  </div>
                ))}
              </div>
              <button type="button" className="ld-link" style={{ fontSize: 13 }} onClick={() => navigate('/learn/support', { state: { raise: { category: 'Other', subject: 'Eligibility calculation review', description: `My eligibility shows ${elig.score}%. What looks wrong:` } } })}>
                Calculation looks wrong? Request a review
              </button>
              <button type="button" className="ld-link" style={{ fontSize: 13 }} onClick={go('/learn/eligibility')}>Details of every gate →</button>
            </>
          ) : (
            <div className="ld-muted" style={{ fontSize: 14 }}>No eligibility rule is set for your internship yet.</div>
          )}
        </section>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <section className="ld-card" aria-label="Attendance">
            <div className="ld-hd"><b>Attendance</b></div>
            <div className="ld-big">{att ? `${att.attendancePct}%` : '—'}</div>
            {att && (
              <>
                <div className="ld-muted" style={{ fontSize: 13 }}>{att.present + att.late} / {att.totalClasses} sessions · {att.partial} partial · {att.absent} absent</div>
                <div className="ld-track" role="img" aria-label={`Attendance ${att.attendancePct}%`}><div style={{ width: `${Math.min(att.attendancePct, 100)}%` }} /></div>
              </>
            )}
            <button type="button" className="ld-link" style={{ fontSize: 13 }} onClick={go('/learn/attendance')}>View session-wise →</button>
          </section>
          <section className="ld-card" aria-label="Assessments">
            <div className="ld-hd"><b>Assessments</b></div>
            {testTypes.length === 0 ? (
              <div className="ld-muted" style={{ fontSize: 13 }}>No assessment unlocked yet.</div>
            ) : (
              <div>
                {testTypes.map((t) => {
                  const last = latestByType[t];
                  const a = attemptsByType[t];
                  return (
                    <div className="ld-li" key={t}>
                      <span>{TEST_TYPE_LABELS[t] || t}</span>
                      {last && last.qualified ? (
                        <b>{last.score}/{last.totalCount} · Qualified</b>
                      ) : (
                        <span className="ld-muted">{last ? `${last.score}/${last.totalCount} · ` : ''}{a.remaining} attempt{a.remaining === 1 ? '' : 's'} left{a.nextEligibleAt ? ` · from ${fmtDay(a.nextEligibleAt)}` : ''}</span>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <section className="ld-card" aria-label="Next actions">
            <div className="ld-hd"><b>Next actions</b></div>
            {actions.length === 0 ? (
              <div className="ld-muted" style={{ fontSize: 13 }}>All up to date.</div>
            ) : (
              <div>
                {actions.slice(0, 5).map((a) => (
                  <div className="ld-li" key={a.key}>
                    <button type="button" className="ld-link" onClick={go(a.to)}>{a.label}</button>
                    {a.tag && <span className="ld-chip red">{a.tag}</span>}
                  </div>
                ))}
              </div>
            )}
          </section>
          {onboarding && onboarding.steps && (
            <section className="ld-card" aria-label="Onboarding checklist">
              <div className="ld-hd"><b>Onboarding checklist</b><span className={`ld-chip ${onboarding.done === onboarding.total ? 'hai' : 'gray'}`}>{onboarding.done} / {onboarding.total}</span></div>
              <div>
                {onboarding.steps.slice(0, 4).map((s) => (
                  <div className="ld-li" key={s.key}>
                    <span>{s.title}</span>
                    <span className={`ld-chip ${s.state === 'done' ? 'hai' : s.state === 'blocked' ? 'red' : 'gray'}`}>{s.state === 'done' ? 'Done' : s.state === 'blocked' ? 'Blocked' : 'Pending'}</span>
                  </div>
                ))}
              </div>
              <button type="button" className="ld-link" style={{ fontSize: 13 }} onClick={go('/learn/onboarding')}>Open checklist →</button>
            </section>
          )}
        </div>
      </div>

      <div className="ld-grid" style={{ gridTemplateColumns: 'repeat(4, minmax(0, 1fr))' }}>
        <section className="ld-card" aria-label="Project">
          <div className="ld-hd"><b>Project</b>{project && <span className={`ld-chip ${project.status === 'approved' ? 'hai' : 'gray'}`}>{project.status}</span>}</div>
          <div style={{ fontSize: 14 }}>{project ? project.title : 'No project assigned yet'}</div>
          {project && <div className="ld-muted" style={{ fontSize: 13 }}>{[project.mentor && `Mentor: ${project.mentor}`, project.dueDate && `Due ${fmtDay(project.dueDate)}`].filter(Boolean).join(' · ')}</div>}
          <button type="button" className="ld-link" style={{ fontSize: 13 }} onClick={go('/learn/projects')}>Open →</button>
        </section>
        <section className="ld-card" aria-label="Feedback and policies">
          <div className="ld-hd"><b>Feedback &amp; policies</b></div>
          <div style={{ fontSize: 14 }}>{!feedbackWin ? 'Weekly feedback not open' : feedbackPending ? `Week of ${feedbackWin.weekKey} pending` : feedback.submitted && feedback.submitted.weekly ? 'This week submitted' : 'Next window opens Friday'}</div>
          <div className="ld-muted" style={{ fontSize: 13 }}>{policies.length ? `${policies.length - pendingPolicies.length} / ${policies.length} policies accepted` : 'No policies published yet'}</div>
          <button type="button" className="ld-link" style={{ fontSize: 13 }} onClick={go(pendingPolicies.length ? '/learn/policies' : '/learn/feedback')}>{pendingPolicies.length ? 'Accept policies →' : feedbackPending ? 'Fill now →' : 'Open →'}</button>
        </section>
        <section className="ld-card" aria-label="Notifications">
          <div className="ld-hd"><b>Notifications</b></div>
          <div style={{ fontSize: 14 }}>{notif.unread || 0} unread</div>
          <div className="ld-muted" style={{ fontSize: 13 }}>{latestNotif.length ? latestNotif.map((n) => n.title).join(' · ') : 'No notifications'}</div>
          <button type="button" className="ld-link" style={{ fontSize: 13 }} onClick={go('/learn/notifications')}>View all →</button>
        </section>
        <section className="ld-card" aria-label="Support requests">
          <div className="ld-hd"><b>Support requests</b></div>
          <div style={{ fontSize: 14 }}>{openTickets[0] ? `${openTickets[0].ticketNo} · ${openTickets[0].status}` : 'No open requests'}</div>
          {openTickets[0] && <div className="ld-muted" style={{ fontSize: 13 }}>{openTickets[0].subject}</div>}
          <button type="button" className="ld-link" style={{ fontSize: 13 }} onClick={go('/learn/support')}>{openTickets.length ? 'Track →' : 'Raise a request →'}</button>
        </section>
      </div>
    </div>
  );
}
