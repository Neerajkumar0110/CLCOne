import React, { useState } from 'react';
import api from '../api';
import { B, ErrorState, Select, Skeleton, dateLabel, todayKey, useErpLive, useLoad } from '../ui';
import { deptOptions, empOptions, useDecide, useLite } from './shared';

// A6 · Leave calendar
const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const short = (n) => {
  const p = String(n || '').split(' ');
  return p.length > 1 ? `${p[0]} ${p[1][0]}.` : p[0];
};
const shiftMonth = (m, n) => {
  const d = new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)) - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
};

export default function Calendar() {
  const lite = useLite();
  const [month, setMonth] = useState(todayKey().slice(0, 7));
  const [dept, setDept] = useState('All');
  const [employee, setEmployee] = useState('All');
  const [sel, setSel] = useState(null);
  const { data, loading, error, reload } = useLoad(() => api.get('admin/calendar', { month, dept, employee }), [month, dept, employee]);
  useErpLive(() => reload(true));
  const { approve, reject, dialog } = useDecide(() => {
    setSel(null);
    reload(true);
  });
  const tk = todayKey();
  const cells = [];
  if (data) {
    const first = new Date(`${month}-01T12:00:00+05:30`);
    const dow = (first.getUTCDay() + 6) % 7; // Monday first
    const start = new Date(first.getTime() - dow * 864e5);
    for (let i = 0; i < 42; i += 1) {
      const k = new Date(start.getTime() + i * 864e5).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
      const inM = k.slice(0, 7) === month;
      const wd = new Date(`${k}T12:00:00+05:30`).getUTCDay();
      const evs = inM ? data.leaves.filter((l) => l.fromKey <= k && l.toKey >= k) : [];
      cells.push({ k, inM, off: data.weeklyOff.includes(wd), hol: data.holidays[k], evs });
    }
    while (cells.length > 35 && cells.slice(-7).every((c) => !c.inM)) cells.splice(-7, 7);
  }
  const monthLabel = new Date(`${month}-15T12:00:00+05:30`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
  return (
    <div className="e-page">
      <div className="e-head">
        <h1 className="e-h1" style={{ flex: 1, minWidth: 200 }}>
          Leave calendar
        </h1>
        <div className="e-row" style={{ gap: 8 }}>
          <button type="button" className="e-btn sm" aria-label="Previous month" onClick={() => setMonth(shiftMonth(month, -1))}>
            ‹
          </button>
          <span className="e-btn" style={{ cursor: 'default', minWidth: 140 }}>
            {monthLabel}
          </span>
          <button type="button" className="e-btn sm" aria-label="Next month" onClick={() => setMonth(shiftMonth(month, 1))}>
            ›
          </button>
          <button type="button" className="e-btn" onClick={() => setMonth(tk.slice(0, 7))}>
            Today
          </button>
          <Select label="Department" value={dept} onChange={setDept} options={deptOptions(lite)} />
          <Select label="Employee" value={employee} onChange={setEmployee} options={empOptions(lite)} style={{ maxWidth: 220 }} />
        </div>
      </div>
      {loading && !data ? (
        <Skeleton rows={6} />
      ) : error && !data ? (
        <ErrorState onRetry={() => reload()} />
      ) : (
        <div className="e-split">
          <section className="e-card main" style={{ overflow: 'hidden' }}>
            <div className="e-tw">
              <div style={{ minWidth: 640 }}>
                <div className="e-cal-h">
                  {DOW.map((d) => (
                    <div key={d}>{d}</div>
                  ))}
                </div>
                <div className="e-cal">
                  {cells.map((c) => (
                    <div key={c.k} className={`e-day${c.off ? ' off' : ''}${c.inM ? '' : ' out'}`}>
                      <div className="e-row" style={{ justifyContent: 'space-between', flexWrap: 'nowrap' }}>
                        <span className={`n${c.k === tk ? ' today' : ''}`}>{Number(c.k.slice(8))}</span>
                        {c.off && c.inM && <span style={{ fontSize: 10, color: 'var(--e-mut)' }}>Weekly off</span>}
                      </div>
                      {c.hol && (
                        <span className="e-ev ho" title={c.hol}>
                          {c.hol}
                        </span>
                      )}
                      {c.evs.slice(0, 3).map((l) => (
                        <button key={l._id} type="button" className={`e-ev ${l.status === 'Approved' ? 'ap' : l.status === 'Pending' ? 'pe' : 'rj'}`} title={`${l.employee} · ${l.leaveType} · ${l.status}`} onClick={() => setSel(l)}>
                          {short(l.employee)} · {l.leaveType === 'Casual' ? 'CL' : l.leaveType === 'Sick' ? 'SL' : l.leaveType === 'Earned' ? 'EL' : l.leaveType}
                        </button>
                      ))}
                      {c.evs.length > 3 && <span style={{ fontSize: 11, color: 'var(--e-mut)' }}>+{c.evs.length - 3} more</span>}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </section>
          <aside className="side">
            <section className="e-card pad">
              <h2 className="e-ct" style={{ marginBottom: 12 }}>
                Legend
              </h2>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, fontSize: 12, color: 'var(--e-ink2)' }}>
                {[
                  ['rgba(37,99,235,.13)', 'Approved leave', ''],
                  ['var(--e-card)', 'Pending leave', '1px dashed #F59E0B'],
                  ['rgba(124,58,237,.13)', 'Holiday', ''],
                  ['var(--e-soft)', `Weekly off (${(data.weeklyOff || []).map((d) => DAYS[d]).join(', ')})`, '1px solid var(--e-line)'],
                  ['var(--e-card)', 'Today', '2px solid var(--e-pri)'],
                ].map(([bg, l, bd]) => (
                  <div key={l} className="e-row" style={{ gap: 8 }}>
                    <i style={{ width: 14, height: 14, borderRadius: 4, background: bg, border: bd || 'none' }} />
                    {l}
                  </div>
                ))}
              </div>
            </section>
            {sel && (
              <section className="e-card pad">
                <div className="e-row" style={{ gap: 8 }}>
                  <h2 className="e-ct" style={{ flex: 1 }}>
                    {sel.employee}
                  </h2>
                  <B>{sel.status}</B>
                </div>
                <p className="e-cs">Opened by clicking the leave on {dateLabel(sel.fromKey, { year: false })}</p>
                <div className="e-kv2" style={{ marginTop: 14 }}>
                  <div>
                    Type<b>{sel.leaveType} Leave</b>
                  </div>
                  <div>
                    Days<b>
                      {sel.days} ({sel.label})
                    </b>
                  </div>
                </div>
                <div style={{ fontSize: 12, color: 'var(--e-mut)', marginTop: 12 }}>Reason</div>
                <div style={{ fontSize: 13, marginTop: 3 }}>{sel.reason || '—'}</div>
                {sel.status === 'Pending' && (
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,minmax(0,1fr))', gap: 8, marginTop: 14 }}>
                    <button type="button" className="e-btn sm d" onClick={() => reject({ ...sel, label: sel.label })}>
                      Reject
                    </button>
                    <button type="button" className="e-btn sm ok" onClick={() => approve(sel)}>
                      Approve
                    </button>
                  </div>
                )}
              </section>
            )}
            <section className="e-card pad">
              <h2 className="e-ct" style={{ marginBottom: 10 }}>
                Coming up
              </h2>
              {data.upcoming.length === 0 && <p className="e-cs">Nothing coming up.</p>}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, fontSize: 13 }}>
                {data.upcoming.map((u, i) => (
                  <div key={i} className="e-row" style={{ gap: 8, flexWrap: 'nowrap' }}>
                    <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{u.kind === 'holiday' ? `${u.name} (holiday)` : `${u.name} · ${u.type}${u.status === 'Pending' ? ' (pending)' : ''}`}</span>
                    <span style={{ color: 'var(--e-mut)' }}>{u.label}</span>
                  </div>
                ))}
              </div>
            </section>
          </aside>
        </div>
      )}
      {dialog}
    </div>
  );
}
