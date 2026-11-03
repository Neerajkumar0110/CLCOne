import React, { useEffect, useState } from 'react';
import { Button, Skeleton } from 'antd';
import { PlayCircleOutlined, FormOutlined } from '@ant-design/icons';
import { useLocation, useNavigate } from 'react-router-dom';
import AssessmentRunner from './AssessmentRunner';
import lmsApi from '../api';
import '../StudentDashboard/StudentHome.css';
import './testIntro.css';

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
  if (a.status === 'SUBMITTED') return a.qualified ? <span className="sh-chip ok">Passed</span> : <span className="sh-chip bad">Not passed</span>;
  if (a.status === 'SUSPENDED') return <span className="sh-chip warn">Suspended</span>;
  if (a.status === 'IN_PROGRESS') return <span className="sh-chip info">In progress</span>;
  return <span className="sh-chip gray">{String(a.status || '').replace(/_/g, ' ').toLowerCase()}</span>;
}

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
    return <AssessmentRunner testType={testType} onExit={() => setStarted(false)} />;
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

  return (
    <div className="sh-root lms-portal">
      <div className="sh-head">
        <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
          <div className="ti-icon" aria-hidden="true">
            {icon || <FormOutlined />}
          </div>
          <div>
            <div className="sh-muted" style={{ fontWeight: 700, letterSpacing: '0.06em', fontSize: 12, textTransform: 'uppercase' }}>
              {eyebrow}
            </div>
            <h1>{title}</h1>
          </div>
        </div>
        <Button type="primary" size="large" icon={<PlayCircleOutlined />} disabled={!!blockReason} onClick={() => setStarted(true)}>
          {attempts.length ? 'Start next attempt' : 'Start Test'}
        </Button>
      </div>

      <div className="ti-grid">
        <div className="sh-stack">
          <section className="sh-card" aria-label="About this test">
            <div className="sh-card-hd">
              <b>Test kyun?</b>
            </div>
            <div style={{ fontSize: 14, lineHeight: '22px' }}>{description}</div>
            <div className="ti-facts">
              <div>
                <div className="sh-muted">Questions</div>
                <b>{totalQ ? `${totalQ} · ${mix.map(([k, n]) => `${n} ${MIX_LABEL[k] || k}`).join(' · ')}` : 'Project-style task'}</b>
              </div>
              <div>
                <div className="sh-muted">Pass mark</div>
                <b>{rules ? `${rules.qualifyPct}%` : '—'}</b>
              </div>
              <div>
                <div className="sh-muted">Attempts</div>
                <b>{t ? `${t.remaining} of ${t.max} left` : rules ? `${rules.maxAttempts}` : '—'}</b>
              </div>
              <div>
                <div className="sh-muted">Cooldown</div>
                <b>{rules ? `${rules.cooldownDays} day${rules.cooldownDays === 1 ? '' : 's'} between attempts` : '—'}</b>
              </div>
            </div>
            <div className="ti-note">
              Proctored — camera, microphone and screen sharing stay on and the test runs in fullscreen. Tab switches are logged as a
              review signal only. A technical failure doesn&apos;t use up an attempt — raise a ticket if it happens.
            </div>
            {blockReason && <div className="sh-chip warn ti-block">{blockReason}</div>}
          </section>

          <section className="sh-card" aria-label="Attempt history">
            <div className="sh-card-hd">
              <b>Attempt history</b>
            </div>
            {attempts.length === 0 ? (
              <div className="sh-muted">No attempts yet.</div>
            ) : (
              <div className="ti-table-wrap">
                <table className="ti-table">
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>Started</th>
                      <th>Submitted</th>
                      <th>Score</th>
                      <th>Status</th>
                    </tr>
                  </thead>
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

        <section className={`sh-card ti-result ${latest ? (passed ? 'ok' : 'bad') : ''}`} aria-label="Result">
          <div className="sh-card-hd">
            <b>Result</b>
          </div>
          {!latest && <div className="sh-muted">Your result will show here after you submit an attempt.</div>}
          {latest && passed && (
            <>
              <span className="sh-chip ok" style={{ alignSelf: 'flex-start' }}>
                Passed · {latest.score} / {latest.totalCount}
              </span>
              <div className="sh-big">Well done!</div>
              <div className="sh-muted" style={{ fontSize: 14 }}>
                Submitted {fmt(latest.submittedAt)}. Your result is saved on your record.
              </div>
              <button type="button" className="sh-link" onClick={() => navigate(`${base}/results`)}>
                See full breakdown →
              </button>
              <button type="button" className="sh-link" onClick={() => navigate(`${base}/classes`)}>
                Go to live classes →
              </button>
            </>
          )}
          {latest && !passed && (
            <>
              <span className="sh-chip bad" style={{ alignSelf: 'flex-start' }}>
                Not passed · {latest.score} / {latest.totalCount}
              </span>
              <div className="sh-big">
                {t && t.remaining === 0 ? 'No attempts left' : coolingDown ? `Agla attempt: ${fmtDay(t.nextEligibleAt)} se` : 'Next attempt available now'}
              </div>
              <div className="ti-remedy">
                <b>Remediation — pehle ye dekhein</b>
                <button type="button" className="sh-link" onClick={() => navigate(`${base}/results`)}>
                  Your topic-wise breakdown
                </button>
                <button type="button" className="sh-link" onClick={() => navigate(`${base}/material`)}>
                  Study material for this unit
                </button>
                <button type="button" className="sh-link" onClick={() => navigate(`${base}/recordings`)}>
                  Class recordings
                </button>
              </div>
              {base === '/learn' && (
                <button
                  type="button"
                  className="sh-link"
                  onClick={() =>
                    navigate('/learn/support', {
                      state: { raise: { category: 'Login / Technical', subject: `Technical problem during ${title}`, description: 'Date / time of the attempt:\nWhat happened:' } },
                    })
                  }
                >
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
