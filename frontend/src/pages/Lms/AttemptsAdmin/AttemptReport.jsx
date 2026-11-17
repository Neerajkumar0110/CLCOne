import React, { useMemo, useState } from 'react';
import { Button, Image, Skeleton, message } from 'antd';
import {
  DownloadOutlined, CopyOutlined, CloseCircleOutlined, MinusCircleOutlined, WarningOutlined, ClockCircleOutlined,
  CalendarOutlined, BarChartOutlined, UnorderedListOutlined, RightOutlined, SafetyCertificateOutlined, StopOutlined,
} from '@ant-design/icons';
import { StatusPill } from '../components/ui';

const PROCTOR_LABEL = {
  TAB_SWITCH: 'Switched tab / window',
  WINDOW_BLUR: 'Clicked outside the test',
  FULLSCREEN_EXIT: 'Left full screen',
  CAMERA_OFF: 'Camera turned off',
  MIC_OFF: 'Microphone turned off',
  SCREEN_SHARE_STOPPED: 'Screen sharing stopped',
  DEVTOOLS_OPEN: 'Developer tools opened',
  MULTIPLE_PERSONS: 'Another person on camera',
  PHONE_DETECTED: 'Mobile phone on camera',
  LOUD_NOISE: 'Talking / loud sound',
};
import QuestionReview from './QuestionReview';

// One candidate's attempt, opened from the Test Attempts table: a score
// header, every topic with a bar (weakest first), and a click on a topic's
// result opens that topic's questions — the learner's answer next to the
// right one. "Download report" saves THIS attempt only (CSV, opens in Excel).
// `report` is GET /assessments/admin/attempts/:id/report's result.

const TYPE_LABEL = { MCQ: 'MCQ', OUTPUT_BASED: 'Output', PROGRAMMING: 'Code' };
const pct = (n, d) => (d > 0 ? Math.round((n / d) * 100) : 0);
const when = (d) => (d ? new Date(d).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—');
const took = (a, b) => {
  if (!a || !b) return null;
  const m = Math.round((new Date(b) - new Date(a)) / 60000);
  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m} min`;
};
const answered = (t) => t.correct + t.incorrect;
const tone = (p) => (p >= 80 ? 'good' : p >= 50 ? 'mid' : 'low');

function answerText(q, idx) {
  if (idx === undefined || idx === null) return '';
  const opt = q.options && q.options[idx];
  // literal "\n" in stored output options → shown as " / " on one line (topic card, CSV)
  return opt !== undefined ? `${String.fromCharCode(65 + idx)}. ${String(opt).replace(/\\n/g, ' / ')}` : `Option ${idx + 1}`;
}
// MCQ and OUTPUT_BASED questions are both pick-an-option; only PROGRAMMING
// questions carry submitted code.
const hasOptions = (q) => Array.isArray(q.options) && q.options.length > 0;
const picked = (q) => q.selectedOption !== undefined && q.selectedOption !== null;
const letter = (i) => String.fromCharCode(65 + i);
function learnerAnswer(q) {
  if (hasOptions(q)) return q.selectedOption === undefined || q.selectedOption === null ? '' : answerText(q, q.selectedOption);
  return q.submittedCode || '';
}
function rightAnswer(q) {
  if (hasOptions(q)) return q.correctOption === undefined || q.correctOption === null ? '' : answerText(q, q.correctOption);
  return q.expectedOutput || '';
}
const csv = (v) => `"${String(v === null || v === undefined ? '' : v).replace(/"/g, '""')}"`;
const resultOf = (q) => (q.isCorrect === true ? 'Correct' : q.isCorrect === false ? 'Wrong' : 'Not graded');

export default function AttemptReport({ attempt: a, report, testLabel, onNeedQuestions }) {
  const [topic, setTopic] = useState(null); // topic name, or '*' for every question
  const loading = !report || report.loading;
  // Opening a topic with no question list in hand (cached by an older build)
  // asks the parent to fetch the report again.
  const openTopic = (t) => {
    setTopic(t);
    if (!loading && !(report.questions && report.questions.length) && onNeedQuestions) onNeedQuestions();
  };
  const topics = useMemo(
    () => ((report && report.breakdown) || []).slice().sort((x, y) => pct(x.correct, answered(x)) - pct(y.correct, answered(y)) || x.topic.localeCompare(y.topic)),
    [report]
  );
  const questions = (report && report.questions) || [];
  const numbered = useMemo(() => questions.map((q, i) => ({ ...q, n: i + 1 })), [questions]);
  const shown = topic === '*' ? numbered : numbered.filter((q) => q.topic === topic);

  const submitted = a.status === 'SUBMITTED';
  const scorePct = pct(a.score || 0, a.totalCount || 0);
  const wrong = questions.filter((q) => q.isCorrect === false).length;
  const skipped = questions.filter((q) => q.isCorrect !== true && q.isCorrect !== false).length;

  const download = () => {
    const rows = [
      ['Candidate', a.studentName], ['Email', a.studentEmail], ['Batch', a.studentBatch || ''], ['Test', testLabel],
      ['Attempt', a.attemptNumber ? `${a.attemptNumber}/3` : ''], ['Status', a.status],
      ['Score', submitted ? `${a.score}/${a.totalCount} (${scorePct}%)` : ''],
      ['Result', a.qualified === null ? '' : a.qualified ? 'Qualified' : 'Disqualified'],
      ['Warnings', a.warningCount || 0], ['Started', when(a.startedAt)], ['Submitted', when(a.submittedAt)],
      [],
      ['Topic', 'Correct', 'Answered', 'Wrong', 'Not graded', 'Score %'],
      ...topics.map((t) => [t.topic, t.correct, answered(t), t.incorrect, t.ungraded, `${pct(t.correct, answered(t))}%`]),
      [],
      ['Q#', 'Topic', 'Type', 'Result', 'Question', "Learner's answer", 'Correct answer'],
      ...numbered.map((q) => [q.n, q.topic, TYPE_LABEL[q.questionType] || q.questionType, resultOf(q), q.text, learnerAnswer(q) || 'Not answered', rightAnswer(q)]),
    ];
    const blob = new Blob([`﻿${rows.map((r) => r.map(csv).join(',')).join('\n')}`], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    const safe = String(a.studentName || 'candidate').replace(/[^\w-]+/g, '-');
    link.href = url;
    link.download = `${safe}-${String(testLabel).replace(/\s+/g, '-')}-attempt-${a.attemptNumber || 1}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const copy = () => {
    const lines = topics.map((t) => `- ${t.topic}: ${answered(t) > 0 ? `${t.correct}/${answered(t)} correct` : 'Not answered'}`).join('\n');
    const text = `${a.studentName} (${a.studentEmail})\n${testLabel} Test — ${submitted ? `Score: ${a.score}/${a.totalCount} (${scorePct}%)` : `Status: ${a.status}`}\n\nTopic Breakdown:\n${lines}`;
    navigator.clipboard?.writeText(text).then(() => message.success('Copied to clipboard')).catch(() => {});
  };

  return (
    <div className="ar">
      <div className="ar-top">
        <div className="ar-score">
          <div className={`ar-ring ${tone(scorePct)}`} style={{ '--p': submitted ? scorePct : 0 }}>
            <span>{submitted ? `${scorePct}%` : '—'}</span>
          </div>
          <div>
            <div className="ar-big">{submitted ? <>{a.score}<small>/{a.totalCount}</small></> : a.status}</div>
            <div className="ar-pills">
              {a.qualified !== null && <StatusPill tone={a.qualified ? 'success' : 'danger'}>{a.qualified ? 'Qualified' : 'Disqualified'}</StatusPill>}
              <StatusPill tone="info">{testLabel}</StatusPill>
              {a.attemptNumber ? <StatusPill>Attempt {a.attemptNumber}/3</StatusPill> : null}
            </div>
          </div>
        </div>
        <div className="ar-facts">
          {[
            ['bad', <CloseCircleOutlined key="i" />, 'Wrong', loading ? '…' : wrong, wrong ? 'bad' : ''],
            ['none', <MinusCircleOutlined key="i" />, 'Not graded', loading ? '…' : skipped, ''],
            ['warn', <WarningOutlined key="i" />, 'Warnings', a.warningCount || 0, a.warningCount ? 'warn' : ''],
            ['time', <ClockCircleOutlined key="i" />, 'Time taken', took(a.startedAt, a.submittedAt) || '—', ''],
            ['date', <CalendarOutlined key="i" />, 'Submitted', when(a.submittedAt), ''],
          ].map(([k, icon, label, value, cls]) => (
            <div key={k} className={`ar-fact ${k}`}>
              <span className="ar-ficon" aria-hidden="true">{icon}</span>
              <div>
                <span>{label}</span>
                <b className={cls}>{value}</b>
              </div>
            </div>
          ))}
        </div>
        <div className="ar-actions">
          <Button type="primary" icon={<DownloadOutlined />} onClick={download} disabled={loading}>Download report</Button>
          <Button icon={<CopyOutlined />} onClick={copy} disabled={loading}>Copy summary</Button>
        </div>
      </div>

      <div className="ar-sec">
        <div className="ar-sechead">
          <span className="ar-sicon" aria-hidden="true"><BarChartOutlined /></span>
          <div className="ar-stext">
            <b>Topic-wise result</b>
            <span>Weakest topics first · click a topic to see its questions</span>
          </div>
          {!loading && numbered.length > 0 && (
            <button type="button" className="ar-allq" onClick={() => openTopic('*')}>
              <UnorderedListOutlined /> All {numbered.length} questions <RightOutlined />
            </button>
          )}
        </div>
        {loading ? (
          <Skeleton active paragraph={{ rows: 4 }} title={false} />
        ) : !topics.length ? (
          <div className="ar-empty">No report available for this attempt.</div>
        ) : (
          <div className="ar-topics">
            {topics.map((t) => {
              const p = pct(t.correct, answered(t));
              return (
                <button key={t.topic} type="button" className={`ar-topic ${answered(t) ? tone(p) : 'none'}`} onClick={() => openTopic(t.topic)} title={`See the ${t.topic} questions`}>
                  <span className="ar-tpct">{answered(t) ? `${p}%` : '—'}</span>
                  <span className="ar-tmain">
                    <span className="ar-tname">{t.topic}</span>
                    <span className="ar-bar"><i className={answered(t) ? tone(p) : ''} style={{ width: `${answered(t) ? Math.max(p, 3) : 0}%` }} /></span>
                    {t.ungraded ? <span className="ar-ug">{t.ungraded} not graded</span> : null}
                    {numbered.filter((q) => q.topic === t.topic && q.isCorrect === false).map((q) => (
                      <span key={q.attemptQuestionId} className="ar-miss">
                        <b className="ar-mq">Q{q.n}</b>
                        {hasOptions(q) ? (
                          <>
                            <span className="ar-mbad" title={learnerAnswer(q) || 'Not answered'}>✗ {picked(q) ? letter(q.selectedOption) : '—'}</span>
                            <span className="ar-mok" title={rightAnswer(q)}>✓ {rightAnswer(q) || '—'}</span>
                          </>
                        ) : (
                          <span className="ar-mok" title={rightAnswer(q)}>✓ {rightAnswer(q) ? `Expected: ${rightAnswer(q)}` : 'Code answer — open to review'}</span>
                        )}
                      </span>
                    ))}
                  </span>
                  <span className={`ar-res ${answered(t) ? tone(p) : 'none'}`}>
                    {answered(t) > 0 ? `${t.correct}/${answered(t)} correct` : 'Not answered'}
                  </span>
                  <RightOutlined className="ar-go" />
                </button>
              );
            })}
          </div>
        )}
      </div>

      {report && !report.loading && (report.proctorEvents || []).length > 0 && (
        <div className="ar-sec">
          <div className="ar-sechead">
            <span className="ar-sicon bad" aria-hidden="true"><SafetyCertificateOutlined /></span>
            <div className="ar-stext">
              <b>Proctoring log</b>
              <span>{report.suspendReason ? `Test ended: ${report.suspendReason}` : 'Warnings recorded during the test'}</span>
            </div>
          </div>
          <div className="ar-plog">
            {report.proctorEvents.map((e, i) => (
              <div key={i} className={`ar-pev${e.severe ? ' severe' : ''}`}>
                {e.snapshot ? (
                  <Image src={e.snapshot} width={120} height={90} style={{ objectFit: 'cover', borderRadius: 10 }} alt={`Camera at ${PROCTOR_LABEL[e.type] || e.type}`} />
                ) : (
                  <span className="ar-pnoimg" aria-hidden="true">{e.severe ? <StopOutlined /> : <WarningOutlined />}</span>
                )}
                <div className="ar-ptext">
                  <b>{PROCTOR_LABEL[e.type] || e.type}</b>
                  {e.detail && <span>{e.detail}</span>}
                  <em>{new Date(e.at).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit' })}</em>
                </div>
                <span className={`ar-ptag${e.severe ? ' severe' : ''}`}>{e.severe ? 'Ended the test' : 'Warning'}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <QuestionReview
        open={!!topic}
        onClose={() => setTopic(null)}
        title={topic === '*' ? 'All questions' : topic}
        subtitle={`${a.studentName} · ${testLabel}${a.attemptNumber ? ` · Attempt ${a.attemptNumber}/3` : ''}`}
        questions={shown}
        loading={loading}
      />
    </div>
  );
}
