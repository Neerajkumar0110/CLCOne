import React, { useEffect, useMemo, useState } from 'react';
import { request } from '@/request';
import { getSocket } from '@/socket';
import HubModal from '@/components/HubModal';
import LeadFullDetailModal from '@/components/LeadFullDetail';
import './chatStats.css';

// Header › WhatsApp / Messenger / Instagram › Report (user ask 2026-11-16):
// how many chats came in, how many got a call, how many we actually spoke to,
// who didn't pick up, every call result and lead stage — with the full list.
// Backend: facebookController/chats.js chatStats.

const RANGES = [
  ['today', 'Today'],
  ['yesterday', 'Yesterday'],
  ['7d', '7 days'],
  ['30d', '30 days'],
  ['all', 'All time'],
];
const RESULT = {
  talked: { label: 'Spoke with them', color: '#16a34a' },
  answeredNoAgent: { label: 'Picked up — agent didn’t join', color: '#d97706' },
  notAnswered: { label: 'Didn’t pick up / busy', color: '#dc2626' },
  never: { label: 'Not called yet', color: '#64748b' },
};
const STATUS_LABEL = { completed: 'Answered', failed: 'Failed / busy', 'no-answer': 'No answer', busy: 'Busy', cancelled: 'Cancelled', ringing: 'Ringing', dialing: 'Dialing', connected: 'On call', voicemail: 'Voicemail', queued: 'Queued' };
const pretty = (s) => String(s || '').toLowerCase().replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
const int = (n) => Number(n || 0).toLocaleString('en-IN');
const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);
const dur = (s) => {
  const v = Math.round(s || 0);
  if (!v) return '0s';
  const h = Math.floor(v / 3600);
  const m = Math.floor((v % 3600) / 60);
  return h ? `${h}h ${m}m` : m ? `${m}m ${v % 60}s` : `${v}s`;
};
const when = (d) => (d ? new Date(d).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : '—');
const fmtPhone = (p) => {
  const d = String(p || '').replace(/\D/g, '');
  if (d.length === 12 && d.startsWith('91')) return `+91 ${d.slice(2, 7)} ${d.slice(7)}`;
  if (d.length === 10) return `+91 ${d.slice(0, 5)} ${d.slice(5)}`;
  return p || '—';
};

function Bars({ data, total, colorOf }) {
  const entries = Object.entries(data || {}).sort((a, b) => b[1] - a[1]);
  if (!entries.length) return <div className="cs-empty">Nothing yet.</div>;
  const max = Math.max(...entries.map((e) => e[1]), 1);
  return (
    <div className="cs-bars">
      {entries.map(([k, v]) => (
        <div key={k} className="cs-bar">
          <span className="cs-bar-k" title={k}>{pretty(STATUS_LABEL[k] || k)}</span>
          <span className="cs-bar-track">
            <span style={{ width: `${(v / max) * 100}%`, background: colorOf ? colorOf(k) : undefined }} />
          </span>
          <span className="cs-bar-v">
            {int(v)}
            {total ? <small> · {pct(v, total)}%</small> : null}
          </span>
        </div>
      ))}
    </div>
  );
}

export default function ChatStatsModal({ open, onClose, channel = 'whatsapp', label = 'WhatsApp' }) {
  const [range, setRange] = useState('today');
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState('');
  const [q, setQ] = useState('');
  const [viewLead, setViewLead] = useState(null);
  const [queueing, setQueueing] = useState(false);
  const [queueMsg, setQueueMsg] = useState('');

  // every chat nobody has spoken to → New Lead, first in the dialer's line
  const requeue = async () => {
    if (!window.confirm(`Move every ${label} chat nobody has spoken to into New Lead, first in the dialer's line?`)) return;
    setQueueing(true);
    setQueueMsg('');
    const res = await request.post({ entity: `facebook/chats/requeue-uncontacted?channel=${channel}`, jsonData: {} });
    setQueueing(false);
    setQueueMsg(res?.success ? res.message : res?.message || 'Could not queue them.');
    load();
  };

  const load = async (r = range) => {
    setLoading(true);
    const res = await request.get({ entity: `facebook/chats/stats?channel=${channel}&range=${r}` });
    setLoading(false);
    if (res?.success) {
      setData(res.result);
      setErr('');
    } else setErr(res?.message || 'Could not load the report.');
  };

  useEffect(() => {
    if (open) load(range);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, range, channel]);

  // live: a new chat / reply → refresh (debounced)
  useEffect(() => {
    if (!open) return undefined;
    const s = getSocket();
    let t = null;
    const on = (p) => {
      if (p?.channel && p.channel !== channel) return;
      clearTimeout(t);
      t = setTimeout(() => load(), 1500);
    };
    s?.on('lead:chat', on);
    return () => {
      clearTimeout(t);
      s?.off('lead:chat', on);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, range, channel]);

  const T = data?.totals;
  const rows = useMemo(() => {
    let r = data?.rows || [];
    if (filter) r = r.filter((x) => (filter === 'form' ? x.form : filter === 'unread' ? x.unread : x.result === filter));
    const s = q.trim().toLowerCase();
    if (s) r = r.filter((x) => `${x.name} ${x.phone} ${x.stage} ${x.disposition || ''} ${x.ad || ''} ${x.lastAgent || ''}`.toLowerCase().includes(s));
    return r;
  }, [data, filter, q]);

  const exportCsv = () => {
    const head = ['Name', 'Phone', 'Chat started', 'Last message', 'Messages in', 'Messages out', 'From ad', 'Calls', 'Result', 'Talk time (s)', 'Last call', 'Last call status', 'Agent', 'Call result', 'Stage', 'Sub-status', 'Assigned to', 'Form filled', 'Unread'];
    const esc = (v) => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;
    const lines = (data?.rows || []).map((r) =>
      [r.name, r.phone, when(r.startedAt), when(r.lastAt), r.msgsIn, r.msgsOut, r.ad || '', r.calls, RESULT[r.result]?.label, r.talkSec, when(r.lastCallAt), r.lastCallStatus || '', r.lastAgent || '', r.disposition ? pretty(r.disposition) : '', r.stage, r.subStatus, r.assignedTo || '', r.form ? 'Yes' : '', r.unread ? 'Yes' : ''].map(esc).join(',')
    );
    const blob = new Blob([[head.map(esc).join(','), ...lines].join('\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${label}-chats-${range}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };

  const funnel = T
    ? [
        ['talked', T.talked],
        ['answeredNoAgent', T.answeredNoAgent],
        ['notAnswered', T.notAnswered],
        ['never', T.neverCalled],
      ]
    : [];
  const maxDay = Math.max(1, ...((data?.daily || []).map((d) => d.chats)));

  return (
    <HubModal open={open} onClose={onClose} title={`${label} chats — report`} subtitle="Chats that started in the period, and every call and result since — live" width={1240}>
      <div className="cs">
        <div className="cs-top">
          <div className="cs-chips">
            {RANGES.map(([k, l]) => (
              <button key={k} type="button" className={`cs-chip ${range === k ? 'on' : ''}`} onClick={() => setRange(k)}>
                {l}
              </button>
            ))}
          </div>
          <div className="cs-actions">
            {data && <span className="cs-muted">Updated {new Date(data.generatedAt).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })}</span>}
            <button type="button" className="hub-btn" onClick={() => load()} disabled={loading}>{loading ? 'Loading…' : 'Refresh'}</button>
            <button type="button" className="hub-btn" onClick={exportCsv} disabled={!data?.rows?.length}>Download CSV</button>
            <button type="button" className="hub-btn hub-btn-primary" onClick={requeue} disabled={queueing} title="Not contacted = never called, didn't pick up, or the agent never joined">
              {queueing ? 'Queuing…' : 'Not contacted → New Lead (call first)'}
            </button>
          </div>
        </div>

        {err && <div className="cs-err">{err}</div>}
        {queueMsg && <div className="cs-ok">{queueMsg}</div>}
        {!data && !err && <div className="cs-empty">Loading report…</div>}

        {T && (
          <>
            {/* KPI tiles */}
            <div className="cs-kpis">
              {[
                ['Chats', T.chats, `${int(T.unread)} unread`, '#25d366'],
                ['Contacted', T.contacted ?? T.talked, `${pct(T.contacted ?? T.talked, T.chats)}% — an agent spoke with them`, '#16a34a'],
                ['Not contacted', T.notContacted ?? T.chats - T.talked, 'Never called / didn’t pick up / agent didn’t join — go to New Lead, called first', '#dc2626'],
                ['Messages received', T.msgsIn, `${int(T.msgsOut)} sent by us`, '#0ea5e9'],
                ['Got a call', T.called, `${pct(T.called, T.chats)}% of chats · ${int(T.callAttempts)} attempts`, '#6366f1'],
                ['Spoke with', T.talked, `${pct(T.talked, T.chats)}% of chats · ${dur(T.talkSec)} talk`, '#16a34a'],
                ['Didn’t pick up', T.notAnswered, `${int(T.answeredNoAgent)} picked up, agent didn’t join`, '#dc2626'],
                ['Not called yet', T.neverCalled, `${pct(T.neverCalled, T.chats)}% of chats`, '#64748b'],
                ['From an ad', T.fromAd, `${pct(T.fromAd, T.chats)}% of chats`, '#e1306c'],
                ['Forms filled', T.formsFilled, `${int(T.autoWelcome)} auto-welcomes · ${int(T.curriculumSent)} curricula`, '#7c3aed'],
              ].map(([k, v, sub, c]) => (
                <div key={k} className="cs-kpi" style={{ '--c': c }}>
                  <b>{int(v)}</b>
                  <span>{k}</span>
                  <small>{sub}</small>
                </div>
              ))}
            </div>

            {/* call outcome stack */}
            <div className="cs-card">
              <div className="cs-h">What happened with these {int(T.chats)} chats</div>
              <div className="cs-stack" role="img" aria-label="Call outcome split">
                {funnel.map(([k, v]) => (v ? <span key={k} style={{ flex: v, background: RESULT[k].color }} title={`${RESULT[k].label}: ${v}`} /> : null))}
              </div>
              <div className="cs-legend">
                {funnel.map(([k, v]) => (
                  <button key={k} type="button" className={`cs-leg ${filter === k ? 'on' : ''}`} onClick={() => setFilter(filter === k ? '' : k)}>
                    <i style={{ background: RESULT[k].color }} />
                    {RESULT[k].label} <b>{int(v)}</b> <small>{pct(v, T.chats)}%</small>
                  </button>
                ))}
              </div>
            </div>

            <div className="cs-grid">
              <div className="cs-card">
                <div className="cs-h">Every call attempt <small>({int(T.callAttempts)})</small></div>
                <Bars data={data.attemptStatus} total={T.callAttempts} colorOf={(k) => (k === 'completed' ? '#16a34a' : k === 'failed' || k === 'busy' || k === 'no-answer' ? '#dc2626' : '#64748b')} />
              </div>
              <div className="cs-card">
                <div className="cs-h">Call results (what the agent marked)</div>
                <Bars data={data.dispositions} total={Object.values(data.dispositions || {}).reduce((a, b) => a + b, 0)} />
              </div>
              <div className="cs-card">
                <div className="cs-h">Lead stage now</div>
                <Bars data={data.stages} total={T.chats} colorOf={() => '#6366f1'} />
              </div>
            </div>

            {data.daily.length > 1 && (
              <div className="cs-card">
                <div className="cs-h">Per day — chats / called / spoke</div>
                <div className="cs-days">
                  {data.daily.map((d) => (
                    <div key={d.date} className="cs-day" title={`${d.date}: ${d.chats} chats · ${d.called} called · ${d.talked} spoke`}>
                      <div className="cs-day-bars">
                        <span style={{ height: `${(d.chats / maxDay) * 100}%`, background: '#25d366' }} />
                        <span style={{ height: `${(d.called / maxDay) * 100}%`, background: '#6366f1' }} />
                        <span style={{ height: `${(d.talked / maxDay) * 100}%`, background: '#16a34a' }} />
                      </div>
                      <small>{d.date.slice(8)}/{d.date.slice(5, 7)}</small>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* every chat */}
            <div className="cs-card">
              <div className="cs-list-top">
                <div className="cs-h" style={{ margin: 0 }}>
                  All chats <small>({int(rows.length)}{filter || q ? ` of ${int(data.rows.length)}` : ''})</small>
                </div>
                <div className="cs-chips">
                  {[['', 'All'], ['talked', 'Spoke'], ['notAnswered', 'Didn’t pick up'], ['answeredNoAgent', 'Agent didn’t join'], ['never', 'Not called'], ['unread', 'Unread'], ['form', 'Form filled']].map(([k, l]) => (
                    <button key={k || 'all'} type="button" className={`cs-chip sm ${filter === k ? 'on' : ''}`} onClick={() => setFilter(k)}>
                      {l}
                    </button>
                  ))}
                </div>
                <input className="cs-search" placeholder="Search name, number, stage, agent…" value={q} onChange={(e) => setQ(e.target.value)} />
              </div>
              <div className="cs-table-wrap">
                <table className="cs-table">
                  <thead>
                    <tr>
                      <th>Customer</th>
                      <th>Chat</th>
                      <th>Msgs</th>
                      <th>Calls</th>
                      <th>Result</th>
                      <th>Talk</th>
                      <th>Last call</th>
                      <th>Call result</th>
                      <th>Stage</th>
                      <th>Form</th>
                    </tr>
                  </thead>
                  <tbody>
                    {!rows.length && (
                      <tr>
                        <td colSpan={10}><div className="cs-empty">No chats here.</div></td>
                      </tr>
                    )}
                    {rows.map((r) => (
                      <tr key={r._id} onClick={() => setViewLead({ _id: r._id, name: r.name })} title="Open lead">
                        <td>
                          <b>{r.name}</b>
                          {r.unread && <i className="cs-dot" aria-label="unread" />}
                          <div className="cs-muted">{fmtPhone(r.phone)}</div>
                        </td>
                        <td>
                          {when(r.startedAt)}
                          {r.ad && <div className="cs-muted" title={r.ad}>Ad · {r.ad.length > 22 ? `${r.ad.slice(0, 22)}…` : r.ad}</div>}
                        </td>
                        <td>
                          {r.msgsIn}
                          <span className="cs-muted"> / {r.msgsOut}</span>
                        </td>
                        <td>{r.calls}</td>
                        <td>
                          <span className="cs-pill" style={{ '--c': RESULT[r.result].color }}>{RESULT[r.result].label}</span>
                        </td>
                        <td>{r.talkSec ? dur(r.talkSec) : '—'}</td>
                        <td>
                          {when(r.lastCallAt)}
                          {r.lastCallStatus && <div className="cs-muted">{STATUS_LABEL[r.lastCallStatus] || r.lastCallStatus}{r.lastAgent ? ` · ${r.lastAgent}` : ''}</div>}
                        </td>
                        <td>{r.disposition ? pretty(r.disposition) : '—'}</td>
                        <td>
                          {r.stage}
                          {r.assignedTo && <div className="cs-muted">{r.assignedTo}</div>}
                        </td>
                        <td>{r.form ? '✅' : r.welcome ? <span className="cs-muted">link sent</span> : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}
      </div>
      {viewLead && <LeadFullDetailModal lead={viewLead} onClose={() => setViewLead(null)} />}
    </HubModal>
  );
}
