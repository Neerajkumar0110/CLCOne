import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../api';
import { B, Bar, Empty, ErrorState, Select, Seg, Skeleton, Trunc, clock, dateLabel, useLoad, useToast } from '../ui';

// E4 · My Leaves — balances + history (own leaves only)
const BAL_C = { Casual: '#4F46E5', Sick: '#0EA5E9', Earned: '#16A34A', Emergency: '#F59E0B', Other: '#94A3B8' };

export default function MyLeaves() {
  const toast = useToast();
  const [status, setStatus] = useState('All');
  const [type, setType] = useState('All');
  const [year, setYear] = useState(String(new Date().getFullYear()));
  const { data, loading, error, reload } = useLoad(() => api.get('me/leaves', { status, type, year }), [status, type, year]);
  const cancel = async (l) => {
    if (!window.confirm(`Cancel your ${l.leaveType} leave request for ${l.label}?`)) return;
    const r = await api.post(`me/leaves/${l._id}/cancel`);
    toast.res(r, 'Request cancelled');
    if (r.success) reload(true);
  };
  if (loading && !data) return <Skeleton kpis={4} rows={6} />;
  if (error && !data) return <ErrorState onRetry={() => reload()} />;
  const c = data.counts;
  return (
    <div className="e-page">
      <div className="e-head">
        <div>
          <h1 className="e-h1">My leaves</h1>
          <p className="e-sub">{year} balance resets on 1 Jan. You get an email when a request is answered.</p>
        </div>
        <Link to="/employee/apply-leave" className="e-btn p">
          + Apply leave
        </Link>
      </div>
      <div className="e-kpis" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))' }}>
        {data.balance
          .filter((b) => b.total > 0 || b.used > 0)
          .map((b) => (
            <div key={b.type} className="e-kpi">
              <div className="e-row" style={{ gap: 8 }}>
                <span style={{ width: 10, height: 10, borderRadius: 3, background: BAL_C[b.type] }} />
                <span style={{ fontSize: 13, fontWeight: 600, flex: 1 }}>{b.type} Leave</span>
              </div>
              <div className="e-kv">
                {b.left} <span style={{ fontSize: 13, color: 'var(--e-mut)', fontWeight: 500 }}>days left</span>
              </div>
              <Bar pct={b.total ? (b.left / b.total) * 100 : 0} color={BAL_C[b.type]} style={{ marginTop: 10 }} />
              <div className="e-ks" style={{ marginTop: 6 }}>
                {b.used} used of {b.total}
                {b.pending ? ` · ${b.pending} pending` : ''}
              </div>
            </div>
          ))}
      </div>
      <div className="e-row" style={{ gap: 10 }}>
        <Seg value={status} onChange={setStatus} options={[['All', `All ${c.All || 0}`], ['Pending', `Pending ${c.Pending || 0}`], ['Approved', `Approved ${c.Approved || 0}`], ['Rejected', `Rejected ${c.Rejected || 0}`]]} />
        <Select label="Type" value={type} onChange={setType} options={['All', ...data.types]} />
        <Select label="Year" value={year} onChange={setYear} options={[0, 1, 2].map((i) => String(new Date().getFullYear() - i))} />
      </div>
      <section className="e-card">
        {data.list.length === 0 && <Empty title="No leaves here" text="Requests you send show here with their status." icon="file" action={<Link to="/employee/apply-leave" className="e-btn p">Apply leave</Link>} />}
        {data.list.map((l) => {
          const d = new Date(l.fromDate);
          return (
            <div key={l._id} className="e-li" style={{ gap: 16 }}>
              <div style={{ width: 62, flex: 'none', textAlign: 'center', border: '1px solid var(--e-line)', borderRadius: 10, padding: '6px 0' }}>
                <div style={{ fontSize: 11, color: 'var(--e-mut)', fontWeight: 600 }}>{d.toLocaleDateString('en-GB', { timeZone: 'Asia/Kolkata', month: 'short' }).toUpperCase()}</div>
                <div style={{ fontSize: 20, fontWeight: 700 }}>{d.toLocaleDateString('en-GB', { timeZone: 'Asia/Kolkata', day: 'numeric' })}</div>
              </div>
              <div style={{ flex: 1, minWidth: 220 }}>
                <div className="e-row" style={{ gap: 8 }}>
                  <b style={{ fontSize: 14 }}>{l.leaveType} Leave</b>
                  <B>{l.status}</B>
                </div>
                <div style={{ fontSize: 13, color: 'var(--e-ink2)', marginTop: 4 }}>
                  {l.label} · {l.days} day{l.days === 1 ? '' : 's'}
                </div>
                <Trunc text={`Reason: ${l.reason || '—'}`} style={{ fontSize: 12, color: 'var(--e-mut)', marginTop: 4, maxWidth: 520 }} />
                {l.status === 'Pending' && <div className="e-note warn" style={{ marginTop: 8, padding: '8px 10px' }}>Sent {dateLabel(l.appliedOn || l.created, { year: false })}, {clock(l.appliedOn || l.created)} · waiting for HR</div>}
                {l.status === 'Approved' && <div className="e-note ok" style={{ marginTop: 8, padding: '8px 10px' }}>Approved{l.decisionBy ? ` by ${l.decisionBy}` : ''}{l.decisionDate ? ` · ${dateLabel(l.decisionDate, { year: false })}` : ''}</div>}
                {l.status === 'Rejected' && (
                  <div className="e-note err" style={{ marginTop: 8, padding: '8px 10px' }}>
                    Rejected{l.decisionBy ? ` by ${l.decisionBy}` : ''}: {l.decisionNote || 'no reason given'}
                  </div>
                )}
              </div>
              {(l.status === 'Pending' || (l.status === 'Approved' && new Date(l.fromDate) > new Date())) && (
                <button type="button" className="e-btn sm d" onClick={() => cancel(l)}>
                  Cancel request
                </button>
              )}
            </div>
          );
        })}
      </section>
    </div>
  );
}
