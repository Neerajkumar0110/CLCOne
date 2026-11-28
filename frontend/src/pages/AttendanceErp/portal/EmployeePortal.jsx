import React, { Suspense, lazy, useCallback, useEffect, useState } from 'react';
import { PortalCtx } from './ctx';
import { NavLink, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { useDispatch, useSelector } from 'react-redux';
import { selectCurrentAdmin } from '@/redux/auth/selectors';
import { logout as logoutAction } from '@/redux/auth/actions';
import api from '../api';
import { setTrackerConfig } from '../tracker';
import { Av, Ic, Skeleton, ToastProvider, Modal, ModalHead, hm } from '../ui';
import '../erp.css';
import AgentSetup from './AgentSetup';
import portalLogo from '@/style/images/Horizontal-1-transparent.png';

// /employee — the Employee Portal (design E0–E9). Own layout (no CRM
// sidebar, no admin menus). Every API it calls is /attendance-erp/me/*,
// which only ever returns the signed-in employee's own data.
const Dashboard = lazy(() => import('./Dashboard'));
const MyAttendance = lazy(() => import('./MyAttendance'));
const MyLeaves = lazy(() => import('./MyLeaves'));
const ApplyLeave = lazy(() => import('./ApplyLeave'));
const MyCalendar = lazy(() => import('./MyCalendar'));
const Profile = lazy(() => import('./Profile'));
const Agent = lazy(() => import('./Agent'));


const NAV = [
  ['dashboard', 'Dashboard', 'home'],
  ['attendance', 'My Attendance', 'clock'],
  ['leaves', 'My Leaves', 'file'],
  ['apply-leave', 'Apply Leave', 'plus'],
  ['calendar', 'Calendar', 'cal'],
  ['profile', 'Profile', 'user'],
  ['notifications', 'Notifications', 'bell'],
];
const TITLES = { dashboard: null, attendance: 'My attendance', leaves: 'My leaves', 'apply-leave': 'Apply leave', calendar: 'My calendar', profile: 'Profile', notifications: 'Notifications', agent: 'Desktop agent' };

export default function EmployeePortal() {
  const me = useSelector(selectCurrentAdmin);
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const loc = useLocation();
  const [today, setToday] = useState(null);
  const [fetchedAt, setFetchedAt] = useState(Date.now());
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [offline, setOffline] = useState(typeof navigator !== 'undefined' && !navigator.onLine);
  const reload = useCallback(async () => {
    const r = await api.get('me/today');
    if (r.success) {
      setToday(r.result);
      setFetchedAt(Date.now());
      setTrackerConfig(r.result.settings);
    } else {
      // no endless loading: not in the ERP (403) → a clear message; else → retry
      setToday((t) => (t && !t.error ? t : { error: true, noAccess: r.status === 403 || /portal|access/i.test(r.message || ''), message: r.message || 'Could not load your day.' }));
    }
    return r;
  }, []);
  useEffect(() => {
    reload();
    const id = setInterval(() => !document.hidden && reload(), 60000);
    let last = null;
    const onBeat = (e) => {
      const d = e.detail || {};
      if (d.offline) return setOffline(true);
      setOffline(false);
      if (d.status !== last) {
        last = d.status;
        reload();
      }
    };
    const on = () => setOffline(false);
    const off = () => setOffline(true);
    window.addEventListener('erp:beat', onBeat);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      clearInterval(id);
      window.removeEventListener('erp:beat', onBeat);
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, [reload]);
  useEffect(() => setOpen(false), [loc.pathname]);
  // First sign-in: ask for the desktop agent once (Allow → download → connect).
  const [agentAsk, setAgentAsk] = useState(false);
  useEffect(() => {
    api.get('me/agent/consent').then((r) => r && r.success && !r.result.consent && !r.result.paired && setAgentAsk(true));
  }, []);

  const doLogout = async () => {
    setConfirm(false);
    await api.post('me/logout');
    dispatch(logoutAction());
    navigate('/employee/login', { replace: true });
  };
  const askLogout = () => {
    const d = today && today.day;
    if (d && d.session && d.live && d.totals.work < d.required) setConfirm(true);
    else doLogout();
  };
  const name = me ? `${me.name || ''} ${me.surname || ''}`.trim() : '';
  const seg = loc.pathname.split('/')[2] || 'dashboard';
  const d = today && today.day;
  const live = d && d.live;
  const pill = !d ? null : offline ? ['Offline · reconnecting…', 'o'] : live === 'active' ? ['Active', 'g'] : live === 'inactive' ? ['Inactive', 'a'] : live === 'lunch' || live === 'break' ? [d.session.currentBreak ? d.session.currentBreak.label || 'Lunch' : 'Lunch', 'v'] : d.session && d.session.status === 'logged_out' ? ['Logged out', 'o'] : ['Not started', 'o'];
  const ctx = { today, reload, fetchedAt, offline, askLogout, doLogout, me, name };
  return (
    <ToastProvider>
      <PortalCtx.Provider value={ctx}>
        <div className="erp ep">
          <nav className={`ep-side${open ? ' open' : ''}`} aria-label="Employee portal">
            <div className="e-row" style={{ gap: 10, padding: '4px 8px 20px', flexWrap: 'nowrap' }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <img src={portalLogo} alt="Career Lab Consulting" style={{ height: 34, maxWidth: 150, objectFit: 'contain', display: 'block' }} />
                <div style={{ fontSize: 11, color: '#94A3B8', marginTop: 6, letterSpacing: 0.3 }}>Employee Portal</div>
              </div>
              <button type="button" className="ep-burger e-btn sm" style={{ background: 'transparent', color: '#94A3B8', borderColor: '#1F2937' }} onClick={() => setOpen(false)} aria-label="Close menu">
                ✕
              </button>
            </div>
            {NAV.map(([k, l, ic]) => (
              <NavLink key={k} to={`/employee/${k}`} className={({ isActive }) => `it${isActive || (k === 'profile' && seg === 'agent') ? ' on' : ''}`}>
                <Ic n={ic} s={17} />
                <span style={{ flex: 1 }}>{l}</span>
                {k === 'notifications' && today && today.unread > 0 && <em>{today.unread}</em>}
              </NavLink>
            ))}
            <div style={{ flex: 1 }} />
            <div style={{ background: '#111827', border: '1px solid #1F2937', borderRadius: 12, padding: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div className="e-row" style={{ gap: 10, flexWrap: 'nowrap' }}>
                <Av name={name} size={34} photo={me && me.photo} />
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: '#fff', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{name}</div>
                  <div style={{ fontSize: 11, color: '#94A3B8' }}>{[today && today.profile && today.profile.employeeCode, today && today.profile && today.profile.department].filter(Boolean).join(' · ') || (me && me.role)}</div>
                </div>
              </div>
              <button type="button" onClick={askLogout} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, height: 36, borderRadius: 8, background: '#1F2937', color: '#FCA5A5', fontSize: 13, fontWeight: 600, border: 0, cursor: 'pointer' }}>
                Logout
              </button>
              <a href="/" style={{ fontSize: 12, color: '#94A3B8', textAlign: 'center', textDecoration: 'none' }}>
                Open the CRM →
              </a>
            </div>
          </nav>
          <div className="ep-main">
            <header className="ep-top">
              <button type="button" className="ep-burger e-btn sm" onClick={() => setOpen(true)} aria-label="Open menu">
                <Ic n="menu" />
              </button>
              <div style={{ flex: 1, minWidth: 0 }}>
                {seg === 'dashboard' ? (
                  <>
                    <div style={{ fontSize: 20, fontWeight: 700 }}>
                      {(() => {
                        const h = Number(new Date().toLocaleTimeString('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', hour12: false }));
                        return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
                      })()}
                      , {me && me.name}
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--e-mut)' }}>
                      {new Date().toLocaleDateString('en-GB', { timeZone: 'Asia/Kolkata', weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}
                      {today && today.settings && ` · General shift ${today.settings.workStart}–${today.settings.workEnd}`}
                    </div>
                  </>
                ) : (
                  <div style={{ fontSize: 17, fontWeight: 700 }}>{TITLES[seg] || 'Employee Portal'}</div>
                )}
              </div>
              {pill && (
                <span className={`e-b ${pill[1]}`} title={live === 'active' && d.session.lastActivityAt ? 'Last activity just now' : undefined}>
                  {pill[0]}
                  {d && d.session && live ? ` · ${hm(d.totals.work)}` : ''}
                </span>
              )}
              <NavLink to="/employee/notifications" className="e-bell" aria-label={`Notifications, ${(today && today.unread) || 0} unread`} style={{ width: 40, height: 40, borderRadius: 10 }}>
                <Ic n="bell" s={17} />
                {today && today.unread > 0 && <span>{today.unread}</span>}
              </NavLink>
            </header>
            {offline && (
              <div className="ep-banner" style={{ margin: '16px 28px 0', background: 'rgba(245,158,11,.14)', color: '#92400E' }}>
                <b>You're offline.</b> Your session is kept. Time syncs when you're back.
              </div>
            )}
            <main className="ep-body">
              {today && today.noAccess ? (
                <section className="e-card pad" style={{ maxWidth: 560, margin: '40px auto', textAlign: 'center', padding: 32 }}>
                  <div style={{ width: 52, height: 52, borderRadius: 14, background: 'var(--e-priS)', color: 'var(--e-pri)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 14px' }}>
                    <Ic n="user" s={24} />
                  </div>
                  <h2 className="e-ct" style={{ fontSize: 18 }}>
                    Your attendance is not tracked here
                  </h2>
                  <p className="e-cs" style={{ margin: '8px 0 18px', lineHeight: '20px' }}>
                    {today.message}
                  </p>
                  <div className="e-row" style={{ justifyContent: 'center' }}>
                    <a className="e-btn p" href="/">
                      Open the CRM
                    </a>
                    <button type="button" className="e-btn" onClick={doLogout}>
                      Sign out
                    </button>
                  </div>
                </section>
              ) : (
                <Suspense fallback={<Skeleton kpis={4} />}>
                  <Routes>
                    <Route path="dashboard" element={<Dashboard />} />
                    <Route path="attendance" element={<MyAttendance />} />
                    <Route path="leaves" element={<MyLeaves />} />
                    <Route path="apply-leave" element={<ApplyLeave />} />
                    <Route path="calendar" element={<MyCalendar />} />
                    <Route path="profile" element={<Profile />} />
                    <Route path="notifications" element={<Profile focus="notifications" />} />
                    <Route path="agent" element={<Agent />} />
                    <Route path="*" element={<Navigate to="/employee/dashboard" replace />} />
                  </Routes>
                </Suspense>
              )}
            </main>
            <nav className="ep-nav" aria-label="Quick menu">
              {[
                ['dashboard', 'Today', 'home'],
                ['attendance', 'Attendance', 'clock'],
                ['leaves', 'Leaves', 'file'],
                ['notifications', 'Alerts', 'bell'],
              ].map(([k, l, ic]) => (
                <NavLink key={k} to={`/employee/${k}`} className={({ isActive }) => (isActive ? 'on' : '')}>
                  <Ic n={ic} s={20} />
                  {l}
                </NavLink>
              ))}
            </nav>
          </div>
        </div>
        <AgentSetup open={agentAsk} onClose={() => setAgentAsk(false)} start="ask" />
        <Modal open={confirm} onClose={() => setConfirm(false)} label="Log out">
          <ModalHead title="Log out now?" onClose={() => setConfirm(false)} />
          {d && (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,minmax(0,1fr))', gap: 10 }}>
                <div className="ep-st">
                  <span>Worked</span>
                  <b>{hm(d.totals.work)}</b>
                </div>
                <div className="ep-st">
                  <span>Short by</span>
                  <b style={{ color: '#B91C1C' }}>{hm(d.required - d.totals.work)}</b>
                </div>
              </div>
              <div className="e-note err" style={{ marginTop: 12, fontSize: 13, lineHeight: '20px' }}>
                Today will be marked <b>Short</b>
                {new Date() < new Date(`${d.dayKey}T${today.settings.workEnd}:00+05:30`) ? (
                  <>
                    {' '}
                    and <b>Early Logout</b> (before {today.settings.workEnd})
                  </>
                ) : null}
                . Your manager can see this.
              </div>
            </>
          )}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,minmax(0,1fr))', gap: 10, marginTop: 16 }}>
            <button type="button" className="e-btn lg" onClick={() => setConfirm(false)}>
              Keep working
            </button>
            <button type="button" className="e-btn lg dd" onClick={doLogout}>
              Log out
            </button>
          </div>
        </Modal>
      </PortalCtx.Provider>
    </ToastProvider>
  );
}
