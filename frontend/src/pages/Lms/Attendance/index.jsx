import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useSelector } from 'react-redux';
import { Row, Table, Tag, Input, Select, Button, Space, DatePicker, Alert, Progress, Modal, Form, message, Tooltip } from 'antd';
import {
  ReloadOutlined, DownloadOutlined, CheckSquareOutlined, EditOutlined, FileTextOutlined, CalendarOutlined,
  CheckOutlined, BookOutlined, TeamOutlined, ClockCircleOutlined, CheckCircleOutlined, LeftOutlined, RightOutlined,
  CodeOutlined, DatabaseOutlined, ExperimentOutlined, ApiOutlined, ThunderboltOutlined,
} from '@ant-design/icons';
import { selectCurrentAdmin } from '@/redux/auth/selectors';
import { LMS_TEACHER_ROLES } from '@/config/roles';
import lmsApi from '../api';
import KpiTile from '../components/KpiTile';
import './Attendance.css';

const MGR = ['owner', 'Super Admin', 'Admin', 'Sales Manager', 'Support'];
const SC = { PRESENT: 'green', LATE: 'gold', PARTIAL: 'orange', ABSENT: 'default', EXCUSED: 'blue' };

function KPI({ label, value, suffix, tone }) {
  return <KpiTile title={label} value={value} suffix={suffix} tone={tone} span={{ xs: 12, sm: 8, md: 4, lg: 4, xxl: 4 }} />;
}

// ── admin / teacher dashboard ──────────────────────────────────────
function Dashboard({ role }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [f, setF] = useState({ courseTitle: '', batchName: '', teacherName: '', student: '', status: undefined, from: null, to: null });
  const [correcting, setCorrecting] = useState(null); // row being corrected
  const [correctForm] = Form.useForm();
  const [correctBusy, setCorrectBusy] = useState(false);

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

  const submitCorrection = async () => {
    let v;
    try { v = await correctForm.validateFields(); } catch (e) { return; }
    setCorrectBusy(true);
    try {
      const res = await lmsApi.correctAttendance(correcting.sessionId, { crmUserId: correcting.crmUser, status: v.status, reason: v.reason });
      message.success(res?.message || 'Corrected.');
      setCorrecting(null); correctForm.resetFields(); load();
    } catch (e) { message.error('Correction failed.'); } finally { setCorrectBusy(false); }
  };

  const rows = (data && data.rows) || [];
  const k = (data && data.kpis) || {};
  const courses = useMemo(() => [...new Set(rows.map((r) => r.course).filter(Boolean))], [rows]);
  const batches = useMemo(() => [...new Set(rows.map((r) => r.batch).filter(Boolean))], [rows]);

  return (
    <div>
      <Row gutter={[14, 14]} style={{ marginBottom: 14 }}>
        <KPI label="Candidates" value={k.totalStudents || 0} tone="blue" />
        <KPI label="Present" value={k.present || 0} tone="green" />
        <KPI label="Partial" value={k.partial || 0} tone="amber" />
        <KPI label="Absent" value={k.absent || 0} tone="red" />
        <KPI label="Avg attendance" value={k.avgAttendancePct || 0} suffix="%" tone="cyan" />
        <KPI label="Classes" value={`${k.completedClasses || 0}/${k.totalClasses || 0}`} tone="slate" />
      </Row>

      <Space wrap className="lms-toolbar" style={{ marginBottom: 12 }}>
        <Select allowClear placeholder="Course" style={{ width: 190 }} value={f.courseTitle || undefined}
          onChange={(v) => setF((x) => ({ ...x, courseTitle: v || '' }))} options={courses.map((c) => ({ value: c, label: c }))} />
        <Select allowClear placeholder="Batch" style={{ width: 170 }} value={f.batchName || undefined}
          onChange={(v) => setF((x) => ({ ...x, batchName: v || '' }))} options={batches.map((c) => ({ value: c, label: c }))} />
        {role === 'admin' && (
          <Input placeholder="Instructor" style={{ width: 150 }} value={f.teacherName}
            onChange={(e) => setF((x) => ({ ...x, teacherName: e.target.value }))} onPressEnter={load} />
        )}
        <Input placeholder="Candidate name / email" style={{ width: 190 }} value={f.student}
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
          { title: 'Candidate', dataIndex: 'studentName', fixed: 'left', width: 150 },
          { title: 'Email', dataIndex: 'email', width: 190 },
          { title: 'Batch', dataIndex: 'batch', width: 130 },
          { title: 'Course', dataIndex: 'course', width: 150 },
          { title: 'Class', dataIndex: 'className', width: 150 },
          { title: 'Date', dataIndex: 'date', width: 110, render: (v) => (v ? new Date(v).toLocaleDateString() : '—') },
          {
            title: <Tooltip title="How long this class was scheduled to run"><span>Scheduled</span></Tooltip>,
            dataIndex: 'scheduledDurationMin',
            width: 90,
            render: (v) => `${v} min`,
          },
          { title: 'Join', dataIndex: 'joinTime', width: 80, render: (v) => (v ? new Date(v).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }) : '—') },
          { title: 'Leave', dataIndex: 'leaveTime', width: 80, render: (v) => (v ? new Date(v).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }) : '—') },
          { title: 'Attended', dataIndex: 'totalDurationMin', width: 90, render: (v) => `${v} min` },
          { title: '%', dataIndex: 'attendancePct', width: 110, render: (v) => <Progress percent={v} size="small" /> },
          { title: 'Joins', dataIndex: 'joins', width: 60 },
          { title: 'Leaves', dataIndex: 'leaves', width: 70 },
          {
            title: 'Status', dataIndex: 'status', fixed: 'right', width: 130,
            render: (v, r) => (
              <Space size={4}>
                <Tag color={SC[v]}>{v}</Tag>
                {r.corrected && <Tag color="purple" title={`${r.correctedByName}: ${r.correctedReason}`}>corrected</Tag>}
              </Space>
            ),
          },
          ...(role === 'admin'
            ? [{
                title: '', fixed: 'right', width: 40,
                render: (_, r) => (
                  <Button
                    size="small" type="text" icon={<EditOutlined />} disabled={!r.crmUser}
                    title={r.crmUser ? 'Correct attendance' : 'No login account for this row'}
                    onClick={() => { setCorrecting(r); correctForm.setFieldsValue({ status: r.status, reason: '' }); }}
                  />
                ),
              }]
            : []),
        ]}
      />

      <Modal
        className="crud-modal"
        open={!!correcting}
        title={
          <span className="crud-modal-title">
            <span className="crud-modal-title-icon"><EditOutlined /></span>
            <span>
              <span className="crud-modal-title-kicker">Correct attendance</span>
              <span className="crud-modal-title-main">{correcting ? correcting.studentName : ''}</span>
            </span>
          </span>
        }
        onCancel={() => setCorrecting(null)}
        onOk={submitCorrection}
        confirmLoading={correctBusy}
        okText="Save correction"
        destroyOnClose
        maskClosable={false}
      >
        <Form form={correctForm} layout="vertical" className="crud-form" preserve={false}>
          <div className="crud-form-grid">
            <Form.Item name="status" label={<span className="crud-lbl"><span className="crud-lbl-icon"><CheckSquareOutlined /></span>Corrected status</span>} rules={[{ required: true }]} className="crud-form-full">
              <Select options={['PRESENT', 'LATE', 'PARTIAL', 'ABSENT', 'EXCUSED'].map((s) => ({ value: s, label: s }))} />
            </Form.Item>
            <Form.Item
              name="reason"
              label={<span className="crud-lbl"><span className="crud-lbl-icon"><FileTextOutlined /></span>Reason (required, audited)</span>}
              className="crud-form-full"
              rules={[{ required: true, message: 'A reason is required for every correction.' }]}
            >
              <Input.TextArea rows={3} placeholder="e.g. Internet outage confirmed via support ticket #123" />
            </Form.Item>
          </div>
        </Form>
      </Modal>
    </div>
  );
}

// Deterministic decorative thumbnail (no real frame-grab exists for a live
// class) — same approach as the Recordings page: a hash of the class/course
// name always resolves to the same gradient + icon, never fabricated data.
const THUMB_PALETTE = [
  ['#2a78d6', '#1b4f9c'],
  ['#1baf7a', '#0c7a52'],
  ['#8540e0', '#5a26a3'],
  ['#eb6834', '#b84a1e'],
  ['#e87ba4', '#b84c78'],
  ['#0d9aaa', '#076873'],
];
const THUMB_ICON_RULES = [
  [/python|django|flask/i, CodeOutlined],
  [/sql|database|db\b/i, DatabaseOutlined],
  [/nlp|llm|language|transformer|agent/i, ExperimentOutlined],
  [/api|integration/i, ApiOutlined],
  [/cloud|deploy|docker|devops/i, ThunderboltOutlined],
];
function hashText(text) {
  let h = 0;
  for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) >>> 0;
  return h;
}
function thumbFor(text) {
  const key = text || 'class';
  const idx = hashText(key) % THUMB_PALETTE.length;
  const Icon = (THUMB_ICON_RULES.find(([re]) => re.test(key)) || [, BookOutlined])[1];
  return { colors: THUMB_PALETTE[idx], Icon };
}

const STATUS_CLASS = { PRESENT: '', LATE: 'is-late', PARTIAL: 'is-partial', ABSENT: 'is-absent', EXCUSED: 'is-excused' };

// ── student's own attendance ───────────────────────────────────────
function MyAttendance() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [course, setCourse] = useState('');
  const [batch, setBatch] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await lmsApi.studentAttendance({ courseTitle: course || undefined, batchName: batch || undefined });
      setData((res && res.result) || null);
    } finally {
      setLoading(false);
    }
  }, [course, batch]);
  useEffect(() => {
    load();
  }, [load]);

  const s = (data && data.summary) || {};
  const allClasses = (data && data.classes) || [];
  const courses = useMemo(() => [...new Set(allClasses.map((c) => c.courseTitle).filter(Boolean))], [allClasses]);
  const batches = useMemo(() => [...new Set(allClasses.map((c) => c.batchName).filter(Boolean))], [allClasses]);

  // Date range isn't a backend filter here — the student's own attendance
  // list is small enough to fetch whole and narrow client-side.
  const classes = useMemo(() => {
    return allClasses.filter((c) => {
      if (dateFrom && (!c.date || new Date(c.date) < new Date(dateFrom))) return false;
      if (dateTo && (!c.date || new Date(c.date) > new Date(`${dateTo}T23:59:59`))) return false;
      return true;
    });
  }, [allClasses, dateFrom, dateTo]);

  useEffect(() => {
    setPage(1);
  }, [course, batch, dateFrom, dateTo]);

  const pagedClasses = useMemo(() => {
    const start = (page - 1) * pageSize;
    return classes.slice(start, start + pageSize);
  }, [classes, page, pageSize]);
  const totalPages = Math.max(1, Math.ceil(classes.length / pageSize));

  const fmtDate = (v) => (v ? new Date(v).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '—');
  const fmtWeekday = (v) => (v ? new Date(v).toLocaleDateString(undefined, { weekday: 'short' }) : '');

  return (
    <div className="attendance-page">
      <div className="attendance-container">
        <section className="attendance-hero">
          <div className="attendance-hero-left">
            <div className="attendance-hero-illustration">
              <CalendarOutlined />
              <span className="attendance-hero-check"><CheckOutlined /></span>
            </div>
            <div className="attendance-hero-content">
              <span className="attendance-hero-badge"><CheckSquareOutlined /> ATTENDANCE PORTAL</span>
              <h1>My Attendance</h1>
              <p>Track your live class attendance and stay consistent with your learning journey.</p>
            </div>
          </div>
          <div className="attendance-hero-note">Show Up<br />Learn<br />Grow</div>
        </section>

        <div className="attendance-stats">
          <div className="attendance-stat-card attendance">
            <div className="attendance-stat-top">
              <div className="attendance-stat-icon"><CalendarOutlined /></div>
              <span className="attendance-stat-label">Attendance</span>
            </div>
            <strong className="attendance-stat-value">{s.attendancePct || 0}%</strong>
            <span className="attendance-stat-sub">Your overall attendance rate</span>
          </div>

          <div className="attendance-stat-card classes">
            <div className="attendance-stat-top">
              <div className="attendance-stat-icon"><TeamOutlined /></div>
              <span className="attendance-stat-label">Classes</span>
            </div>
            <strong className="attendance-stat-value">{s.totalClasses || 0}</strong>
            <span className="attendance-stat-sub">Total classes scheduled</span>
          </div>

          <div className="attendance-stat-card present">
            <div className="attendance-stat-top">
              <div className="attendance-stat-icon"><CheckCircleOutlined /></div>
              <span className="attendance-stat-label">Present</span>
            </div>
            <strong className="attendance-stat-value">{s.present || 0}</strong>
            <span className="attendance-stat-sub">Classes marked present</span>
          </div>

          <div className="attendance-stat-card absent">
            <div className="attendance-stat-top">
              <div className="attendance-stat-icon"><CheckSquareOutlined /></div>
              <span className="attendance-stat-label">Absent</span>
            </div>
            <strong className="attendance-stat-value">{s.absent || 0}</strong>
            <span className="attendance-stat-sub">Classes marked absent</span>
          </div>
        </div>

        <div className="attendance-filter">
          <div className="attendance-select-wrap">
            <BookOutlined />
            <select className="attendance-select" value={course} onChange={(e) => setCourse(e.target.value)}>
              <option value="">Course</option>
              {courses.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>

          <div className="attendance-select-wrap">
            <TeamOutlined />
            <select className="attendance-select" value={batch} onChange={(e) => setBatch(e.target.value)}>
              <option value="">Batch</option>
              {batches.map((b) => (
                <option key={b} value={b}>{b}</option>
              ))}
            </select>
          </div>

          <div className="attendance-daterange">
            <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} aria-label="Start date" />
            <span>→</span>
            <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} aria-label="End date" />
            <CalendarOutlined />
          </div>

          <button type="button" className="attendance-refresh-btn" onClick={load}>
            <ReloadOutlined /> Refresh
          </button>
        </div>

        <div className="attendance-table-wrapper">
          <table className="attendance-table">
            <thead>
              <tr>
                <th>DATE</th>
                <th>CLASS</th>
                <th>COURSE</th>
                <th>DURATION</th>
                <th>ATTENDED</th>
                <th>%</th>
                <th>STATUS</th>
              </tr>
            </thead>
            <tbody>
              {!loading && pagedClasses.length === 0 && (
                <tr>
                  <td colSpan={7}>
                    <div className="attendance-empty">
                      <div className="attendance-empty-icon"><CalendarOutlined /></div>
                      <p className="attendance-empty-title">No classes found</p>
                      <p className="attendance-empty-text">Nothing matches your current filters yet.</p>
                    </div>
                  </td>
                </tr>
              )}
              {pagedClasses.map((c, i) => {
                const thumb = thumbFor(c.className || c.courseTitle);
                return (
                  <tr key={`${c.className}-${i}`}>
                    <td>
                      <span className="attendance-date">{fmtDate(c.date)}</span>
                      <span className="attendance-date-sub">{fmtWeekday(c.date)}</span>
                    </td>
                    <td>
                      <div className="attendance-class-flex">
                        <div className="attendance-thumb" style={{ background: `linear-gradient(135deg, ${thumb.colors[0]}, ${thumb.colors[1]})` }}>
                          <thumb.Icon />
                          {c.scheduledDurationMin ? <span className="attendance-thumb-duration">{c.scheduledDurationMin}m</span> : null}
                        </div>
                        <div>
                          <span className="attendance-class">{c.className}</span>
                          {c.batchName && <span className="attendance-class-sub">{c.batchName}</span>}
                        </div>
                      </div>
                    </td>
                    <td>
                      <div className="attendance-course">
                        <span className="attendance-course-icon"><BookOutlined /></span>
                        {c.courseTitle}
                      </div>
                    </td>
                    <td>
                      <span className="attendance-duration"><ClockCircleOutlined /> {c.scheduledDurationMin ? `${c.scheduledDurationMin} min` : '—'}</span>
                    </td>
                    <td>
                      <span className="attendance-attended"><CheckCircleOutlined /> {c.attendedMin != null ? `${c.attendedMin} min` : '—'}</span>
                    </td>
                    <td>
                      <div className="attendance-progress">
                        <div className="attendance-progress-track">
                          <div className="attendance-progress-fill" style={{ width: `${c.attendancePct || 0}%` }} />
                        </div>
                        <span className="attendance-progress-value">{c.attendancePct || 0}%</span>
                      </div>
                    </td>
                    <td>
                      <span className={`attendance-status ${STATUS_CLASS[c.status] || ''}`}>{c.status}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="attendance-pagination">
          <span className="attendance-pagination-count">
            {classes.length === 0 ? 'No classes' : `Showing ${(page - 1) * pageSize + 1}-${Math.min(page * pageSize, classes.length)} of ${classes.length} classes`}
          </span>
          <div className="attendance-pagination-controls">
            <button type="button" className="attendance-page-btn" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
              <LeftOutlined />
            </button>
            <span className="attendance-page-number">{page}</span>
            <button type="button" className="attendance-page-btn" disabled={page >= totalPages} onClick={() => setPage((p) => Math.min(totalPages, p + 1))}>
              <RightOutlined />
            </button>
            <div className="attendance-pagesize-wrap">
              <select className="attendance-pagesize" value={pageSize} onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1); }}>
                {[20, 50, 100].map((n) => (
                  <option key={n} value={n}>{n} / page</option>
                ))}
              </select>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function Attendance() {
  const admin = useSelector(selectCurrentAdmin) || {};
  const role = MGR.includes(admin.role) ? 'admin' : LMS_TEACHER_ROLES.includes(admin.role) ? 'teacher' : 'student';
  if (role === 'student') return <MyAttendance />;
  return (
    <div className="lms-portal lms-section-attendance">
      <div className="lms-portal-head">
        <div>
          <h2><CheckSquareOutlined /> Attendance</h2>
          <p>Auto-captured from join/leave events across all classes.</p>
        </div>
      </div>
      <Dashboard role={role} />
    </div>
  );
}
