import React, { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Layout, Menu, Button, Grid, Drawer, Empty, Badge, Dropdown, message } from 'antd';
import axios from 'axios';
import lmsApi from '@/pages/Lms/api';
import { getSocket } from '@/socket';
import {
  DashboardOutlined,
  ReadOutlined,
  VideoCameraOutlined,
  PlayCircleOutlined,
  CheckSquareOutlined,
  TeamOutlined,
  FileTextOutlined,
  FormOutlined,
  FolderOpenOutlined,
  SoundOutlined,
  QuestionCircleOutlined,
  BarChartOutlined,
  CalendarOutlined,
  TrophyOutlined,
  MenuOutlined,
  LogoutOutlined,
  BookOutlined,
  BellOutlined,
  UserOutlined,
  MoonOutlined,
  SunOutlined,
  ScheduleOutlined,
  AuditOutlined,
  LineChartOutlined,
  ProfileOutlined,
  ExperimentOutlined,
  RocketOutlined,
  FileProtectOutlined,
  SafetyCertificateOutlined,
  ProjectOutlined,
  LockOutlined,
  WalletOutlined,
} from '@ant-design/icons';
import { Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom';
import { useDispatch, useSelector } from 'react-redux';
import { selectCurrentAdmin } from '@/redux/auth/selectors';
import { logout as logoutAction } from '@/redux/auth/actions';
import PageLoader from '@/components/PageLoader';
import { LMS_TEACHER_ROLES } from '@/config/roles';
import { useAppContext } from '@/context/appContext';
import { useTheme } from '@/context/themeContext';
import careerLabIcon from '@/style/images/Horizontal-1-transparent.png';
import careerLabCollapsedIcon from '@/style/images/Vertical-1-transparent.png';

const { Sider, Header, Content } = Layout;
const { useBreakpoint } = Grid;

const TeacherDashboard = lazy(() => import('@/pages/Lms/TeacherDashboard'));
const StudentDashboard = lazy(() => import('@/pages/Lms/StudentDashboard'));
const LiveClasses = lazy(() => import('@/pages/Lms/LiveClasses'));
const Recordings = lazy(() => import('@/pages/Lms/Recordings'));
const Attendance = lazy(() => import('@/pages/Lms/Attendance'));
const CourseBuilder = lazy(() => import('@/pages/Lms/CourseBuilder'));
const LearningPage = lazy(() => import('@/pages/Lms/LearningPage'));
const Assignments = lazy(() => import('@/pages/Lms/Assignments'));
const Quizzes = lazy(() => import('@/pages/Lms/Quizzes'));
const Doubts = lazy(() => import('@/pages/Lms/Doubts'));
const AnnouncementsPage = lazy(() => import('@/pages/Lms/Announcements'));
const Certificates = lazy(() => import('@/pages/Lms/Certificates'));
const Analytics = lazy(() => import('@/pages/Lms/Analytics'));
const Curriculum = lazy(() => import('@/pages/Lms/Curriculum'));
const AttemptsAdmin = lazy(() => import('@/pages/Lms/AttemptsAdmin'));
const Results = lazy(() => import('@/pages/Lms/Results'));
const AssessmentDashboard = lazy(() => import('@/pages/Lms/AssessmentDashboard'));
const TestIntro = lazy(() => import('@/pages/Lms/TestIntro'));
const Policies = lazy(() => import('@/pages/Lms/Policies'));
const Eligibility = lazy(() => import('@/pages/Lms/Eligibility'));
const Projects = lazy(() => import('@/pages/Lms/Projects'));
const Learner360 = lazy(() => import('@/pages/Lms/Learner360'));
// Same month-grid calendar the CRM's LMS → Calendar tab uses — the backend's
// listFor()/resolveRole() already scope GET /lms/live-classes to "every batch
// I teach" for a Teacher and "just my batch" for a Student, so one component
// serves both roles unchanged.
const LmsCalendar = lazy(() => import('@/pages/Lms/Calendar'));
const MyFees = lazy(() => import('@/pages/Lms/MyFees'));

const ComingSoon = ({ title }) => (
  <div style={{ padding: 48 }}>
    <Empty description={<span><b>{title}</b><br />This section is being rolled out in the next update.</span>} />
  </div>
);

const fmtInr = (n) => {
  try {
    return Number(n).toLocaleString('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });
  } catch (e) {
    return `₹${n}`;
  }
};

// Rendered in place of every route once the finance tick (see backend
// jobs/financeEmiTick.js) has put this account on hold for an EMI
// installment more than 24h overdue — see updates.finance in the
// /my/updates poll below. Clears itself automatically: the same poll
// notices financeHold flip back to false the moment the payment lands
// (paymentsController/refreshStatus.js and paymentsPublicController/
// return.js both call services/payments/financeHold.js's unblockIfClear).
function FinanceHoldScreen({ info }) {
  return (
    <div style={{ minHeight: '70vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div
        style={{
          maxWidth: 440,
          width: '100%',
          textAlign: 'center',
          background: 'var(--hub-surface, #fff)',
          border: '1px solid var(--hub-border, #e5e7eb)',
          borderRadius: 18,
          padding: '40px 32px',
          boxShadow: '0 10px 30px rgba(15,23,42,.08)',
        }}
      >
        <div
          style={{
            width: 56,
            height: 56,
            borderRadius: '50%',
            margin: '0 auto 18px',
            display: 'grid',
            placeItems: 'center',
            background: 'color-mix(in srgb, #dc2626 14%, transparent)',
            color: '#dc2626',
            fontSize: 26,
          }}
        >
          <LockOutlined />
        </div>
        <h2 style={{ margin: '0 0 8px', fontSize: 19, fontWeight: 800 }}>Access on hold</h2>
        <p style={{ color: '#667085', fontSize: 14, marginBottom: 20 }}>
          Your course access is paused because an EMI installment is overdue{info?.course ? ` for ${info.course}` : ''}. Pay
          now to reactivate instantly.
        </p>
        {info?.amount ? <div style={{ fontSize: 28, fontWeight: 800, marginBottom: 20 }}>{fmtInr(info.amount)}</div> : null}
        {info?.shortUrl ? (
          <a href={info.shortUrl} target="_blank" rel="noreferrer">
            <Button type="primary" size="large" block>
              Pay now
            </Button>
          </a>
        ) : (
          <p style={{ fontSize: 13, color: '#94a3b8' }}>Contact your program coordinator for the payment link.</p>
        )}
        <p style={{ fontSize: 12, color: '#94a3b8', marginTop: 18 }}>This page updates automatically once your payment is confirmed.</p>
      </div>
    </div>
  );
}

// "Quizzes & Exams" as one dropdown group with 3 sub-tabs — Basic (flat),
// Major and Micro (each its own dropdown of the reference nav's 2 variants).
// [path, label, icon, element] — a group entry carries a 5th array of
// children of the same shape, nested to any depth.
function quizzesGroup(base, label) {
  return [
    'group:quizzes', label, <FormOutlined />, null,
    [
      [
        `${base}/tests/basic`,
        'Basic',
        <ProfileOutlined />,
        <TestIntro testType="BASIC" icon={<ProfileOutlined />} eyebrow="Foundational Assessment" title="Basic Test" description="Multiple-choice, output-based, and short programming questions covering core fundamentals." />,
      ],
      [
        'group:major-test', 'Major', <FormOutlined />, null,
        [
          [
            `${base}/tests/major/python-sql`,
            'Python Programming Foundations & SQL Basics',
            <FormOutlined />,
            <TestIntro testType="MAJOR" icon={<FormOutlined />} eyebrow="Comprehensive Assessment" title="Python Programming Foundations & SQL Basics" description="In-depth, advanced-level questions administered under full proctoring." />,
          ],
          [
            `${base}/tests/major/nlp`,
            'NLP Fundamentals & Introduction to LLMs',
            <FormOutlined />,
            <TestIntro testType="NLP_MAJOR" icon={<FormOutlined />} eyebrow="Comprehensive Assessment" title="NLP Fundamentals & Introduction to LLMs" description="Text preprocessing, POS tagging & NER, TF-IDF/YAKE keyword extraction, embeddings, sentiment analysis, and LLM fundamentals." />,
          ],
        ],
      ],
      [
        'group:micro-test', 'Micro', <ExperimentOutlined />, null,
        [
          [
            `${base}/tests/micro/sql-db`,
            'SQL-Backed Keyword Database',
            <ExperimentOutlined />,
            <TestIntro testType="MICRO" icon={<ExperimentOutlined />} eyebrow="Applied Project" title="Micro Test — SQL-Backed Keyword Database" description="Design and query a SQL-backed keyword database." />,
          ],
          [
            `${base}/tests/micro/nlp-serp`,
            'NLP on a SERP Dataset',
            <ExperimentOutlined />,
            <TestIntro testType="NLP_MICRO" icon={<ExperimentOutlined />} eyebrow="Applied Project" title="Micro Test — NLP on a SERP Dataset" description="Given 20 scraped article titles: extract keywords, classify intent, output ranked report." />,
          ],
        ],
      ],
    ],
  ];
}

// Recursively flattens nav entries into their routable leaves — a "group:"
// entry (no route of its own) may itself contain further group entries
// (Major/Micro nested inside Quizzes & Exams), so this recurses to any depth.
function flattenNavLeaves(entries) {
  return entries.flatMap((entry) => (entry[4] ? flattenNavLeaves(entry[4]) : [entry]));
}

// Recursively builds AntD Menu items, preserving nested dropdown groups.
// unreadPaths (a Set of nav paths) draws a small live dot next to any item
// with an unread notification pointing at it — stays lit until that
// notification is read (see markLinkRead), not on a timer.
function buildMenuItems(entries, unreadPaths) {
  return entries.map(([path, label, icon, , children]) => {
    const dotted = unreadPaths && unreadPaths.has(path);
    const renderedLabel = dotted ? (
      <span className="lms-nav-unread-label">
        {label}
        <i className="lms-nav-unread-dot" />
      </span>
    ) : label;
    return children
      ? { key: path, icon, label: renderedLabel, children: buildMenuItems(children, unreadPaths) }
      : { key: path, icon, label: renderedLabel };
  });
}

// [path, label, icon, element]
const TEACHER_NAV = [
  ['/teacher', 'Dashboard', <DashboardOutlined />, <TeacherDashboard />],
  ['/teacher/assessment-dashboard', 'Assessment', <RocketOutlined />, <AssessmentDashboard />],
  ['/teacher/courses', 'My Courses', <ReadOutlined />, <CourseBuilder />],
  ['/teacher/classes', 'Live Classes', <VideoCameraOutlined />, <LiveClasses />],
  ['/teacher/recordings', 'Recorded Classes', <PlayCircleOutlined />, <Recordings />],
  ['/teacher/attendance', 'Attendance', <CheckSquareOutlined />, <Attendance />],
  ['/teacher/students', 'Students', <TeamOutlined />, <ComingSoon title="Students" />],
  ['/teacher/assignments', 'Assignments', <FileTextOutlined />, <Assignments />],
  ['/teacher/projects', 'Projects', <ProjectOutlined />, <Projects />],
  quizzesGroup('/teacher', 'Quizzes & Exams'),
  ['/teacher/attempts', 'Test Attempts', <AuditOutlined />, <AttemptsAdmin />],
  ['/teacher/curriculum', 'Curriculum Tracker', <ScheduleOutlined />, <Curriculum />],
  ['/teacher/material', 'Study Material', <FolderOpenOutlined />, <ComingSoon title="Study Material" />],
  ['/teacher/announcements', 'Announcements', <SoundOutlined />, <AnnouncementsPage />],
  ['/teacher/policies', 'Policies', <FileProtectOutlined />, <Policies />],
  ['/teacher/eligibility', 'Eligibility', <SafetyCertificateOutlined />, <Eligibility />],
  ['/teacher/learner-360', 'Learner 360', <ProfileOutlined />, <Learner360 />],
  ['/teacher/doubts', 'Doubts / Questions', <QuestionCircleOutlined />, <Doubts />],
  ['/teacher/analytics', 'Analytics', <BarChartOutlined />, <Analytics />],
  ['/teacher/calendar', 'Calendar', <CalendarOutlined />, <LmsCalendar />],
  ['/teacher/certificates', 'Certificates', <TrophyOutlined />, <Certificates />],
];

const STUDENT_NAV = [
  ['/learn', 'Home', <DashboardOutlined />, <StudentDashboard />],
  ['/learn/fees', 'My Fees', <WalletOutlined />, <MyFees />],
  ['/learn/assessment-dashboard', 'Assessment', <RocketOutlined />, <AssessmentDashboard />],
  ['/learn/courses', 'My Courses', <BookOutlined />, <LearningPage />],
  ['/learn/classes', 'My Classes', <VideoCameraOutlined />, <LiveClasses />],
  ['/learn/recordings', 'Recordings', <PlayCircleOutlined />, <Recordings />],
  ['/learn/attendance', 'My Attendance', <CheckSquareOutlined />, <Attendance />],
  ['/learn/calendar', 'Calendar', <CalendarOutlined />, <LmsCalendar />],
  ['/learn/assignments', 'Assignments', <FileTextOutlined />, <Assignments />],
  ['/learn/projects', 'My Projects', <ProjectOutlined />, <Projects />],
  quizzesGroup('/learn', 'Quizzes & Exams'),
  ['/learn/results', 'My Results', <LineChartOutlined />, <Results />],
  ['/learn/material', 'Study Material', <FolderOpenOutlined />, <ComingSoon title="Study Material" />],
  ['/learn/doubts', 'My Doubts', <QuestionCircleOutlined />, <Doubts />],
  ['/learn/notifications', 'Announcements', <BellOutlined />, <AnnouncementsPage />],
  ['/learn/policies', 'Policies', <FileProtectOutlined />, <Policies />],
  ['/learn/eligibility', 'My Eligibility', <SafetyCertificateOutlined />, <Eligibility />],
  ['/learn/certificates', 'My Certificates', <TrophyOutlined />, <Certificates />],
];

export default function LmsPanelApp() {
  const admin = useSelector(selectCurrentAdmin) || {};
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const location = useLocation();
  const screens = useBreakpoint();
  const isMobile = !screens.lg;
  const [drawer, setDrawer] = useState(false);

  // Same collapse state + theme as the Admin panel, so the two shells feel
  // like one product instead of two separately-built UIs.
  const { state: stateApp, appContextAction } = useAppContext();
  const { isNavMenuClose } = stateApp;
  const { navMenu } = appContextAction;
  const { isDark, toggleTheme, palette, setPalette, palettes } = useTheme();

  const isTeacher = LMS_TEACHER_ROLES.includes(admin.role);
  const base = isTeacher ? '/teacher' : '/learn';
  const nav = isTeacher ? TEACHER_NAV : STUDENT_NAV;
  // A "group:" entry (Quizzes & Exams / Major / Micro) has no route of its
  // own — its 5th element carries the real, routable leaf entries, to any
  // nesting depth.
  const leaves = useMemo(() => flattenNavLeaves(nav), [nav]);
  const collapsed = isMobile ? false : isNavMenuClose;
  const sidebarGap = isMobile ? 0 : collapsed ? 80 : 256;

  const selectedKey = useMemo(() => {
    // longest matching path wins so /teacher/classes doesn't select /teacher
    const match = leaves
      .map(([p]) => p)
      .filter((p) => location.pathname === p || location.pathname.startsWith(p + '/'))
      .sort((a, b) => b.length - a.length)[0];
    return match || base;
  }, [location.pathname, leaves, base]);

  // ── real-time: Socket.IO push refetches /api/lms/my/updates instead of a
  // tight poll. backend/src/services/lms/realtime.js already emits
  // 'notification:new' (assignments graded, doubt replies, announcements)
  // and the 'lms:announcement' / 'lms:doubt' broadcasts whenever something
  // changes — we just never had a client listening. The REST endpoint stays
  // the source of truth (a socket event only says "go refetch"); the
  // interval below drops to a long safety net in case a socket event is
  // ever missed or the connection is mid-reconnect (also a no-op on Vercel
  // serverless, where the socket layer doesn't run at all).
  const [updates, setUpdates] = useState({ unread: 0, notifications: [], liveNow: [] });
  const lastTopId = useRef(null);
  const pollUpdates = useCallback(async () => {
    try {
      const res = await lmsApi.updates();
      const u = (res && res.result) || { unread: 0, notifications: [], liveNow: [] };
      setUpdates(u);
      const top = u.notifications && u.notifications[0];
      if (top && lastTopId.current && top.id !== lastTopId.current && !top.read) {
        message.info(top.title);
      }
      if (top) lastTopId.current = top.id;
    } catch (e) {
      /* silent */
    }
  }, []);
  useEffect(() => {
    pollUpdates();
    const iv = setInterval(pollUpdates, 180000); // 3-min safety net, not the primary trigger
    const onVis = () => document.visibilityState === 'visible' && pollUpdates();
    document.addEventListener('visibilitychange', onVis);
    // also refresh when a live-class socket event bubbles (VPS deployments)
    const onLive = () => pollUpdates();
    window.addEventListener('lms:liveclass', onLive);

    const socket = getSocket();
    const onNotification = (doc) => {
      if (doc?.module === 'LMS') pollUpdates();
    };
    socket?.on('notification:new', onNotification);
    socket?.on('lms:announcement', pollUpdates);
    socket?.on('lms:doubt', pollUpdates);

    return () => {
      clearInterval(iv);
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('lms:liveclass', onLive);
      socket?.off('notification:new', onNotification);
      socket?.off('lms:announcement', pollUpdates);
      socket?.off('lms:doubt', pollUpdates);
    };
  }, [pollUpdates]);

  // Marks notifications read — optimistic locally (so the dot/badge drops
  // the instant the matching page is opened, not on the next 3-min poll)
  // and persisted via the generic /notification/:id/read route (same one
  // the main CRM bell uses). Calls axios directly rather than request.patch
  // — that helper always pops a "Marked as read" success toast, which is
  // fine for one explicit bell click but noisy fired silently on every nav.
  const markRead = useCallback((ids) => {
    if (!ids || !ids.length) return;
    setUpdates((u) => ({
      ...u,
      unread: Math.max(0, (u.unread || 0) - ids.length),
      notifications: (u.notifications || []).map((n) => (ids.includes(n.id) ? { ...n, read: true } : n)),
    }));
    ids.forEach((id) => axios.patch(`notification/${id}/read`).catch(() => {}));
  }, []);
  const markLinkRead = useCallback(
    (path) => {
      const ids = (updates.notifications || [])
        .filter((n) => !n.read && n.link && n.link.replace(/^\/(learn|teacher)/, base) === path)
        .map((n) => n.id);
      markRead(ids);
    },
    [updates.notifications, base, markRead]
  );

  // Live dot next to a sidebar item stays lit until its matching
  // notification(s) get marked read — see buildMenuItems.
  const unreadPaths = useMemo(() => {
    const set = new Set();
    (updates.notifications || []).forEach((n) => {
      if (n.read || !n.link) return;
      set.add(n.link.replace(/^\/(learn|teacher)/, base));
    });
    return set;
  }, [updates.notifications, base]);

  const go = (path) => {
    navigate(path);
    setDrawer(false);
    markLinkRead(path);
  };

  const notifItems = (updates.notifications || []).slice(0, 10).map((n) => ({
    key: n.id,
    label: (
      <div
        style={{ maxWidth: 320, whiteSpace: 'normal', padding: '2px 0' }}
        onClick={() => {
          if (n.link) navigate(n.link.replace(/^\/(learn|teacher)/, base));
          if (!n.read) markRead([n.id]);
        }}
      >
        <div style={{ fontWeight: n.read ? 400 : 600, fontSize: 13 }}>{n.title}</div>
        {n.body ? <div style={{ fontSize: 12, color: '#667085' }}>{n.body}</div> : null}
      </div>
    ),
  }));

  const menu = (
    <Menu
      mode="inline"
      theme="dark"
      selectedKeys={[selectedKey]}
      inlineCollapsed={isMobile ? false : collapsed}
      onClick={({ key }) => key.startsWith('group:') || go(key)}
      items={buildMenuItems(nav, unreadPaths)}
      style={{ borderRight: 0, background: 'transparent', width: '100%' }}
    />
  );

  // Routes here isn't nested under a parent <Route path="/teacher/*">, so it
  // matches against the full browser pathname — route paths must stay
  // absolute (e.g. "/teacher/courses"), never stripped down to a relative
  // fragment, or nothing below the sidebar will ever match a click.
  const financeHold = updates.finance && updates.finance.hold;
  const routes = (
    <Suspense fallback={<PageLoader />}>
      {financeHold ? (
        <FinanceHoldScreen info={updates.finance.outstanding} />
      ) : (
        <Routes>
          {leaves.map(([path, , , element]) => (
            <Route key={path} path={path} element={element} />
          ))}
          {/* Not in the sidebar (dropped along with "All Quizzes"), but every
              Test Intro card's "Go to Quizzes & Exams" button still points here. */}
          <Route path={`${base}/quizzes`} element={<Quizzes />} />
          <Route path="*" element={<Navigate to={base} replace />} />
        </Routes>
      )}
    </Suspense>
  );

  const sidebarInner = (isDrawer) => (
    <>
      <div
        className="logo"
        onClick={() => go(base)}
        style={{
          cursor: 'pointer',
          ...(!isDrawer && collapsed && { margin: '15px auto 30px', width: 'auto', justifyContent: 'center' }),
        }}
      >
        <img
          src={!isDrawer && collapsed ? careerLabCollapsedIcon : careerLabIcon}
          alt="Career Lab Consulting"
          style={{
            height: '40px',
            width: 'auto',
            objectFit: 'contain',
            marginLeft: !isDrawer && collapsed ? 0 : '-5px',
          }}
        />
      </div>
      {updates.liveNow && updates.liveNow.length > 0 && (
        <div
          onClick={() => go(`${base}/classes`)}
          style={{
            margin: !isDrawer && collapsed ? '0 10px 8px' : '0 16px 8px',
            padding: !isDrawer && collapsed ? '8px 0' : '8px 12px',
            borderRadius: 8,
            background: '#7f1d1d',
            color: '#fff',
            fontWeight: 700,
            fontSize: 12,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: !isDrawer && collapsed ? 'center' : 'flex-start',
            gap: 8,
          }}
          title={`LIVE NOW · ${updates.liveNow.length}`}
        >
          <span style={{ width: 8, height: 8, borderRadius: 8, background: '#fca5a5', boxShadow: '0 0 0 3px rgba(252,165,165,.35)', flexShrink: 0 }} />
          {(isDrawer || !collapsed) && <span>LIVE NOW · {updates.liveNow.length}</span>}
        </div>
      )}
      {menu}
    </>
  );

  return (
    <Layout hasSider style={{ minHeight: '100vh' }}>
      {!isMobile && (
        <Sider
          collapsible
          collapsed={collapsed}
          onCollapse={() => navMenu.collapse()}
          trigger={<div className="navigation-trigger">{collapsed ? '»' : '«'}</div>}
          className="navigation"
          width={256}
          style={{ overflow: 'hidden', height: '100vh', position: 'fixed', top: 0, left: 0, zIndex: 20 }}
          theme="dark"
        >
          {sidebarInner(false)}
        </Sider>
      )}

      <Drawer
        placement="left"
        open={drawer}
        onClose={() => setDrawer(false)}
        width={256}
        closable={false}
        className="navigation-drawer"
        styles={{ body: { padding: 0 }, header: { display: 'none' } }}
      >
        <Sider className="navigation" theme="dark" collapsible={false} width={256} style={{ position: 'static', height: '100%' }}>
          {sidebarInner(true)}
        </Sider>
      </Drawer>

      <Layout style={{ marginLeft: sidebarGap, height: '100vh', overflowY: 'auto', transition: 'margin-left .2s ease-in-out' }}>
        <Header className="app-header" style={{ padding: '0 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', position: 'sticky', top: 0, zIndex: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {isMobile && <Button type="text" icon={<MenuOutlined />} onClick={() => setDrawer(true)} style={{ color: 'var(--nav-text)' }} />}
            <span style={{ fontWeight: 600, color: 'var(--nav-text)' }}>{isTeacher ? 'Teacher' : 'Student'} · {admin.name} {admin.surname || ''}</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Dropdown menu={{ items: notifItems.length ? notifItems : [{ key: 'none', label: 'No notifications', disabled: true }] }} trigger={['click']} placement="bottomRight">
              <Badge count={updates.unread || 0} size="small">
                <span className="header-bell-trigger">
                  <BellOutlined style={{ color: 'var(--nav-text)', fontSize: 16 }} />
                </span>
              </Badge>
            </Dropdown>
            <Button type="text" icon={<UserOutlined />} onClick={() => go(base)} style={{ color: 'var(--nav-text)' }}>
              {admin.email}
            </Button>
            <button
              type="button"
              className={`theme-toggle ${isDark ? 'is-dark' : ''}`}
              onClick={toggleTheme}
              role="switch"
              aria-checked={isDark}
              aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
              title={isDark ? 'Light mode' : 'Dark mode'}
            >
              <span className="theme-toggle-track">
                <SunOutlined className="tt-icon tt-sun" />
                <MoonOutlined className="tt-icon tt-moon" />
                <span className="theme-toggle-knob" />
              </span>
            </button>
            <select
              className="theme-picker"
              value={palette}
              onChange={(e) => setPalette(e.target.value)}
              aria-label="Colour theme"
              title="Colour theme"
            >
              {(palettes || []).map((p) => (
                <option key={p.key} value={p.key}>
                  {p.emoji} {p.label}
                </option>
              ))}
            </select>
            <Button className="lms-logout-btn" type="text" icon={<LogoutOutlined />} onClick={() => dispatch(logoutAction())}>
              Logout
            </Button>
          </div>
        </Header>
        <Content style={{ margin: 10, overflow: 'initial', width: 'calc(100% - 20px)', padding: 0, maxWidth: 'none' }}>
          {routes}
        </Content>
      </Layout>
    </Layout>
  );
}
