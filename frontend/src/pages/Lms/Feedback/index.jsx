import React, { useCallback, useEffect, useState } from 'react';
import { Button, Checkbox, Empty, Input, Skeleton, message } from 'antd';
import { useNavigate } from 'react-router-dom';
import lmsApi from '../api';
import '../StudentDashboard/StudentHome.css';
import './feedback.css';

// Learner weekly feedback (design L7, backend lmsController/feedback.js):
// week-by-week history, then this week's two short forms — the week in
// general, and the batch's Project Manager (confidential; optional serious
// concern goes to management only).

const when = (v) => (v ? new Date(v).toLocaleString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : '');
const STATE = {
  submitted: { cls: 'ok', label: '' },
  late: { cls: 'warn', label: 'late' },
  missing: { cls: 'bad', label: 'missed' },
  open: { cls: 'info', label: 'due' },
};
// one chip per week: worst of the two forms
const RANK = { missing: 0, open: 1, late: 2, submitted: 3 };
const weekState = (h) => (RANK[h.weekly] <= RANK[h.pm] ? h.weekly : h.pm);

function RatingRow({ text, value, onChange }) {
  return (
    <div className="fb-q">
      <div className="fb-q-text">{text}</div>
      <div className="fb-scale" role="radiogroup" aria-label={text}>
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            role="radio"
            aria-checked={value === n}
            aria-label={`${text} ${n} of 5`}
            className={value === n ? 'on' : ''}
            onClick={() => onChange(n)}
          >
            {n}
          </button>
        ))}
      </div>
    </div>
  );
}

export default function WeeklyFeedback() {
  const [d, setD] = useState(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('weekly');
  const [answers, setAnswers] = useState({ weekly: [], pm: [] });
  const [comment, setComment] = useState({ weekly: '', pm: '' });
  const [concern, setConcern] = useState(false);
  const [concernText, setConcernText] = useState('');
  const [saving, setSaving] = useState(false);
  const navigate = useNavigate();

  const load = useCallback(async () => {
    const r = await lmsApi.myFeedback().catch(() => null);
    setD((r && r.success !== false && r.result) || null);
    setLoading(false);
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  if (loading) return <Skeleton active paragraph={{ rows: 6 }} style={{ padding: 24 }} />;
  if (!d) return <Empty style={{ marginTop: 80 }} description="Could not load your feedback." />;
  if (!d.enrolled) return <Empty style={{ marginTop: 80 }} description="Feedback opens once you are in an active batch." />;

  const qs = d.questions[tab] || [];
  const mine = answers[tab];
  const complete = qs.length > 0 && qs.every((_, i) => mine[i]);
  const done = d.submitted && d.submitted[tab];
  const win = d.window;

  const submit = async () => {
    setSaving(true);
    const r = await lmsApi
      .submitFeedback({ kind: tab, answers: qs.map((_, i) => mine[i]), comment: comment[tab], concern: tab === 'pm' && concern, concernText: tab === 'pm' && concern ? concernText : undefined })
      .catch(() => null);
    setSaving(false);
    if (!r || r.success === false) {
      message.error((r && r.message) || 'Could not submit your feedback.');
      return;
    }
    message.success(r.message || 'Thanks!');
    if (tab === 'pm') {
      setConcern(false);
      setConcernText('');
    }
    load();
  };

  return (
    <div className="sh-root lms-portal">
      <div className="sh-head">
        <div>
          <h1>Feedback</h1>
          <div className="sh-sub">Har hafte mandatory · 2–3 minute · aapka feedback batch ke Project Manager aur management tak pahunchta hai</div>
        </div>
      </div>

      <section className="sh-card" aria-label="Week-by-week history">
        <div className="sh-card-hd">
          <b>Week-by-week history</b>
          <span className="sh-muted">{d.batch}</span>
        </div>
        {d.history.length === 0 && <div className="sh-muted">Your weekly history will appear here after the first feedback week.</div>}
        <ol className="fb-weeks">
          {d.history.map((h) => {
            const st = STATE[weekState(h)];
            return (
              <li key={h.weekKey} className={st.cls} title={`Week of ${h.weekKey} · weekly: ${h.weekly} · PM: ${h.pm}`}>
                <b>{h.label}</b>
                {st.label && <span>{st.label}</span>}
              </li>
            );
          })}
        </ol>
      </section>

      {!win ? (
        <section className="sh-card">
          <b>This week&apos;s feedback opens {when(d.nextOpensAt)}.</b>
          <div className="sh-muted">Each week the form opens on Friday evening and is due Sunday night.</div>
        </section>
      ) : (
        <section className="sh-card" aria-label="This week's feedback">
          <div className="fb-tabs" role="tablist">
            <button type="button" role="tab" aria-selected={tab === 'weekly'} className={tab === 'weekly' ? 'on' : ''} onClick={() => setTab('weekly')}>
              Weekly feedback {d.submitted.weekly && '✓'}
            </button>
            <button type="button" role="tab" aria-selected={tab === 'pm'} className={tab === 'pm' ? 'on' : ''} onClick={() => setTab('pm')}>
              Project Manager feedback{d.pmName ? ` · ${d.pmName}` : ''} {d.submitted.pm && '✓'}
            </button>
          </div>
          <div className="sh-muted">
            {win.late ? `Late submission for the week of ${win.weekKey} — accepted until ${when(win.lateUntil)}.` : `Due ${when(win.dueAt)}.`}
          </div>

          {done ? (
            <div className="fb-done">Submitted for this week — thank you.</div>
          ) : (
            <>
              {qs.map((q, i) => (
                <RatingRow
                  key={q}
                  text={q}
                  value={mine[i]}
                  onChange={(n) =>
                    setAnswers((a) => {
                      const next = [...a[tab]];
                      next[i] = n;
                      return { ...a, [tab]: next };
                    })
                  }
                />
              ))}
              <Input.TextArea
                aria-label="Comments"
                rows={3}
                maxLength={2000}
                value={comment[tab]}
                onChange={(e) => setComment((c) => ({ ...c, [tab]: e.target.value }))}
                placeholder="Kya achha raha, kya badalna chahiye?"
              />
              {tab === 'pm' && (
                <div className="fb-concern">
                  <Checkbox checked={concern} onChange={(e) => setConcern(e.target.checked)}>
                    Mujhe ek gambhir concern report karna hai (conduct / safety) — sirf authorised management dekhega
                  </Checkbox>
                  {concern && (
                    <Input.TextArea aria-label="Concern details" rows={3} maxLength={2000} value={concernText} onChange={(e) => setConcernText(e.target.value)} placeholder="What happened? Only management will read this." />
                  )}
                  <div className="sh-muted">Confidential: aapka naam Project Manager ko nahi dikhega. Sirf category averages aur trends share hote hain.</div>
                </div>
              )}
              <div className="sh-card-hd" style={{ flexWrap: 'wrap' }}>
                <span className="sh-muted">
                  Form v{d.formVersion} ·{' '}
                  <button type="button" className="sh-link" onClick={() => navigate('/learn/support', { state: { raise: { category: 'Login / Technical', subject: 'Problem with the weekly feedback form' } } })}>
                    form me problem?
                  </button>
                </span>
                <Button type="primary" disabled={!complete || (concern && !concernText.trim())} loading={saving} onClick={submit}>
                  Submit
                </Button>
              </div>
            </>
          )}
        </section>
      )}
    </div>
  );
}
