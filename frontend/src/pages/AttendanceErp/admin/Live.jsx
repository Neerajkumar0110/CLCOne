import React, { useState } from 'react';
import api from '../api';
import { Av, B, Bar, Card, Empty, ErrorState, Search, Select, Skeleton, Trunc, ago, clock, hm, useErpLive, useLoad, useNow, workColor } from '../ui';

// A2 · Live Activity — Active / Inactive / Lunch / Offline cards that update
// on their own (socket + 15 s poll); "last activity 20 s ago" ticks locally.
const SINCE = (r, now) => {
  const s = r.session;
  if (r.live === 'active') return { text: `Last activity ${ago(s.lastActivityAt, now)}`, color: '#15803D' };
  if (r.live === 'inactive') return { text: `Inactive since ${clock(s.since)} · ${Math.round((now - new Date(s.since)) / 60000)} min`, color: '#B45309' };
  if (r.live === 'lunch' || r.live === 'break') return { text: `${(s.currentBreak && s.currentBreak.label) || 'Break'} since ${clock(s.since)}`, color: '#6D28D9' };
  if (r.live === 'offline') return { text: `Connection lost ${clock(s.since)} · no logout yet`, color: '#475569' };
  return { text: `Logged out ${clock(s.logoutAt)}`, color: '#475569' };
};
const FEED_C = { inactive: '#F59E0B', active: '#16A34A', done: '#16A34A', offline: '#94A3B8', out: '#94A3B8', short: '#DC2626', lunch: '#8B5CF6' };

export default function Live({ openDetail, globalQ }) {
  const [q, setQ] = useState(globalQ || '');
  const [chip, setChip] = useState('all');
  const [dept, setDept] = useState('All');
  const [sort, setSort] = useState('remaining');
  const now = useNow(1000);
  const { data, loading, error, reload } = useLoad(() => api.get('admin/live'), [], { poll: 15000 });
  useErpLive(() => reload(true));
  if (loading && !data) return <Skeleton kpis={5} />;
  if (error && !data) return <ErrorState onRetry={() => reload()} />;
  const c = data.counts;
  const req = data.required;
  let cards = data.cards.filter((r) => (!q || `${r.employee.name} ${r.employee.employeeCode}`.toLowerCase().includes(q.toLowerCase())) && (dept === 'All' || r.employee.department === dept));
  if (chip !== 'all') cards = cards.filter((r) => (chip === 'loggedout' ? !r.live : r.live === chip || (chip === 'lunch' && r.live === 'break')));
  cards = [...cards].sort((a, b) => (sort === 'remaining' ? a.remaining - b.remaining : sort === 'name' ? a.employee.name.localeCompare(b.employee.name) : new Date(a.session.loginAt) - new Date(b.session.loginAt)));
  const online = c.active + c.inactive + c.lunch + c.break + c.offline;
  return (
    <div className="e-page">
      <div className="e-head">
        <div>
          <h1 className="e-h1">Live employee status</h1>
          <p className="e-sub">Inactive = no mouse, keyboard, scroll or touch for {Math.round(data.inactivitySec / 60)} min. Offline = no heartbeat for 2 min. Only presence is tracked, never what is typed.</p>
        </div>
        <B kind="g">Connected · updates every few seconds</B>
      </div>
      <div className="e-kpis" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(160px,1fr))' }}>
        <div className="e-kpi">
          <B>Active</B>
          <div className="e-kv">{c.active}</div>
          <div className="e-ks">working right now</div>
        </div>
        <div className="e-kpi">
          <B>Inactive</B>
          <div className="e-kv">{c.inactive}</div>
          <div className="e-ks">{c.inactive ? `longest ${data.longestInactive} min` : 'nobody idle'}</div>
        </div>
        <div className="e-kpi">
          <B kind="v">Lunch / Break</B>
          <div className="e-kv">{c.lunch + c.break}</div>
          <div className="e-ks">{c.lunch + c.break ? 'on a scheduled break' : 'nobody on a break'}</div>
        </div>
        <div className="e-kpi">
          <B>Offline</B>
          <div className="e-kv">{c.offline + c.loggedOut}</div>
          <div className="e-ks">
            {c.loggedOut} logged out · {c.offline} lost connection
          </div>
        </div>
        <div className="e-kpi">
          <B kind="bl">Not logged in</B>
          <div className="e-kv">{c.notIn}</div>
          <div className="e-ks">
            {c.leave} on leave · {c.absent} absent
          </div>
        </div>
      </div>
      <div className="e-row">
        <Search value={q} onChange={setQ} placeholder="Search name or code" style={{ flex: '0 1 260px' }} />
        {[
          ['all', `All ${data.cards.length}`],
          ['active', `Active ${c.active}`],
          ['inactive', `Inactive ${c.inactive}`],
          ['lunch', `Lunch ${c.lunch + c.break}`],
          ['offline', `Offline ${c.offline}`],
          ['loggedout', `Logged out ${c.loggedOut}`],
        ].map(([k, l]) => (
          <button key={k} type="button" className={`e-chip${chip === k ? ' on' : ''}`} onClick={() => setChip(k)}>
            {l}
          </button>
        ))}
        <Select label="Department" value={dept} onChange={setDept} options={['All', ...data.departments]} />
        <Select label="Sort" value={sort} onChange={setSort} options={[{ value: 'remaining', label: 'Remaining time' }, { value: 'name', label: 'Name' }, { value: 'login', label: 'Login time' }]} />
        <span style={{ flex: 1 }} />
        <button
          type="button"
          className="e-chip"
          onClick={() => {
            setQ('');
            setChip('all');
            setDept('All');
          }}
        >
          Reset
        </button>
      </div>
      <div className="e-split">
        <div className="main" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(270px,1fr))', gap: 14, alignContent: 'start' }}>
          {cards.length === 0 && (
            <div className="e-card" style={{ gridColumn: '1 / -1' }}>
              <Empty title={online ? 'Nobody matches these filters' : 'Nobody has logged in yet today'} text="Cards appear here the moment someone signs in." icon="users" />
            </div>
          )}
          {cards.map((r) => {
            const s = SINCE(r, now);
            const pct = Math.min(100, Math.round((r.totals.work / req) * 100));
            const done = r.totals.work >= req;
            return (
              <article key={r.employee._id} className="e-card" style={{ padding: 16, cursor: 'pointer' }} onClick={() => openDetail(r.employee._id, r.dayKey)}>
                <div className="e-row" style={{ gap: 12, flexWrap: 'nowrap' }}>
                  <Av name={r.employee.name} size={40} photo={r.employee.photo} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <Trunc text={r.employee.name} style={{ fontSize: 14, fontWeight: 600 }} />
                    <Trunc text={[r.employee.department, r.employee.designation].filter(Boolean).join(' · ') || r.employee.role} style={{ fontSize: 12, color: 'var(--e-mut)' }} />
                  </div>
                  <B>{r.live ? r.status : 'Logged out'}</B>
                </div>
                <div style={{ fontSize: 12, marginTop: 10, color: s.color }}>{s.text}</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,minmax(0,1fr))', gap: 10, marginTop: 14, fontSize: 11, color: 'var(--e-mut)' }}>
                  <div>
                    Login<b style={{ display: 'block', fontSize: 14, color: 'var(--e-ink)', marginTop: 2 }}>{clock(r.session.loginAt)}</b>
                  </div>
                  <div>
                    Active<b style={{ display: 'block', fontSize: 14, color: 'var(--e-ink)', marginTop: 2 }}>{hm(r.totals.active)}</b>
                  </div>
                  <div>
                    Inactive<b style={{ display: 'block', fontSize: 14, color: 'var(--e-ink)', marginTop: 2 }}>{hm(r.totals.inactive)}</b>
                  </div>
                  <div>
                    Lunch<b style={{ display: 'block', fontSize: 14, color: 'var(--e-ink)', marginTop: 2 }}>{hm(r.totals.lunch)}</b>
                  </div>
                  <div>
                    Target<b style={{ display: 'block', fontSize: 14, color: 'var(--e-ink)', marginTop: 2 }}>{hm(req)}</b>
                  </div>
                  <div>
                    Remaining<b style={{ display: 'block', fontSize: 14, color: done ? '#15803D' : 'var(--e-ink)', marginTop: 2 }}>{done ? 'Done ✓' : hm(r.remaining)}</b>
                  </div>
                </div>
                <Bar pct={pct} color={r.live ? workColor(pct, r.live === 'inactive') : '#94A3B8'} style={{ marginTop: 14 }} />
                <div className="e-row" style={{ justifyContent: 'space-between', marginTop: 10, flexWrap: 'nowrap' }}>
                  <span style={{ fontSize: 11, color: 'var(--e-mut)' }}>{pct}% of target</span>
                  <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--e-pri)' }}>Timeline →</span>
                </div>
              </article>
            );
          })}
        </div>
        <aside className="side">
          <Card title="Activity feed" sub="Status changes, newest first" pad={false}>
            <div style={{ padding: '6px 20px 16px' }}>
              {data.feed.length === 0 && <p className="e-cs" style={{ padding: '12px 0' }}>No changes yet today.</p>}
              {data.feed.map((f, i) => (
                <div key={i} className="e-row" style={{ gap: 10, padding: '10px 0', borderBottom: '1px solid var(--e-line2)', flexWrap: 'nowrap', alignItems: 'flex-start' }}>
                  <span style={{ flex: 'none', width: 8, height: 8, borderRadius: '50%', marginTop: 6, background: FEED_C[f.kind] || '#94A3B8' }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, color: 'var(--e-ink2)' }}>
                      <b style={{ color: 'var(--e-ink)', fontWeight: 600 }}>{f.name}</b> {f.text}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--e-mut)', marginTop: 2 }}>
                      {clock(f.at)} · {ago(f.at, now)}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </aside>
      </div>
    </div>
  );
}
