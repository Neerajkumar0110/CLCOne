import React, { lazy, useState } from 'react';
import { Alert, message } from 'antd';
import { useNavigate } from 'react-router-dom';
import lmsApi from '../api';
import { PMPage, useLoad, Loading, Legacy, res, fmtTime, shortName, errText } from './shared';
import DuplicateClassesAlert from '../components/DuplicateClassesAlert';

const OldDashboard = lazy(() => import('../TeacherDashboard'));

// P1 — Project Manager dashboard: 6 KPIs, today's classes (with the
// recording-off warning), review queue, at-risk learners and a quick
// announcement. Everything comes from existing endpoints plus the PM board
// endpoints (pmAssess / pmCurriculum / pmAnnounce).

const greet = () => {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
};
const LIVE = ['live', 'starting'];
const OVER = ['ended', 'recording_processing', 'recording_available', 'cancelled'];
const minsTo = (v) => Math.round((new Date(v).getTime() - Date.now()) / 60000);
const statusOf = (c) => String(c.status || c.lifecycle || '').toLowerCase();

export default function PMDashboard() {
  const navigate = useNavigate();
  const [note, setNote] = useState('');
  const [sending, setSending] = useState(false);
  const [charts, setCharts] = useState(false);
  const { data, loading, error } = useLoad(async () => {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const end = new Date(start.getTime() + 86400000 - 1);
    const [dash, today, projects, doubts, fb, assess, cur] = await Promise.all([
      lmsApi.teacherDashboard(),
      lmsApi.liveClassesRange(start.toISOString(), end.toISOString()).catch(() => null),
      lmsApi.teacherProjects().catch(() => null),
      lmsApi.doubts().catch(() => null),
      lmsApi.feedbackMySummary().catch(() => null),
      lmsApi.pmAssess().catch(() => null),
      lmsApi.pmCurriculum().catch(() => null),
    ]);
    return { dash: res(dash) || {}, today: res(today) || [], projects: res(projects) || [], doubts: res(doubts) || [], fb: res(fb), assess: res(assess), cur: res(cur) };
  }, []);

  if (loading) return <Loading />;
  if (error) return <Alert type="error" showIcon message={error} style={{ margin: 24 }} />;
  const { dash, today, projects, doubts, fb, assess, cur } = data;
  const k = dash.kpis || {};
  const batches = dash.batches || [];
  const classes = today.filter((c) => c.myRole !== 'student').sort((a, b) => new Date(a.scheduledStart) - new Date(b.scheduledStart));
  const upcoming = classes.filter((c) => !OVER.includes(statusOf(c)));
  const now = new Date();
  const queue = projects
    .filter((p) => ['submitted', 'in_review'].includes(p.status) || (p.status === 'revision_requested' && p.currentVersion > 1))
    .map((p) => ({ ...p, late: p.dueDate && new Date(p.dueDate) < now ? Math.floor((now - new Date(p.dueDate)) / 86400000) : 0 }));
  const toVerify = ((assess && assess.tests) || []).filter((t) => t.attempted > 0 && (!t.verified || new Date(t.verified.at) < new Date(t.lastActivity)));
  const openDoubts = doubts.filter((d) => d.status === 'open').length;
  const overall = fb && (fb.categories || []).find((c) => /overall/i.test(c.label));
  const fbWeek = fb && fb.latestWeek;
  const atRisk = dash.atRiskStudents || [];
  const lastDelivered = cur && (cur.rows || []).filter((r) => r.state === 'DELIVERED').slice(-1)[0];

  const sendNote = async () => {
    if (note.trim().length < 5) return message.warning('Write the announcement (at least 5 characters).');
    setSending(true);
    try {
      const r = await lmsApi.pmAnnounce({ text: note.trim() });
      if (r && r.success === false) throw new Error(r.message);
      message.success((r && r.message) || 'Sent to Ops.');
      setNote('');
    } catch (e) {
      message.error(errText(e, 'Could not send.'));
    } finally {
      setSending(false);
    }
  };

  const batchLine = batches
    .slice(0, 3)
    .map((b) => `${b.name}${b.classTime ? ` ${b.classTime}${b.endTime ? `–${b.endTime}` : ''}` : ''}`)
    .join(', ');

  return (
    <PMPage
      title={`${greet()}, ${(dash.teacher && dash.teacher.name) || 'Project Manager'}`}
      right={<button type="button" className="ld-link" style={{ fontSize: 13 }} onClick={() => setCharts(!charts)}>{charts ? 'Hide charts & tables' : 'Charts & tables →'}</button>}
      sub={`Project Manager · ${batches.length} batch${batches.length === 1 ? '' : 'es'}${batchLine ? ` (${batchLine}${batches.length > 3 ? ', …' : ''})` : ''} · ${k.totalStudents || 0} learners`}
    >
      <DuplicateClassesAlert load={lmsApi.pmDuplicates} request={lmsApi.pmDuplicateRequest} />
      <div className="pm-g6" style={{ display: 'grid', gridTemplateColumns: 'repeat(6, minmax(0, 1fr))', gap: 12 }}>
        <div className="ld-k"><b>{classes.length}</b><span>Classes today</span></div>
        <div className="ld-k"><b style={{ color: queue.length ? '#9a3412' : undefined }}>{queue.length}</b><span>Project reviews pending</span></div>
        <div className="ld-k"><b>{toVerify.length}</b><span>Result report to verify</span></div>
        <div className="ld-k"><b style={{ color: atRisk.length ? '#991b1b' : undefined }}>{atRisk.length}</b><span>At-risk learners</span></div>
        <div className="ld-k"><b>{openDoubts}</b><span>Open doubts</span></div>
        <div className="ld-k">
          <b>{overall && overall.avg != null ? overall.avg : '—'}{overall && overall.avg != null && <span style={{ fontSize: 14, color: '#475569' }}>/5</span>}</b>
          <span>My feedback{fbWeek ? ` (${fbWeek})` : ''}</span>
        </div>
      </div>

      <div className="pm-g" style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr 1fr', gap: 14, flex: 1, minHeight: 0 }}>
        <section className="ld-card" aria-label="Today's classes">
          <div className="ld-hd"><b>Today's classes</b><button type="button" className="ld-link" style={{ fontSize: 13 }} onClick={() => navigate('/teacher/classes?tab=all')}>All classes →</button></div>
          {classes.length === 0 && <div className="ld-empty">No class scheduled today.</div>}
          {classes.map((c, i) => {
            const st = statusOf(c);
            const live = LIVE.includes(st);
            const over = OVER.includes(st);
            const next = !over && upcoming[0] === c;
            const recOn = !(c.recording && c.recording.enabled === false);
            const m = minsTo(c.scheduledStart);
            const chip = live ? <span className="ld-chip red">LIVE NOW</span> : over ? <span className="ld-chip gray">{st === 'cancelled' ? 'CANCELLED' : 'ENDED'}</span> : m <= 60 && m > 0 ? <span className="ld-chip red">LIVE IN {m} MIN</span> : <span className="ld-chip gray">{fmtTime(c.scheduledStart)}</span>;
            return (
              <div key={c.id || i} className={`pm-cls${next || live ? ' next' : ''}`}>
                <div className="ld-hd"><b style={{ fontSize: 15 }}>{c.title}</b>{chip}</div>
                {(next || live) && (
                  <div className="ld-muted" style={{ fontSize: 13 }}>
                    {c.batchName} · {fmtTime(c.scheduledStart)}–{fmtTime(c.scheduledEnd)} · {c.participantCount || 0} joined · recording{' '}
                    <b style={{ color: recOn ? '#166534' : '#991b1b' }}>{recOn ? 'ON' : 'OFF'}</b>
                  </div>
                )}
                {!recOn && !over && <div style={{ fontSize: 13, color: '#991b1b', fontWeight: 600 }}>Recording is OFF — turn it ON before the class (OPS-02)</div>}
                {(next || live) && (
                  <button type="button" className="ld-btn" style={{ alignSelf: 'flex-start' }} onClick={() => navigate(`/teacher/classes?class=${c.id}`)}>
                    {live ? 'Open class' : 'Start class'}
                  </button>
                )}
                {!next && !live && !over && (
                  <button type="button" className="ld-link" style={{ fontSize: 13, alignSelf: 'flex-start' }} onClick={() => navigate(`/teacher/classes?class=${c.id}`)}>Pre-class checklist →</button>
                )}
              </div>
            );
          })}
          <div className="ld-li" style={{ marginTop: 'auto' }}>
            <span>Planned topic vs delivered{cur && cur.batch ? ` (${cur.batch})` : ''}</span>
            <button type="button" className="ld-link" onClick={() => navigate('/teacher/curriculum')}>{lastDelivered ? `${lastDelivered.code} delivered ✓` : 'Open tracker'}</button>
          </div>
        </section>

        <section className="ld-card" aria-label="Review queue">
          <div className="ld-hd"><b>Review queue</b><button type="button" className="ld-link" style={{ fontSize: 13 }} onClick={() => navigate('/teacher/projects')}>Open →</button></div>
          {queue.length === 0 && <div className="ld-empty">No submission pending review.</div>}
          {queue.slice(0, 6).map((p) => (
            <div className="ld-li" key={p.id}>
              <button type="button" className="ld-link" style={{ color: '#0f172a' }} onClick={() => navigate(`/teacher/projects?review=${p.id}`)}>
                {shortName(p.student)} · {p.title}
              </button>
              {p.late ? <span className="ld-chip red">{p.late} day{p.late > 1 ? 's' : ''} late</span> : p.currentVersion > 1 ? <span className="ld-chip adh">resubmit</span> : <span className="ld-chip naya">v{p.currentVersion || 1}</span>}
            </div>
          ))}
          {toVerify.length > 0 && (
            <div className="ld-li" style={{ marginTop: 'auto' }}>
              <span>{toVerify[0].label} · {assess.batch}</span>
              <button type="button" className="ld-link" onClick={() => navigate('/teacher/assessment-dashboard')}>Verify report →</button>
            </div>
          )}
        </section>

        <section className="ld-card" aria-label="At-risk learners">
          <div className="ld-hd"><b>At-risk learners</b><span className="ld-muted" style={{ fontSize: 12 }}>{atRisk.length} learners</span></div>
          {atRisk.length === 0 && <div className="ld-empty">No at-risk learner right now.</div>}
          {atRisk.slice(0, 5).map((s) => (
            <div className="ld-li" key={s.email || s.name}>
              <button type="button" className="ld-link" onClick={() => navigate(`/teacher/learner-360?email=${encodeURIComponent(s.email || '')}`)}>{s.name}</button>
              <span className="ld-muted">{s.attendancePct}% attendance · {s.progress}% progress</span>
            </div>
          ))}
          <div className="ld-muted" style={{ fontSize: 12 }}>A signal, not a decision — follow up with the Support Manager</div>
          <div className="ld-hd" style={{ marginTop: 'auto' }}><b>Quick announcement</b><span className="ld-chip adh">OPS APPROVAL</span></div>
          <input className="ld-inp" aria-label="Announcement" placeholder="Tomorrow's class starts 15 min early" value={note} onChange={(e) => setNote(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && sendNote()} />
          <button type="button" className="ld-btn2 sm" style={{ alignSelf: 'flex-start' }} disabled={sending || !note.trim()} onClick={sendNote}>{sending ? 'Sending…' : 'Send for approval'}</button>
        </section>
      </div>
      {charts && <Legacy><OldDashboard /></Legacy>}
    </PMPage>
  );
}
