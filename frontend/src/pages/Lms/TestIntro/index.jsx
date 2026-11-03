import React, { useEffect, useState } from 'react';
import { Skeleton } from 'antd';
import { PlayCircleOutlined } from '@ant-design/icons';
import { useLocation, useNavigate } from 'react-router-dom';
import AssessmentRunner, { TIME_LIMITS } from './AssessmentRunner';
import lmsApi from '../api';
import '../components/LearnerDesign.css';

/**
 * Landing page for one test type (design L2 "readiness" layout, used by every
 * test): why / what the test is, the rules the learner is held to (from
 * GET /assessments/my-results — pass %, attempts, cooldown, question mix),
 * their attempt history and what to do next after the latest result.
 * "Start Test" moves into the proctored attempt flow (AssessmentRunner) —
 * same as before; it is only disabled when the server would refuse anyway
 * (locked, no attempts left, still cooling down).
 */

const fmt = (v) => (v ? new Date(v).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : '—');
const fmtDay = (v) => (v ? new Date(v).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '');
const MIX_LABEL = { MCQ: 'MCQ', OUTPUT_BASED: 'output-based', PROGRAMMING: 'programming' };

function statusChip(a) {
  if (a.status === 'SUBMITTED') return a.qualified ? <span className="ld-chip hai">Passed</span> : <span className="ld-chip red">Not passed</span>;
  if (a.status === 'SUSPENDED') return <span className="ld-chip adh">Suspended</span>;
  if (a.status === 'IN_PROGRESS') return <span className="ld-chip naya">In progress</span>;
  return <span className="ld-chip gray">{String(a.status || '').replace(/_/g, ' ').toLowerCase()}</span>;
}

// `icon` is still passed by the nav entries; the board layout doesn't show it.
// eslint-disable-next-line no-unused-vars
export default function TestIntro({ icon, eyebrow, title, description, testType }) {
  const [started, setStarted] = useState(false);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const base = pathname.startsWith('/teacher') ? '/teacher' : '/learn';

  useEffect(() => {
    if (started) return undefined;
    let alive = true;
    setLoading(true);
    lmsApi
      .myAssessmentResults()
      .then((r) => alive && setData((r && r.success !== false && r.result) || null))
      .catch(() => alive && setData(null))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [started]);

  if (started) {
    return <AssessmentRunner testType={testType} title={title} onExit={() => setStarted(false)} />;
  }
  if (loading) return <Skeleton active paragraph={{ rows: 6 }} style={{ padding: 24 }} />;

  const rules = (data && data.rules) || null;
  const t = (data && data.attemptsByType && data.attemptsByType[testType]) || null;
  const attempts = ((data && data.results) || []).filter((a) => a.testType === testType);
  const latest = attempts.find((a) => a.status === 'SUBMITTED');
  const passed = !!(latest && latest.qualified);
  const coolingDown = t && t.nextEligibleAt && new Date(t.nextEligibleAt) > new Date();

  let blockReason = null;
  if (t && !t.unlocked) blockReason = `Unlocks when your batch reaches ${t.requiredPercent}% of the curriculum (now ${data.curriculumPercent || 0}%).`;
  else if (t && t.remaining === 0) blockReason = `You have used all ${t.max} attempts for this test.`;
  else if (coolingDown) blockReason = `Next attempt from ${fmtDay(t.nextEligibleAt)}.`;

  const mix = t && t.mix ? Object.entries(t.mix).filter(([, n]) => n > 0) : [];
  const totalQ = mix.reduce((s, [, n]) => s + n, 0);
  // per-question clocks of the runner, added up (board: "Time limit 30 min")
  const totalMin = Math.ceil(mix.reduce((s, [k, n]) => s + n * (TIME_LIMITS[k] ?? TIME_LIMITS.DEFAULT), 0) / 60);

  // design board L2 — eyebrow + title, 1fr | 460px: why/rules + attempt history | result
  return (
    <div className="ld-page" style={{ padding: '32px 36px', gap: 20 }}>
      <div className="ld-head">
        <div style={{ gap: 6 }}>
          <div className="ld-eyebrow">{eyebrow}</div>
          <h1 style={{ fontSize: 30 }}>{title}</h1>
        </div>
        <button type="button" className="ld-btn" disabled={!!blockReason} onClick={() => setStarted(true)}>
          <PlayCircleOutlined /> {attempts.length ? 'Start next attempt' : 'Start Test'}
        </button>
      </div>

      <div className="ld-grid" style={{ gridTemplateColumns: 'minmax(0, 1fr) 460px', gap: 20, flex: 1 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <section className="ld-card p20" aria-label="About this test" style={{ gap: 14 }}>
            <b style={{ fontSize: 16 }}>Test kyun?</b>
            <div className="ld-muted" style={{ fontSize: 14, lineHeight: '21px' }}>{description}</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 10 }}>
              <div className="ld-kv"><span className="ld-muted">Questions</span><b>{totalQ ? `${totalQ} · ${mix.map(([k, n]) => `${n} ${MIX_LABEL[k] || k}`).join(' · ')}` : 'Project-style task'}</b></div>
              <div className="ld-kv"><span className="ld-muted">Time limit</span><b>{totalQ ? `${totalMin} min` : '—'}</b></div>
              <div className="ld-kv"><span className="ld-muted">Pass mark</span><b>{rules ? `${rules.qualifyPct}%` : '—'}</b></div>
              <div className="ld-kv"><span className="ld-muted">Attempts / cooldown</span><b>{rules ? `${rules.maxAttempts} · ${rules.cooldownDays} din${t ? ` · ${t.remaining} left` : ''}` : '—'}</b></div>
            </div>
            <div className="ld-muted" style={{ fontSize: 13 }}>Camera on rahega · tab switch log hota hai (sirf review signal) · technical failure par attempt count nahi hoga.</div>
            {blockReason && <span className="ld-chip adh" style={{ alignSelf: 'flex-start', height: 'auto', padding: '4px 10px', whiteSpace: 'normal' }}>{blockReason}</span>}
          </section>

          <section className="ld-card p20" aria-label="Attempt history">
            <b style={{ fontSize: 16 }}>Attempt history</b>
            {attempts.length === 0 ? (
              <div className="ld-empty">No attempts yet.</div>
            ) : (
              <div className="ld-tablewrap">
                <table className="ld-table">
                  <thead><tr><th>#</th><th>Started</th><th>Submitted</th><th>Score</th><th>Status</th></tr></thead>
                  <tbody>
                    {attempts.map((a, i) => (
                      <tr key={a.attemptId || i}>
                        <td>{attempts.length - i}</td>
                        <td>{fmt(a.startedAt)}</td>
                        <td>{fmt(a.submittedAt)}</td>
                        <td>{a.status === 'SUBMITTED' ? `${a.score} / ${a.totalCount}` : '—'}</td>
                        <td>{statusChip(a)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>

        <section className="ld-card p20" aria-label="Result" style={{ gap: 16 }}>
          <b style={{ fontSize: 16 }}>Result</b>
          {!latest && <div className="ld-muted" style={{ fontSize: 14 }}>Your result will show here after you submit an attempt.</div>}
          {latest && passed && (
            <>
              <span className="ld-chip hai lg">Passed · {latest.score} / {latest.totalCount}</span>
              <div style={{ fontSize: 22, fontWeight: 700 }}>Well done — result saved</div>
              <div className="ld-muted" style={{ fontSize: 14, lineHeight: '21px' }}>Submitted {fmt(latest.submittedAt)}. Server ne aapka result record par save kar liya hai.</div>
              <button type="button" className="ld-btn" style={{ alignSelf: 'flex-start' }} onClick={() => navigate(`${base}/classes`)}>Live class par jaayein →</button>
              <button type="button" className="ld-link" style={{ fontSize: 14 }} onClick={() => navigate(`${base}/results`)}>See full breakdown →</button>
            </>
          )}
          {latest && !passed && (
            <>
              <span className="ld-chip red lg">Not passed · {latest.score} / {latest.totalCount}</span>
              <div style={{ fontSize: 20, fontWeight: 700 }}>{t && t.remaining === 0 ? 'No attempts left' : coolingDown ? `Agla attempt: ${fmtDay(t.nextEligibleAt)} se` : 'Next attempt available now'}</div>
              <div style={{ fontSize: 14, fontWeight: 600 }}>Remediation — pehle ye dekhein</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 14 }}>
                <button type="button" className="ld-link" onClick={() => navigate(`${base}/results`)}>Your topic-wise breakdown</button>
                <button type="button" className="ld-link" onClick={() => navigate(`${base}/material`)}>Study material for this unit</button>
                <button type="button" className="ld-link" onClick={() => navigate(`${base}/recordings`)}>Class recordings</button>
              </div>
              {base === '/learn' && (
                <button type="button" className="ld-link" style={{ fontSize: 14 }} onClick={() => navigate('/learn/support', { state: { raise: { category: 'Login / Technical', subject: `Technical problem during ${title}`, description: 'Date / time of the attempt:\nWhat happened:' } } })}>
                  Exception / technical issue? Ticket raise karein
                </button>
              )}
            </>
          )}
        </section>
      </div>
    </div>
  );
}
