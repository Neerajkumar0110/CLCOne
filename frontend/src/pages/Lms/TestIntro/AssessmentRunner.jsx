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
const TIME_LIMITS = { MCQ: 45, OUTPUT_BASED: 60, PROGRAMMING: 210, DEFAULT: 60 };
const TEST_TYPE_LABELS = { BASIC: 'Basic', MAJOR: 'Major', MICRO: 'Micro', NLP_MICRO: 'NLP Micro', NLP_MAJOR: 'NLP Major', LLM_MAJOR: 'LLM Major' };

export default function AssessmentRunner({ testType, onExit }) {
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
  const streamsRef = useRef(null);

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
        return;
      }
      setAttemptId(data.attemptId);
      setQuestions(data.questions);

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
    return <AssessmentProctorGate onReady={beginTest} />;
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

  return (
    <div className="lms-portal ar-wrap">
      <div className="ar-shell">
        {lastWarning !== null && (
          <Alert type="error" showIcon banner message={`Warning ${lastWarning}/3 — proctoring violation detected`} className="ar-alert" />
        )}

        <div className="ar-top">
          <div className="ar-top-left">
            <span className="ar-test">{TEST_TYPE_LABELS[testType] || testType}</span>
            <span className="ar-topic" title={q.topic}>{q.topic}</span>
          </div>
          <div className="ar-top-right">
            {warningCount > 0 && <span className="ar-warn">Warnings {warningCount}/3</span>}
            <span className={`ar-timer${urgent ? ' urgent' : ''}`} title="Time left for this question">
              <ClockCircleOutlined />
              {Math.floor(secondsLeft / 60)}:{String(secondsLeft % 60).padStart(2, '0')}
            </span>
          </div>
        </div>

        <div className="ar-progress">
          <div className="ar-progress-meta">
            <span>Question <b>{current + 1}</b> of {questions.length}</span>
            <span>{answeredCount} answered</span>
          </div>
          <div className="ar-bar"><div style={{ width: `${((current + 1) / questions.length) * 100}%` }} /></div>
        </div>

        <div className="ar-card">
          <div className="ar-qhead">
            <span className={`ar-type t-${q.questionType.toLowerCase()}`}>{TYPE_LABELS[q.questionType] || q.questionType}</span>
            <span className="ar-qtime"><span style={{ width: `${Math.max(0, Math.min(100, (secondsLeft / limit) * 100))}%` }} className={urgent ? 'urgent' : ''} /></span>
          </div>
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
        </div>

        {error && <Alert type="error" showIcon message={error} className="ar-alert" />}

        <div className="ar-nav">
          <Button size="large" icon={<LeftOutlined />} disabled={current === 0} onClick={() => setCurrent((c) => Math.max(0, c - 1))}>
            Previous
          </Button>
          {isLast ? (
            <Button size="large" type="primary" loading={submitting} onClick={handleSubmit} className="ar-primary">
              Submit test
            </Button>
          ) : (
            <Button size="large" type="primary" onClick={() => setCurrent((c) => Math.min(questions.length - 1, c + 1))} className="ar-primary">
              Next <RightOutlined />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
