import React, { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Layout, Menu, Button, Grid, Drawer, Empty, Badge, Dropdown, message } from 'antd';
import lmsApi from '@/pages/Lms/api';
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

const ComingSoon = ({ title }) => (
  <div style={{ padding: 48 }}>
    <Empty description={<span><b>{title}</b><br />This section is being rolled out in the next update.</span>} />
  </div>
);

// [path, label, icon, element]
const TEACHER_NAV = [
  ['/teacher', 'Dashboard', <DashboardOutlined />, <TeacherDashboard />],
  ['/teacher/courses', 'My Courses', <ReadOutlined />, <CourseBuilder />],
  ['/teacher/classes', 'Live Classes', <VideoCameraOutlined />, <LiveClasses />],
  ['/teacher/recordings', 'Recorded Classes', <PlayCircleOutlined />, <Recordings />],
  ['/teacher/attendance', 'Attendance', <CheckSquareOutlined />, <Attendance />],
  ['/teacher/students', 'Students', <TeamOutlined />, <ComingSoon title="Students" />],
  ['/teacher/assignments', 'Assignments', <FileTextOutlined />, <Assignments />],
  ['/teacher/quizzes', 'Quizzes & Exams', <FormOutlined />, <Quizzes />],
  ['/teacher/material', 'Study Material', <FolderOpenOutlined />, <ComingSoon title="Study Material" />],
  ['/teacher/announcements', 'Announcements', <SoundOutlined />, <AnnouncementsPage />],
  ['/teacher/doubts', 'Doubts / Questions', <QuestionCircleOutlined />, <Doubts />],
  ['/teacher/analytics', 'Analytics', <BarChartOutlined />, <Analytics />],
  ['/teacher/calendar', 'Calendar', <CalendarOutlined />, <ComingSoon title="Calendar" />],
  ['/teacher/certificates', 'Certificates', <TrophyOutlined />, <Certificates />],
];

const STUDENT_NAV = [
  ['/learn', 'Home', <DashboardOutlined />, <StudentDashboard />],
  ['/learn/courses', 'My Courses', <BookOutlined />, <LearningPage />],
  ['/learn/classes', 'My Classes', <VideoCameraOutlined />, <LiveClasses />],
  ['/learn/recordings', 'Recordings', <PlayCircleOutlined />, <Recordings />],
  ['/learn/attendance', 'My Attendance', <CheckSquareOutlined />, <Attendance />],
  ['/learn/calendar', 'Calendar', <CalendarOutlined />, <ComingSoon title="Calendar" />],
  ['/learn/assignments', 'Assignments', <FileTextOutlined />, <Assignments />],
  ['/learn/quizzes', 'Quizzes', <FormOutlined />, <Quizzes />],
  ['/learn/material', 'Study Material', <FolderOpenOutlined />, <ComingSoon title="Study Material" />],
  ['/learn/doubts', 'My Doubts', <QuestionCircleOutlined />, <Doubts />],
  ['/learn/notifications', 'Announcements', <BellOutlined />, <AnnouncementsPage />],
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
  const collapsed = isMobile ? false : isNavMenuClose;
  const sidebarGap = isMobile ? 0 : collapsed ? 80 : 256;

  const selectedKey = useMemo(() => {
    // longest matching path wins so /teacher/classes doesn't select /teacher
    const match = nav
      .map(([p]) => p)
      .filter((p) => location.pathname === p || location.pathname.startsWith(p + '/'))
      .sort((a, b) => b.length - a.length)[0];
    return match || base;
  }, [location.pathname, nav, base]);

  const go = (path) => {
    navigate(path);
    setDrawer(false);
  };

  // ── lightweight real-time: poll /api/lms/my/updates every 20s ──
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
    const iv = setInterval(pollUpdates, 20000);
    const onVis = () => document.visibilityState === 'visible' && pollUpdates();
    document.addEventListener('visibilitychange', onVis);
    // also refresh when a live-class socket event bubbles (VPS deployments)
    const onLive = () => pollUpdates();
    window.addEventListener('lms:liveclass', onLive);
    return () => {
      clearInterval(iv);
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('lms:liveclass', onLive);
    };
  }, [pollUpdates]);

  const notifItems = (updates.notifications || []).slice(0, 10).map((n) => ({
    key: n.id,
    label: (
      <div style={{ maxWidth: 320, whiteSpace: 'normal', padding: '2px 0' }} onClick={() => n.link && navigate(n.link.replace(/^\/(learn|teacher)/, base))}>
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
      onClick={({ key }) => go(key)}
      items={nav.map(([path, label, icon]) => ({ key: path, icon, label }))}
      style={{ borderRight: 0, background: 'transparent', width: '100%' }}
    />
  );

  // Routes here isn't nested under a parent <Route path="/teacher/*">, so it
  // matches against the full browser pathname — route paths must stay
  // absolute (e.g. "/teacher/courses"), never stripped down to a relative
  // fragment, or nothing below the sidebar will ever match a click.
  const routes = (
    <Suspense fallback={<PageLoader />}>
      <Routes>
        {nav.map(([path, , , element]) => (
          <Route key={path} path={path} element={element} />
        ))}
        <Route path="*" element={<Navigate to={base} replace />} />
      </Routes>
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
