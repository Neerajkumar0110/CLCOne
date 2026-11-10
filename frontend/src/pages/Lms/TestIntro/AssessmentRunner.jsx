import React, { useEffect, useRef, useState } from 'react';
import { Button, Typography, Alert, Spin, Result } from 'antd';
import { LeftOutlined, RightOutlined, PlayCircleOutlined, ClockCircleOutlined, CheckCircleFilled } from '@ant-design/icons';
import lmsApi from '@/pages/Lms/api';
import AssessmentProctorGate from './AssessmentProctorGate';
import useAssessmentProctor from './useAssessmentProctor';
import './assessmentRunner.css';

const { Paragraph } = Typography;
const TYPE_LABELS = { MCQ: 'Multiple choice', OUTPUT_BASED: 'Predict the output', PROGRAMMING: 'Programming' };

// Ported from python-test-platform's frontend/components/TestRunner.tsx
// (Next.js/Tailwind -> this app's React Router/antd). Same phase machine
// (gate/loading/testing/suspended/result/error), same per-question countdown
// and proctoring rules. PROGRAMMING questions use a plain textarea, matching
// the reference (it doesn't use a code-editor library either).
export const TIME_LIMITS = { MCQ: 45, OUTPUT_BASED: 60, PROGRAMMING: 210, DEFAULT: 60 };
const TEST_TYPE_LABELS = { BASIC: 'Basic', MAJOR: 'Major', MICRO: 'Micro', NLP_MICRO: 'NLP Micro', NLP_MAJOR: 'NLP Major', LLM_MAJOR: 'LLM Major' };

export default function AssessmentRunner({ testType, title, onExit }) {
  const [phase, setPhase] = useState('gate'); // gate | loading | testing | suspended | result | error
  const [error, setError] = useState('');
  const [attemptId, setAttemptId] = useState(null);
  const [questions, setQuestions] = useState([]);
  const [current, setCurrent] = useState(0);
  const [answers, setAnswers] = useState({});
  const [code, setCode] = useState({});
  const [runResults, setRunResults] = useState({});
  const [running, setRunning] = useState({});
  const [result, setResult] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [lastWarning, setLastWarning] = useState(null);
  const [timeLeft, setTimeLeft] = useState({});
  const [meta, setMeta] = useState({}); // attemptNumber / maxAttempts / passPct / cooldownDays
  const streamsRef = useRef(null);
  const camRef = useRef(null);

  const { warningCount } = useAssessmentProctor(attemptId, {
    onSuspended: () => {
      stopAllMedia();
      setPhase('suspended');
    },
    onWarning: (count) => setLastWarning(count),
  });

  function stopAllMedia() {
    streamsRef.current?.cameraStream.getTracks().forEach((t) => t.stop());
    streamsRef.current?.screenStream.getTracks().forEach((t) => t.stop());
    streamsRef.current = null;
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  }

  useEffect(() => () => stopAllMedia(), []);

  // the proctoring camera, shown live in the side card (board L11)
  useEffect(() => {
    const v = camRef.current;
    const s = streamsRef.current && streamsRef.current.cameraStream;
    if (phase === 'testing' && v && s && v.srcObject !== s) v.srcObject = s;
  });

  useEffect(() => {
    if (lastWarning === null) return undefined;
    const t = setTimeout(() => setLastWarning(null), 4000);
    return () => clearTimeout(t);
  }, [lastWarning]);

  // Per-question countdown: ticks down the active question's time, auto-advances
  // (or submits on the last question) when it hits zero.
  useEffect(() => {
    if (phase !== 'testing' || questions.length === 0) return undefined;
    const activeQ = questions[current];
    if (!activeQ) return undefined;
    const id = activeQ.attemptQuestionId;

    const interval = setInterval(() => {
      setTimeLeft((prev) => {
        const remaining = (prev[id] ?? 0) - 1;
        if (remaining <= 0) {
          clearInterval(interval);
          if (current === questions.length - 1) {
            handleSubmit();
          } else {
            setCurrent((c) => Math.min(questions.length - 1, c + 1));
          }
          return { ...prev, [id]: 0 };
        }
        return { ...prev, [id]: remaining };
      });
    }, 1000);

    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, current, questions]);

  async function beginTest(streams) {
    streamsRef.current = streams;
    setPhase('loading');
    try {
      const res = await lmsApi.startAssessment(testType);
      const data = res && res.result;
      if (!data) {
        stopAllMedia();
        setError((res && res.message) || 'Something went wrong.');
        setPhase('error');
        lmsApi.reportAssessmentGateIssue({ testType, step: 'start', error: (res && res.message) || 'no result' });
        return;
      }
      setAttemptId(data.attemptId);
      setQuestions(data.questions);
      setMeta({ attemptNumber: data.attemptNumber, maxAttempts: data.maxAttempts, passPct: data.passPct, cooldownDays: data.cooldownDays });

      const initialCode = {};
      const initialTime = {};
      data.questions.forEach((q) => {
        if (q.questionType === 'PROGRAMMING') initialCode[q.attemptQuestionId] = q.starterCode || '';
        initialTime[q.attemptQuestionId] = TIME_LIMITS[q.questionType] ?? TIME_LIMITS.DEFAULT;
      });
      setCode(initialCode);
      setTimeLeft(initialTime);
      setPhase('testing');
    } catch (err) {
      stopAllMedia();
      setError('Something went wrong.');
      setPhase('error');
      lmsApi.reportAssessmentGateIssue({ testType, step: 'start', error: (err && err.message) || 'request failed' });
    }
  }

  function selectAnswer(attemptQuestionId, optionIndex) {
    setAnswers((prev) => ({ ...prev, [attemptQuestionId]: optionIndex }));
  }

  function updateCode(attemptQuestionId, value) {
    setCode((prev) => ({ ...prev, [attemptQuestionId]: value }));
  }

  async function handleRunCode(attemptQuestionId) {
    setRunning((prev) => ({ ...prev, [attemptQuestionId]: true }));
    setRunResults((prev) => {
      const next = { ...prev };
      delete next[attemptQuestionId];
      return next;
    });
    try {
      const res = await lmsApi.runAssessmentCode(code[attemptQuestionId] ?? '');
      const data = (res && res.result) || { output: '', error: (res && res.message) || 'Something went wrong.', success: false };
      setRunResults((prev) => ({ ...prev, [attemptQuestionId]: data }));
    } catch (err) {
      setRunResults((prev) => ({
        ...prev,
        [attemptQuestionId]: { output: '', error: 'Something went wrong.', success: false },
      }));
    } finally {
      setRunning((prev) => ({ ...prev, [attemptQuestionId]: false }));
    }
  }

  async function handleSubmit() {
    if (!attemptId) return;
    setSubmitting(true);
    setError('');

    const payload = {
      answers: questions.map((q) => {
        if (q.questionType === 'PROGRAMMING') {
          return { attemptQuestionId: q.attemptQuestionId, submittedCode: code[q.attemptQuestionId] ?? '' };
        }
        return { attemptQuestionId: q.attemptQuestionId, selectedOption: answers[q.attemptQuestionId] ?? null };
      }),
    };

    try {
      const res = await lmsApi.submitAssessment(attemptId, payload);
      const data = res && res.result;
      if (!data) {
        setError((res && res.message) || 'Something went wrong.');
        return;
      }
      stopAllMedia();
      setResult({ score: data.score, gradableTotal: data.gradableTotal });
      setPhase('result');
    } catch (err) {
      setError('Something went wrong.');
    } finally {
      setSubmitting(false);
    }
  }

  if (phase === 'gate') {
    return <AssessmentProctorGate testType={testType} onReady={beginTest} />;
  }

  if (phase === 'loading') {
    return (
      <div className="lms-portal" style={{ padding: 48, textAlign: 'center' }}>
        <Spin size="large" />
        <Paragraph type="secondary" style={{ marginTop: 16 }}>Preparing your assessment...</Paragraph>
      </div>
    );
  }

  if (phase === 'error') {
    return (
      <div className="lms-portal" style={{ padding: 4 }}>
        <Result status="error" title="Couldn't start this test" subTitle={error} extra={<Button onClick={onExit}>Back</Button>} />
      </div>
    );
  }

  if (phase === 'suspended') {
    return (
      <div className="lms-portal" style={{ padding: 4 }}>
        <Result
          status="warning"
          title="Test Suspended"
          subTitle="Your test was automatically suspended after 3 proctoring warnings. Please contact your project manager."
          extra={<Button type="primary" onClick={onExit}>Back</Button>}
        />
      </div>
    );
  }

  if (phase === 'result' && result) {
    return (
      <div className="lms-portal" style={{ padding: 4 }}>
        <Result
          status="success"
          title={`${result.score} / ${result.gradableTotal}`}
          subTitle="Your test has been submitted and scored."
          extra={<Button type="primary" onClick={onExit}>Back</Button>}
        />
      </div>
    );
  }

  const q = questions[current];
  if (!q) return null;
  const isLast = current === questions.length - 1;
  const isProgramming = q.questionType === 'PROGRAMMING';
  const runResult = runResults[q.attemptQuestionId];
  const isRunning = running[q.attemptQuestionId];
  const secondsLeft = timeLeft[q.attemptQuestionId] ?? 0;

  const limit = TIME_LIMITS[q.questionType] ?? TIME_LIMITS.DEFAULT;
  const urgent = secondsLeft <= 10;
  const answeredCount = questions.filter((x) =>
    x.questionType === 'PROGRAMMING' ? (code[x.attemptQuestionId] ?? '').trim() && (code[x.attemptQuestionId] ?? '') !== (x.starterCode || '') : answers[x.attemptQuestionId] != null
  ).length;
  const selected = answers[q.attemptQuestionId];

  const isAnswered = (x) =>
    x.questionType === 'PROGRAMMING' ? !!(code[x.attemptQuestionId] ?? '').trim() && (code[x.attemptQuestionId] ?? '') !== (x.starterCode || '') : answers[x.attemptQuestionId] != null;
  const mmss = `${String(Math.floor(secondsLeft / 60)).padStart(2, '0')}:${String(secondsLeft % 60).padStart(2, '0')}`;

  // design board L11 — full-screen: white bar (chip · title · attempt · topic | timer),
  // progress line, question card | camera + question palette
  return (
    <div className="ar-wrap ar-l11">
      <header className="ar-bar64">
        <div className="ar-bar64-l">
          <span className="ld-chip naya">{TEST_TYPE_LABELS[testType] || testType} test</span>
          <b>{title || `${TEST_TYPE_LABELS[testType] || testType} test`}{meta.attemptNumber ? ` · Attempt ${meta.attemptNumber}${meta.maxAttempts ? ` of ${meta.maxAttempts}` : ''}` : ''}</b>
          {q.topic && <span className="ar-topic" title={q.topic}>· {q.topic}</span>}
        </div>
        <div className="ar-bar64-r">
          {warningCount > 0 && <span className="ar-warn">Warnings {warningCount}/3</span>}
          <span className={`ar-timer${urgent ? ' urgent' : ''}`} title="Time left for this question">
            <ClockCircleOutlined /> {mmss} left
          </span>
        </div>
      </header>
      <div className="ar-line"><div style={{ width: `${(answeredCount / questions.length) * 100}%` }} /></div>

      {lastWarning !== null && (
        <Alert type="error" showIcon banner message={`Warning ${lastWarning}/3 — proctoring violation detected`} className="ar-alert" />
      )}

      <div className="ar-body">
        <div className="ar-main">
        <div className="ar-card">
          <div className="ar-qhead">
            <span className="ar-qno">QUESTION {current + 1} OF {questions.length}</span>
            <span className="ld-chip gray">{q.questionType === 'MCQ' ? 'MCQ' : TYPE_LABELS[q.questionType] || q.questionType}</span>
            <span className="ar-answered">{answeredCount} answered</span>
          </div>
          <span className="ar-qtime"><span style={{ width: `${Math.max(0, Math.min(100, (secondsLeft / limit) * 100))}%` }} className={urgent ? 'urgent' : ''} /></span>
          {(() => {
            // "What does this print?\n\n<code>" — the part after the first blank line is a code snippet
            const text = String(q.text || '');
            const cut = text.indexOf('\n\n');
            const head = cut > 0 ? text.slice(0, cut) : text;
            const snippet = cut > 0 ? text.slice(cut + 2).replace(/^\n+|\s+$/g, '') : '';
            return (
              <>
                <div className="ar-qtext">{head}</div>
                {snippet && <pre className="ar-snippet">{snippet}</pre>}
              </>
            );
          })()}

          {isProgramming ? (
            <div className="ar-code">
              <div className="ar-label">Python code</div>
              <textarea
                className="ar-editor"
                value={code[q.attemptQuestionId] ?? ''}
                onChange={(e) => updateCode(q.attemptQuestionId, e.target.value)}
                spellCheck={false}
              />
              <Button icon={<PlayCircleOutlined />} loading={isRunning} onClick={() => handleRunCode(q.attemptQuestionId)} className="ar-run">
                Run code
              </Button>
              {runResult && (
                <div className="ar-output">
                  <div className="ar-label">Output</div>
                  <pre className={runResult.error ? 'err' : ''}>{runResult.error ? runResult.error : runResult.output || '(no output)'}</pre>
                </div>
              )}
            </div>
          ) : (
            <div className="ar-options" role="radiogroup">
              {(q.options || []).map((opt, i) => (
                <button
                  key={i}
                  type="button"
                  role="radio"
                  aria-checked={selected === i}
                  className={`ar-option${selected === i ? ' on' : ''}`}
                  onClick={() => selectAnswer(q.attemptQuestionId, i)}
                >
                  <span className="ar-letter">{String.fromCharCode(65 + i)}</span>
                  <span className="ar-opt-text">{opt}</span>
                  {selected === i && <CheckCircleFilled className="ar-check" />}
                </button>
              ))}
            </div>
          )}

          {error && <Alert type="error" showIcon message={error} className="ar-alert" />}

          <div className="ar-nav">
            <button type="button" className="ld-btn2 ar-navbtn" disabled={current === 0} onClick={() => setCurrent((c) => Math.max(0, c - 1))}>
              <LeftOutlined /> Previous
            </button>
            {isLast ? (
              <button type="button" className="ld-btn ar-navbtn" disabled={submitting} onClick={handleSubmit}>
                {submitting ? 'Submitting…' : 'Submit test'}
              </button>
            ) : (
              <button type="button" className="ld-btn ar-navbtn" onClick={() => setCurrent((c) => Math.min(questions.length - 1, c + 1))}>
                Next <RightOutlined />
              </button>
            )}
          </div>
        </div>
        </div>

        <aside className="ar-side">
          <section className="ar-scard" aria-label="Proctoring">
            <div className="ar-cam">
              <video ref={camRef} autoPlay muted playsInline />
              <span>Camera · proctoring on</span>
            </div>
            <div className="ar-kv"><span>Proctoring warnings</span><b>{warningCount}/3</b></div>
            <div className="ld-muted" style={{ fontSize: 12, lineHeight: '17px' }}>Switching tabs, leaving full screen or turning the camera off is a warning — after 3 warnings the test is suspended.</div>
          </section>
          <section className="ar-scard" aria-label="Questions">
            <b style={{ fontSize: 14 }}>Questions</b>
            <div className="ar-pal">
              {questions.map((x, i) => (
                <button
                  key={x.attemptQuestionId}
                  type="button"
                  className={`ar-num${i === current ? ' cur' : isAnswered(x) ? ' ans' : ''}`}
                  aria-label={`Question ${i + 1}${isAnswered(x) ? ', answered' : ''}`}
                  aria-current={i === current ? 'step' : undefined}
                  onClick={() => setCurrent(i)}
                >
                  {i + 1}
                </button>
              ))}
            </div>
            {meta.maxAttempts ? (
              <div className="ld-muted" style={{ fontSize: 12 }}>
                Rules: {questions.length} questions · pass {meta.passPct}% · {meta.maxAttempts} attempts{meta.cooldownDays ? ` · ${meta.cooldownDays} din cooldown` : ''}
              </div>
            ) : null}
          </section>
        </aside>
      </div>
    </div>
  );
}
