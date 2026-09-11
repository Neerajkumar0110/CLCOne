import React, { useEffect, useState } from 'react';
import { Row, Col, Card, Table, Tag, Progress, Empty, Skeleton, Alert, Button } from 'antd';
import {
  ReadOutlined,
  TeamOutlined,
  VideoCameraOutlined,
  CheckSquareOutlined,
  ClockCircleOutlined,
  PlayCircleOutlined,
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

const KPI = ({ title, value, suffix, tone, icon }) => (
  <KpiTile title={title} value={value} suffix={suffix} tone={tone} icon={icon} />
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
    <div className="lms-portal lms-dashboard-shell" style={{ padding: 4 }}>
      <div className="lms-portal-head">
        <div>
          <h2><ReadOutlined /> Teacher Dashboard</h2>
          <p>Welcome back, {d.teacher?.name}. Here's your teaching at a glance.</p>
        </div>
        <Button type="primary" icon={<VideoCameraOutlined />} onClick={() => navigate('/teacher/classes')}>
          Go to Live Classes
        </Button>
      </div>

      <Row gutter={[14, 14]} style={{ marginTop: 12 }}>
        <KPI title="Courses" value={k.totalCourses} tone="blue" icon={<ReadOutlined />} />
        <KPI title="Published" value={k.publishedCourses} tone="green" />
        <KPI title="Drafts" value={k.draftCourses} tone="amber" />
        <KPI title="Students" value={k.totalStudents} tone="blue" icon={<TeamOutlined />} />
        <KPI title="Active students" value={k.activeStudents} tone="green" />
        <KPI title="Today's classes" value={k.todaysClasses} tone="cyan" icon={<ClockCircleOutlined />} />
        <KPI title="Live now" value={k.liveClasses} tone="red" />
        <KPI title="Upcoming" value={k.upcomingClasses} tone="purple" />
        <KPI title="Completed" value={k.completedClasses} tone="slate" />
        <KPI title="Live hours" value={k.totalLiveClassHours} tone="cyan" />
        <KPI title="Recordings" value={k.totalRecordings} tone="purple" icon={<PlayCircleOutlined />} />
        <KPI title="Avg attendance" value={k.avgAttendance} suffix="%" tone="blue" icon={<CheckSquareOutlined />} />
        <KPI title="Avg completion" value={k.avgCourseCompletion} suffix="%" tone="green" />
        <KPI title="Pending assignments" value={k.pendingAssignments} tone="slate" />
        <KPI title="Pending doubts" value={k.pendingDoubts} tone="slate" />
      </Row>

      <Row gutter={[12, 12]} style={{ marginTop: 12 }} key={isDark ? 'charts-d' : 'charts-l'}>
        <Col xs={24} lg={12}>
          <ChartCard def={{ key: 'attendanceByClass', kind: 'bar', title: 'Attendance by class' }} raw={attendanceChart} />
        </Col>
        <Col xs={24} lg={12}>
          <ChartCard def={{ key: 'courseStatus', kind: 'donut', title: 'Course status' }} raw={courseStatusChart} />
        </Col>
        <Col xs={24} lg={12}>
          <ChartCard def={{ key: 'studentProgress', kind: 'bar', title: 'Student progress' }} raw={progressChart} />
        </Col>
        <Col xs={24} lg={12}>
          <ChartCard def={{ key: 'studentStatus', kind: 'donut', title: 'Students · active vs inactive' }} raw={studentStatusChart} />
        </Col>
      </Row>

      <Row gutter={[12, 12]} style={{ marginTop: 12 }}>
        <Col xs={24} lg={12}>
          <Card size="small" title="Today's classes" bordered>
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
        <Col xs={24} lg={12}>
          <Card size="small" title="Upcoming classes" bordered>
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
      </Row>

      <Row gutter={[12, 12]} style={{ marginTop: 12 }}>
        <Col xs={24} lg={12}>
          <Card size="small" title="At-risk students" bordered>
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
        <Col xs={24} lg={12}>
          <Card size="small" title="My courses" bordered>
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
