import React, { Suspense, lazy, useEffect, useState } from 'react';
import api from '../api';
import { Ic, Skeleton, ToastProvider, useErpLive, useNow, clock } from '../ui';
import '../erp.css';

// HRMS › Work & Leave Tracker › Attendance ERP — the ONE admin tab of the
// Attendance & Leave ERP (design A1–A14). Its sub-tabs live here; Notifications
// go to the CRM header bell; the Audit log opens from Settings › "Audit log"
// (2026-11-28 — the ERP's own bell was removed).
const Dashboard = lazy(() => import('./Dashboard'));
const Live = lazy(() => import('./Live'));
const Attendance = lazy(() => import('./Attendance'));
const Detail = lazy(() => import('./Detail'));
const Leaves = lazy(() => import('./Leaves'));
const Calendar = lazy(() => import('./Calendar'));
const Reports = lazy(() => import('./Reports'));
const Employees = lazy(() => import('./Employees'));
const AuditPanel = lazy(() => import('./Audit'));
const Settings = lazy(() => import('./Settings'));
const SystemTracking = lazy(() => import('./SystemTracking'));
const IdleLog = lazy(() => import('./IdleLog'));

// [key, label, icon] in groups — a thin divider sits between groups.
const GROUPS = [
  [['dashboard', 'Dashboard', 'home']],
  [
    ['employees', 'Employees', 'users'],
    ['attendance', 'Attendance', 'check'],
  ],
  [
    ['live', 'Live Activity', 'act'],
    ['system', 'System Tracking', 'laptop'],
    ['idle', 'Inactivity Log', 'pause'],
  ],
  [
    ['leaves', 'Leaves', 'file'],
    ['calendar', 'Leave Calendar', 'cal'],
  ],
  [['reports', 'Reports', 'chart']],
];
// Settings opens from the gear in the header (keeps the tab row on one line).
const TABS = [...GROUPS.flat(), ['settings', 'Settings', 'gear']];
const KEY = 'erp.adminTab';

export default function AdminErp({ initialTab }) {
  const [tab, setTabState] = useState(() => {
    if (initialTab && TABS.some(([k]) => k === initialTab)) return initialTab;
    try {
      const t = localStorage.getItem(KEY);
      return TABS.some(([k]) => k === t) ? t : 'dashboard'; // old 'notifications'/'audit' → dashboard
    } catch (e) {
      return 'dashboard';
    }
  });
  const [detail, setDetail] = useState(null); // { adminId, date }
  const [q, setQ] = useState('');
  const [badges, setBadges] = useState({});
  const [settings, setSettings] = useState(null);
  const [bell, setBell] = useState(false);
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
    const [l, i] = await Promise.all([api.get('admin/leaves', { status: 'Pending' }), api.get('admin/idle')]);
    setBadges({ leaves: l.success ? l.result.counts.Pending : 0, idle: i.success ? i.result.kpis.count : 0 });
  };
  useEffect(() => {
    loadBadges();
    api.get('admin/settings').then((r) => r.success && setSettings(r.result.settings));
    const id = setInterval(() => !document.hidden && loadBadges(), 60000);
    return () => clearInterval(id);
  }, []);
  useErpLive(loadBadges);
  // A header-notification deep link (/hr/work-tracker?erp=leaves) opens that sub-tab.
  useEffect(() => {
    if (initialTab && TABS.some(([k]) => k === initialTab)) setTab(initialTab);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialTab]);

  const openDetail = (adminId, date) => setDetail({ adminId, date });
  const nowLabel = new Date(now).toLocaleDateString('en-GB', { timeZone: 'Asia/Kolkata', weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
  const shared = { openDetail, setTab, globalQ: q };

  return (
    <ToastProvider>
      <div className="erp e-page">
        <div className="e-erphead">
          <div className="e-erptop">
            <div className="e-erpicon">
              <Ic n="clock" s={22} />
            </div>
            <div className="e-erptitle">
              <h1>Attendance ERP</h1>
              <div className="e-erpmeta">
                <span>
                  <Ic n="cal" s={13} />
                  {nowLabel}
                </span>
                {settings && (
                  <>
                    <span>
                      <Ic n="clock" s={13} />
                      Shift {settings.workStart} – {settings.workEnd}
                    </span>
                    <span>
                      <Ic n="target" s={13} />
                      Target {Math.floor(settings.requiredMin / 60)}h{settings.requiredMin % 60 ? ` ${settings.requiredMin % 60}m` : ''} actual work
                    </span>
                    <span className="now" title="All times are IST">
                      Now {clock(now)} IST
                    </span>
                  </>
                )}
              </div>
            </div>
            <label className="e-inp e-erpsearch">
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
            <button type="button" className={`e-bell${tab === 'settings' && !detail ? ' on' : ''}`} aria-label="Attendance settings" title="Settings" onClick={() => setTab('settings')}>
              <Ic n="gear" />
            </button>
            <span className="e-live">
              <i />
              Live
            </span>
            <a className="e-btn sm e-portalbtn" href="/employee/dashboard" target="_blank" rel="noopener" title="The panel every employee logs in to: /employee">
              Employee Portal
              <Ic n="ext" s={13} />
            </a>
          </div>
          <nav className="e-subtabs" aria-label="Attendance ERP sections">
            {GROUPS.map((g, gi) => (
              <React.Fragment key={gi}>
                {gi > 0 && <i className="sep" aria-hidden="true" />}
                {g.map(([k, l, icon]) => (
                  <button key={k} type="button" className={tab === k && !detail ? 'on' : ''} aria-current={tab === k && !detail ? 'page' : undefined} onClick={() => setTab(k)}>
                    <Ic n={icon} s={15} />
                    {l}
                    {badges[k] > 0 && <em>{badges[k]}</em>}
                  </button>
                ))}
              </React.Fragment>
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
              {tab === 'settings' && <Settings {...shared} onSaved={(s) => setSettings(s)} onAudit={() => setBell(true)} />}
            </>
          )}
        </Suspense>
        {bell && (
          <Suspense fallback={null}>
            <AuditPanel open onClose={() => setBell(false)} />
          </Suspense>
        )}
      </div>
    </ToastProvider>
  );
}
