import React, { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Layout, Menu, Button, Grid, Drawer, Empty, Badge, Dropdown, List, Tag, message } from 'antd';
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
} from '@ant-design/icons';
import { Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom';
import { useDispatch, useSelector } from 'react-redux';
import { selectCurrentAdmin } from '@/redux/auth/selectors';
import { logout as logoutAction } from '@/redux/auth/actions';
import PageLoader from '@/components/PageLoader';
import { LMS_TEACHER_ROLES } from '@/config/roles';

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

  const isTeacher = LMS_TEACHER_ROLES.includes(admin.role);
  const base = isTeacher ? '/teacher' : '/learn';
  const nav = isTeacher ? TEACHER_NAV : STUDENT_NAV;
  const brand = isTeacher ? 'Teacher Panel' : 'Learning';

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
      onClick={({ key }) => go(key)}
      items={nav.map(([path, label, icon]) => ({ key: path, icon, label }))}
      style={{ borderRight: 0, background: 'transparent' }}
    />
  );

  const routes = (
    <Suspense fallback={<PageLoader />}>
      <Routes>
        {nav.map(([path, , , element]) => (
          <Route key={path} path={path.replace(base, '') || '/'} element={element} />
        ))}
        <Route path="*" element={<Navigate to={base} replace />} />
      </Routes>
    </Suspense>
  );

  return (
    <Layout hasSider style={{ minHeight: '100vh' }}>
      {!isMobile && (
        <Sider width={240} style={{ background: '#0b1120', position: 'fixed', height: '100vh', overflowY: 'auto', zIndex: 20 }}>
          <div style={{ color: '#fff', fontWeight: 800, fontSize: 18, padding: '20px 20px 12px' }}>
            CLC · <span style={{ color: '#60a5fa' }}>{brand}</span>
          </div>
          {updates.liveNow && updates.liveNow.length > 0 && (
            <div
              onClick={() => go(`${base}/classes`)}
              style={{ margin: '0 16px 8px', padding: '8px 12px', borderRadius: 8, background: '#7f1d1d', color: '#fff', fontWeight: 700, fontSize: 13, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8 }}
            >
              <span style={{ width: 8, height: 8, borderRadius: 8, background: '#fca5a5', boxShadow: '0 0 0 3px rgba(252,165,165,.35)' }} />
              LIVE NOW · {updates.liveNow.length}
            </div>
          )}
          {menu}
        </Sider>
      )}

      <Drawer
        placement="left"
        open={drawer}
        onClose={() => setDrawer(false)}
        width={240}
        styles={{ body: { padding: 0, background: '#0b1120' }, header: { display: 'none' } }}
      >
        <div style={{ color: '#fff', fontWeight: 800, fontSize: 18, padding: '20px' }}>CLC · {brand}</div>
        {menu}
      </Drawer>

      <Layout style={{ marginLeft: isMobile ? 0 : 240, transition: 'margin-left .2s' }}>
        <Header
          style={{
            background: '#fff',
            padding: '0 16px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            borderBottom: '1px solid #eef0f3',
            position: 'sticky',
            top: 0,
            zIndex: 10,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {isMobile && <Button type="text" icon={<MenuOutlined />} onClick={() => setDrawer(true)} />}
            <span style={{ fontWeight: 600 }}>{isTeacher ? 'Teacher' : 'Student'} · {admin.name} {admin.surname || ''}</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Dropdown menu={{ items: notifItems.length ? notifItems : [{ key: 'none', label: 'No notifications', disabled: true }] }} trigger={['click']} placement="bottomRight">
              <Badge count={updates.unread || 0} size="small">
                <Button type="text" icon={<BellOutlined />} />
              </Badge>
            </Dropdown>
            <Button type="text" icon={<UserOutlined />} onClick={() => go(`${base}`)}>
              {admin.email}
            </Button>
            <Button icon={<LogoutOutlined />} onClick={() => dispatch(logoutAction())}>
              Logout
            </Button>
          </div>
        </Header>
        <Content style={{ margin: 12, background: '#f6f7f9', borderRadius: 10, minHeight: 'calc(100vh - 88px)' }}>
          {routes}
        </Content>
      </Layout>
    </Layout>
  );
}
