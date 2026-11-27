import React, { useState } from 'react';
import api from '../api';
import { Av, B, Bar, Card, ErrorState, Kpi, Name, Select, Skeleton, StatusBadges, Trunc, clock, dateLabel, greet, hm, useErpLive, useLoad, workColor, ago } from '../ui';
import { ExportMenu, useDecide } from './shared';

// A1 · Dashboard
const LIVE_BG = { active: '#F0FDF4', inactive: '#FFFBEB', lunch: '#F5F3FF', offline: '#F8FAFC' };
const LIVE_SUB = (r) => {
  const s = r.session;
  if (r.live === 'active') return `Active · last input ${ago(s.lastActivityAt)}`;
  if (r.live === 'inactive') return `Inactive since ${clock(s.since)}`;
  if (r.live === 'lunch' || r.live === 'break') return `${s.currentBreak ? s.currentBreak.label : 'Break'} since ${clock(s.since)}`;
  if (r.live === 'offline') return `Offline since ${clock(s.since)} · no logout`;
  return `Logged out ${clock(s.logoutAt)}`;
};
const LEAVE_COLORS = { Casual: '#4F46E5', Sick: '#0EA5E9', Earned: '#16A34A', Emergency: '#F59E0B', Other: '#94A3B8' };

export default function Dashboard({ setTab, openDetail }) {
  const [dept, setDept] = useState('All');
  const { data, loading, error, reload } = useLoad(() => api.get('admin/dashboard', { dept }), [dept], { poll: 30000 });
  useErpLive(() => reload(true));
  const { approve, reject, dialog } = useDecide(() => reload(true));
  if (loading && !data) return <Skeleton kpis={8} />;
  if (error && !data) return <ErrorState onRetry={() => reload()} />;
  const d = data;
  const k = d.kpis;
  const req = d.required;
  const leaveTotal = Object.values(d.leaveStats).reduce((n, v) => n + v, 0);
  let acc = 0;
  const conic = Object.entries(d.leaveStats)
    .map(([t, v]) => {
      const a = acc;
      acc += (v / (leaveTotal || 1)) * 100;
      return `${LEAVE_COLORS[t] || '#94A3B8'} ${a}% ${acc}%`;
    })
    .join(',');
  const maxTrend = Math.max(1, ...d.trend.map((t) => t.onTime + t.late + t.absent));
  const KP = [
    ['Total employees', k.total, `${k.joinedThisMonth} joined this month`, 'users', '#4F46E5', '#EEF2FF', 'employees'],
    ['Present today', k.present, `${k.total ? Math.round((k.present / k.total) * 100) : 0}% · ${k.late} came late`, 'check', '#15803D', 'rgba(22,163,74,.13)', 'attendance'],
    ['Currently online', k.online, `${k.active} active · ${k.inactive} inactive`, 'act', '#15803D', 'rgba(22,163,74,.13)', 'live'],
    ['Currently inactive', k.inactive, 'no input for 5+ min', 'pause', '#B45309', 'rgba(217,119,6,.14)', 'idle'],
    ['On leave', k.onLeave, Object.entries(k.leaveTypes).map(([t, n]) => `${n} ${t.toLowerCase()}`).join(' · ') || 'nobody today', 'cal', '#1D4ED8', 'rgba(37,99,235,.12)', 'calendar'],
    ['Absent', k.absent, 'no login, no leave', 'x', '#B91C1C', 'rgba(220,38,38,.11)', 'attendance'],
    [`Completed ${Math.round(req / 60)} hours`, k.completed, `of ${k.present} present`, 'target', '#15803D', 'rgba(22,163,74,.13)', 'attendance'],
    ['Pending leave requests', k.pending, k.oldestPendingAt ? `oldest ${Math.max(0, Math.round((Date.now() - new Date(k.oldestPendingAt)) / 864e5))} days` : 'none waiting', 'file', '#B45309', 'rgba(217,119,6,.14)', 'leaves'],
  ];
  return (
    <div className="e-page">
      <div className="e-head">
        <div>
          <h1 className="e-h1">{greet()}</h1>
          <p className="e-sub">Live numbers for today. Updated {ago(d.now)}.</p>
        </div>
        <div className="e-row">
          <span className="e-btn" style={{ cursor: 'default' }}>
            Today
          </span>
          <Select ariaLabel="Department" value={dept} onChange={setDept} options={[{ value: 'All', label: 'All departments' }, ...d.departments.map((x) => ({ value: x, label: x }))]} />
          <ExportMenu kind="daily" />
        </div>
      </div>

      <div className="e-kpis k4">
        {KP.map(([l, v, s, ic, c, bg, t]) => (
          <Kpi key={l} label={l} value={v} sub={s} icon={ic} color={c} bg={bg} onClick={() => setTab(t)} />
        ))}
      </div>

      <div className="e-grid e-g2">
        <Card title="Live employee activity" sub="Moves on its own. No refresh needed." right={<button type="button" className="e-btn sm" onClick={() => setTab('live')}>Open live view</button>} pad={false}>
          <div className="e-row" style={{ gap: 10, padding: '16px 20px 4px' }}>
            {[
              ['active', 'Active', d.live.active],
              ['inactive', 'Inactive', d.live.inactive],
              ['lunch', 'Lunch', d.live.lunch + d.live.break],
              ['offline', 'Offline', d.live.offline],
            ].map(([key, l, n]) => (
              <div key={key} style={{ flex: 1, minWidth: 110, background: LIVE_BG[key], borderRadius: 10, padding: 12 }} className="e-livebox">
                <B>{l}</B>
                <div style={{ fontSize: 24, fontWeight: 700, marginTop: 6, color: '#0F172A' }}>{n}</div>
              </div>
            ))}
          </div>
          <div style={{ padding: '8px 20px 16px' }}>
            {d.liveList.length === 0 && <p className="e-cs" style={{ padding: '12px 0' }}>Nobody is signed in right now.</p>}
            {d.liveList.map((r) => {
              const pct = Math.round((r.totals.work / req) * 100);
              return (
                <div key={r.employee._id} className="e-row" style={{ gap: 12, padding: '10px 0', borderBottom: '1px solid var(--e-line2)', flexWrap: 'nowrap', cursor: 'pointer' }} onClick={() => openDetail(r.employee._id, r.dayKey)}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <Name name={r.employee.name} sub={LIVE_SUB(r)} photo={r.employee.photo} />
                  </div>
                  <div style={{ width: 150, flex: 'none' }} className="e-hide-m">
                    <Bar pct={pct} color={workColor(pct, r.live === 'inactive')} />
                    <div style={{ fontSize: 11, color: 'var(--e-mut)', marginTop: 4 }}>
                      {hm(r.totals.work)} / {hm(req)}
                    </div>
                  </div>
                  <B>{r.status}</B>
                </div>
              );
            })}
          </div>
        </Card>
        <Card title="Pending leave requests" sub={k.pending ? `${k.pending} waiting.${k.oldestPendingAt ? ` Oldest sent ${dateLabel(k.oldestPendingAt, { year: false })}.` : ''}` : 'Nothing waiting.'} right={<button type="button" className="e-btn sm" onClick={() => setTab('leaves')}>All leaves</button>} pad={false}>
          <div style={{ padding: '4px 20px 16px' }}>
            {d.pending.length === 0 && <p className="e-cs" style={{ padding: '16px 0' }}>No pending leave requests. New ones show here and in the bell as soon as they are sent.</p>}
            {d.pending.map((l) => (
              <div key={l._id} className="e-row" style={{ gap: 12, padding: '14px 0', borderBottom: '1px solid var(--e-line2)', alignItems: 'flex-start' }}>
                <Av name={l.employee} />
                <div style={{ flex: 1, minWidth: 180 }}>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>
                    {l.employee} <span style={{ fontWeight: 400, color: 'var(--e-mut)' }}>· {l.leaveType} Leave</span>
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--e-ink2)', marginTop: 2 }}>
                    {l.label} · {l.days} day{l.days === 1 ? '' : 's'}
                  </div>
                  <Trunc text={`“${l.reason || '—'}”`} style={{ fontSize: 12, color: 'var(--e-mut)', marginTop: 4, maxWidth: 300 }} />
                </div>
                <div className="e-row" style={{ gap: 6 }}>
                  <button type="button" className="e-btn sm d" onClick={() => reject(l)}>
                    Reject
                  </button>
                  <button type="button" className="e-btn sm ok" onClick={() => approve(l)}>
                    Approve
                  </button>
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>

      <Card title="Today's attendance" sub="Work = active time only. Lunch, breaks and inactive time are left out." right={<button type="button" className="e-btn sm" onClick={() => setTab('attendance')}>View all {k.total}</button>} flush>
        <div className="e-tw e-hide-m">
          <table className="e-tbl" style={{ minWidth: 860 }}>
            <colgroup>
              <col style={{ width: '24%' }} />
              <col style={{ width: '9%' }} />
              <col style={{ width: '10%' }} />
              <col style={{ width: '10%' }} />
              <col style={{ width: '10%' }} />
              <col style={{ width: '9%' }} />
              <col style={{ width: '12%' }} />
              <col style={{ width: '16%' }} />
            </colgroup>
            <thead>
              <tr>
                <th>Employee</th>
                <th>Login</th>
                <th>Logout</th>
                <th>Active</th>
                <th>Inactive</th>
                <th>Lunch</th>
                <th>Total work</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {d.today.length === 0 && (
                <tr>
                  <td colSpan={8} style={{ textAlign: 'center', color: 'var(--e-mut)', padding: 24 }}>
                    Nobody has logged in yet today.
                  </td>
                </tr>
              )}
              {d.today.map((r) => (
                <tr key={r.employee._id} style={{ cursor: 'pointer' }} onClick={() => openDetail(r.employee._id, r.dayKey)}>
                  <td>
                    <Name name={r.employee.name} sub={[r.employee.department, r.employee.designation].filter(Boolean).join(' · ')} photo={r.employee.photo} />
                  </td>
                  <td>{clock(r.session.loginAt)}</td>
                  <td>{r.session.logoutAt ? clock(r.session.logoutAt) : '—'}</td>
                  <td>{hm(r.totals.active)}</td>
                  <td>{hm(r.totals.inactive)}</td>
                  <td>{hm(r.totals.lunch)}</td>
                  <td className="strong">{hm(r.totals.work)}</td>
                  <td>
                    <StatusBadges status={r.status} tags={r.tags} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="e-mcards">
          {d.today.map((r) => (
            <div key={r.employee._id} className="e-mcard" onClick={() => openDetail(r.employee._id, r.dayKey)}>
              <div className="e-row" style={{ flexWrap: 'nowrap' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <Name name={r.employee.name} sub={`${clock(r.session.loginAt)} – ${r.session.logoutAt ? clock(r.session.logoutAt) : 'now'} · ${hm(r.totals.work)}`} />
                </div>
                <B>{r.status}</B>
              </div>
            </div>
          ))}
        </div>
      </Card>

      <div className="e-grid e-g3">
        <Card title="Attendance trend" sub={`Last ${d.trend.length} working days`}>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, height: 160 }} role="img" aria-label="On time, late and absent per day">
            {d.trend.map((t) => (
              <div key={t.dayKey} title={`${dateLabel(t.dayKey, { year: false })}: ${t.onTime} on time, ${t.late} late, ${t.absent} absent`} style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', height: '100%', gap: 2 }}>
                <div style={{ height: `${(t.absent / maxTrend) * 150}px`, background: '#F87171', borderRadius: '3px 3px 0 0' }} />
                <div style={{ height: `${(t.late / maxTrend) * 150}px`, background: '#F59E0B' }} />
                <div style={{ height: `${(t.onTime / maxTrend) * 150}px`, background: '#4F46E5', borderRadius: '0 0 3px 3px' }} />
              </div>
            ))}
          </div>
          <div className="e-row" style={{ justifyContent: 'space-between', fontSize: 11, color: 'var(--e-mut)', marginTop: 6 }}>
            <span>{d.trend[0] && dateLabel(d.trend[0].dayKey, { year: false })}</span>
            <span>{d.trend.length > 0 && dateLabel(d.trend[d.trend.length - 1].dayKey, { year: false })}</span>
          </div>
          <div className="e-lg" style={{ marginTop: 12 }}>
            <span>
              <i style={{ background: '#4F46E5' }} />
              On time
            </span>
            <span>
              <i style={{ background: '#F59E0B' }} />
              Late
            </span>
            <span>
              <i style={{ background: '#F87171' }} />
              Absent
            </span>
          </div>
        </Card>
        <Card title="Monthly working hours" sub="Avg actual work per day, this month">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {d.depts.length === 0 && <p className="e-cs">No attendance this month yet.</p>}
            {d.depts.map((x) => {
              const pct = Math.round((x.avg / (req * 1.125)) * 100);
              return (
                <div key={x.name}>
                  <div className="e-row" style={{ fontSize: 12, marginBottom: 6, flexWrap: 'nowrap' }}>
                    <span style={{ flex: 1, color: 'var(--e-ink2)' }}>{x.name}</span>
                    <b>{hm(x.avg)}</b>
                  </div>
                  <div style={{ position: 'relative' }}>
                    <Bar pct={pct} h={8} color={x.avg >= req ? '#16A34A' : '#4F46E5'} />
                    <span style={{ position: 'absolute', left: `${(1 / 1.125) * 100}%`, top: -2, bottom: -2, width: 2, background: 'var(--e-ink)', opacity: 0.35 }} />
                  </div>
                </div>
              );
            })}
            <div style={{ fontSize: 11, color: 'var(--e-mut)' }}>Line = {Math.round(req / 60)}h target</div>
          </div>
        </Card>
        <Card title="Leave statistics" sub={`This month · ${leaveTotal} day${leaveTotal === 1 ? '' : 's'} taken`}>
          <div className="e-row" style={{ gap: 20, alignItems: 'center' }}>
            <div role="img" aria-label={`Leave types: ${Object.entries(d.leaveStats).map(([t, v]) => `${t} ${v}`).join(', ') || 'none'}`} style={{ width: 140, height: 140, borderRadius: '50%', background: leaveTotal ? `conic-gradient(${conic})` : 'var(--e-line2)', display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none' }}>
              <div style={{ width: 92, height: 92, borderRadius: '50%', background: 'var(--e-card)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
                <b style={{ fontSize: 22 }}>{leaveTotal}</b>
                <span style={{ fontSize: 11, color: 'var(--e-mut)' }}>days</span>
              </div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 12, flex: 1, minWidth: 140 }}>
              {['Casual', 'Sick', 'Earned', 'Emergency', 'Other'].map((t) => (
                <div key={t} className="e-row" style={{ gap: 8, flexWrap: 'nowrap' }}>
                  <span style={{ width: 10, height: 10, borderRadius: 3, background: LEAVE_COLORS[t], flex: 'none' }} />
                  <span style={{ flex: 1 }}>{t}</span>
                  <b>{d.leaveStats[t] || 0}</b>
                </div>
              ))}
            </div>
          </div>
        </Card>
      </div>
      {dialog}
    </div>
  );
}
