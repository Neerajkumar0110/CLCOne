import React, { useEffect, useState } from 'react';
import { Row, Col, Card, Table, Tag, Progress, Empty, Skeleton, Alert, Button } from 'antd';
import { VideoCameraOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import lmsApi from '../api';
import './StudentHome.css';

// Learner Home (design L3). Everything here is read from endpoints that
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
  if (!item.applicable) return <span className="sh-chip gray">N/A</span>;
  if (item.passed) return <span className="sh-chip ok">Done</span>;
  return <span className="sh-chip bad">{item.achieved} / {item.required}</span>;
}

export default function StudentDashboard() {
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);
  const [d, setD] = useState(null);
  const [ov, setOv] = useState(null);
  const [tickets, setTickets] = useState([]);
  const navigate = useNavigate();

  useEffect(() => {
    let alive = true;
    (async () => {
      // Each source is optional except the dashboard itself — a failure in
      // one (say tickets) just leaves its card empty instead of blanking Home.
      const [dash, overview, tk] = await Promise.allSettled([lmsApi.studentDashboard(), lmsApi.myOverview(), lmsApi.myTickets()]);
      if (!alive) return;
      if (dash.status !== 'fulfilled') setErr('Could not load your dashboard.');
      setD(settledResult(dash));
      setOv(settledResult(overview));
      setTickets((settledResult(tk) || {}).tickets || []);
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

  return (
    <div className="sh-root lms-portal lms-dashboard-shell">
      <div className="sh-head">
        <div>
          <h1>Namaste, {(d.student?.name || 'there').split(' ')[0]}</h1>
          <div className="sh-sub">{[course, batch].filter(Boolean).join(' · ') || 'Continue learning — your internships, classes and progress.'}</div>
        </div>
        {k.liveNow > 0 && (
          <Button type="primary" icon={<VideoCameraOutlined />} onClick={() => navigate('/learn/classes')}>
            Join live class
          </Button>
        )}
      </div>

      <div className="sh-grid-top">
        <section className="sh-card" aria-label="Overall eligibility">
          <div className="sh-card-hd">
            <b>Overall eligibility</b>
            {elig && <span className={`sh-chip ${elig.eligible ? 'ok' : 'warn'}`}>{elig.score}%</span>}
          </div>
          {elig ? (
            <>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
                <span className={`sh-big sh-status-big ${elig.eligible ? 'ok' : 'warn'}`}>{elig.eligible ? 'Eligible' : 'Not yet eligible'}</span>
                <span className="sh-muted" style={{ fontSize: 14 }}>
                  {doneGates} of {totalGates} done
                </span>
              </div>
              <div>
                {(elig.items || []).map((item) => (
                  <div className="sh-row" key={item.key}>
                    <span>{item.label}</span>
                    {gateChip(item)}
                  </div>
                ))}
              </div>
              <button type="button" className="sh-link" onClick={() => navigate('/learn/overview')}>
                Full breakdown →
              </button>
              <button
                type="button"
                className="sh-link"
                onClick={() =>
                  navigate('/learn/support', {
                    state: { raise: { category: 'Internship Content', subject: 'Eligibility calculation review', description: `My eligibility shows ${elig.score}%. What looks wrong:` } },
                  })
                }
              >
                Calculation galat lagi? Review request karein
              </button>
            </>
          ) : (
            <div className="sh-muted">No eligibility rule is set for your internship yet.</div>
          )}
        </section>

        <div className="sh-stack">
          <section className="sh-card" aria-label="Attendance">
            <div className="sh-card-hd">
              <b>Attendance</b>
            </div>
            <div className="sh-big">{att ? `${att.attendancePct}%` : '—'}</div>
            {att && (
              <>
                <div className="sh-muted">
                  {att.present + att.late} present · {att.partial} partial · {att.absent} absent · {att.totalClasses} classes
                </div>
                <div className="sh-bar" role="img" aria-label={`Attendance ${att.attendancePct}%`}>
                  <span style={{ width: `${Math.min(att.attendancePct, 100)}%` }} />
                </div>
              </>
            )}
            <button type="button" className="sh-link" onClick={() => navigate('/learn/attendance')}>
              Session-wise dekhein →
            </button>
          </section>

          <section className="sh-card" aria-label="Assessments">
            <div className="sh-card-hd">
              <b>Assessments</b>
            </div>
            {testTypes.length === 0 ? (
              <div className="sh-muted">No assessment unlocked yet.</div>
            ) : (
              <div>
                {testTypes.map((t) => {
                  const last = latestByType[t];
                  const a = attemptsByType[t];
                  return (
                    <div className="sh-row small" key={t}>
                      <span>{TEST_TYPE_LABELS[t] || t}</span>
                      {last ? (
                        <b>
                          {last.score}/{last.totalCount} · {last.qualified ? 'Qualified' : 'Not qualified'}
                        </b>
                      ) : (
                        <span className="sh-muted">
                          {a.remaining} attempt{a.remaining === 1 ? '' : 's'} left
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
            <button type="button" className="sh-link" onClick={() => navigate('/learn/results')}>
              My results →
            </button>
          </section>
        </div>

        <div className="sh-stack">
          <section className="sh-card" aria-label="Next actions">
            <div className="sh-card-hd">
              <b>Next actions</b>
              {actions.length > 0 && <span className="sh-chip info">{actions.length}</span>}
            </div>
            {actions.length === 0 ? (
              <div className="sh-muted">Sab up to date hai.</div>
            ) : (
              <div>
                {actions.slice(0, 6).map((a) => (
                  <button type="button" className="sh-action" key={a.key} onClick={() => navigate(a.to)}>
                    <span>{a.label}</span>
                    {a.tag && <span className="sh-chip bad">{a.tag}</span>}
                  </button>
                ))}
              </div>
            )}
          </section>
        </div>
      </div>

      <div className="sh-grid-four">
        <section className="sh-card" aria-label="Project">
          <div className="sh-card-hd">
            <b>Project</b>
            {project && <span className={`sh-chip ${project.status === 'approved' ? 'ok' : 'gray'}`}>{project.status}</span>}
          </div>
          <div style={{ fontSize: 14 }}>{project ? project.title : 'No project assigned yet'}</div>
          {project && <div className="sh-muted">{[project.mentor && `Mentor: ${project.mentor}`, project.dueDate && `Due ${fmtDay(project.dueDate)}`].filter(Boolean).join(' · ')}</div>}
          <button type="button" className="sh-link" onClick={() => navigate('/learn/projects')}>
            Open →
          </button>
        </section>

        <section className="sh-card" aria-label="Policies">
          <div className="sh-card-hd">
            <b>Policies</b>
            {policies.length > 0 && (
              <span className={`sh-chip ${pendingPolicies.length ? 'warn' : 'ok'}`}>{pendingPolicies.length ? `${pendingPolicies.length} pending` : 'Done'}</span>
            )}
          </div>
          <div style={{ fontSize: 14 }}>
            {policies.length ? `${policies.length - pendingPolicies.length} / ${policies.length} accepted` : 'No policies published yet'}
          </div>
          <button type="button" className="sh-link" onClick={() => navigate('/learn/policies')}>
            {pendingPolicies.length ? 'Accept now →' : 'View →'}
          </button>
        </section>

        <section className="sh-card" aria-label="Notifications">
          <div className="sh-card-hd">
            <b>Notifications</b>
            {notif.unread > 0 && <span className="sh-chip info">{notif.unread} unread</span>}
          </div>
          {latestNotif.length === 0 ? (
            <div className="sh-muted">No notifications</div>
          ) : (
            <div className="sh-muted">{latestNotif.map((n) => n.title).join(' · ')}</div>
          )}
          <button type="button" className="sh-link" onClick={() => navigate('/learn/notifications')}>
            View all →
          </button>
        </section>

        <section className="sh-card" aria-label="Support requests">
          <div className="sh-card-hd">
            <b>Support requests</b>
            {openTickets.length > 0 && <span className="sh-chip warn">{openTickets.length} open</span>}
          </div>
          <div style={{ fontSize: 14 }}>{openTickets[0] ? `${openTickets[0].ticketNo} · ${openTickets[0].status}` : 'No open requests'}</div>
          {openTickets[0] && <div className="sh-muted">{openTickets[0].subject}</div>}
          <button type="button" className="sh-link" onClick={() => navigate('/learn/support')}>
            {openTickets.length ? 'Track →' : 'Raise a request →'}
          </button>
        </section>
      </div>

      <Row gutter={[12, 12]}>
        <Col xs={24} lg={12}>
          <Card size="small" title="My internships" bordered>
            <Table
              size="small"
              rowKey={(r) => `${r.course}-${r.batch}`}
              dataSource={d.courses || []}
              pagination={false}
              locale={{ emptyText: 'No internships' }}
              columns={[
                { title: 'Internship', dataIndex: 'course' },
                { title: 'Batch', dataIndex: 'batch' },
                { title: 'Progress', dataIndex: 'progress', render: (v) => <Progress percent={v} size="small" style={{ width: 120 }} /> },
              ]}
            />
          </Card>
        </Col>
        <Col xs={24} lg={12}>
          <Card size="small" title="Upcoming & live classes" bordered>
            <Table
              size="small"
              rowKey="id"
              dataSource={[...(d.liveNow || []), ...(d.upcomingClasses || [])]}
              pagination={false}
              locale={{ emptyText: 'Nothing scheduled' }}
              columns={[
                { title: 'Class', dataIndex: 'title' },
                { title: 'Starts', dataIndex: 'scheduledStart', render: fmtTime },
                { title: 'Status', dataIndex: 'status', render: (s) => <Tag>{String(s || '').toUpperCase()}</Tag> },
              ]}
            />
          </Card>
        </Col>
      </Row>

      <Row gutter={[12, 12]}>
        <Col xs={24} lg={12}>
          <Card size="small" title="Latest recordings" bordered>
            <Table
              size="small"
              rowKey={(r) => `${r.className}-${r.publishedAt}`}
              dataSource={d.recordings || []}
              pagination={false}
              locale={{ emptyText: 'No recordings yet' }}
              columns={[
                {
                  title: 'Class',
                  render: (_, r) =>
                    [r.batch, r.date && new Date(r.date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })]
                      .filter(Boolean)
                      .join(' — ') || r.className,
                },
                { title: 'Internship', dataIndex: 'course' },
                { title: 'Min', dataIndex: 'durationMin', width: 60 },
              ]}
            />
          </Card>
        </Col>
        <Col xs={24} lg={12}>
          <Card size="small" title="My certificates" bordered>
            <Table
              size="small"
              rowKey={(r) => r.certificateId || r.course}
              dataSource={d.certificates || []}
              pagination={false}
              locale={{ emptyText: 'No certificates yet' }}
              columns={[
                { title: 'Internship', dataIndex: 'course' },
                { title: 'ID', dataIndex: 'certificateId' },
                { title: 'Status', dataIndex: 'status', render: (s) => <Tag>{s}</Tag> },
              ]}
            />
          </Card>
        </Col>
      </Row>
    </div>
  );
}
