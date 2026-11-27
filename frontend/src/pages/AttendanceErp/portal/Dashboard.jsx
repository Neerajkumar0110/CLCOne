import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../api';
import { usePortal } from './ctx';
import { B, Bar, Card, ErrorState, Skeleton, clock, hm, useNow, useToast, dateLabel } from '../ui';

// E1 · Dashboard (+ the E2 status-card states)
const SEG = { ACTIVE: '#16A34A', INACTIVE: '#F59E0B', LUNCH: '#8B5CF6', BREAK: '#8B5CF6', OFFLINE: '#CBD5E1' };
const SEG_B = { ACTIVE: ['Active', 'g'], INACTIVE: ['Inactive', 'a'], LUNCH: ['Lunch', 'v'], BREAK: ['Break', 'v'], OFFLINE: ['Offline', 'o'] };
const BAL_C = { Casual: '#4F46E5', Sick: '#0EA5E9', Earned: '#16A34A', Emergency: '#F59E0B', Other: '#94A3B8' };

function useTabs() {
  const [n, setN] = useState(1);
  useEffect(() => {
    if (typeof BroadcastChannel === 'undefined') return undefined;
    const ch = new BroadcastChannel('erp-tabs');
    const me = Math.random().toString(36).slice(2);
    const seen = new Map();
    const tick = () => {
      ch.postMessage(me);
      const now = Date.now();
      [...seen.entries()].forEach(([k, t]) => now - t > 6000 && seen.delete(k));
      setN(seen.size + 1);
    };
    ch.onmessage = (e) => seen.set(e.data, Date.now());
    const id = setInterval(tick, 2000);
    tick();
    return () => {
      clearInterval(id);
      ch.close();
    };
  }, []);
  return n;
}

export default function Dashboard() {
  const { today, reload, fetchedAt, askLogout, offline } = usePortal();
  const toast = useToast();
  const now = useNow(1000);
  const tabs = useTabs();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  if (!today) return <Skeleton kpis={4} />;
  if (today.error) return <ErrorState onRetry={reload} />;
  const d = today.day;
  const S = today.settings;
  const s = d.session;
  const live = d.live;
  const req = d.required;
  // tick the clock locally between server refreshes
  const extra = live === 'active' && !offline ? (now - fetchedAt) / 60000 : 0;
  const work = Math.round(d.totals.work + extra);
  const remaining = Math.max(0, req - work);
  const pct = Math.min(100, Math.round((work / req) * 100));
  const done = work >= req;
  const openP = d.periods.find((p) => !p.endAt);
  const finishAt = new Date(now + remaining * 60000);
  const act = async (url, body, okMsg) => {
    setBusy(true);
    const r = await api.post(url, body);
    setBusy(false);
    toast.res(r, okMsg);
    reload();
  };
  const breaksLeft = S.breaks.filter((b) => !(s && (s.breaksTaken || []).includes(b.key)));
  const lunchTaken = s && (s.breaksTaken || []).includes('lunch');
  const lastIn = s && s.lastActivityAt;

  // ── the big status card ──
  let card;
  if (!s || !s.loginAt) {
    card = (
      <section className="e-card pad" style={{ flex: '999 1 560px', display: 'flex', flexDirection: 'column', gap: 14, alignItems: 'flex-start' }}>
        <B>{d.status === 'Leave' ? 'On leave today' : d.status === 'Holiday' ? `Holiday · ${d.holiday}` : d.status === 'Weekly Off' ? 'Weekly off' : 'Not started'}</B>
        <h2 style={{ fontSize: 22 }}>{d.status === 'Leave' || d.status === 'Holiday' || d.status === 'Weekly Off' ? 'Enjoy your day off.' : 'Your day has not started yet'}</h2>
        <p className="e-sub" style={{ margin: 0 }}>
          Your attendance starts the moment you start your day (or sign in). The target is {hm(req)} of actual work — lunch, breaks and inactive time don't count.
        </p>
        <button type="button" className="e-btn p lg" disabled={busy} onClick={() => act('me/start', {}, 'Your day has started')}>
          Start my day
        </button>
      </section>
    );
  } else if (s.status === 'logged_out') {
    card = (
      <section className="e-card pad" style={{ flex: '999 1 560px', display: 'flex', gap: 20, alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 260, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <B>Logged out</B>
          <h2 style={{ fontSize: 22 }}>Your day is saved</h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(110px,1fr))', gap: 10 }}>
            <div className="ep-st">
              <span>Login</span>
              <b>{clock(s.loginAt)}</b>
            </div>
            <div className="ep-st">
              <span>Logout</span>
              <b>{clock(s.logoutAt)}</b>
            </div>
            <div className="ep-st">
              <span>Worked</span>
              <b style={{ color: done ? '#15803D' : '#B91C1C' }}>{hm(work)}</b>
            </div>
            <div className="ep-st">
              <span>Status</span>
              <b>{d.status}</b>
            </div>
          </div>
          <div className="e-row">
            <button type="button" className="e-btn" disabled={busy} onClick={() => act('me/start', {}, 'Welcome back — your day continues')}>
              Start again
            </button>
            <span style={{ fontSize: 12, color: 'var(--e-mut)' }}>Signing back in continues today's session; the gap is kept as offline time.</span>
          </div>
        </div>
      </section>
    );
  } else if (live === 'lunch' || live === 'break') {
    const cb = s.currentBreak || {};
    const left = Math.max(0, Math.round((new Date(cb.plannedEndAt) - now) / 60000));
    const total = Math.round((new Date(cb.plannedEndAt) - new Date(cb.startAt)) / 60000) || 60;
    card = (
      <section className="e-card pad" style={{ flex: '999 1 560px', display: 'flex', flexDirection: 'column', gap: 14, borderColor: '#DDD6FE' }}>
        <B kind="v">
          {cb.label || 'Lunch'} · {total - left}m of {hm(total)}
        </B>
        <div>
          <div style={{ fontSize: 12, color: 'var(--e-mut)' }}>{cb.label || 'Lunch'} ends at</div>
          <div style={{ fontSize: 32, fontWeight: 700 }}>{clock(cb.plannedEndAt)}</div>
        </div>
        <Bar pct={((total - left) / total) * 100} h={8} color="#8B5CF6" />
        <div style={{ fontSize: 13, color: 'var(--e-mut)', lineHeight: '20px' }}>
          {openP && openP.auto ? `${cb.label} started on its own at ${clock(cb.startAt)} as per the shift schedule. ` : `${cb.label} started at ${clock(cb.startAt)}. `}
          Work time is stopped{today.profile.department === 'Sales' ? ' and the dialer is paused' : ''}.
        </div>
        <div className="e-row">
          <button type="button" className="e-btn p" disabled={busy} onClick={() => act('me/break/end', {}, 'Welcome back')}>
            End {String(cb.label || 'lunch').toLowerCase()} and resume
          </button>
          <span style={{ fontSize: 13, color: 'var(--e-mut)' }}>Worked so far {hm(work)}</span>
        </div>
      </section>
    );
  } else {
    card = (
      <section className="e-card pad" style={{ flex: '999 1 560px', display: 'flex', gap: 28, flexWrap: 'wrap', alignItems: 'center', ...(done ? { borderColor: '#BBF7D0' } : live === 'inactive' ? { borderColor: '#FDE68A' } : {}) }}>
        <div role="img" aria-label={`${hm(work)} of ${hm(req)} done`} className="ep-ring" style={{ width: 210, height: 210, background: `conic-gradient(${done ? '#16A34A' : live === 'inactive' ? '#F59E0B' : '#4F46E5'} 0 ${pct}%, var(--e-line) ${pct}% 100%)` }}>
          <div style={{ width: 170, height: 170 }}>
            <div style={{ fontSize: 12, color: 'var(--e-mut)' }}>Today's work{live === 'inactive' ? ' (paused)' : ''}</div>
            <div style={{ fontSize: 34, fontWeight: 700, lineHeight: '40px', color: live === 'inactive' ? '#94A3B8' : 'var(--e-ink)' }}>{hm(work)}</div>
            <div style={{ fontSize: 13, color: 'var(--e-mut)' }}>of {hm(req)}</div>
          </div>
        </div>
        <div style={{ flex: 1, minWidth: 260, display: 'flex', flexDirection: 'column', gap: 16 }}>
          {done ? (
            <div className="e-row" style={{ gap: 12, flexWrap: 'nowrap' }}>
              <span style={{ width: 44, height: 44, borderRadius: '50%', background: '#16A34A', color: '#fff', fontSize: 22, display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none' }}>✓</span>
              <div>
                <b style={{ fontSize: 16 }}>Daily target completed</b>
                <div style={{ fontSize: 13, color: '#15803D' }}>{hm(work)} actual work · you can log out now. Time after {Math.round(req / 60)} hours counts as overtime.</div>
              </div>
            </div>
          ) : (
            <div className="e-row" style={{ gap: 10 }}>
              <B kind={live === 'inactive' ? 'a' : live === 'offline' ? 'o' : 'g'} style={{ fontSize: 13, padding: '5px 12px' }}>
                {live === 'inactive' ? 'Inactive' : live === 'offline' ? 'Offline' : 'Active'}
              </B>
              <span style={{ fontSize: 13, color: 'var(--e-mut)' }}>{live === 'inactive' ? `Inactive since ${clock(openP && openP.startAt)} · ${Math.max(0, Math.round((now - new Date(openP && openP.startAt)) / 60000))} min` : openP ? `Active since ${clock(openP.startAt)}` : ''}</span>
            </div>
          )}
          {!done && (
            <div>
              <div style={{ fontSize: 13, color: 'var(--e-mut)' }}>Remaining</div>
              <div style={{ fontSize: 30, fontWeight: 700, color: 'var(--e-priD)' }}>{hm(remaining)}</div>
              <div style={{ fontSize: 12, color: 'var(--e-mut)', marginTop: 2 }}>If you stay active you'll reach {Math.round(req / 60)} hours at about {clock(finishAt)}.</div>
            </div>
          )}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(110px,1fr))', gap: 10 }}>
            <div className="ep-st">
              <span>Login</span>
              <b>{clock(s.loginAt)}</b>
            </div>
            <div className="ep-st">
              <span>Inactive</span>
              <b style={{ color: '#B45309' }}>{hm(d.totals.inactive)}</b>
            </div>
            <div className="ep-st">
              <span>Lunch</span>
              <b style={{ color: '#6D28D9' }}>{hm(d.totals.lunch + d.totals.break)}</b>
            </div>
            <div className="ep-st">
              <span>{done ? 'Overtime' : 'Logout'}</span>
              <b style={{ color: done ? '#15803D' : 'var(--e-mut2)' }}>{done ? hm(work - req) : '—'}</b>
            </div>
          </div>
          <div className="e-row">
            <button type="button" className="e-btn" disabled={busy || !breaksLeft.length} onClick={() => act('me/break/start', { kind: 'BREAK', key: breaksLeft[0] && breaksLeft[0].key }, 'Break started')}>
              {breaksLeft.length ? `Start ${breaksLeft[0].label.toLowerCase()}` : 'Breaks used'}
            </button>
            <button type="button" className={`e-btn${lunchTaken ? ' dis' : ''}`} disabled={busy || lunchTaken} onClick={() => act('me/break/start', { kind: 'LUNCH' }, 'Lunch started')}>
              {lunchTaken ? 'Lunch taken' : 'Start lunch'}
            </button>
            <button type="button" className="e-btn d" onClick={askLogout}>
              Logout
            </button>
          </div>
        </div>
      </section>
    );
  }

  const weekMax = Math.max(req * 1.125, ...today.week.map((w) => w.work));
  const weekTotal = today.week.reduce((n, w) => n + w.work, 0) + extra;
  // day bar
  const H = (x) => Number(clock(x).slice(0, 2));
  const h0 = Math.min(9, s && s.loginAt ? H(s.loginAt) : 9);
  const h1 = Math.max(19, H(new Date(now)) + 1);
  const base = new Date(`${d.dayKey}T${String(h0).padStart(2, '0')}:00:00+05:30`).getTime();
  const span = (h1 - h0) * 3600e3;
  const pos = (x) => Math.max(0, Math.min(100, ((new Date(x).getTime() - base) / span) * 100));
  const ticks = [];
  for (let h = h0; h <= h1; h += 2) ticks.push(`${String(h).padStart(2, '0')}:00`);

  return (
    <>
      {live === 'inactive' && S.inactiveBanner && (
        <div className="ep-banner" style={{ background: 'rgba(245,158,11,.12)', color: '#92400E' }}>
          <b>You're inactive since {clock(openP && openP.startAt)}.</b> Move the mouse or press any key to continue. This time isn't counted as work.
        </div>
      )}
      {today.review && (
        <section className="e-card pad e-row" style={{ gap: 16, borderColor: '#FECACA' }}>
          <B>Needs review</B>
          <div style={{ flex: 1, minWidth: 280, fontSize: 14, color: 'var(--e-ink2)', lineHeight: '22px' }}>
            On {dateLabel(today.review.dayKey, { weekday: true, year: false })} your session stayed open after {clock(today.review.lastAt)} (laptop shut down?). HR will check it, and you can add a note now. Only time with real activity was counted: <b>{hm(today.review.work)}</b>.
          </div>
          <input className="e-fld" style={{ flex: 1, minWidth: 260, height: 40 }} aria-label="Note for HR" placeholder="e.g. Power cut at 18:00, I left at 18:30" value={note} onChange={(e) => setNote(e.target.value)} />
          <button
            type="button"
            className="e-btn p"
            disabled={!note.trim()}
            onClick={async () => {
              const r = await api.post('me/review-note', { dayKey: today.review.dayKey, note });
              toast.res(r, 'Note sent to HR');
              if (r.success) {
                setNote('');
                reload();
              }
            }}
          >
            Send note
          </button>
        </section>
      )}
      <div className="e-row" style={{ gap: 20, alignItems: 'stretch' }}>
        {card}
        <section className="e-card pad" style={{ flex: '1 1 300px', display: 'flex', flexDirection: 'column', gap: 12 }}>
          <h2 className="e-ct">This week</h2>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 10, height: 150 }} role="img" aria-label="Hours worked this week">
            {today.week.map((w) => {
              const v = w.today ? w.work + extra : w.work;
              return (
                <div key={w.dayKey} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, height: '100%', justifyContent: 'flex-end' }}>
                  <span style={{ fontSize: 10, color: 'var(--e-mut)' }}>{v ? hm(v).replace(/^0/, '') : '—'}</span>
                  <div style={{ width: '100%', maxWidth: 34, borderRadius: '6px 6px 3px 3px', height: `${Math.round((v / weekMax) * 110)}px`, background: w.today ? '#A5B4FC' : v >= req ? '#16A34A' : '#F59E0B' }} />
                  <span style={{ fontSize: 11, color: 'var(--e-ink2)', fontWeight: w.today ? 700 : 400 }}>{new Date(`${w.dayKey}T12:00:00+05:30`).toLocaleDateString('en-GB', { weekday: 'short' })}</span>
                </div>
              );
            })}
          </div>
          <div className="e-row" style={{ justifyContent: 'space-between', fontSize: 12, color: 'var(--e-mut)', borderTop: '1px solid var(--e-line2)', paddingTop: 10 }}>
            <span>Week total</span>
            <b style={{ color: 'var(--e-ink)' }}>
              {hm(weekTotal)} / {hm(req * today.week.length)}
            </b>
          </div>
          {tabs > 1 && (
            <div className="e-note info">
              <B kind="g" sm>
                Same session · {tabs} tabs
              </B>{' '}
              Both tabs share one attendance session; no extra time is added.
            </div>
          )}
        </section>
      </div>

      <section className="e-card pad">
        <div className="e-row" style={{ marginBottom: 12 }}>
          <h2 className="e-ct" style={{ flex: 1 }}>
            Today's timeline
          </h2>
          <span className="e-lg">
            <span>
              <i style={{ background: '#16A34A' }} />
              Active
            </span>
            <span>
              <i style={{ background: '#F59E0B' }} />
              Inactive
            </span>
            <span>
              <i style={{ background: '#8B5CF6' }} />
              Lunch
            </span>
          </span>
        </div>
        <div className="e-daybar" style={{ height: 30 }} role="img" aria-label="Today's timeline">
          {d.periods.map((p) => (
            <i key={p._id} style={{ left: `${pos(p.startAt)}%`, width: `${Math.max(0.3, pos(p.endAt || now) - pos(p.startAt))}%`, background: SEG[p.type] }} />
          ))}
        </div>
        <div className="e-row" style={{ justifyContent: 'space-between', fontSize: 11, color: 'var(--e-mut)', marginTop: 6 }}>
          {ticks.map((t) => (
            <span key={t}>{t}</span>
          ))}
        </div>
        {d.periods.length === 0 && <p className="e-cs" style={{ marginTop: 12 }}>Nothing yet today.</p>}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))', gap: 10, marginTop: 16 }}>
          {d.periods.map((p) => {
            const m = Math.round((new Date(p.endAt || now) - new Date(p.startAt)) / 60000);
            const [l, k] = SEG_B[p.type];
            return (
              <div key={p._id} className="e-row" style={{ gap: 10, padding: '10px 12px', border: '1px solid var(--e-line2)', borderRadius: 10, flexWrap: 'nowrap' }}>
                <B kind={k}>{p.type === 'LUNCH' || p.type === 'BREAK' ? p.label || l : l}</B>
                <span style={{ fontSize: 13, color: 'var(--e-ink2)', flex: 1 }}>
                  {clock(p.startAt)} – {p.endAt ? clock(p.endAt) : 'now'}
                </span>
                <b style={{ fontSize: 13 }}>{m >= 60 ? `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m` : `${m}m`}</b>
              </div>
            );
          })}
        </div>
      </section>

      <div className="e-grid e-g3">
        <Card title="Leave balance" right={<Link to="/employee/apply-leave" className="e-btn p sm">Apply leave</Link>}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {today.balance
              .filter((b) => b.total > 0)
              .map((b) => (
                <div key={b.type}>
                  <div className="e-row" style={{ fontSize: 13, marginBottom: 6, flexWrap: 'nowrap' }}>
                    <span style={{ flex: 1, color: 'var(--e-ink2)' }}>{b.type}</span>
                    <b>
                      {b.left} left of {b.total}
                    </b>
                  </div>
                  <Bar pct={(b.left / b.total) * 100} color={BAL_C[b.type]} />
                </div>
              ))}
          </div>
        </Card>
        <Card title="My requests">
          {today.recent.length === 0 && <p className="e-cs">No leave requests yet.</p>}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {today.recent.map((l) => (
              <div key={l._id} className="e-row" style={{ gap: 10, fontSize: 13, flexWrap: 'nowrap' }}>
                <span style={{ flex: 1 }}>
                  {l.leaveType} · {l.label}
                </span>
                <B>{l.status}</B>
              </div>
            ))}
          </div>
          <Link to="/employee/leaves" style={{ display: 'block', fontSize: 13, fontWeight: 600, marginTop: 14, textDecoration: 'none' }}>
            All my leaves →
          </Link>
        </Card>
        <section className="e-card pad" style={{ background: 'var(--e-priS)', borderColor: '#E0E7FF' }}>
          <h2 className="e-ct">What this portal tracks</h2>
          <div style={{ fontSize: 13, color: 'var(--e-ink2)', lineHeight: '21px', marginTop: 10 }}>
            <div>✓ Whether the mouse or keyboard was used, every {S.heartbeatSec} s</div>
            <div>✓ Login, logout, lunch and break times</div>
            <div style={{ color: '#B91C1C' }}>✕ Never the keys you press or what you type</div>
            <div style={{ color: '#B91C1C' }}>✕ Never your screen, files or messages</div>
          </div>
          <div style={{ fontSize: 12, color: 'var(--e-mut)', marginTop: 10 }}>
            After {Math.round(S.inactivitySec / 60)} minutes without input you show as Inactive, and that time doesn't count as work. {lastIn && live === 'active' ? `Last activity ${Math.max(0, Math.round((now - new Date(lastIn)) / 1000))} s ago.` : ''}
          </div>
          <Link to="/employee/agent" style={{ display: 'block', fontSize: 13, fontWeight: 600, marginTop: 10, textDecoration: 'none' }}>
            Desktop agent {today.agent.some((a) => a.online) ? '· connected' : '· not running'} →
          </Link>
        </section>
      </div>
    </>
  );
}
