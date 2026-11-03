import React, { useCallback, useEffect, useState } from 'react';
import { Button, DatePicker, Empty, Input, Select, Skeleton, message } from 'antd';
import dayjs from 'dayjs';
import lmsApi from '../api';
import '../StudentDashboard/StudentHome.css';
import './feedback.css';

// Project Manager's own feedback (design P7): category averages for the
// latest week with enough responses (never a name, never below the minimum),
// change vs the week before, and the improvement actions they commit to.

const STATUSES = ['Planned', 'In progress', 'Done'];
const STATUS_CHIP = { Planned: 'gray', 'In progress': 'info', Done: 'ok' };
const weekLabel = (k) => (k ? new Date(`${k}T00:00:00Z`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : '');

export default function PMFeedback() {
  const [s, setS] = useState(null);
  const [actions, setActions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState({ action: '', fromCategory: undefined, owner: '', due: null, effectCheck: '' });
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    const [a, b] = await Promise.all([lmsApi.feedbackMySummary().catch(() => null), lmsApi.feedbackActions().catch(() => null)]);
    setS((a && a.success !== false && a.result) || null);
    setActions((b && b.success !== false && b.result) || []);
    setLoading(false);
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  const add = async () => {
    setAdding(true);
    const r = await lmsApi.createFeedbackAction({ ...draft, due: draft.due ? draft.due.toISOString() : null }).catch(() => null);
    setAdding(false);
    if (!r || r.success === false) {
      message.error((r && r.message) || 'Could not add the action.');
      return;
    }
    setDraft({ action: '', fromCategory: undefined, owner: '', due: null, effectCheck: '' });
    setActions((xs) => [r.result, ...xs]);
  };
  const setStatus = async (row, status) => {
    const r = await lmsApi.updateFeedbackAction(row._id, { status }).catch(() => null);
    if (!r || r.success === false) {
      message.error((r && r.message) || 'Could not update.');
      return;
    }
    setActions((xs) => xs.map((x) => (x._id === row._id ? r.result : x)));
  };

  if (loading) return <Skeleton active paragraph={{ rows: 6 }} style={{ padding: 24 }} />;
  if (!s) return <Empty style={{ marginTop: 80 }} description="Could not load your feedback." />;

  const first = s.weeks[0];
  const last = s.weeks[s.weeks.length - 1];
  const latestWeek = s.weeks.find((w) => w.weekKey === s.latestWeek);

  return (
    <div className="sh-root lms-portal">
      <div className="sh-head">
        <div>
          <h1>
            My feedback — {weekLabel(first && first.weekKey)} to {weekLabel(last && last.weekKey)}
          </h1>
          <div className="sh-sub">Sirf aggregated scores · respondent ka naam kabhi nahi dikhta · minimum {s.minResponses} responses par hi score dikhega</div>
        </div>
      </div>

      <section className="sh-card" aria-label="Category averages">
        <div className="sh-card-hd">
          <b>Category averages (out of 5)</b>
          <span className="sh-muted">
            {latestWeek ? `${latestWeek.responses} responses · week of ${weekLabel(latestWeek.weekKey)}` : 'Not enough responses yet'}
          </span>
        </div>
        <div className="fb-table-wrap">
          <table className="fb-table">
            <thead>
              <tr>
                <th>Category</th>
                <th>Avg</th>
                <th>vs previous</th>
              </tr>
            </thead>
            <tbody>
              {s.categories.map((c) => (
                <tr key={c.label}>
                  <td>{c.label}</td>
                  <td>
                    <b>{c.avg === null ? '—' : c.avg.toFixed(1)}</b>
                  </td>
                  <td className={c.delta > 0 ? 'fb-up' : c.delta < 0 ? 'fb-down' : ''}>
                    {c.delta === null ? '—' : `${c.delta > 0 ? '+' : c.delta < 0 ? '−' : ''}${Math.abs(c.delta).toFixed(1)}`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="sh-muted">
          Responses per week: {s.weeks.map((w) => `${weekLabel(w.weekKey)} · ${w.responses}`).join('  |  ')}. Serious / conduct concerns never appear here —
          they go to management only.
        </div>
      </section>

      <section className="sh-card" aria-label="Improvement actions">
        <div className="sh-card-hd">
          <b>Improvement actions</b>
          <span className="sh-muted">owner · due · effect check</span>
        </div>
        <div className="fb-action-form">
          <Input aria-label="Action" placeholder="Action, e.g. Milestone reviews within 72 hours" value={draft.action} maxLength={300} onChange={(e) => setDraft((x) => ({ ...x, action: e.target.value }))} />
          <Select
            aria-label="From category"
            placeholder="From category"
            allowClear
            value={draft.fromCategory}
            onChange={(v) => setDraft((x) => ({ ...x, fromCategory: v }))}
            options={s.categories.map((c) => ({ value: c.label, label: c.label }))}
          />
          <Input aria-label="Owner" placeholder="Owner" value={draft.owner} onChange={(e) => setDraft((x) => ({ ...x, owner: e.target.value }))} />
          <DatePicker aria-label="Due date" value={draft.due} onChange={(v) => setDraft((x) => ({ ...x, due: v }))} />
          <Input aria-label="Effect check" placeholder="Effect check, e.g. W11 score" value={draft.effectCheck} onChange={(e) => setDraft((x) => ({ ...x, effectCheck: e.target.value }))} />
          <Button type="primary" disabled={!draft.action.trim()} loading={adding} onClick={add}>
            Add action
          </Button>
        </div>
        {actions.length === 0 ? (
          <div className="sh-muted">No actions yet.</div>
        ) : (
          <div className="fb-table-wrap">
            <table className="fb-table">
              <thead>
                <tr>
                  <th>Action</th>
                  <th>From</th>
                  <th>Owner</th>
                  <th>Due</th>
                  <th>Status</th>
                  <th>Effect check</th>
                </tr>
              </thead>
              <tbody>
                {actions.map((a) => (
                  <tr key={a._id}>
                    <td>{a.action}</td>
                    <td>{a.fromCategory || '—'}</td>
                    <td>{a.owner || '—'}</td>
                    <td>{a.due ? dayjs(a.due).format('D MMM') : '—'}</td>
                    <td>
                      <Select
                        size="small"
                        aria-label={`Status of ${a.action}`}
                        value={a.status}
                        onChange={(v) => setStatus(a, v)}
                        options={STATUSES.map((x) => ({ value: x, label: x }))}
                        style={{ width: 130 }}
                        className={`fb-status-${STATUS_CHIP[a.status]}`}
                      />
                    </td>
                    <td>{a.effectCheck || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
