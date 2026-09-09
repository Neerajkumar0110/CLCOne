import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useSelector } from 'react-redux';
import { Row, Col, Card, Table, Tag, Input, Select, Button, Space, DatePicker, Alert, Progress, Statistic } from 'antd';
import { ReloadOutlined, DownloadOutlined, CheckSquareOutlined } from '@ant-design/icons';
import { selectCurrentAdmin } from '@/redux/auth/selectors';
import lmsApi from '../api';

const MGR = ['owner', 'Super Admin', 'Admin', 'Sales Manager'];
const SC = { PRESENT: 'green', LATE: 'gold', PARTIAL: 'orange', ABSENT: 'default', EXCUSED: 'blue' };

function KPI({ label, value, suffix }) {
  return (
    <Card size="small" className="lms-kpi">
      <Statistic title={label} value={value} suffix={suffix} />
    </Card>
  );
}

// ── admin / teacher dashboard ──────────────────────────────────────
function Dashboard({ role }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [f, setF] = useState({ courseTitle: '', batchName: '', teacherName: '', student: '', status: undefined, from: null, to: null });

  const fetcher = role === 'admin' ? lmsApi.adminAttendance : lmsApi.teacherAttendance;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetcher({
        courseTitle: f.courseTitle || undefined,
        batchName: f.batchName || undefined,
        teacherName: f.teacherName || undefined,
        student: f.student || undefined,
        status: f.status,
        from: f.from ? f.from.toISOString() : undefined,
        to: f.to ? f.to.toISOString() : undefined,
      });
      setData((res && res.result) || null);
    } finally {
      setLoading(false);
    }
  }, [f, fetcher]);

  useEffect(() => {
    load();
  }, [load]);

  const rows = (data && data.rows) || [];
  const k = (data && data.kpis) || {};
  const courses = useMemo(() => [...new Set(rows.map((r) => r.course).filter(Boolean))], [rows]);
  const batches = useMemo(() => [...new Set(rows.map((r) => r.batch).filter(Boolean))], [rows]);

  return (
    <div>
      <Row gutter={[12, 12]} style={{ marginBottom: 14 }}>
        <Col xs={12} sm={8} md={4}><KPI label="Students" value={k.totalStudents || 0} /></Col>
        <Col xs={12} sm={8} md={4}><KPI label="Present" value={k.present || 0} /></Col>
        <Col xs={12} sm={8} md={4}><KPI label="Partial" value={k.partial || 0} /></Col>
        <Col xs={12} sm={8} md={4}><KPI label="Absent" value={k.absent || 0} /></Col>
        <Col xs={12} sm={8} md={4}><KPI label="Avg attendance" value={k.avgAttendancePct || 0} suffix="%" /></Col>
        <Col xs={12} sm={8} md={4}><KPI label="Classes" value={`${k.completedClasses || 0}/${k.totalClasses || 0}`} /></Col>
      </Row>

      <Space wrap style={{ marginBottom: 12 }}>
        <Select allowClear placeholder="Course" style={{ width: 190 }} value={f.courseTitle || undefined}
          onChange={(v) => setF((x) => ({ ...x, courseTitle: v || '' }))} options={courses.map((c) => ({ value: c, label: c }))} />
        <Select allowClear placeholder="Batch" style={{ width: 170 }} value={f.batchName || undefined}
          onChange={(v) => setF((x) => ({ ...x, batchName: v || '' }))} options={batches.map((c) => ({ value: c, label: c }))} />
        {role === 'admin' && (
          <Input placeholder="Teacher" style={{ width: 150 }} value={f.teacherName}
            onChange={(e) => setF((x) => ({ ...x, teacherName: e.target.value }))} onPressEnter={load} />
        )}
        <Input placeholder="Student name / email" style={{ width: 190 }} value={f.student}
          onChange={(e) => setF((x) => ({ ...x, student: e.target.value }))} onPressEnter={load} />
        <Select allowClear placeholder="Status" style={{ width: 130 }} value={f.status}
          onChange={(v) => setF((x) => ({ ...x, status: v }))}
          options={['PRESENT', 'LATE', 'PARTIAL', 'ABSENT', 'EXCUSED'].map((s) => ({ value: s, label: s }))} />
        <DatePicker.RangePicker onChange={(v) => setF((x) => ({ ...x, from: v && v[0], to: v && v[1] }))} />
        <Button icon={<ReloadOutlined />} onClick={load}>Apply</Button>
        <Button icon={<DownloadOutlined />} onClick={() => lmsApi.attendanceExport(role, { ...f, from: f.from?.toISOString(), to: f.to?.toISOString(), format: 'csv' })}>CSV</Button>
        <Button icon={<DownloadOutlined />} onClick={() => lmsApi.attendanceExport(role, { ...f, from: f.from?.toISOString(), to: f.to?.toISOString(), format: 'xlsx' })}>Excel</Button>
      </Space>

      <Table
        rowKey={(r, i) => `${r.email || r.studentName}-${r.className}-${i}`}
        size="small"
        loading={loading}
        dataSource={rows}
        pagination={{ pageSize: 25, showSizeChanger: true }}
        scroll={{ x: 1100 }}
        columns={[
          { title: 'Student', dataIndex: 'studentName', fixed: 'left', width: 150 },
          { title: 'Email', dataIndex: 'email', width: 190 },
          { title: 'Batch', dataIndex: 'batch', width: 130 },
          { title: 'Course', dataIndex: 'course', width: 150 },
          { title: 'Class', dataIndex: 'className', width: 150 },
          { title: 'Date', dataIndex: 'date', width: 110, render: (v) => (v ? new Date(v).toLocaleDateString() : '—') },
          { title: 'Sched', dataIndex: 'scheduledDurationMin', width: 70, render: (v) => `${v}m` },
          { title: 'Join', dataIndex: 'joinTime', width: 80, render: (v) => (v ? new Date(v).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }) : '—') },
          { title: 'Leave', dataIndex: 'leaveTime', width: 80, render: (v) => (v ? new Date(v).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }) : '—') },
          { title: 'Attended', dataIndex: 'totalDurationMin', width: 90, render: (v) => `${v} min` },
          { title: '%', dataIndex: 'attendancePct', width: 110, render: (v) => <Progress percent={v} size="small" /> },
          { title: 'Joins', dataIndex: 'joins', width: 60 },
          { title: 'Leaves', dataIndex: 'leaves', width: 70 },
          { title: 'Status', dataIndex: 'status', fixed: 'right', width: 100, render: (v) => <Tag color={SC[v]}>{v}</Tag> },
        ]}
      />
    </div>
  );
}

// ── student's own attendance ───────────────────────────────────────
function MyAttendance() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [course, setCourse] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await lmsApi.studentAttendance({ courseTitle: course || undefined });
      setData((res && res.result) || null);
    } finally {
      setLoading(false);
    }
  }, [course]);
  useEffect(() => {
    load();
  }, [load]);

  const s = (data && data.summary) || {};
  const classes = (data && data.classes) || [];
  const courses = useMemo(() => [...new Set(classes.map((c) => c.courseTitle).filter(Boolean))], [classes]);

  return (
    <div>
      <Row gutter={[12, 12]} style={{ marginBottom: 14 }}>
        <Col xs={12} sm={6}><KPI label="Attendance" value={s.attendancePct || 0} suffix="%" /></Col>
        <Col xs={12} sm={6}><KPI label="Classes" value={s.totalClasses || 0} /></Col>
        <Col xs={12} sm={6}><KPI label="Present" value={s.present || 0} /></Col>
        <Col xs={12} sm={6}><KPI label="Absent" value={s.absent || 0} /></Col>
      </Row>
      <Space style={{ marginBottom: 12 }}>
        <Select allowClear placeholder="Course" style={{ width: 220 }} value={course || undefined}
          onChange={(v) => setCourse(v || '')} options={courses.map((c) => ({ value: c, label: c }))} />
        <Button icon={<ReloadOutlined />} onClick={load}>Refresh</Button>
      </Space>
      <Table
        rowKey={(r, i) => `${r.className}-${i}`}
        size="small"
        loading={loading}
        dataSource={classes}
        pagination={{ pageSize: 20 }}
        columns={[
          { title: 'Date', dataIndex: 'date', render: (v) => (v ? new Date(v).toLocaleDateString() : '—') },
          { title: 'Class', dataIndex: 'className' },
          { title: 'Course', dataIndex: 'courseTitle' },
          { title: 'Duration', dataIndex: 'scheduledDurationMin', render: (v) => `${v} min` },
          { title: 'Attended', dataIndex: 'attendedMin', render: (v) => `${v} min` },
          { title: '%', dataIndex: 'attendancePct', width: 120, render: (v) => <Progress percent={v} size="small" /> },
          { title: 'Status', dataIndex: 'status', render: (v) => <Tag color={SC[v]}>{v}</Tag> },
        ]}
      />
    </div>
  );
}

export default function Attendance() {
  const admin = useSelector(selectCurrentAdmin) || {};
  const role = MGR.includes(admin.role) ? 'admin' : 'student';
  // A non-manager who actually teaches still sees their own classes via the
  // teacher dashboard fallback inside Dashboard(role='teacher'); we surface the
  // student view by default and let managers see the full dashboard.
  return (
    <div className="lms-portal lms-section-attendance">
      <div className="lms-portal-head">
        <div>
          <h2><CheckSquareOutlined /> Attendance</h2>
          <p>{role === 'admin' ? 'Auto-captured from join/leave events across all classes.' : 'Your live-class attendance.'}</p>
        </div>
      </div>
      {role === 'admin' ? <Dashboard role="admin" /> : <MyAttendance />}
    </div>
  );
}
