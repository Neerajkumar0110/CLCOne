import React, { useEffect, useState } from 'react';
import { Row, Col, Card, Statistic, Table, Tag, Progress, Empty, Skeleton, Alert, Button } from 'antd';
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

const fmtTime = (v) => {
  if (!v) return '—';
  try {
    return new Date(v).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  } catch (e) {
    return '—';
  }
};

const KPI = ({ title, value, suffix, color, icon }) => (
  <Col xs={12} sm={8} lg={6} xxl={4}>
    <Card size="small" className="lms-kpi" bordered>
      <Statistic title={title} value={value} suffix={suffix} valueStyle={{ color: color || '#101828', fontWeight: 700 }} prefix={icon} />
    </Card>
  </Col>
);

export default function TeacherDashboard() {
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);
  const [d, setD] = useState(null);
  const navigate = useNavigate();

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

  return (
    <div className="lms-portal" style={{ padding: 4 }}>
      <div className="lms-portal-head">
        <div>
          <h2><ReadOutlined /> Teacher Dashboard</h2>
          <p>Welcome back, {d.teacher?.name}. Here's your teaching at a glance.</p>
        </div>
        <Button type="primary" icon={<VideoCameraOutlined />} onClick={() => navigate('/teacher/classes')}>
          Go to Live Classes
        </Button>
      </div>

      <Row gutter={[12, 12]} style={{ marginTop: 12 }}>
        <KPI title="Courses" value={k.totalCourses} icon={<ReadOutlined />} />
        <KPI title="Published" value={k.publishedCourses} color="#15803d" />
        <KPI title="Drafts" value={k.draftCourses} color="#b45309" />
        <KPI title="Students" value={k.totalStudents} icon={<TeamOutlined />} />
        <KPI title="Active students" value={k.activeStudents} color="#15803d" />
        <KPI title="Today's classes" value={k.todaysClasses} icon={<ClockCircleOutlined />} />
        <KPI title="Live now" value={k.liveClasses} color="#dc2626" />
        <KPI title="Upcoming" value={k.upcomingClasses} />
        <KPI title="Completed" value={k.completedClasses} />
        <KPI title="Live hours" value={k.totalLiveClassHours} />
        <KPI title="Recordings" value={k.totalRecordings} icon={<PlayCircleOutlined />} />
        <KPI title="Avg attendance" value={k.avgAttendance} suffix="%" color="#1d4ed8" icon={<CheckSquareOutlined />} />
        <KPI title="Avg completion" value={k.avgCourseCompletion} suffix="%" />
        <KPI title="Pending assignments" value={k.pendingAssignments} color="#94a3b8" />
        <KPI title="Pending doubts" value={k.pendingDoubts} color="#94a3b8" />
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
