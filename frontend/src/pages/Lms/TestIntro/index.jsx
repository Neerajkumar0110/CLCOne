import React, { useEffect, useState } from 'react';
import { Skeleton } from 'antd';
import {
  PlayCircleOutlined, FileDoneOutlined, LockOutlined, InfoCircleOutlined, QuestionCircleOutlined, ClockCircleOutlined, TrophyOutlined,
  RedoOutlined, VideoCameraOutlined, EyeOutlined, SafetyOutlined, HistoryOutlined, BarChartOutlined, CheckCircleFilled, CloseCircleFilled, ReadOutlined,
} from '@ant-design/icons';
import { useLocation, useNavigate } from 'react-router-dom';
import AssessmentRunner, { TIME_LIMITS } from './AssessmentRunner';
import lmsApi from '../api';
import '../components/LearnerDesign.css';
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
  if (t && t.lockReason === 'readiness') blockReason = t.lockMessage;
  else if (t && !t.unlocked) blockReason = `Unlocks when your batch reaches ${t.requiredPercent}% of the curriculum (now ${data.curriculumPercent || 0}%).`;
  else if (t && t.remaining === 0) blockReason = `You have used all ${t.max} attempts for this test.`;
  else if (coolingDown) blockReason = `Next attempt from ${fmtDay(t.nextEligibleAt)}.`;

  const mix = t && t.mix ? Object.entries(t.mix).filter(([, n]) => n > 0) : [];
  const totalQ = mix.reduce((s, [, n]) => s + n, 0);
  // per-question clocks of the runner, added up (board: "Time limit 30 min")
  const totalMin = Math.ceil(mix.reduce((s, [k, n]) => s + n * (TIME_LIMITS[k] ?? TIME_LIMITS.DEFAULT), 0) / 60);

  // design board L2 — eyebrow + title, 1fr | 420px: why/rules + attempt history | result
  // 2026-11-27: tidied — hero header, icon info tiles, compact fonts / sizes
  const leftN = t ? t.remaining : null;
  return (
    <div className="ld-page tix" style={{ padding: '24px 28px', gap: 18 }}>
      <div className="tix-hero">
        <div className="tix-hero-l">
          <span className="tix-hero-ic"><FileDoneOutlined /></span>
          <div style={{ minWidth: 0 }}>
            <span className="tix-eyebrow">{eyebrow}</span>
            <h1>{title}</h1>
            <p>{description}</p>
          </div>
        </div>
        <div className="tix-hero-r">
          <button type="button" className="tix-start" disabled={!!blockReason} onClick={() => setStarted(true)}>
            <PlayCircleOutlined /> {attempts.length ? 'Start next attempt' : 'Start test'}
          </button>
          {leftN != null && !blockReason && <small>{leftN} attempt{leftN === 1 ? '' : 's'} left</small>}
        </div>
      </div>
      {blockReason && <div className="tix-block"><LockOutlined /> {blockReason}</div>}

      <div className="tix-grid">
        <div className="tix-col">
          <section className="tix-card" aria-label="About this test">
            <div className="tix-hd"><span className="tix-hd-ic"><InfoCircleOutlined /></span><b>About this test</b></div>
            <div className="tix-tiles">
              <div className="tix-tile">
                <span className="tix-tile-ic q"><QuestionCircleOutlined /></span>
                <div><small>Questions</small><b>{totalQ || '—'}</b>{totalQ ? <span className="tix-mix">{mix.map(([k, n]) => <em key={k}>{n} {MIX_LABEL[k] || k}</em>)}</span> : <span className="tix-mix"><em>Project-style task</em></span>}</div>
              </div>
              <div className="tix-tile">
                <span className="tix-tile-ic t"><ClockCircleOutlined /></span>
                <div><small>Time limit</small><b>{totalQ ? `${totalMin} min` : '—'}</b></div>
              </div>
              <div className="tix-tile">
                <span className="tix-tile-ic p"><TrophyOutlined /></span>
                <div><small>Pass mark</small><b>{rules ? `${rules.qualifyPct}%` : '—'}</b></div>
              </div>
              <div className="tix-tile">
                <span className="tix-tile-ic a"><RedoOutlined /></span>
                <div><small>Attempts</small><b>{rules ? `${rules.maxAttempts}${t ? ` · ${t.remaining} left` : ''}` : '—'}</b>{rules && <span className="tix-mix"><em>{rules.cooldownDays}-day cooldown</em></span>}</div>
              </div>
            </div>
            <div className="tix-rules">
              <span><VideoCameraOutlined /> Camera stays on</span>
              <span><EyeOutlined /> Tab switches are logged (review signal only)</span>
              <span><SafetyOutlined /> A technical failure does not use up an attempt</span>
            </div>
          </section>

          <section className="tix-card" aria-label="Attempt history">
            <div className="tix-hd"><span className="tix-hd-ic"><HistoryOutlined /></span><b>Attempt history</b><span className="tix-count">{attempts.length}</span></div>
            {attempts.length === 0 ? (
              <div className="tix-empty">No attempts yet — your attempts will be listed here.</div>
            ) : (
              <div className="tix-tbl">
                <div className="tix-tr tix-th"><span>#</span><span>Started</span><span>Submitted</span><span>Score</span><span>Status</span></div>
                {attempts.map((a, i) => (
                  <div className="tix-tr" key={a.attemptId || i}>
                    <span className="tix-no">{attempts.length - i}</span>
                    <span>{fmt(a.startedAt)}</span>
                    <span>{fmt(a.submittedAt)}</span>
                    <span><b>{a.status === 'SUBMITTED' ? `${a.score} / ${a.totalCount}` : '—'}</b></span>
                    <span>{statusChip(a)}</span>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>

        <section className={`tix-card tix-result${latest ? (passed ? ' pass' : ' fail') : ''}`} aria-label="Result">
          <div className="tix-hd"><span className="tix-hd-ic"><BarChartOutlined /></span><b>Result</b></div>
          {!latest && (
            <div className="tix-res-empty">
              <span><BarChartOutlined /></span>
              <b>No result yet</b>
              <small>Your score shows here after you submit an attempt.</small>
            </div>
          )}
          {latest && passed && (
            <>
              <div className="tix-score pass"><CheckCircleFilled /><div><small>Passed</small><b>{latest.score} / {latest.totalCount}</b></div></div>
              <div className="tix-res-t">Well done — result saved</div>
              <small className="tix-res-s">Submitted {fmt(latest.submittedAt)} · saved to your record.</small>
              <button type="button" className="tix-start sm" onClick={() => navigate(`${base}/classes`)}>Go to live classes →</button>
              <button type="button" className="ld-link" style={{ fontSize: 13 }} onClick={() => navigate(`${base}/results`)}>See the full breakdown →</button>
            </>
          )}
          {latest && !passed && (
            <>
              <div className="tix-score fail"><CloseCircleFilled /><div><small>Not passed</small><b>{latest.score} / {latest.totalCount}</b></div></div>
              <div className="tix-res-t">{t && t.remaining === 0 ? 'No attempts left' : coolingDown ? `Next attempt from ${fmtDay(t.nextEligibleAt)}` : 'Next attempt available now'}</div>
              <small className="tix-res-s">Look at these first:</small>
              <div className="tix-links">
                <button type="button" onClick={() => navigate(`${base}/results`)}><BarChartOutlined /> Your topic-wise breakdown</button>
                <button type="button" onClick={() => navigate(`${base}/material`)}><ReadOutlined /> Study material for this unit</button>
                <button type="button" onClick={() => navigate(`${base}/recordings`)}><VideoCameraOutlined /> Class recordings</button>
              </div>
              {base === '/learn' && (
                <button type="button" className="ld-link" style={{ fontSize: 13 }} onClick={() => navigate('/learn/support', { state: { raise: { category: 'Login / Technical', subject: `Technical problem during ${title}`, description: 'Date / time of the attempt:\nWhat happened:' } } })}>
                  Exception / technical issue? Raise a ticket
                </button>
              )}
            </>
          )}
        </section>
      </div>
    </div>
  );
}
