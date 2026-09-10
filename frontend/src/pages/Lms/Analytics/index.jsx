import React, { useEffect, useState } from 'react';
import { Row, Col, Card, Statistic, Table, Tag, Tabs, Empty, Skeleton, Alert, Progress } from 'antd';
import { BarChartOutlined } from '@ant-design/icons';
import lmsApi from '../api';

const KPI = ({ title, value, suffix, color }) => (
  <Col xs={12} sm={8} lg={6} xxl={4}>
    <Card size="small" className="lms-kpi" bordered>
      <Statistic title={title} value={value} suffix={suffix} valueStyle={{ color: color || '#101828', fontWeight: 700 }} />
    </Card>
  </Col>
);

function Bars({ data }) {
  const max = Math.max(1, ...data.map((d) => d.count));
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', height: 120, padding: '8px 0' }}>
      {data.map((d) => (
        <div key={d.range} style={{ flex: 1, textAlign: 'center' }}>
          <div style={{ background: '#1d4ed8', borderRadius: 4, height: `${(d.count / max) * 90}px`, minHeight: 2 }} />
          <div style={{ fontSize: 11, marginTop: 4, color: '#667085' }}>{d.range}</div>
          <div style={{ fontSize: 12, fontWeight: 600 }}>{d.count}</div>
        </div>
      ))}
    </div>
  );
}

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
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);

  useEffect(() => {
    lmsApi.teacherAnalytics()
      .then((r) => setD((r && r.result) || null))
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
    <div className="lms-portal" style={{ padding: 4 }}>
      <div className="lms-portal-head">
        <div><h2><BarChartOutlined /> Analytics</h2><p>{d.scope?.students || 0} students · {d.scope?.courses || 0} courses · {d.scope?.batches || 0} batches</p></div>
      </div>

      <Row gutter={[12, 12]}>
        <KPI title="Avg completion" value={k.avgCourseCompletion} suffix="%" color="#1d4ed8" />
        <KPI title="Avg attendance" value={k.avgAttendance} suffix="%" />
        <KPI title="Avg quiz score" value={k.avgQuizScore} suffix="%" />
        <KPI title="Active students" value={k.activeStudents} color="#15803d" />
        <KPI title="Completed" value={k.completedStudents} color="#15803d" />
        <KPI title="Live hours" value={k.totalLiveHours} />
        <KPI title="Classes done" value={k.completedClasses} />
        <KPI title="To grade" value={k.assignmentsToGrade} color="#b45309" />
      </Row>

      <Row gutter={[12, 12]} style={{ marginTop: 12 }}>
        <Col xs={24} lg={8}><Card size="small" title="Course completion">{ch.courseCompletion ? <Bars data={ch.courseCompletion} /> : null}</Card></Col>
        <Col xs={24} lg={8}><Card size="small" title="Attendance">{ch.attendance ? <Bars data={ch.attendance} /> : null}</Card></Col>
        <Col xs={24} lg={8}><Card size="small" title="Quiz scores">{ch.quizScores ? <Bars data={ch.quizScores} /> : null}</Card></Col>
      </Row>

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
