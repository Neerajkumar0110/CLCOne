import React, { Suspense, lazy, useMemo, useState } from 'react';
import { Layout, Menu, Button, Grid, Drawer, Empty } from 'antd';
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
  ['/teacher/announcements', 'Announcements', <SoundOutlined />, <ComingSoon title="Announcements" />],
  ['/teacher/doubts', 'Doubts / Questions', <QuestionCircleOutlined />, <ComingSoon title="Doubts / Questions" />],
  ['/teacher/analytics', 'Analytics', <BarChartOutlined />, <ComingSoon title="Analytics" />],
  ['/teacher/calendar', 'Calendar', <CalendarOutlined />, <ComingSoon title="Calendar" />],
  ['/teacher/certificates', 'Certificates', <TrophyOutlined />, <ComingSoon title="Certificates" />],
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
  ['/learn/doubts', 'My Doubts', <QuestionCircleOutlined />, <ComingSoon title="My Doubts" />],
  ['/learn/notifications', 'Notifications', <BellOutlined />, <ComingSoon title="Notifications" />],
  ['/learn/certificates', 'My Certificates', <TrophyOutlined />, <ComingSoon title="My Certificates" />],
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
