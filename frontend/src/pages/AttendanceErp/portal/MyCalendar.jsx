import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../api';
import { ErrorState, Skeleton, hm, todayKey, useLoad } from '../ui';

// E6 · My calendar — my days, leaves, holidays, weekly offs
const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const TAG = (d, tk) => {
  if (d.dayKey === tk && !['Leave', 'Holiday', 'Weekly Off'].includes(d.status)) return [`Today · ${hm(d.work)}`, 'rgba(79,70,229,.12)', '#4338CA'];
  if (d.holiday) return [d.holiday, 'rgba(124,58,237,.13)', '#6D28D9'];
  if (d.leave) return [`${d.leave} leave`, 'rgba(37,99,235,.13)', '#1D4ED8'];
  if (d.pending) return [`${d.pending} pending`, 'var(--e-card)', '#B45309', '1px dashed #F59E0B'];
  if (d.weeklyOff) return ['Weekly off', 'var(--e-line2)', '#475569'];
  if (d.status === 'Present') return [d.tags.includes('Late') ? 'Late' : 'Present', d.tags.includes('Late') ? 'rgba(245,158,11,.15)' : 'rgba(22,163,74,.13)', d.tags.includes('Late') ? '#B45309' : '#15803D'];
  if (['Short', 'Half Day', 'Absent', 'Needs review'].includes(d.status)) return [d.status, 'rgba(220,38,38,.1)', '#B91C1C'];
  return null;
};
const shiftMonth = (m, n) => {
  const d = new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)) - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
};

export default function MyCalendar() {
  const [month, setMonth] = useState(todayKey().slice(0, 7));
  const { data, loading, error, reload } = useLoad(() => api.get('me/calendar', { month }), [month]);
  const tk = todayKey();
  if (loading && !data) return <Skeleton rows={6} />;
  if (error && !data) return <ErrorState onRetry={() => reload()} />;
  const first = new Date(`${month}-01T12:00:00+05:30`);
  const lead = (first.getUTCDay() + 6) % 7;
  const cells = [...Array.from({ length: lead }).map(() => null), ...data.days];
  while (cells.length % 7) cells.push(null);
  const label = first.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
  return (
    <div className="e-page">
      <div className="e-head">
        <h1 className="e-h1" style={{ flex: 1, minWidth: 200 }}>
          My calendar
        </h1>
        <div className="e-row">
          <button type="button" className="e-btn sm" aria-label="Previous month" onClick={() => setMonth(shiftMonth(month, -1))}>
            ‹
          </button>
          <span className="e-btn" style={{ cursor: 'default', minWidth: 140 }}>
            {label}
          </span>
          <button type="button" className="e-btn sm" aria-label="Next month" onClick={() => setMonth(shiftMonth(month, 1))}>
            ›
          </button>
          <Link to="/employee/apply-leave" className="e-btn p">
            + Apply leave
          </Link>
        </div>
      </div>
      <div className="e-split">
        <section className="e-card main" style={{ overflow: 'hidden' }}>
          <div className="e-tw">
            <div style={{ minWidth: 560 }}>
              <div className="e-cal-h">
                {DOW.map((d) => (
                  <div key={d}>{d}</div>
                ))}
              </div>
              <div className="e-cal">
                {cells.map((d, i) => {
                  if (!d) return <div key={`x${i}`} className="e-day out" />;
                  const t = TAG(d, tk);
                  const showHrs = d.work > 0 && d.dayKey !== tk;
                  return (
                    <div key={d.dayKey} className={`e-day${d.weeklyOff ? ' off' : ''}`} style={{ minHeight: 104, ...(d.dayKey === tk ? { boxShadow: 'inset 0 0 0 2px var(--e-pri)' } : {}) }}>
                      <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--e-ink2)' }}>{Number(d.dayKey.slice(8))}</span>
                      {t && <span style={{ alignSelf: 'flex-start', fontSize: 11, fontWeight: 500, padding: '2px 7px', borderRadius: 6, background: t[1], color: t[2], border: t[3] || 'none', maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t[0]}</span>}
                      {showHrs && <span style={{ fontSize: 11, color: 'var(--e-mut)' }}>{hm(d.work)}</span>}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </section>
        <aside className="side">
          <section className="e-card pad">
            <h2 className="e-ct" style={{ marginBottom: 12 }}>
              Legend
            </h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 9, fontSize: 12, color: 'var(--e-ink2)' }}>
              {[
                ['rgba(22,163,74,.13)', 'Present (8h done)'],
                ['rgba(245,158,11,.15)', 'Late login'],
                ['rgba(220,38,38,.1)', 'Short / Half day / Absent'],
                ['rgba(37,99,235,.13)', 'Approved leave'],
                ['var(--e-card)', 'Pending leave', '1px dashed #F59E0B'],
                ['rgba(124,58,237,.13)', 'Holiday'],
                ['var(--e-line2)', 'Weekly off'],
              ].map(([bg, l, bd]) => (
                <div key={l} className="e-row" style={{ gap: 8 }}>
                  <i style={{ width: 14, height: 14, borderRadius: 4, background: bg, border: bd || 'none' }} />
                  {l}
                </div>
              ))}
            </div>
          </section>
          <section className="e-card pad">
            <h2 className="e-ct" style={{ marginBottom: 10 }}>
              {label.split(' ')[0]} {month === tk.slice(0, 7) ? 'so far' : ''}
            </h2>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,minmax(0,1fr))', gap: 12, fontSize: 12, color: 'var(--e-mut)' }}>
              <div>
                Present<b style={{ display: 'block', fontSize: 18, color: 'var(--e-ink)' }}>{data.summary.present}</b>
              </div>
              <div>
                Late<b style={{ display: 'block', fontSize: 18, color: 'var(--e-ink)' }}>{data.summary.late}</b>
              </div>
              <div>
                Leave<b style={{ display: 'block', fontSize: 18, color: 'var(--e-ink)' }}>{data.summary.leave}</b>
              </div>
              <div>
                Avg / day<b style={{ display: 'block', fontSize: 18, color: 'var(--e-ink)' }}>{hm(data.summary.avgWork)}</b>
              </div>
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}
