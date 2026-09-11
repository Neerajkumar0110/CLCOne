import React, { useEffect, useState } from 'react';
import { Row, Col, Card, Table, Tag, Progress, Empty, Skeleton, Alert, Button } from 'antd';
import { BookOutlined, VideoCameraOutlined, CheckSquareOutlined, TrophyOutlined, PlayCircleOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import lmsApi from '../api';
import KpiTile from '../components/KpiTile';

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

export default function StudentDashboard() {
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);
  const [d, setD] = useState(null);
  const navigate = useNavigate();

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await lmsApi.studentDashboard();
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
  if (!d) return <Empty style={{ marginTop: 80 }} description="You are not enrolled in any course yet." />;

  const k = d.kpis || {};

  return (
    <div className="lms-portal lms-dashboard-shell" style={{ padding: 4 }}>
      <div className="lms-portal-head">
        <div>
          <h2><BookOutlined /> Hi {d.student?.name || 'there'} 👋</h2>
          <p>Continue learning — your courses, classes and progress.</p>
        </div>
        {k.liveNow > 0 && (
          <Button type="primary" danger icon={<VideoCameraOutlined />} onClick={() => navigate('/learn/classes')}>
            Join live class
          </Button>
        )}
      </div>

      <Row gutter={[14, 14]} style={{ marginTop: 12 }}>
        <KPI title="Enrolled courses" value={k.enrolledCourses} tone="blue" icon={<BookOutlined />} />
        <KPI title="Course progress" value={k.courseProgress} suffix="%" tone="purple" />
        <KPI title="Attendance" value={k.attendancePct} suffix="%" tone="cyan" icon={<CheckSquareOutlined />} />
        <KPI title="Today's classes" value={k.todaysClasses} tone="slate" />
        <KPI title="Upcoming classes" value={k.upcomingClasses} tone="slate" />
        <KPI title="Live now" value={k.liveNow} tone="red" />
        <KPI title="Recordings" value={k.latestRecordings} tone="purple" icon={<PlayCircleOutlined />} />
        <KPI title="Certificates" value={k.certificates} tone="amber" icon={<TrophyOutlined />} />
      </Row>

      <Row gutter={[12, 12]} style={{ marginTop: 12 }}>
        <Col xs={24} lg={12}>
          <Card size="small" title="My courses" bordered>
            <Table
              size="small"
              rowKey={(r) => `${r.course}-${r.batch}`}
              dataSource={d.courses || []}
              pagination={false}
              locale={{ emptyText: 'No courses' }}
              columns={[
                { title: 'Course', dataIndex: 'course' },
                { title: 'Batch', dataIndex: 'batch' },
                { title: 'Progress', dataIndex: 'progress', render: (v) => <Progress percent={v} size="small" style={{ width: 120 }} /> },
              ]}
            />
          </Card>
        </Col>
        <Col xs={24} lg={12}>
          <Card size="small" title="Upcoming & live classes" bordered>
            <Table
              size="small"
              rowKey="id"
              dataSource={[...(d.liveNow || []), ...(d.upcomingClasses || [])]}
              pagination={false}
              locale={{ emptyText: 'Nothing scheduled' }}
              columns={[
                { title: 'Class', dataIndex: 'title' },
                { title: 'Starts', dataIndex: 'scheduledStart', render: fmtTime },
                { title: 'Status', dataIndex: 'status', render: (s) => <Tag color={['live', 'starting'].includes(s) ? 'red' : 'blue'}>{String(s || '').toUpperCase()}</Tag> },
              ]}
            />
          </Card>
        </Col>
      </Row>

      <Row gutter={[12, 12]} style={{ marginTop: 12 }}>
        <Col xs={24} lg={12}>
          <Card size="small" title="Latest recordings" bordered>
            <Table
              size="small"
              rowKey={(r) => `${r.className}-${r.publishedAt}`}
              dataSource={d.recordings || []}
              pagination={false}
              locale={{ emptyText: 'No recordings yet' }}
              columns={[
                { title: 'Class', dataIndex: 'className' },
                { title: 'Course', dataIndex: 'course' },
                { title: 'Min', dataIndex: 'durationMin', width: 60 },
              ]}
            />
          </Card>
        </Col>
        <Col xs={24} lg={12}>
          <Card size="small" title="My certificates" bordered>
            <Table
              size="small"
              rowKey={(r) => r.certificateId || r.course}
              dataSource={d.certificates || []}
              pagination={false}
              locale={{ emptyText: 'No certificates yet' }}
              columns={[
                { title: 'Course', dataIndex: 'course' },
                { title: 'ID', dataIndex: 'certificateId' },
                { title: 'Status', dataIndex: 'status', render: (s) => <Tag color={['Issued', 'Sent'].includes(s) ? 'green' : 'default'}>{s}</Tag> },
              ]}
            />
          </Card>
        </Col>
      </Row>
    </div>
  );
}
