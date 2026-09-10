import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Card, Table, Tag, Button, Modal, Form, Input, InputNumber, Select, Checkbox, Drawer, Space, Empty,
  Skeleton, message, Typography, Radio, Progress, Result, List, Divider, Statistic,
} from 'antd';
import { PlusOutlined, FormOutlined, EditOutlined, DeleteOutlined, PlayCircleOutlined, CheckCircleOutlined } from '@ant-design/icons';
import { useSelector } from 'react-redux';
import { selectCurrentAdmin } from '@/redux/auth/selectors';
import { LMS_TEACHER_ROLES } from '@/config/roles';
import lmsApi from '../api';

const { Text, Paragraph, Title } = Typography;
const QTYPES = [
  { value: 'mcq', label: 'Single choice (MCQ)' },
  { value: 'multiple', label: 'Multiple correct' },
  { value: 'truefalse', label: 'True / False' },
  { value: 'fill', label: 'Fill in the blank' },
  { value: 'short', label: 'Short answer' },
  { value: 'long', label: 'Long answer (manual)' },
];

/* ═══════════════════════ TEACHER ═══════════════════════ */
function TeacherQuizzes() {
  const [rows, setRows] = useState([]);
  const [courses, setCourses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [quizForm] = Form.useForm();
  const [editing, setEditing] = useState(null);
  const [qDrawer, setQDrawer] = useState(null); // quiz row
  const [quiz, setQuiz] = useState(null);       // full quiz w/ questions
  const [qForm] = Form.useForm();
  const [qEditing, setQEditing] = useState(null);
  const [resFor, setResFor] = useState(null);
  const [results, setResults] = useState(null);
  const [gradeAtt, setGradeAtt] = useState(null); // {attempt result}
  const [gradeForm] = Form.useForm();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [q, d] = await Promise.all([lmsApi.quizzes(), lmsApi.teacherDashboard()]);
      setRows((q && q.result) || []);
      setCourses(((d && d.result && d.result.courses) || []).map((c) => ({ value: c.id, label: c.title })));
    } catch (e) {
      message.error('Could not load quizzes.');
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const openQuizEditor = (row) => {
    setEditing(row || {});
    setTimeout(() => quizForm.setFieldsValue(row || {
      type: 'quiz', timeLimitMin: 0, passingPercent: 40, attemptsAllowed: 1, instantResult: true, showAnswers: true, published: true,
    }), 0);
  };
  const saveQuiz = async () => {
    let v; try { v = await quizForm.validateFields(); } catch (e) { return; }
    try {
      if (editing && editing.id) await lmsApi.updateQuiz(editing.id, v);
      else await lmsApi.createQuiz(v);
      setEditing(null); quizForm.resetFields(); load();
    } catch (e) { message.error('Save failed.'); }
  };

  const openQuestions = async (row) => {
    setQDrawer(row); setQuiz(null);
    try { const res = await lmsApi.quiz(row.id); setQuiz((res && res.result) || null); }
    catch (e) { message.error('Could not load questions.'); }
  };
  const openQEditor = (q) => {
    setQEditing(q || {});
    setTimeout(() => qForm.setFieldsValue(q ? {
      ...q,
      correctText: (q.correctText || []).join(' | '),
      options: (q.options || []).map((o) => ({ ...o })),
    } : { type: 'mcq', marks: 1, options: [{ text: '', correct: false }, { text: '', correct: false }] }), 0);
  };
  const saveQuestion = async () => {
    let v; try { v = await qForm.validateFields(); } catch (e) { return; }
    const body = { ...v };
    if (['fill', 'short'].includes(v.type)) body.correctText = (v.correctText || '').split('|').map((s) => s.trim()).filter(Boolean);
    try {
      if (qEditing && qEditing.id) await lmsApi.updateQuestion(qEditing.id, body);
      else await lmsApi.addQuestion(qDrawer.id, body);
      setQEditing(null); qForm.resetFields();
      openQuestions(qDrawer); load();
    } catch (e) { message.error('Save failed.'); }
  };

  const openResults = async (row) => {
    setResFor(row); setResults(null);
    try { const res = await lmsApi.quizResults(row.id); setResults((res && res.result) || null); }
    catch (e) { message.error('Could not load results.'); }
  };
  const openGrade = async (attRow) => {
    try {
      const res = await lmsApi.attemptResult(attRow.id);
      const r = (res && res.result) || null;
      setGradeAtt(r);
      const manualQs = (r.answers || []).map((a, i) => ({ ...a, i })).filter((a) => a.needsManual);
      setTimeout(() => gradeForm.setFieldsValue(Object.fromEntries(manualQs.map((a) => [`q${a.i}`, a.awarded || 0]))), 0);
    } catch (e) { message.error('Could not open attempt.'); }
  };
  const saveGrade = async () => {
    const v = gradeForm.getFieldsValue();
    const scores = (gradeAtt.answers || [])
      .map((a, i) => ({ a, i }))
      .filter(({ a }) => a.needsManual && a.questionId)
      .map(({ a, i }) => ({ question: a.questionId, awarded: Number(v[`q${i}`]) || 0 }));
    try {
      await lmsApi.evaluateAttempt(gradeAtt.attemptId, { scores });
      setGradeAtt(null); gradeForm.resetFields();
      openResults(resFor); load();
    } catch (e) { message.error('Save failed.'); }
  };

  if (loading) return <Skeleton active paragraph={{ rows: 6 }} style={{ padding: 24 }} />;

  return (
    <div className="lms-portal" style={{ padding: 4 }}>
      <div className="lms-portal-head">
        <div><h2><FormOutlined /> Quizzes & Exams</h2><p>Build, publish, and grade.</p></div>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => openQuizEditor(null)} disabled={!courses.length}>New quiz</Button>
      </div>

      {rows.length === 0 ? (
        <Card><Empty description={courses.length ? 'No quizzes yet.' : 'You have no courses assigned.'} /></Card>
      ) : (
        <Table
          rowKey="id"
          dataSource={rows}
          pagination={false}
          columns={[
            { title: 'Title', dataIndex: 'title' },
            { title: 'Type', dataIndex: 'type', render: (t) => <Tag>{t}</Tag> },
            { title: 'Qs', dataIndex: 'questions', width: 60 },
            { title: 'Attempts', dataIndex: 'attempts', width: 90 },
            { title: 'Avg %', dataIndex: 'avgPercent', width: 80 },
            { title: 'Pass %', dataIndex: 'passingPercent', width: 80 },
            { title: 'Status', dataIndex: 'published', render: (p) => <Tag color={p ? 'green' : 'default'}>{p ? 'Published' : 'Draft'}</Tag> },
            {
              title: '', width: 260, render: (_, r) => (
                <Space>
                  <Button size="small" onClick={() => openQuestions(r)}>Questions</Button>
                  <Button size="small" onClick={() => openResults(r)}>Results</Button>
                  <Button size="small" icon={<EditOutlined />} onClick={() => openQuizEditor(r)} />
                  <Button size="small" danger icon={<DeleteOutlined />} onClick={() =>
                    Modal.confirm({ title: 'Delete quiz?', onOk: async () => { await lmsApi.deleteQuiz(r.id); load(); } })} />
                </Space>
              ),
            },
          ]}
        />
      )}

      {/* quiz settings */}
      <Modal open={!!editing} title={editing?.id ? 'Edit quiz' : 'New quiz'} onCancel={() => setEditing(null)} onOk={saveQuiz} okText="Save" destroyOnClose width={560}>
        <Form form={quizForm} layout="vertical" preserve={false}>
          <Form.Item name="course" label="Course" rules={[{ required: true }]}><Select options={courses} disabled={!!editing?.id} /></Form.Item>
          <Form.Item name="title" label="Title" rules={[{ required: true }]}><Input /></Form.Item>
          <Space size="large" wrap>
            <Form.Item name="type" label="Type"><Select options={[{ value: 'quiz', label: 'Quiz' }, { value: 'exam', label: 'Exam' }]} /></Form.Item>
            <Form.Item name="timeLimitMin" label="Time limit (min, 0 = none)"><InputNumber min={0} /></Form.Item>
            <Form.Item name="passingPercent" label="Passing %"><InputNumber min={0} max={100} /></Form.Item>
            <Form.Item name="attemptsAllowed" label="Attempts"><InputNumber min={1} /></Form.Item>
          </Space>
          <Space size="large" wrap>
            <Form.Item name="randomizeQuestions" valuePropName="checked" noStyle><Checkbox>Randomize questions</Checkbox></Form.Item>
            <Form.Item name="randomizeOptions" valuePropName="checked" noStyle><Checkbox>Randomize options</Checkbox></Form.Item>
            <Form.Item name="negativeMarking" valuePropName="checked" noStyle><Checkbox>Negative marking</Checkbox></Form.Item>
          </Space>
          <Form.Item name="negativeMarkPerWrong" label="Negative mark per wrong"><InputNumber min={0} step={0.25} /></Form.Item>
          <Space size="large">
            <Form.Item name="instantResult" valuePropName="checked" noStyle><Checkbox>Show result instantly</Checkbox></Form.Item>
            <Form.Item name="showAnswers" valuePropName="checked" noStyle><Checkbox>Reveal correct answers</Checkbox></Form.Item>
            <Form.Item name="published" valuePropName="checked" noStyle><Checkbox>Published</Checkbox></Form.Item>
          </Space>
        </Form>
      </Modal>

      {/* questions */}
      <Drawer open={!!qDrawer} title={qDrawer ? `Questions — ${qDrawer.title}` : ''} width={680} onClose={() => setQDrawer(null)}
        extra={<Button type="primary" icon={<PlusOutlined />} onClick={() => openQEditor(null)}>Add question</Button>}>
        {!quiz ? <Skeleton active /> : (
          <List
            dataSource={quiz.questions}
            locale={{ emptyText: 'No questions yet' }}
            renderItem={(q, i) => (
              <List.Item actions={[
                <Button key="e" size="small" icon={<EditOutlined />} onClick={() => openQEditor(q)} />,
                <Button key="d" size="small" danger icon={<DeleteOutlined />} onClick={async () => { await lmsApi.deleteQuestion(q.id); openQuestions(qDrawer); load(); }} />,
              ]}>
                <List.Item.Meta
                  title={<span>{i + 1}. {q.text} <Tag>{q.type}</Tag><Tag>{q.marks} mk</Tag></span>}
                  description={
                    ['mcq', 'multiple', 'truefalse'].includes(q.type)
                      ? (q.options || []).map((o) => `${o.correct ? '✓ ' : ''}${o.text}`).join('   ·   ')
                      : (q.correctText || []).length ? `Answer: ${q.correctText.join(' / ')}` : 'Manually graded'
                  }
                />
              </List.Item>
            )}
          />
        )}
      </Drawer>

      <Modal open={!!qEditing} title={qEditing?.id ? 'Edit question' : 'Add question'} onCancel={() => setQEditing(null)} onOk={saveQuestion} okText="Save" destroyOnClose width={620}>
        <Form form={qForm} layout="vertical" preserve={false}>
          <Space size="large">
            <Form.Item name="type" label="Type" rules={[{ required: true }]}><Select style={{ width: 220 }} options={QTYPES} /></Form.Item>
            <Form.Item name="marks" label="Marks"><InputNumber min={0.25} step={0.25} /></Form.Item>
          </Space>
          <Form.Item name="text" label="Question" rules={[{ required: true }]}><Input.TextArea rows={2} /></Form.Item>
          <Form.Item noStyle shouldUpdate={(p, c) => p.type !== c.type}>
            {({ getFieldValue }) => {
              const t = getFieldValue('type');
              if (['mcq', 'multiple'].includes(t))
                return (
                  <Form.List name="options">
                    {(fields, { add, remove }) => (
                      <>
                        <Text type="secondary">Tick the correct option(s)</Text>
                        {fields.map((f) => (
                          <Space key={f.key} align="baseline" style={{ display: 'flex', marginTop: 6 }}>
                            <Form.Item {...f} name={[f.name, 'correct']} valuePropName="checked" noStyle><Checkbox /></Form.Item>
                            <Form.Item {...f} name={[f.name, 'text']} noStyle rules={[{ required: true, message: 'text' }]}>
                              <Input placeholder="Option text" style={{ width: 420 }} />
                            </Form.Item>
                            <Button size="small" danger onClick={() => remove(f.name)}>×</Button>
                          </Space>
                        ))}
                        <Button size="small" type="dashed" onClick={() => add({ text: '', correct: false })} style={{ marginTop: 8 }}>+ Option</Button>
                      </>
                    )}
                  </Form.List>
                );
              if (t === 'truefalse') return <Text type="secondary">Options (True / False) are added automatically — set the answer below.</Text>;
              if (['fill', 'short'].includes(t))
                return <Form.Item name="correctText" label="Accepted answers (separate with |)"><Input placeholder="Paris | paris" /></Form.Item>;
              return <Text type="secondary">Long answers are graded manually after submission.</Text>;
            }}
          </Form.Item>
          <Form.Item noStyle shouldUpdate={(p, c) => p.type !== c.type}>
            {({ getFieldValue }) => getFieldValue('type') === 'truefalse' && (
              <Form.Item name="__tf" label="Correct answer">
                <Radio.Group
                  onChange={(e) => qForm.setFieldsValue({ options: [{ key: 'true', text: 'True', correct: e.target.value === 'true' }, { key: 'false', text: 'False', correct: e.target.value === 'false' }] })}
                >
                  <Radio value="true">True</Radio><Radio value="false">False</Radio>
                </Radio.Group>
              </Form.Item>
            )}
          </Form.Item>
          <Form.Item name="explanation" label="Explanation (shown in results)"><Input.TextArea rows={2} /></Form.Item>
        </Form>
      </Modal>

      {/* results */}
      <Drawer open={!!resFor} title={resFor ? `Results — ${resFor.title}` : ''} width={720} onClose={() => setResFor(null)}>
        {!results ? <Skeleton active /> : (
          <Table
            rowKey="id"
            size="small"
            dataSource={results.attempts}
            pagination={false}
            locale={{ emptyText: 'No attempts yet' }}
            columns={[
              { title: 'Student', dataIndex: 'studentName' },
              { title: 'Score', render: (_, r) => `${r.totalScore}/${r.maxScore}` },
              { title: '%', dataIndex: 'percent', width: 60 },
              { title: 'Result', render: (_, r) => <Tag color={r.passed ? 'green' : 'red'}>{r.passed ? 'PASS' : 'FAIL'}</Tag> },
              { title: 'Status', dataIndex: 'status', render: (s, r) => r.needsManual ? <Tag color="orange">needs grading</Tag> : <Tag>{s}</Tag> },
              { title: '', render: (_, r) => <Button size="small" onClick={() => openGrade(r)}>{r.needsManual ? 'Grade' : 'View'}</Button> },
            ]}
          />
        )}
      </Drawer>

      <Modal open={!!gradeAtt} title="Grade attempt" width={640} onCancel={() => setGradeAtt(null)} onOk={saveGrade} okText="Save grades" destroyOnClose>
        {gradeAtt && (
          <Form form={gradeForm} layout="vertical" preserve={false}>
            {(gradeAtt.answers || []).map((a, i) => (
              <Card key={i} size="small" style={{ marginBottom: 8 }}>
                <b>{a.question}</b> <Tag>{a.type}</Tag> <Tag>max {a.marks}</Tag>
                <Paragraph style={{ background: '#f6f7f9', padding: 8, borderRadius: 6, marginTop: 6 }}>
                  {Array.isArray(a.yourAnswer) ? a.yourAnswer.join(', ') : (a.yourAnswer || <i>— blank —</i>)}
                </Paragraph>
                {a.needsManual
                  ? <Form.Item name={`q${i}`} label="Award marks" style={{ marginBottom: 0 }}><InputNumber min={0} max={a.marks} /></Form.Item>
                  : <Text type={a.correct ? 'success' : 'danger'}>{a.awarded}/{a.marks} · {a.correct ? 'correct' : 'wrong'}</Text>}
              </Card>
            ))}
          </Form>
        )}
      </Modal>
    </div>
  );
}

/* ═══════════════════════ STUDENT ═══════════════════════ */
function StudentQuizzes() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [runner, setRunner] = useState(null); // {attemptId, quiz, questions, dueAt}
  const [answers, setAnswers] = useState({});
  const [result, setResult] = useState(null);
  const [remaining, setRemaining] = useState(null);
  const timer = useRef(null);

  const load = useCallback(async () => {
    setLoading(true);
    try { const res = await lmsApi.myQuizzes(); setRows((res && res.result) || []); }
    catch (e) { message.error('Could not load quizzes.'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!runner || !runner.dueAt) return;
    timer.current = setInterval(() => {
      const ms = new Date(runner.dueAt) - Date.now();
      setRemaining(Math.max(0, Math.floor(ms / 1000)));
      if (ms <= 0) { clearInterval(timer.current); submit(); }
    }, 1000);
    return () => clearInterval(timer.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runner]);

  const start = async (row) => {
    try {
      const res = await lmsApi.startQuiz(row.id);
      const r = (res && res.result) || null;
      if (!r) return;
      setRunner(r); setAnswers({}); setResult(null);
    } catch (e) {
      message.error(e?.response?.data?.message || 'Could not start.');
      load();
    }
  };

  const submit = async () => {
    if (!runner) return;
    clearInterval(timer.current);
    const payload = runner.questions.map((q) => {
      const a = answers[q.id] || {};
      return { question: q.id, chosen: a.chosen || [], text: a.text || '' };
    });
    try {
      const res = await lmsApi.submitQuizAttempt(runner.attemptId, { answers: payload });
      const r = (res && res.result) || {};
      setRunner(null);
      if (r.result) setResult({ ...r.result, instant: true });
      else message.success('Submitted — awaiting teacher evaluation.');
      load();
    } catch (e) {
      message.error('Submit failed.');
    }
  };

  const viewResult = async (attemptId) => {
    try { const res = await lmsApi.attemptResult(attemptId); setResult({ ...(res && res.result), full: true }); }
    catch (e) { message.error('Could not load result.'); }
  };

  if (loading) return <Skeleton active paragraph={{ rows: 6 }} style={{ padding: 24 }} />;

  // ---- runner ----
  if (runner) {
    return (
      <div className="lms-portal" style={{ padding: 4 }}>
        <div className="lms-portal-head">
          <div><h2>{runner.quiz.title}</h2><Text type="secondary">{runner.questions.length} questions</Text></div>
          {remaining != null && <Statistic title="Time left" value={`${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, '0')}`} />}
        </div>
        {runner.questions.map((q, i) => (
          <Card key={q.id} size="small" style={{ marginBottom: 10 }} title={<span>{i + 1}. {q.text} <Tag>{q.marks} mk</Tag></span>}>
            {q.type === 'mcq' || q.type === 'truefalse' ? (
              <Radio.Group
                onChange={(e) => setAnswers((a) => ({ ...a, [q.id]: { chosen: [e.target.value] } }))}
                value={(answers[q.id]?.chosen || [])[0]}
              >
                <Space direction="vertical">{(q.options || []).map((o) => <Radio key={o.key} value={o.key}>{o.text}</Radio>)}</Space>
              </Radio.Group>
            ) : q.type === 'multiple' ? (
              <Checkbox.Group
                options={(q.options || []).map((o) => ({ label: o.text, value: o.key }))}
                value={answers[q.id]?.chosen || []}
                onChange={(vals) => setAnswers((a) => ({ ...a, [q.id]: { chosen: vals } }))}
              />
            ) : (
              <Input.TextArea rows={q.type === 'long' ? 4 : 1} placeholder="Your answer"
                value={answers[q.id]?.text || ''}
                onChange={(e) => setAnswers((a) => ({ ...a, [q.id]: { text: e.target.value } }))} />
            )}
          </Card>
        ))}
        <Space>
          <Button type="primary" icon={<CheckCircleOutlined />} onClick={() => Modal.confirm({ title: 'Submit quiz?', onOk: submit })}>Submit</Button>
          <Button onClick={() => setRunner(null)}>Leave (saves nothing)</Button>
        </Space>
      </div>
    );
  }

  // ---- result view ----
  if (result) {
    return (
      <div className="lms-portal" style={{ padding: 4 }}>
        <Result
          status={result.passed ? 'success' : 'warning'}
          title={`${result.percent}%  ${result.passed ? '· Passed' : '· Not passed'}`}
          subTitle={result.totalScore != null ? `${result.totalScore} / ${result.maxScore}` : ''}
          extra={<Button type="primary" onClick={() => { setResult(null); load(); }}>Back to quizzes</Button>}
        />
        {result.full && (result.answers || []).map((a, i) => (
          <Card key={i} size="small" style={{ marginBottom: 8 }}>
            <b>{a.question}</b> <Tag color={a.correct ? 'green' : a.correct === false ? 'red' : 'default'}>{a.awarded}/{a.marks}</Tag>
            <div style={{ marginTop: 4 }}><Text type="secondary">Your answer: </Text>{Array.isArray(a.yourAnswer) ? a.yourAnswer.join(', ') : (a.yourAnswer || '—')}</div>
            {a.correctAnswer && <div><Text type="secondary">Correct: </Text>{Array.isArray(a.correctAnswer) ? a.correctAnswer.join(', ') : a.correctAnswer}</div>}
            {a.explanation && <Paragraph type="secondary" style={{ marginTop: 4 }}>{a.explanation}</Paragraph>}
          </Card>
        ))}
      </div>
    );
  }

  // ---- list ----
  return (
    <div className="lms-portal" style={{ padding: 4 }}>
      <div className="lms-portal-head"><div><h2><FormOutlined /> Quizzes</h2><p>Take quizzes and review results.</p></div></div>
      {rows.length === 0 ? (
        <Card><Empty description="No quizzes yet." /></Card>
      ) : (
        rows.map((r) => {
          const attemptsLeft = (r.attemptsAllowed || 1) - (r.attemptsUsed || 0);
          return (
            <Card key={r.id} size="small" style={{ marginBottom: 12 }}
              title={<Space><b>{r.title}</b><Tag>{r.course}</Tag><Tag>{r.type}</Tag></Space>}
              extra={<Text type="secondary">{r.questions} Qs{r.timeLimitMin ? ` · ${r.timeLimitMin} min` : ''} · pass {r.passingPercent}%</Text>}>
              <Space wrap>
                {r.lastResult && <Tag color={r.lastResult.passed ? 'green' : 'red'}>Last: {r.lastResult.percent}% {r.lastResult.status === 'submitted' ? '(pending)' : ''}</Tag>}
                <Text type="secondary">Attempts left: {Math.max(0, attemptsLeft)}</Text>
              </Space>
              <div style={{ marginTop: 10 }}>
                <Space>
                  {r.inProgressAttemptId ? (
                    <Button type="primary" icon={<PlayCircleOutlined />} onClick={() => start(r)}>Resume</Button>
                  ) : (
                    <Button type="primary" icon={<PlayCircleOutlined />} disabled={attemptsLeft <= 0} onClick={() => start(r)}>
                      {r.attemptsUsed > 0 ? 'Retake' : 'Start'}
                    </Button>
                  )}
                  {r.lastResult && <Button onClick={() => viewResult(r.lastResult.attemptId)}>View result</Button>}
                </Space>
              </div>
            </Card>
          );
        })
      )}
    </div>
  );
}

export default function Quizzes() {
  const admin = useSelector(selectCurrentAdmin) || {};
  return LMS_TEACHER_ROLES.includes(admin.role) ? <TeacherQuizzes /> : <StudentQuizzes />;
}
