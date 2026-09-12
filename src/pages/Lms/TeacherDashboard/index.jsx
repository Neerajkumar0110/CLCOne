import React, { useEffect, useState } from 'react';
import { Row, Col, Card, Table, Tag, Progress, Empty, Skeleton, Alert, Button } from 'antd';
import {
  ReadOutlined,
  TeamOutlined,
  VideoCameraOutlined,
  CheckSquareOutlined,
  ClockCircleOutlined,
  PlayCircleOutlined,
  CheckCircleOutlined,
  EditOutlined,
  UserOutlined,
  CalendarOutlined,
  FieldTimeOutlined,
  TrophyOutlined,
  FileTextOutlined,
  QuestionCircleOutlined,
} from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import lmsApi from '../api';
import ChartCard from '@/components/dashboard/ChartCard';
import { applyChartTheme } from '@/components/dashboard/chartTheme';
import { useTheme } from '@/context/themeContext';
import KpiTile from '../components/KpiTile';
import '@/components/dashboard/dashboard.css';

const fmtTime = (v) => {
  if (!v) return '—';
  try {
    return new Date(v).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  } catch (e) {
    return '—';
  }
};

const KPI = ({ title, value, suffix, tone, icon, index }) => (
  <KpiTile title={title} value={value} suffix={suffix} tone={tone} icon={icon} index={index} />
);

export default function TeacherDashboard() {
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);
  const [d, setD] = useState(null);
  const navigate = useNavigate();
  const { isDark } = useTheme();
  applyChartTheme(isDark);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await lmsApi.teacherDashboard();
        if (alive) setD((res && res.result) || null);
      } catch (e) {
        if (alive) setErr('Could not load your dashboard.');
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  if (loading) return <Skeleton active paragraph={{ rows: 8 }} style={{ padding: 24 }} />;
  if (err) return <Alert type="error" showIcon message={err} style={{ margin: 24 }} />;
  if (!d) return <Empty style={{ marginTop: 80 }} description="No data yet" />;

  const k = d.kpis || {};
  const c = d.charts || {};

  const attendanceByClass = c.attendanceByClass || [];
  const attendanceChart = {
    labels: attendanceByClass.map((r) => r.name),
    datasets: [
      { label: 'Present', data: attendanceByClass.map((r) => r.present) },
      { label: 'Total', data: attendanceByClass.map((r) => r.total) },
    ],
  };

  const courseStatusChart = {
    labels: ['Published', 'Draft', 'Archived'],
    datasets: [{ data: [k.publishedCourses || 0, k.draftCourses || 0, k.archivedCourses || 0] }],
  };

  const studentStatusChart = {
    labels: ['Active', 'Inactive'],
    datasets: [{ data: [k.activeStudents || 0, k.inactiveStudents || 0] }],
  };

  const studentProgress = c.studentProgress || [];
  const progressChart = {
    labels: studentProgress.map((s) => s.name),
    datasets: [{ label: 'Progress %', data: studentProgress.map((s) => s.progress) }],
  };

  return (
    <div className="lms-portal lms-dashboard-shell">
      <div className="lms-portal-head">
        <div>
          <h2><ReadOutlined /> Teacher Dashboard</h2>
          <p>Welcome back, {d.teacher?.name}. Here's your teaching at a glance.</p>
        </div>
        <Button type="primary" icon={<VideoCameraOutlined />} onClick={() => navigate('/teacher/classes')}>
          Go to Live Classes
        </Button>
      </div>

      <Row gutter={[16, 16]} className="lms-kpi-row">
        <KPI index={0} title="Courses" value={k.totalCourses} tone="blue" icon={<ReadOutlined />} />
        <KPI index={1} title="Published" value={k.publishedCourses} tone="green" icon={<CheckCircleOutlined />} />
        <KPI index={2} title="Drafts" value={k.draftCourses} tone="amber" icon={<EditOutlined />} />
        <KPI index={3} title="Students" value={k.totalStudents} tone="blue" icon={<TeamOutlined />} />
        <KPI index={4} title="Active students" value={k.activeStudents} tone="green" icon={<UserOutlined />} />
        <KPI index={5} title="Today's classes" value={k.todaysClasses} tone="cyan" icon={<ClockCircleOutlined />} />
        <KPI index={6} title="Live now" value={k.liveClasses} tone="red" icon={<VideoCameraOutlined />} />
        <KPI index={7} title="Upcoming" value={k.upcomingClasses} tone="purple" icon={<CalendarOutlined />} />
        <KPI index={8} title="Completed" value={k.completedClasses} tone="slate" icon={<CheckSquareOutlined />} />
        <KPI index={9} title="Live hours" value={k.totalLiveClassHours} tone="cyan" icon={<FieldTimeOutlined />} />
        <KPI index={10} title="Recordings" value={k.totalRecordings} tone="purple" icon={<PlayCircleOutlined />} />
        <KPI index={11} title="Avg attendance" value={k.avgAttendance} suffix="%" tone="blue" icon={<CheckSquareOutlined />} />
        <KPI index={12} title="Avg completion" value={k.avgCourseCompletion} suffix="%" tone="green" icon={<TrophyOutlined />} />
        <KPI index={13} title="Pending assignments" value={k.pendingAssignments} tone="slate" icon={<FileTextOutlined />} />
        <KPI index={14} title="Pending doubts" value={k.pendingDoubts} tone="slate" icon={<QuestionCircleOutlined />} />
      </Row>

      <Row gutter={[16, 16]} className="lms-charts-row" key={isDark ? 'charts-d' : 'charts-l'}>
        <Col xs={24} lg={12} className="lms-card-col">
          <ChartCard def={{ key: 'attendanceByClass', kind: 'bar', title: 'Attendance by class' }} raw={attendanceChart} />
        </Col>
        <Col xs={24} lg={12} className="lms-card-col">
          <ChartCard def={{ key: 'courseStatus', kind: 'donut', title: 'Course status' }} raw={courseStatusChart} />
        </Col>
        <Col xs={24} lg={12} className="lms-card-col">
          <ChartCard def={{ key: 'studentProgress', kind: 'bar', title: 'Student progress' }} raw={progressChart} />
        </Col>
        <Col xs={24} lg={12} className="lms-card-col">
          <ChartCard def={{ key: 'studentStatus', kind: 'donut', title: 'Students · active vs inactive' }} raw={studentStatusChart} />
        </Col>
      </Row>

      <Row gutter={[16, 16]} className="lms-tables-row">
        <Col xs={24} lg={12} className="lms-card-col">
          <Card size="small" title="Today's classes" bordered className="lms-table-card">
            <Table
              size="small"
              rowKey="id"
              dataSource={d.todaysClasses || []}
              pagination={false}
              locale={{ emptyText: 'No classes today' }}
              columns={[
                { title: 'Class', dataIndex: 'title' },
                { title: 'Batch', dataIndex: 'batch' },
                { title: 'Time', dataIndex: 'scheduledStart', render: fmtTime },
                { title: 'Status', dataIndex: 'status', render: (s) => <Tag>{String(s || '').toUpperCase()}</Tag> },
              ]}
            />
          </Card>
        </Col>
        <Col xs={24} lg={12} className="lms-card-col">
          <Card size="small" title="Upcoming classes" bordered className="lms-table-card">
            <Table
              size="small"
              rowKey="id"
              dataSource={d.upcomingClasses || []}
              pagination={false}
              locale={{ emptyText: 'Nothing scheduled' }}
              columns={[
                { title: 'Class', dataIndex: 'title' },
                { title: 'Course', dataIndex: 'course' },
                { title: 'Starts', dataIndex: 'scheduledStart', render: fmtTime },
              ]}
            />
          </Card>
        </Col>
        <Col xs={24} lg={12} className="lms-card-col">
          <Card size="small" title="At-risk students" bordered className="lms-table-card">
            <Table
              size="small"
              rowKey={(r) => r.email || r.name}
              dataSource={d.atRiskStudents || []}
              pagination={false}
              locale={{ emptyText: 'No at-risk students 🎉' }}
              columns={[
                { title: 'Student', dataIndex: 'name' },
                { title: 'Batch', dataIndex: 'batch' },
                { title: 'Attendance', dataIndex: 'attendancePct', render: (v) => <Progress percent={v} size="small" style={{ width: 90 }} /> },
                { title: 'Progress', dataIndex: 'progress', render: (v) => `${v}%` },
              ]}
            />
          </Card>
        </Col>
        <Col xs={24} lg={12} className="lms-card-col">
          <Card size="small" title="My courses" bordered className="lms-table-card">
            <Table
              size="small"
              rowKey="id"
              dataSource={d.courses || []}
              pagination={false}
              locale={{ emptyText: 'No courses assigned' }}
              columns={[
                { title: 'Course', dataIndex: 'title' },
                { title: 'Status', dataIndex: 'status', render: (s) => <Tag color={s === 'Published' ? 'green' : s === 'Draft' ? 'orange' : 'default'}>{s}</Tag> },
                { title: 'Enrolled', dataIndex: 'enrolled' },
              ]}
            />
          </Card>
        </Col>
      </Row>
    </div>
  );
}
