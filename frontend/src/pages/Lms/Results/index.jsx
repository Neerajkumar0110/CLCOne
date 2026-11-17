import React, { useEffect, useMemo, useState } from 'react';
import { Skeleton } from 'antd';
import {
  LineChartOutlined, TrophyOutlined, FileDoneOutlined, RiseOutlined, FundOutlined, LockOutlined,
  CheckCircleFilled, CloseCircleFilled, ClockCircleOutlined, CalendarOutlined, WarningOutlined,
  DownOutlined, UpOutlined, EyeOutlined, StopOutlined, HourglassOutlined, CodeOutlined,
  RobotOutlined, ExperimentOutlined, ReadOutlined, BulbOutlined,
} from '@ant-design/icons';
import lmsApi from '@/pages/Lms/api';
import MyAttemptReview from './MyAttemptReview';

// My Results (/learn/results) — every test the learner has taken: a summary
// row, one card per test (best score, attempts used, qualified or not, next
// attempt), and the attempt history where each attempt opens its review —
// topic-wise result and every question they got wrong (MyAttemptReview).
// Wired to GET /api/lms/assessments/my-results and
// GET /api/lms/assessments/:attemptId/breakdown.

const TESTS = {
  BASIC: { label: 'Basic Test', icon: <ReadOutlined /> },
  MAJOR: { label: 'Major Test', icon: <CodeOutlined /> },
  MICRO: { label: 'Micro Test', icon: <ExperimentOutlined /> },
  NLP_MICRO: { label: 'NLP Micro Test', icon: <ExperimentOutlined /> },
  NLP_MAJOR: { label: 'NLP Major Test', icon: <BulbOutlined /> },
  LLM_MAJOR: { label: 'LLM Major Test', icon: <RobotOutlined /> },
};
const ORDER = ['BASIC', 'MAJOR', 'MICRO', 'NLP_MAJOR', 'NLP_MICRO', 'LLM_MAJOR'];
const label = (t) => (TESTS[t] && TESTS[t].label) || t;
const icon = (t) => (TESTS[t] && TESTS[t].icon) || <FileDoneOutlined />;
const pctOf = (a) => (a.status === 'SUBMITTED' && a.totalCount ? Math.round((a.score / a.totalCount) * 100) : null);
const tone = (p, pass) => (p === null ? 'none' : p >= pass ? 'good' : p >= pass - 20 ? 'mid' : 'low');
const day = (d) => (d ? new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');
const time = (d) => (d ? new Date(d).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' }) : '');
const took = (a, b) => {
  if (!a || !b) return null;
  const m = Math.round((new Date(b) - new Date(a)) / 60000);
  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m} min`;
};

function Ring({ p, size = 'md', tone: t }) {
  return (
    <span className={`rs-ring ${size} ${t}`} style={{ '--p': p || 0 }}>
      <i>{p === null || p === undefined ? '—' : `${p}%`}</i>
    </span>
  );
}

export default function Results() {
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState([]);
  const [byType, setByType] = useState({});
  const [rules, setRules] = useState({ qualifyPct: 90, maxAttempts: 3, cooldownDays: 0 });
  const [filter, setFilter] = useState('');
  const [open, setOpen] = useState(null);
  const [reviews, setReviews] = useState({}); // attemptId -> { loading, data }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await lmsApi.myAssessmentResults();
      if (cancelled) return;
      const data = (res && res.result) || {};
      setRows(data.results || []);
      setByType(data.attemptsByType || {});
      if (data.rules) setRules(data.rules);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, []);

  const loadReview = async (attemptId) => {
    if (reviews[attemptId]) return;
    setReviews((prev) => ({ ...prev, [attemptId]: { loading: true, data: null } }));
    const res = await lmsApi.assessmentBreakdown(attemptId);
    // { breakdown, review: { counts, mistakes, answersUnlocked, lockedReason } }
    setReviews((prev) => ({ ...prev, [attemptId]: { loading: false, data: (res && res.result) || null } }));
  };
  const toggle = (a) => {
    const next = open === a.attemptId ? null : a.attemptId;
    setOpen(next);
    if (next) loadReview(a.attemptId);
  };

  const pass = rules.qualifyPct || 90;

  // attempt number per test, oldest = 1
  const attempts = useMemo(() => {
    const seen = {};
    return rows
      .slice()
      .sort((x, y) => new Date(x.startedAt) - new Date(y.startedAt))
      .map((a) => {
        seen[a.testType] = (seen[a.testType] || 0) + 1;
        return { ...a, n: seen[a.testType], pct: pctOf(a) };
      })
      .reverse();
  }, [rows]);

  const tests = useMemo(() => {
    const types = ORDER.filter((t) => attempts.some((a) => a.testType === t) || (byType[t] && byType[t].unlocked));
    Object.keys(byType).forEach((t) => !types.includes(t) && attempts.some((a) => a.testType === t) && types.push(t));
    return types.map((t) => {
      const mine = attempts.filter((a) => a.testType === t);
      const done = mine.filter((a) => a.status === 'SUBMITTED');
      const best = done.reduce((b, a) => (a.pct > (b ? b.pct : -1) ? a : b), null);
      return { type: t, info: byType[t] || {}, mine, best, qualified: mine.some((a) => a.qualified === true) };
    });
  }, [attempts, byType]);

  const submitted = attempts.filter((a) => a.status === 'SUBMITTED');
  const kpi = {
    taken: submitted.length,
    qualified: tests.filter((t) => t.qualified).length,
    best: submitted.length ? Math.max(...submitted.map((a) => a.pct)) : null,
    avg: submitted.length ? Math.round(submitted.reduce((s, a) => s + a.pct, 0) / submitted.length) : null,
  };
  const shown = filter ? attempts.filter((a) => a.testType === filter) : attempts;

  if (loading) return <div className="rs"><Skeleton active paragraph={{ rows: 10 }} /></div>;

  return (
    <div className="rs">
      <header className="rs-hero">
        <span className="rs-hicon"><LineChartOutlined /></span>
        <div className="rs-htext">
          <h2>My Test Results</h2>
          <p>Every test you have taken, your score and the questions to go over.</p>
        </div>
        <div className="rs-rules">
          <span><TrophyOutlined /> Pass mark <b>{pass}%</b></span>
          <span><FileDoneOutlined /> <b>{rules.maxAttempts}</b> attempts per test</span>
          {rules.cooldownDays ? <span><HourglassOutlined /> <b>{`${rules.cooldownDays}-day`}</b> gap between attempts</span> : null}
        </div>
      </header>

      <div className="rs-kpis">
        <div className="rs-kpi blue"><span className="rs-kicon"><FileDoneOutlined /></span><div><b>{kpi.taken}</b><span>Tests taken</span></div></div>
        <div className="rs-kpi green"><span className="rs-kicon"><TrophyOutlined /></span><div><b>{kpi.qualified}<small>/{tests.length || 0}</small></b><span>Tests qualified</span></div></div>
        <div className="rs-kpi purple"><span className="rs-kicon"><RiseOutlined /></span><div><b>{kpi.best === null ? '—' : `${kpi.best}%`}</b><span>Best score</span></div></div>
        <div className="rs-kpi amber"><span className="rs-kicon"><FundOutlined /></span><div><b>{kpi.avg === null ? '—' : `${kpi.avg}%`}</b><span>Average score</span></div></div>
      </div>

      {tests.length > 0 && (
        <section>
          <div className="rs-sechead"><b>Your tests</b><span>Best score and attempts for each test</span></div>
          <div className="rs-tests">
            {tests.map(({ type, info, mine, best, qualified }) => {
              const locked = info.unlocked === false && !mine.length;
              const used = info.used !== undefined ? info.used : mine.length;
              const max = info.max || rules.maxAttempts;
              const state = locked ? 'locked' : qualified ? 'pass' : mine.length ? (info.remaining === 0 ? 'out' : 'retry') : 'new';
              const chip = {
                locked: [<LockOutlined key="i" />, 'Locked'],
                pass: [<CheckCircleFilled key="i" />, 'Qualified'],
                out: [<StopOutlined key="i" />, 'No attempts left'],
                retry: [<ClockCircleOutlined key="i" />, 'Not qualified yet'],
                new: [<FileDoneOutlined key="i" />, 'Not taken yet'],
              }[state];
              const closed = mine.filter((a) => ['SUBMITTED', 'SUSPENDED'].includes(a.status)).slice().reverse();
              return (
                <button
                  key={type}
                  type="button"
                  className={`rs-test ${state}${filter === type ? ' on' : ''}`}
                  onClick={() => setFilter(filter === type ? '' : type)}
                  disabled={!mine.length}
                  title={mine.length ? `Show only ${label(type)} attempts` : undefined}
                >
                  <div className="rs-ttop">
                    <span className="rs-ticon">{icon(type)}</span>
                    <b>{label(type)}</b>
                    <span className={`rs-chip ${state}`}>{chip[0]} {chip[1]}</span>
                  </div>
                  {locked ? (
                    <p className="rs-tnote">{info.lockReason === 'readiness' ? info.lockMessage : `Opens at ${info.requiredPercent}% of the course delivered.`}</p>
                  ) : (
                    <div className="rs-tbody">
                      <Ring p={best ? best.pct : null} tone={tone(best ? best.pct : null, pass)} />
                      <div className="rs-tfacts">
                        <span>Best score <b>{best ? `${best.score}/${best.totalCount}` : '—'}</b></span>
                        <span className="rs-dots" aria-label={`${used} of ${max} attempts used`}>
                          {Array.from({ length: max }).map((_, i) => {
                            const a = closed[i];
                            const cls = !a ? 'empty' : a.status === 'SUSPENDED' ? 'stop' : a.qualified ? 'pass' : 'fail';
                            return <i key={i} className={cls} title={a ? `Attempt ${i + 1}: ${a.status === 'SUSPENDED' ? 'suspended' : `${a.pct}%`}` : `Attempt ${i + 1}: not used`} />;
                          })}
                          <em>{used}/{max} attempts</em>
                        </span>
                        {!qualified && info.nextEligibleAt && <span className="rs-next"><CalendarOutlined /> Next attempt {day(info.nextEligibleAt)}</span>}
                        {!qualified && !info.nextEligibleAt && info.remaining > 0 && mine.length > 0 && <span className="rs-next ok"><CheckCircleFilled /> Next attempt available now</span>}
                      </div>
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        </section>
      )}

      <section>
        <div className="rs-sechead">
          <b>Attempt history</b>
          <span>{filter ? `${label(filter)} only` : 'Newest first'} · open an attempt to review your answers</span>
          {filter && <button type="button" className="rs-clear" onClick={() => setFilter('')}>Show all tests</button>}
        </div>

        {shown.length === 0 ? (
          <div className="rs-empty"><FileDoneOutlined /><b>No tests taken yet</b><span>Your results will show here after your first test.</span></div>
        ) : (
          <div className="rs-attempts">
            {shown.map((a) => {
              const t = tone(a.pct, pass);
              const isOpen = open === a.attemptId;
              const canOpen = a.status === 'SUBMITTED' || a.status === 'SUSPENDED';
              const rv = reviews[a.attemptId];
              return (
                <article key={a.attemptId} className={`rs-att ${t}${isOpen ? ' open' : ''}`}>
                  <div className="rs-arow">
                    <span className="rs-aicon">{icon(a.testType)}</span>
                    <div className="rs-amain">
                      <div className="rs-atitle">
                        <b>{label(a.testType)}</b>
                        <span className="rs-anum">Attempt {a.n}</span>
                        {a.status === 'SUBMITTED' && a.qualified !== null && (
                          <span className={`rs-chip ${a.qualified ? 'pass' : 'retry'}`}>
                            {a.qualified ? <><CheckCircleFilled /> Qualified</> : <><CloseCircleFilled /> Not qualified</>}
                          </span>
                        )}
                        {a.status === 'SUSPENDED' && <span className="rs-chip out"><StopOutlined /> Suspended</span>}
                        {a.status === 'IN_PROGRESS' && <span className="rs-chip retry"><ClockCircleOutlined /> In progress</span>}
                      </div>
                      <div className="rs-ameta">
                        <span><CalendarOutlined /> {day(a.startedAt)}, {time(a.startedAt)}</span>
                        {took(a.startedAt, a.submittedAt) && <span><ClockCircleOutlined /> {took(a.startedAt, a.submittedAt)}</span>}
                        {a.warningCount > 0 && <span className="warn"><WarningOutlined /> {a.warningCount} warning{a.warningCount === 1 ? '' : 's'}</span>}
                      </div>
                    </div>
                    <div className="rs-ascore">
                      {a.pct !== null ? (
                        <>
                          <div className="rs-anums"><b>{a.score}</b><small>/{a.totalCount}</small><span className={`rs-apct ${t}`}>{a.pct}%</span></div>
                          <div className="rs-abar" title={`Pass mark ${pass}%`}>
                            <i style={{ width: `${a.pct}%` }} />
                            <em style={{ left: `${pass}%` }} />
                          </div>
                          <span className="rs-acount"><CheckCircleFilled /> {a.score} correct · <CloseCircleFilled /> {a.totalCount - a.score} not correct</span>
                        </>
                      ) : <span className="rs-acount">No score</span>}
                    </div>
                    {canOpen && (
                      <button type="button" className={`rs-open${isOpen ? ' on' : ''}`} aria-expanded={isOpen} onClick={() => toggle(a)}>
                        {isOpen ? <>Hide <UpOutlined /></> : <><EyeOutlined /> Review answers <DownOutlined /></>}
                      </button>
                    )}
                  </div>
                  {isOpen && (
                    <div className="rs-review">
                      <MyAttemptReview data={rv && rv.data} loading={!rv || rv.loading} />
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
