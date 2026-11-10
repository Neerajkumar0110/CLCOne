import React, { useCallback, useEffect, useState } from 'react';
import { Button, DatePicker, Empty, Input, Select, Skeleton, message } from 'antd';
import dayjs from 'dayjs';
import lmsApi from '../api';
import '../components/LearnerDesign.css';
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

  const chip = (st) => (st === 'Done' ? 'hai' : st === 'In progress' ? 'naya' : 'gray');
  return (
    <div className="ld-page pm">
      <div className="ld-hd" style={{ flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <h1>
            My feedback — {weekLabel(first && first.weekKey)} to {weekLabel(last && last.weekKey)}
          </h1>
          <div className="ld-muted" style={{ fontSize: 14 }}>Aggregated scores only · a respondent's name is never shown · a score appears only after at least {s.minResponses} responses</div>
        </div>
      </div>

      <div className="pm-g" style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.3fr) minmax(0, 1fr)', gap: 14 }}>
        <section className="ld-card" aria-label="Category averages" style={{ gap: 12 }}>
          <div className="ld-hd">
            <b>Category averages (out of 5)</b>
            <span className="ld-muted" style={{ fontSize: 12 }}>
              {latestWeek ? `${latestWeek.responses} responses · week of ${weekLabel(latestWeek.weekKey)}` : 'Not enough responses yet'}
            </span>
          </div>
          <div className="fb-bar" style={{ color: '#475569', fontSize: 12, fontWeight: 600 }}><span>Category</span><span /><span>Avg</span><span>vs prev</span></div>
          {s.categories.map((c) => (
            <div className="fb-bar" key={c.label}>
              <span>{c.label}</span>
              <div className="fb-trk"><div className="fb-fill" style={{ width: `${c.avg == null ? 0 : (c.avg / 5) * 100}%`, background: c.avg != null && c.avg < 3.8 ? '#c2410c' : '#4f46e5' }} /></div>
              <b>{c.avg === null ? '—' : c.avg.toFixed(1)}</b>
              <span className={c.delta > 0 ? 'fb-up' : c.delta < 0 ? 'fb-down' : 'ld-muted'}>{c.delta === null ? '—' : `${c.delta > 0 ? '+' : c.delta < 0 ? '−' : ''}${Math.abs(c.delta).toFixed(1)}`}</span>
            </div>
          ))}
          <div className="ld-muted" style={{ fontSize: 12 }}>Responses per week: {s.weeks.map((w) => `${weekLabel(w.weekKey)} · ${w.responses}`).join('  |  ')}</div>
        </section>
        <section className="ld-card" aria-label="Themes">
          <div className="ld-hd"><b>Themes</b><span className="ld-chip gray">HUMAN REVIEW</span></div>
          <div className="ld-muted" style={{ fontSize: 13, lineHeight: '20px' }}>
            Comment themes appear only after management reviews and shares them — no reviewed theme yet. Names or exact comments are never shown.
          </div>
          <div className="ld-muted" style={{ fontSize: 12, marginTop: 'auto' }}>Serious / conduct concerns don't come here — restricted management route</div>
        </section>
      </div>

      <section className="ld-card" aria-label="Improvement actions" style={{ flex: 1 }}>
        <div className="ld-hd">
          <b>Improvement actions</b>
          <span className="ld-muted" style={{ fontSize: 12 }}>owner · due · evidence · effectiveness check</span>
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
          <Button type="primary" disabled={!draft.action.trim()} loading={adding} onClick={add} style={{ background: '#4f46e5' }}>
            Add action
          </Button>
        </div>
        {actions.length === 0 ? (
          <div className="ld-empty">No actions yet.</div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="ld-table">
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
                      <span className={`ld-chip ${chip(a.status)}`} style={{ marginRight: 6 }}>{a.status}</span>
                      <Select
                        size="small"
                        aria-label={`Status of ${a.action}`}
                        value={a.status}
                        onChange={(v) => setStatus(a, v)}
                        options={STATUSES.map((x) => ({ value: x, label: x }))}
                        style={{ width: 120 }}
                        className={`fb-status-${STATUS_CHIP[a.status]}`}
                      />
                    </td>
                    <td className="ld-muted">{a.effectCheck || '—'}</td>
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
