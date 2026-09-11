import React, { useEffect, useState } from 'react';
import { Row, Col, Card, Table, Tabs, Empty, Skeleton, Alert, Progress } from 'antd';
import { BarChartOutlined } from '@ant-design/icons';
import lmsApi from '../api';
import ChartCard from '@/components/dashboard/ChartCard';
import { applyChartTheme } from '@/components/dashboard/chartTheme';
import { useTheme } from '@/context/themeContext';
import KpiTile from '../components/KpiTile';
import '@/components/dashboard/dashboard.css';

const KPI = ({ title, value, suffix, tone }) => (
  <KpiTile title={title} value={value} suffix={suffix} tone={tone} />
);

const histogramChart = (data) => ({
  labels: (data || []).map((d) => d.range),
  datasets: [{ label: 'Students', data: (data || []).map((d) => d.count) }],
});

const cohortCols = [
  { title: 'Student', dataIndex: 'name' },
  { title: 'Course', dataIndex: 'course' },
  { title: 'Batch', dataIndex: 'batch' },
  { title: 'Progress', dataIndex: 'progress', render: (v) => <Progress percent={v} size="small" style={{ width: 90 }} /> },
  { title: 'Attendance', dataIndex: 'attendancePct', render: (v) => `${v}%` },
  { title: 'Avg score', dataIndex: 'avgScore', render: (v) => `${v}%` },
];

export default function Analytics() {
  const [d, setD] = useState(null);
  const [live, setLive] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);
  const { isDark } = useTheme();
  applyChartTheme(isDark);

  useEffect(() => {
    Promise.all([lmsApi.teacherAnalytics(), lmsApi.teacherLiveAnalytics().catch(() => null)])
      .then(([r, l]) => {
        setD((r && r.result) || null);
        setLive((l && l.result) || null);
      })
      .catch(() => setErr('Could not load analytics.'))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <Skeleton active paragraph={{ rows: 8 }} style={{ padding: 24 }} />;
  if (err) return <Alert type="error" showIcon message={err} style={{ margin: 24 }} />;
  if (!d) return <Empty style={{ marginTop: 80 }} />;

  const k = d.kpis || {};
  const ch = d.charts || {};
  const co = d.cohorts || {};

  return (
    <div className="lms-portal lms-dashboard-shell" style={{ padding: 4 }}>
      <div className="lms-portal-head">
        <div><h2><BarChartOutlined /> Analytics</h2><p>{d.scope?.students || 0} students · {d.scope?.courses || 0} courses · {d.scope?.batches || 0} batches</p></div>
      </div>

      <Row gutter={[14, 14]}>
        <KPI title="Avg completion" value={k.avgCourseCompletion} suffix="%" tone="blue" />
        <KPI title="Avg attendance" value={k.avgAttendance} suffix="%" tone="cyan" />
        <KPI title="Avg quiz score" value={k.avgQuizScore} suffix="%" tone="purple" />
        <KPI title="Active students" value={k.activeStudents} tone="green" />
        <KPI title="Completed" value={k.completedStudents} tone="green" />
        <KPI title="Live hours" value={k.totalLiveHours} tone="cyan" />
        <KPI title="Classes done" value={k.completedClasses} tone="slate" />
        <KPI title="To grade" value={k.assignmentsToGrade} tone="amber" />
      </Row>

      <Row gutter={[14, 14]} style={{ marginTop: 12 }} key={isDark ? 'an-charts-d' : 'an-charts-l'}>
        <Col xs={24} lg={8}>
          <ChartCard def={{ key: 'courseCompletion', kind: 'bar', title: 'Course completion' }} raw={histogramChart(ch.courseCompletion)} height={220} />
        </Col>
        <Col xs={24} lg={8}>
          <ChartCard def={{ key: 'attendance', kind: 'bar', title: 'Attendance' }} raw={histogramChart(ch.attendance)} height={220} />
        </Col>
        <Col xs={24} lg={8}>
          <ChartCard def={{ key: 'quizScores', kind: 'bar', title: 'Quiz scores' }} raw={histogramChart(ch.quizScores)} height={220} />
        </Col>
      </Row>

      {live && live.totals && (
        <Card size="small" style={{ marginTop: 12 }} title="Live classes">
          <Row gutter={[14, 14]}>
            <KPI title="Total classes" value={live.totals.totalClasses} tone="blue" />
            <KPI title="Completed" value={live.totals.completedClasses} tone="green" />
            <KPI title="Live hours" value={live.totals.totalLiveHours} tone="cyan" />
            <KPI title="Avg attendance" value={live.totals.avgAttendancePct} suffix="%" tone="blue" />
            <KPI title="Avg join delay" value={live.totals.avgJoinDelayMin} suffix=" min" tone="amber" />
            <KPI title="Avg duration" value={live.totals.avgDurationMin} suffix=" min" tone="cyan" />
            <KPI title="Recording views" value={live.totals.recordingViews} tone="purple" />
            <KPI title="Participants" value={live.totals.totalParticipants} tone="blue" />
          </Row>
          <Table
            style={{ marginTop: 12 }}
            rowKey={(r) => r.email || r.name}
            size="small"
            dataSource={live.perStudent}
            pagination={{ pageSize: 10 }}
            locale={{ emptyText: 'No attendance data yet' }}
            columns={[
              { title: 'Student', dataIndex: 'name' },
              { title: 'Attended', dataIndex: 'classesAttended', width: 90 },
              { title: 'Missed', dataIndex: 'classesMissed', width: 80 },
              { title: 'Attendance', dataIndex: 'attendancePct', render: (v) => `${v}%` },
              { title: 'Avg watch (min)', dataIndex: 'avgDurationMin', width: 130 },
              { title: 'Last class', dataIndex: 'lastClassAt', render: (v) => (v ? new Date(v).toLocaleDateString() : '—') },
            ]}
          />
        </Card>
      )}

      <Card size="small" style={{ marginTop: 12 }} title="Student cohorts">
        <Tabs
          items={[
            { key: 'atRisk', label: `At risk (${(co.atRiskStudents || []).length})`, children: <Table rowKey={(r) => r.email || r.name} size="small" dataSource={co.atRiskStudents} columns={cohortCols} pagination={false} locale={{ emptyText: 'None' }} /> },
            { key: 'slow', label: `Slow learners (${(co.slowLearners || []).length})`, children: <Table rowKey={(r) => r.email || r.name} size="small" dataSource={co.slowLearners} columns={cohortCols} pagination={false} locale={{ emptyText: 'None' }} /> },
            { key: 'inactive', label: `Inactive (${(co.inactiveStudents || []).length})`, children: <Table rowKey={(r) => r.email || r.name} size="small" dataSource={co.inactiveStudents} columns={cohortCols} pagination={false} locale={{ emptyText: 'None' }} /> },
            { key: 'lowAtt', label: `Low attendance (${(co.lowAttendance || []).length})`, children: <Table rowKey={(r) => r.email || r.name} size="small" dataSource={co.lowAttendance} columns={cohortCols} pagination={false} locale={{ emptyText: 'None' }} /> },
            { key: 'high', label: `High performers (${(co.highPerformers || []).length})`, children: <Table rowKey={(r) => r.email || r.name} size="small" dataSource={co.highPerformers} columns={cohortCols} pagination={false} locale={{ emptyText: 'None' }} /> },
          ]}
        />
      </Card>
    </div>
  );
}
