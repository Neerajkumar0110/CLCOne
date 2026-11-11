import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Button, Empty, Select, Skeleton, message } from 'antd';
import lmsApi from '../api';
import '../StudentDashboard/StudentHome.css';
import './feedback.css';

// Feedback centre for Support / management (design S8): the weekly schedule,
// response rate per batch per week (submitted ÷ active learners), who hasn't
// responded this week (remind, max 2 a week), low-scoring areas and — for
// management only — serious concerns.

const weekLabel = (k) => (k ? new Date(`${k}T00:00:00Z`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : '');
const pctCls = (p) => (p === null ? '' : p >= 80 ? 'fb-up' : p < 60 ? 'fb-down' : '');

export default function FeedbackCentre() {
  const [d, setD] = useState(null);
  const [loading, setLoading] = useState(true);
  const [batch, setBatch] = useState(undefined);
  const [sending, setSending] = useState(false);

  const load = useCallback(async () => {
    const r = await lmsApi.feedbackAdminOverview(8).catch(() => null);
    setD((r && r.success !== false && r.result) || null);
    setLoading(false);
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  const batches = useMemo(() => (d ? d.responseRate.map((b) => b.batch) : []), [d]);
  useEffect(() => {
    if (!batch && batches.length) setBatch(batches[0]);
  }, [batches, batch]);

  if (loading) return <Skeleton active paragraph={{ rows: 8 }} style={{ padding: 24 }} />;
  if (!d) return <Empty style={{ marginTop: 60 }} description="Could not load the feedback centre." />;

  const nonResp = d.nonRespondents.filter((n) => n.batch === batch);
  const remind = async () => {
    setSending(true);
    const r = await lmsApi.feedbackAdminRemind(batch).catch(() => null);
    setSending(false);
    if (!r || r.success === false) {
      message.error((r && r.message) || 'Could not send reminders.');
      return;
    }
    message.success(r.message);
    load();
  };

  return (
    <div className="sh-root">
      <div className="sh-head">
        <div>
          <h1>Feedback centre</h1>
          <div className="sh-sub">
            Form v{d.schedule.formVersion} · opens {d.schedule.opens} · due {d.schedule.due} · late till {d.schedule.lateUntil} · max {d.schedule.maxReminders} reminders /
            week
          </div>
        </div>
      </div>

      <section className="sh-card" aria-label="Response rate by batch">
        <div className="sh-card-hd">
          <b>Response rate by batch</b>
          <span className="sh-muted">weekly form · submitted ÷ active learners</span>
        </div>
        {d.responseRate.length === 0 ? (
          <div className="sh-muted">No active batches.</div>
        ) : (
          <div className="fb-table-wrap">
            <table className="fb-table">
              <thead>
                <tr>
                  <th>Batch</th>
                  <th>Learners</th>
                  {d.weeks.map((k) => (
                    <th key={k}>{weekLabel(k)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {d.responseRate.map((b) => (
                  <tr key={b.batch}>
                    <td>
                      <b>{b.batch}</b>
                    </td>
                    <td>{b.eligible}</td>
                    {b.weeks.map((w) => (
                      <td key={w.weekKey} className={pctCls(w.pct)} title={`${w.submitted} of ${b.eligible}`}>
                        {w.open ? `${w.pct}% · open` : w.pct === null ? '—' : `${w.pct}%`}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <div className="fc-grid">
        <section className="sh-card" aria-label="Non-respondents">
          <div className="sh-card-hd" style={{ flexWrap: 'wrap' }}>
            <b>{d.focusWeek ? `Week of ${weekLabel(d.focusWeek)} · not submitted · ${nonResp.length}` : 'Not submitted'}</b>
            <span style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <Select aria-label="Batch" value={batch} onChange={setBatch} options={batches.map((b) => ({ value: b, label: b }))} style={{ minWidth: 160 }} />
              <Button type="primary" disabled={!d.window || !nonResp.length} loading={sending} onClick={remind}>
                Send reminder
              </Button>
            </span>
          </div>
          {!d.window && <div className="sh-muted">No feedback week is open right now — reminders can be sent while one is.</div>}
          {!d.focusWeek ? (
            <div className="sh-muted">No feedback week has opened yet.</div>
          ) : nonResp.length === 0 ? (
            <div className="sh-muted">Everyone in this batch has submitted.</div>
          ) : (
            <div>
              {nonResp.slice(0, 50).map((n) => (
                <div className="sh-row small" key={`${n.name}-${n.batch}`}>
                  <span>{n.name}</span>
                  <span className="sh-muted">
                    {n.reminders} reminder{n.reminders === 1 ? '' : 's'} · {n.weeksMissing} of last 3 weeks missing{n.lastEmail ? ` · last email ${n.lastEmail === 'sent' ? 'delivered' : n.lastEmail}` : ''}
                  </span>
                </div>
              ))}
              {nonResp.length > 50 && <div className="sh-muted">+ {nonResp.length - 50} more</div>}
            </div>
          )}
        </section>

        <section className="sh-card" aria-label="Concerns">
          <div className="sh-card-hd">
            <b>Concerns</b>
            <span className="sh-muted">low scores (avg below 3){d.focusWeek ? ` · week of ${weekLabel(d.focusWeek)}` : ''}</span>
          </div>
          {d.lowScores.length === 0 ? (
            <div className="sh-muted">No low-scoring areas this week (or not enough responses yet).</div>
          ) : (
            d.lowScores.map((l) => (
              <div className="sh-row small" key={`${l.batch}-${l.kind}-${l.question}`}>
                <span>
                  <b>{l.batch}</b> · {l.kind === 'pm' ? 'Project Manager' : 'Weekly'} · {l.question}
                </span>
                <span className="sh-chip bad">
                  {l.avg} · {l.responses} resp.
                </span>
              </div>
            ))
          )}
          <div className="sh-card-hd" style={{ marginTop: 8 }}>
            <b>Serious / conduct concerns</b>
            <span className="sh-chip warn">{d.concerns.restricted ? 'MGMT ONLY' : `${d.concerns.count}`}</span>
          </div>
          {d.concerns.restricted ? (
            <div className="sh-muted">
              {d.concerns.count} reported in the last 8 weeks — visible to management only.
            </div>
          ) : d.concerns.items.length === 0 ? (
            <div className="sh-muted">None reported in the last 8 weeks.</div>
          ) : (
            d.concerns.items.map((c, i) => (
              <div className="sh-row small" key={i}>
                <span style={{ whiteSpace: 'pre-wrap' }}>{c.text || '(no details given)'}</span>
                <span className="sh-muted">
                  {c.batch} · week of {weekLabel(c.weekKey)}
                </span>
              </div>
            ))
          )}
        </section>
      </div>
    </div>
  );
}
