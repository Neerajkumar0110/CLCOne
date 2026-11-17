import React, { useMemo, useRef, useState } from 'react';
import { Modal, Skeleton, Tooltip, message } from 'antd';
import {
  CheckCircleFilled, CloseCircleFilled, MinusCircleFilled, CheckOutlined, CloseOutlined, UserOutlined,
  CodeOutlined, UnorderedListOutlined, ConsoleSqlOutlined, CopyOutlined, ReadOutlined, AppstoreOutlined,
  BulbOutlined, ExclamationCircleOutlined,
} from '@ant-design/icons';

// The question review popup of one attempt (opened from a topic's result in
// AttemptReport): a header with the topic score, a jump strip of question
// numbers coloured by result, All / Wrong / Correct filters, and one card
// per question — prompt, code in a code panel, every option with the
// learner's pick and the right answer marked, and a one-line verdict.

const TYPE = {
  MCQ: { label: 'Multiple choice', icon: <UnorderedListOutlined /> },
  OUTPUT_BASED: { label: 'Predict the output', icon: <CodeOutlined /> },
  PROGRAMMING: { label: 'Write code', icon: <ConsoleSqlOutlined /> },
};
const LEVEL = { easy: 'easy', medium: 'medium', hard: 'hard' };
const key = (i) => String.fromCharCode(65 + i);
// Output options are stored with a literal "\n" for a line break ("caught\ndone")
const lines = (t) => String(t === undefined || t === null ? '' : t).replace(/\\n/g, '\n');
const hasOptions = (q) => Array.isArray(q.options) && q.options.length > 0;
const state = (q) => (q.isCorrect === true ? 'ok' : q.isCorrect === false ? 'bad' : 'none');
const picked = (q) => q.selectedOption !== undefined && q.selectedOption !== null;

function copy(text) {
  navigator.clipboard?.writeText(text).then(() => message.success('Code copied')).catch(() => {});
}

function CodePanel({ code, label = 'Code' }) {
  return (
    <div className="qr-codewrap">
      <div className="qr-codebar">
        <span><CodeOutlined /> {label}</span>
        <Tooltip title="Copy">
          <button type="button" className="qr-iconbtn" aria-label="Copy code" onClick={() => copy(code)}><CopyOutlined /></button>
        </Tooltip>
      </div>
      <pre className="qr-code">{code}</pre>
    </div>
  );
}

const hasKey = (q) => q.correctOption !== undefined && q.correctOption !== null;

// who: 'staff' (Test Attempts) or 'learner' (My Results — "You chose").
// lockedNote: shown when the answer key is held back from a learner.
function Verdict({ q, who, lockedNote }) {
  const s = state(q);
  const subj = who === 'learner' ? 'You chose' : 'Learner chose';
  const right = hasKey(q) ? <> · correct answer is <b>{key(q.correctOption)}</b></> : null;
  if (s === 'none') return <div className="qr-verdict none"><ExclamationCircleOutlined /> Not graded{hasOptions(q) && !picked(q) ? ' — no option was chosen' : ''}</div>;
  if (!hasOptions(q)) return lockedNote && !q.expectedOutput ? <div className="qr-verdict lock"><ExclamationCircleOutlined /> {lockedNote}</div> : null;
  if (s === 'ok') return <div className="qr-verdict ok"><CheckCircleFilled /> {subj} <b>{key(q.selectedOption)}</b> — the correct answer</div>;
  return (
    <>
      <div className="qr-verdict bad">
        <CloseCircleFilled /> {picked(q) ? <>{subj} <b>{key(q.selectedOption)}</b></> : 'Not answered'}{right}
      </div>
      {!hasKey(q) && lockedNote && <div className="qr-verdict lock"><ExclamationCircleOutlined /> {lockedNote}</div>}
    </>
  );
}

export function QuestionCard({ q, anchor, who = 'staff', lockedNote }) {
  const learner = who === 'learner';
  const s = state(q);
  const t = TYPE[q.questionType] || { label: q.questionType, icon: <AppstoreOutlined /> };
  const lvl = LEVEL[String(q.difficulty || '').toLowerCase()];
  const text = String(q.text || 'Question text not available.');
  const cut = text.indexOf('\n\n');
  const prompt = cut > 0 ? text.slice(0, cut) : text;
  const code = cut > 0 ? text.slice(cut + 2) : '';
  return (
    <article ref={anchor} className={`qr-card ${s}`} aria-label={`Question ${q.n}`}>
      <header className="qr-chead">
        <span className={`qr-num ${s}`}>{q.n}</span>
        <span className="qr-chip">{t.icon} {t.label}</span>
        {q.difficulty && <span className={`qr-chip lvl ${lvl || ''}`}><span className="qr-bars" aria-hidden="true"><i /><i /><i /></span>{q.difficulty}</span>}
        <span className={`qr-result ${s}`}>
          {s === 'ok' ? <><CheckCircleFilled /> Correct</> : s === 'bad' ? <><CloseCircleFilled /> Wrong</> : <><MinusCircleFilled /> Not graded</>}
        </span>
      </header>

      <div className="qr-prompt">{prompt}</div>
      {code && <CodePanel code={code} />}

      {hasOptions(q) ? (
        <ul className={`qr-opts${q.questionType === 'OUTPUT_BASED' ? ' mono' : ''}`}>
          {q.options.map((o, i) => {
            const mine = q.selectedOption === i;
            const right = q.correctOption === i;
            const cls = right ? 'right' : mine ? 'wrong' : '';
            return (
              <li key={i} className={cls}>
                <span className="qr-key">{right ? <CheckOutlined /> : mine ? <CloseOutlined /> : key(i)}</span>
                <span className="qr-otext"><b className="qr-okey">{key(i)}.</b> {lines(o)}</span>
                <span className="qr-tags">
                  {mine && <span className={`qr-tag ${right ? 'ok' : 'bad'}`}><UserOutlined /> {learner ? 'Your answer' : 'Learner'}</span>}
                  {right && <span className="qr-tag ok"><CheckOutlined /> {learner ? 'Correct answer' : 'Answer'}</span>}
                </span>
              </li>
            );
          })}
        </ul>
      ) : (
        <div className="qr-codes">
          {q.submittedCode ? <CodePanel code={q.submittedCode} label={learner ? 'Your code' : "Learner's code"} /> : <div className="qr-empty"><UserOutlined /> {learner ? 'You submitted no code' : 'Learner submitted no code'}</div>}
          {q.expectedOutput && <CodePanel code={q.expectedOutput} label="Expected output" />}
        </div>
      )}
      <Verdict q={q} who={who} lockedNote={lockedNote} />
    </article>
  );
}

export default function QuestionReview({ open, onClose, title, subtitle, questions, loading }) {
  const [view, setView] = useState('all');
  const refs = useRef({});
  const counts = useMemo(() => ({
    all: questions.length,
    bad: questions.filter((q) => q.isCorrect === false).length,
    ok: questions.filter((q) => q.isCorrect === true).length,
  }), [questions]);
  const list = view === 'all' ? questions : questions.filter((q) => state(q) === view);
  const p = counts.all ? Math.round((counts.ok / counts.all) * 100) : 0;
  const tone = p >= 80 ? 'good' : p >= 50 ? 'mid' : 'low';
  const jump = (q) => {
    if (view !== 'all' && state(q) !== view) setView('all');
    setTimeout(() => refs.current[q.attemptQuestionId]?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 30);
  };

  return (
    <Modal open={open} onCancel={onClose} footer={null} width={820} title={null} rootClassName="qr-modal" destroyOnClose afterOpenChange={(o) => o && setView('all')}>
      <div className="qr-head">
        <span className="qr-hicon" aria-hidden="true"><ReadOutlined /></span>
        <div className="qr-htext">
          <b>{title}</b>
          <span>{subtitle}</span>
        </div>
        {!loading && counts.all > 0 && (
          <div className={`qr-hscore ${tone}`} title={`${counts.ok} of ${counts.all} correct`}>
            <span className="qr-ring" style={{ '--p': p }}><i>{p}%</i></span>
            <span><b>{counts.ok}/{counts.all}</b> correct</span>
          </div>
        )}
      </div>

      {!loading && counts.all > 0 && (
        <div className="qr-bar">
          <div className="qr-tabs" role="tablist" aria-label="Filter questions">
            {[
              ['all', 'All', <AppstoreOutlined key="a" />],
              ['bad', 'Wrong', <CloseCircleFilled key="b" />],
              ['ok', 'Correct', <CheckCircleFilled key="c" />],
            ].map(([k, label, icon]) => (
              <button key={k} type="button" role="tab" aria-selected={view === k} className={`qr-tab ${k}${view === k ? ' on' : ''}`} onClick={() => setView(k)}>
                {icon} {label} <i>{counts[k]}</i>
              </button>
            ))}
          </div>
          <div className="qr-jump" aria-label="Jump to a question">
            {questions.map((q) => (
              <Tooltip key={q.attemptQuestionId} title={`Q${q.n} · ${state(q) === 'ok' ? 'Correct' : state(q) === 'bad' ? 'Wrong' : 'Not graded'}`}>
                <button type="button" className={`qr-dot ${state(q)}`} onClick={() => jump(q)}>{q.n}</button>
              </Tooltip>
            ))}
          </div>
        </div>
      )}

      <div className="qr-list">
        {loading && <Skeleton active paragraph={{ rows: 6 }} />}
        {!loading && list.map((q) => <QuestionCard key={q.attemptQuestionId} q={q} anchor={(el) => { refs.current[q.attemptQuestionId] = el; }} />)}
        {!loading && !list.length && (
          <div className="qr-none">
            <BulbOutlined />
            <b>{counts.all ? (view === 'bad' ? 'No wrong answers here' : 'Nothing for this filter') : 'No questions recorded for this topic'}</b>
            {counts.all > 0 && view === 'bad' && <span>Every question in this topic was answered correctly.</span>}
          </div>
        )}
      </div>
    </Modal>
  );
}
