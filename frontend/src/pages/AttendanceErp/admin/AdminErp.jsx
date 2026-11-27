import React, { Suspense, lazy, useEffect, useState } from 'react';
import api from '../api';
import { Ic, Skeleton, ToastProvider, useErpLive, useNow, clock } from '../ui';
import '../erp.css';

// HRMS › Work & Leave Tracker › Attendance ERP — the ONE admin tab of the
// Attendance & Leave ERP (design A1–A14). Its 12 sub-tabs live here.
const Dashboard = lazy(() => import('./Dashboard'));
const Live = lazy(() => import('./Live'));
const Attendance = lazy(() => import('./Attendance'));
const Detail = lazy(() => import('./Detail'));
const Leaves = lazy(() => import('./Leaves'));
const Calendar = lazy(() => import('./Calendar'));
const Reports = lazy(() => import('./Reports'));
const Employees = lazy(() => import('./Employees'));
const Audit = lazy(() => import('./Audit'));
const Settings = lazy(() => import('./Settings'));
const SystemTracking = lazy(() => import('./SystemTracking'));
const IdleLog = lazy(() => import('./IdleLog'));

const TABS = [
  ['dashboard', 'Dashboard'],
  ['employees', 'Employees'],
  ['attendance', 'Attendance'],
  ['live', 'Live Activity'],
  ['system', 'System Tracking'],
  ['idle', 'Inactivity Log'],
  ['leaves', 'Leaves'],
  ['calendar', 'Leave Calendar'],
  ['reports', 'Reports'],
  ['notifications', 'Notifications'],
  ['audit', 'Audit Logs'],
  ['settings', 'Settings'],
];
const KEY = 'erp.adminTab';

export default function AdminErp() {
  const [tab, setTabState] = useState(() => {
    try {
      return localStorage.getItem(KEY) || 'dashboard';
    } catch (e) {
      return 'dashboard';
    }
  });
  const [detail, setDetail] = useState(null); // { adminId, date }
  const [q, setQ] = useState('');
  const [badges, setBadges] = useState({});
  const [settings, setSettings] = useState(null);
  const now = useNow(30000);
  const setTab = (t) => {
    setDetail(null);
    setTabState(t);
    try {
      localStorage.setItem(KEY, t);
    } catch (e) {
      /* private window */
    }
  };
  const loadBadges = async () => {
    const [l, n, i] = await Promise.all([api.get('admin/leaves', { status: 'Pending' }), api.get('admin/notifications'), api.get('admin/idle')]);
    setBadges({ leaves: l.success ? l.result.counts.Pending : 0, notifications: n.success ? n.result.unread : 0, idle: i.success ? i.result.kpis.count : 0 });
  };
  useEffect(() => {
    loadBadges();
    api.get('admin/settings').then((r) => r.success && setSettings(r.result.settings));
    const id = setInterval(() => !document.hidden && loadBadges(), 60000);
    return () => clearInterval(id);
  }, []);
  useErpLive(loadBadges);

  const openDetail = (adminId, date) => setDetail({ adminId, date });
  const nowLabel = new Date(now).toLocaleDateString('en-GB', { timeZone: 'Asia/Kolkata', weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
  const shared = { openDetail, setTab, globalQ: q };

  return (
    <ToastProvider>
      <div className="erp e-page">
        <div className="e-erphead">
          <div className="e-erptop">
            <div className="e-erpicon">
              <Ic n="clock" s={20} />
            </div>
            <div style={{ flex: 1, minWidth: 240 }}>
              <div style={{ fontSize: 20, fontWeight: 700 }}>Attendance ERP</div>
              <div style={{ fontSize: 12, color: 'var(--e-mut)', marginTop: 2 }}>
                {nowLabel}
                {settings && ` · Shift ${settings.workStart} – ${settings.workEnd} · Now ${clock(now)} · Target ${String(Math.floor(settings.requiredMin / 60)).padStart(2, '0')}h ${String(settings.requiredMin % 60).padStart(2, '0')}m actual work · Times in IST`}
              </div>
            </div>
            <label className="e-inp" style={{ width: 280, maxWidth: '100%' }}>
              <Ic n="search" s={15} style={{ color: '#94A3B8' }} />
              <input
                aria-label="Search employees"
                placeholder="Search employee, code…"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !['attendance', 'employees', 'live', 'system', 'idle', 'leaves'].includes(tab)) setTab('attendance');
                }}
              />
            </label>
            <button type="button" className="e-bell" aria-label={`Notifications, ${badges.notifications || 0} unread`} onClick={() => setTab('notifications')}>
              <Ic n="bell" />
              {badges.notifications > 0 && <span>{badges.notifications}</span>}
            </button>
            <span className="e-live">
              <i />
              Live
            </span>
          </div>
          <nav className="e-subtabs" aria-label="Attendance ERP sections">
            {TABS.map(([k, l]) => (
              <button key={k} type="button" className={tab === k && !detail ? 'on' : ''} onClick={() => setTab(k)}>
                {l}
                {badges[k] > 0 && <em>{badges[k]}</em>}
              </button>
            ))}
          </nav>
        </div>
        <Suspense fallback={<Skeleton kpis={4} />}>
          {detail ? (
            <Detail adminId={detail.adminId} date={detail.date} onBack={() => setDetail(null)} onDate={(d) => setDetail({ ...detail, date: d })} />
          ) : (
            <>
              {tab === 'dashboard' && <Dashboard {...shared} />}
              {tab === 'live' && <Live {...shared} />}
              {tab === 'attendance' && <Attendance {...shared} />}
              {tab === 'system' && <SystemTracking {...shared} />}
              {tab === 'idle' && <IdleLog {...shared} onChanged={loadBadges} />}
              {tab === 'leaves' && <Leaves {...shared} onChanged={loadBadges} />}
              {tab === 'calendar' && <Calendar {...shared} />}
              {tab === 'reports' && <Reports {...shared} />}
              {tab === 'employees' && <Employees {...shared} />}
              {(tab === 'notifications' || tab === 'audit') && <Audit {...shared} focus={tab} onChanged={loadBadges} />}
              {tab === 'settings' && <Settings {...shared} onSaved={(s) => setSettings(s)} />}
            </>
          )}
        </Suspense>
      </div>
    </ToastProvider>
  );
}
