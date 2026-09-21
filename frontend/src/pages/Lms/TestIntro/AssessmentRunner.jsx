import React, { useEffect, useRef, useState } from 'react';
import { Card, Button, Radio, Space, Typography, Alert, Spin, Result } from 'antd';
import { LeftOutlined, RightOutlined, PlayCircleOutlined } from '@ant-design/icons';
import lmsApi from '@/pages/Lms/api';
import AssessmentProctorGate from './AssessmentProctorGate';
import useAssessmentProctor from './useAssessmentProctor';

const { Text, Paragraph } = Typography;

// Ported from python-test-platform's frontend/components/TestRunner.tsx
// (Next.js/Tailwind -> this app's React Router/antd). Same phase machine
// (gate/loading/testing/suspended/result/error), same per-question countdown
// and proctoring rules. PROGRAMMING questions use a plain textarea, matching
// the reference (it doesn't use a code-editor library either).
const TIME_LIMITS = { MCQ: 45, OUTPUT_BASED: 60, PROGRAMMING: 210, DEFAULT: 60 };
const TEST_TYPE_LABELS = { BASIC: 'Basic', MAJOR: 'Major', MICRO: 'Micro', NLP_MICRO: 'NLP Micro', NLP_MAJOR: 'NLP Major' };

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
          subTitle="Your test was automatically suspended after 3 proctoring warnings. Please contact your instructor."
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

  return (
    <div className="lms-portal" style={{ padding: 4, display: 'flex', justifyContent: 'center' }}>
      <div style={{ maxWidth: 720, width: '100%' }}>
        {lastWarning !== null && (
          <Alert
            type="error"
            showIcon
            banner
            message={`Warning ${lastWarning}/3 — proctoring violation detected`}
            style={{ marginBottom: 12 }}
          />
        )}

        <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', gap: 8, marginBottom: 12 }}>
          <Text type="secondary" style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5 }}>
            {TEST_TYPE_LABELS[testType] || testType} — {q.topic}
          </Text>
          <Space size="middle">
            {warningCount > 0 && <Text type="danger" style={{ fontSize: 12, fontWeight: 600 }}>Warnings: {warningCount}/3</Text>}
            <Text style={{ fontFamily: 'monospace', fontWeight: 600 }} type={secondsLeft <= 10 ? 'danger' : 'secondary'}>
              {Math.floor(secondsLeft / 60)}:{String(secondsLeft % 60).padStart(2, '0')}
            </Text>
            <Text type="secondary" style={{ fontSize: 13 }}>Question {current + 1} of {questions.length}</Text>
          </Space>
        </div>

        <Card style={{ marginBottom: 16 }}>
          <Paragraph style={{ fontSize: 15, whiteSpace: 'pre-wrap', marginBottom: 20 }}>{q.text}</Paragraph>

          {isProgramming ? (
            <div>
              <Text type="secondary" style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', display: 'block', marginBottom: 8 }}>
                Python Code
              </Text>
              <textarea
                value={code[q.attemptQuestionId] ?? ''}
                onChange={(e) => updateCode(q.attemptQuestionId, e.target.value)}
                spellCheck={false}
                style={{
                  width: '100%',
                  height: 220,
                  background: '#0b1120',
                  color: '#e5e7eb',
                  border: '1px solid #23262f',
                  borderRadius: 8,
                  padding: 12,
                  fontFamily: 'monospace',
                  fontSize: 13,
                  resize: 'vertical',
                }}
              />
              <Button icon={<PlayCircleOutlined />} loading={isRunning} onClick={() => handleRunCode(q.attemptQuestionId)} style={{ marginTop: 10 }}>
                Run Code
              </Button>
              {runResult && (
                <div style={{ marginTop: 12 }}>
                  <Text type="secondary" style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', display: 'block', marginBottom: 6 }}>
                    Output
                  </Text>
                  <pre
                    style={{
                      background: '#000',
                      color: runResult.error ? '#f87171' : '#e5e7eb',
                      borderRadius: 8,
                      padding: 12,
                      fontFamily: 'monospace',
                      fontSize: 12,
                      whiteSpace: 'pre-wrap',
                      overflowX: 'auto',
                      margin: 0,
                    }}
                  >
                    {runResult.error ? runResult.error : runResult.output || '(no output)'}
                  </pre>
                </div>
              )}
            </div>
          ) : (
            <Radio.Group
              value={answers[q.attemptQuestionId]}
              onChange={(e) => selectAnswer(q.attemptQuestionId, e.target.value)}
              style={{ width: '100%' }}
            >
              <Space direction="vertical" style={{ width: '100%' }} size={10}>
                {(q.options || []).map((opt, i) => (
                  <Radio key={i} value={i} style={{ width: '100%', padding: '10px 12px', border: '1px solid #d9d9d9', borderRadius: 8 }}>
                    {opt}
                  </Radio>
                ))}
              </Space>
            </Radio.Group>
          )}
        </Card>

        {error && <Alert type="error" showIcon message={error} style={{ marginBottom: 16 }} />}

        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <Button icon={<LeftOutlined />} disabled={current === 0} onClick={() => setCurrent((c) => Math.max(0, c - 1))}>
            Previous
          </Button>
          {isLast ? (
            <Button type="primary" loading={submitting} onClick={handleSubmit}>
              Submit Test
            </Button>
          ) : (
            <Button type="primary" onClick={() => setCurrent((c) => Math.min(questions.length - 1, c + 1))}>
              Next <RightOutlined />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
