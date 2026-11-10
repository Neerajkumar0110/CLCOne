import React, { lazy, useState } from 'react';
import { Alert } from 'antd';
import { useNavigate } from 'react-router-dom';
import lmsApi from '../api';
import { PMPage, PMTabs, Legacy, Loading, useLoad, useTab, res, BatchSelect } from './shared';

const Roster = lazy(() => import('../TeacherStudents'));

// P9 — candidates of one of my batches, every number with its meaning:
// today's classes held/scheduled, last class joined/enrolled, latest test
// attempted/eligible, at-risk; table with classes attended/scheduled,
// attendance %, tests qualified, project, feedback and "View profile"
// (→ Learner 360). The old contact roster stays on its own tab.

const STATUS = { Active: 'hai', 'On Hold': 'adh', Dropped: 'gray', Completed: 'naya', Deferred: 'adh' };

function Board() {
  const navigate = useNavigate();
  const [batch, setBatch] = useState('');
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const { data, loading, error } = useLoad(async () => res(await lmsApi.pmCandidates(batch ? { batch } : {})), [batch]);
  if (loading && !data) return <Loading />;
  if (error) return <Alert type="error" showIcon message={error} />;
  if (!data.batch) return <section className="ld-card"><div className="ld-empty">Aapko abhi koi batch assign nahi hai.</div></section>;
  const k = data.kpis || {};
  const rows = data.rows.filter((r) => (!status || r.status === status) && (!q || `${r.name} ${r.enrollmentId} ${r.email}`.toLowerCase().includes(q.toLowerCase())));
  const statuses = [...new Set(data.rows.map((r) => r.status))];
  const enrolled = data.rows.filter((r) => r.status !== 'Dropped').length;

  return (
    <>
      <div className="ld-hd" style={{ marginTop: -6 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <h1>Candidates · {data.batch} ({enrolled})</h1>
          <div className="ld-muted" style={{ fontSize: 14 }}>Sirf aapke assigned batches · har number ka matlab saath mein likha hai</div>
        </div>
        <BatchSelect batches={data.batches} value={data.batch} onChange={setBatch} />
      </div>
      <div className="pm-g4" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 12 }}>
        <div className="pm-k"><span className="cap">Today's classes</span><b>{k.today ? `${k.today.held} / ${k.today.scheduled}` : '—'}</b><div className="pm-tip">held / scheduled today{k.today && k.today.scheduled > k.today.held ? ` · ${k.today.scheduled - k.today.held} abhi baaki` : ''}</div></div>
        <div className="pm-k"><span className="cap">Attendance · last class</span><b>{k.lastClass ? `${k.lastClass.joined} / ${k.lastClass.enrolled}` : '—'}</b><div className="pm-tip">joined / enrolled (Dropped excluded){k.lastClass ? ` · ${k.lastClass.title}` : ''}</div></div>
        <div className="pm-k"><span className="cap">Class progress{k.test ? ` · ${k.test.label}` : ''}</span><b>{k.test ? `${k.test.pct}%` : '—'}</b><div className="pm-tip">attempted / eligible learners for the latest test</div></div>
        <div className="pm-k"><span className="cap">At risk</span><b style={{ color: k.atRisk ? '#991b1b' : undefined }}>{k.atRisk}</b><div className="pm-tip">attendance &lt; 80% ya project overdue · signal only</div></div>
      </div>
      <section className="ld-card" style={{ flex: 1 }} aria-label="Candidates">
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <input className="ld-inp" style={{ width: 240 }} placeholder="Search name / ID" aria-label="Search" value={q} onChange={(e) => setQ(e.target.value)} />
          <select className="ld-inp" aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All statuses</option>
            {statuses.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <span className="ld-muted" style={{ fontSize: 12, marginLeft: 'auto' }}>Column header par hover = definition</span>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table className="ld-table">
            <thead>
              <tr>
                <th>Candidate</th>
                <th>Status</th>
                <th title="Live classes attended / held since the learner's first class in this batch">Classes<br /><span style={{ fontWeight: 400, fontSize: 11 }}>attended / scheduled</span></th>
                <th title="Average % of each class attended (time-weighted) — the number eligibility uses">Attendance %</th>
                <th title="Test types qualified / test types this batch has taken">Tests qualified</th>
                <th title="Current milestone of the learner's project">Project</th>
                <th title="Weekly feedback forms submitted vs weeks the batch submitted">Feedback</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && <tr><td colSpan={8} className="ld-muted">Koi candidate nahi mila.</td></tr>}
              {rows.map((r) =>
                r.status === 'Dropped' ? (
                  <tr key={r.email}>
                    <td className="ld-muted"><b>{r.name}</b><br />{r.enrollmentId}</td>
                    <td><span className="ld-chip gray">Dropped</span></td>
                    <td className="ld-muted" colSpan={5}>Dropped — attendance denominator se bahar</td>
                    <td />
                  </tr>
                ) : (
                  <tr key={r.email}>
                    <td><b>{r.name}</b><br /><span className="ld-muted">{r.enrollmentId}</span></td>
                    <td><span className={`ld-chip ${STATUS[r.status] || 'gray'}`}>{r.status}</span></td>
                    <td>{r.classes.attended} / {r.classes.scheduled}</td>
                    <td style={{ color: r.attendancePct < 60 ? '#991b1b' : r.attendancePct < 80 ? '#9a3412' : undefined }}>{r.attendancePct}%</td>
                    <td>{r.tests.of ? `${r.tests.qualified} / ${r.tests.of}` : '—'}</td>
                    <td style={{ color: r.projectOverdue ? '#991b1b' : undefined }}>{r.project}</td>
                    <td>{r.feedback}</td>
                    <td><button type="button" className="ld-btn2 sm" onClick={() => navigate(`/teacher/learner-360?email=${encodeURIComponent(r.email)}`)}>View profile</button></td>
                  </tr>
                )
              )}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}

export default function PMCandidates() {
  const [tab, setTab] = useTab('board');
  return (
    <PMPage title="" right={<PMTabs tabs={[['board', 'Candidates'], ['roster', 'Contact roster']]} value={tab} onChange={setTab} />}>
      {tab === 'board' ? <Board /> : <Legacy><Roster /></Legacy>}
    </PMPage>
  );
}
