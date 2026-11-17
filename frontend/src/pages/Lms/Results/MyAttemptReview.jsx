import React, { useMemo, useState } from 'react';
import { Skeleton } from 'antd';
import {
  CheckCircleFilled, CloseCircleFilled, MinusCircleFilled, LockOutlined, UnlockOutlined,
  BarChartOutlined, AimOutlined, SmileOutlined,
} from '@ant-design/icons';
import { QuestionCard } from '../AttemptsAdmin/QuestionReview';

// A learner's own attempt, opened from My Results: how they did per topic and
// every question they got wrong (or left blank) — the prompt, the option they
// picked and, once the answer key is open to them, the correct answer.
// The key opens when they have qualified in that test or used every attempt
// (backend: testController.getAttemptBreakdown → review.answersUnlocked), so a
// retake can't be passed by memorising answers from the bank.

const pct = (n, d) => (d > 0 ? Math.round((n / d) * 100) : 0);
const tone = (p) => (p >= 80 ? 'good' : p >= 50 ? 'mid' : 'low');

export default function MyAttemptReview({ data, loading }) {
  const [topic, setTopic] = useState('');
  const review = (data && data.review) || null;
  const breakdown = (data && data.breakdown) || [];
  const mistakes = (review && review.mistakes) || [];
  const byTopic = useMemo(() => {
    const m = new Map();
    mistakes.forEach((q) => m.set(q.topic, (m.get(q.topic) || 0) + 1));
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [mistakes]);
  const shown = topic ? mistakes.filter((q) => q.topic === topic) : mistakes;

  if (loading) return <div className="mr"><Skeleton active paragraph={{ rows: 5 }} /></div>;
  if (!review && !breakdown.length) return <div className="mr"><div className="mr-empty">No report available for this attempt.</div></div>;

  const c = (review && review.counts) || {};
  const topics = breakdown
    .map((t) => ({ ...t, answered: t.correct + t.incorrect }))
    .sort((x, y) => pct(x.correct, x.answered) - pct(y.correct, y.answered) || x.topic.localeCompare(y.topic));

  return (
    <div className="mr">
      {review && <div className="mr-stats">
        <div className="mr-stat ok"><CheckCircleFilled /><b>{c.correct || 0}</b><span>Correct</span></div>
        <div className="mr-stat bad"><CloseCircleFilled /><b>{c.wrong || 0}</b><span>Wrong</span></div>
        <div className="mr-stat none"><MinusCircleFilled /><b>{c.unanswered || 0}</b><span>Not answered</span></div>
        <div className={`mr-key ${review.answersUnlocked ? 'open' : 'shut'}`}>
          {review.answersUnlocked ? <UnlockOutlined /> : <LockOutlined />}
          <div>
            <b>{review.answersUnlocked ? 'Correct answers are shown' : 'Correct answers are locked for now'}</b>
            <span>{review.lockedReason}</span>
          </div>
        </div>
      </div>}

      {topics.length > 0 && (
        <section className="mr-sec">
          <div className="mr-head"><span className="mr-icon"><BarChartOutlined /></span><div><b>Topic-wise result</b><span>Weakest topics first</span></div></div>
          <div className="mr-topics">
            {topics.map((t) => {
              const p = pct(t.correct, t.answered);
              return (
                <div key={t.topic} className={`mr-topic ${t.answered ? tone(p) : 'none'}`}>
                  <span className="mr-tname" title={t.topic}>{t.topic}</span>
                  <span className="mr-tbar"><i style={{ width: `${t.answered ? Math.max(p, 3) : 0}%` }} /></span>
                  <span className="mr-tres">{t.answered ? `${t.correct}/${t.answered}` : '—'}</span>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {review && <section className="mr-sec">
        <div className="mr-head">
          <span className="mr-icon bad"><AimOutlined /></span>
          <div>
            <b>Review your mistakes</b>
            <span>{mistakes.length ? `${mistakes.length} question${mistakes.length === 1 ? '' : 's'} to go over — your answer is marked in red${review.answersUnlocked ? ', the correct one in green' : ''}` : 'Nothing to review'}</span>
          </div>
        </div>

        {byTopic.length > 1 && (
          <div className="mr-filter" role="tablist" aria-label="Filter by topic">
            <button type="button" role="tab" aria-selected={!topic} className={`mr-chip${!topic ? ' on' : ''}`} onClick={() => setTopic('')}>All topics <i>{mistakes.length}</i></button>
            {byTopic.map(([name, n]) => (
              <button key={name} type="button" role="tab" aria-selected={topic === name} className={`mr-chip${topic === name ? ' on' : ''}`} onClick={() => setTopic(topic === name ? '' : name)}>
                {name} <i>{n}</i>
              </button>
            ))}
          </div>
        )}

        {mistakes.length === 0 ? (
          <div className="mr-perfect"><SmileOutlined /><b>No mistakes in this attempt</b><span>Every question you answered was correct.</span></div>
        ) : (
          <div className="mr-list">
            {shown.map((q) => (
              <QuestionCard key={q.attemptQuestionId} q={q} who="learner" lockedNote={review.answersUnlocked ? null : 'Correct answer unlocks once you qualify or use all attempts.'} />
            ))}
          </div>
        )}
      </section>}
    </div>
  );
}
