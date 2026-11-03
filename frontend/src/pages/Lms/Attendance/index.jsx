import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useSelector } from 'react-redux';
import { useNavigate } from 'react-router-dom';
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
import StudentReport from './StudentReport';
import './Attendance.css';
import '../components/LearnerDesign.css';

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
  const [report, setReport] = useState(null); // row whose candidate report is open

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
        <Select allowClear placeholder="Internship" style={{ width: 190 }} value={f.courseTitle || undefined}
          onChange={(v) => setF((x) => ({ ...x, courseTitle: v || '' }))} options={courses.map((c) => ({ value: c, label: c }))} />
        <Select allowClear placeholder="Batch" style={{ width: 170 }} value={f.batchName || undefined}
          onChange={(v) => setF((x) => ({ ...x, batchName: v || '' }))} options={batches.map((c) => ({ value: c, label: c }))} />
        {role === 'admin' && (
          <Input placeholder="Project Manager" style={{ width: 150 }} value={f.teacherName}
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
        rowClassName={() => 'att-row-click'}
        onRow={(r) => ({ onClick: () => setReport(r), title: 'Open full attendance report' })}
        columns={[
          { title: 'Candidate', dataIndex: 'studentName', fixed: 'left', width: 150 },
          { title: 'Email', dataIndex: 'email', width: 190 },
          { title: 'Batch', dataIndex: 'batch', width: 130 },
          { title: 'Internship', dataIndex: 'course', width: 150 },
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
                    onClick={(e) => { e.stopPropagation(); setCorrecting(r); correctForm.setFieldsValue({ status: r.status, reason: '' }); }}
                  />
                ),
              }]
            : []),
        ]}
      />

      {report && <StudentReport role={role} target={report} onClose={() => setReport(null)} />}

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

const STATUS_CHIP = { PRESENT: 'hai', LATE: 'adh', PARTIAL: 'adh', ABSENT: 'red', EXCUSED: 'gray' };

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
  const [required, setRequired] = useState(null);
  const [corrId, setCorrId] = useState('');
  const [corrText, setCorrText] = useState('');
  const navigate = useNavigate();

  useEffect(() => {
    lmsApi
      .myEligibility()
      .then((r) => {
        const first = r && r.success !== false && Array.isArray(r.result) ? r.result[0] : null;
        const item = first && (first.items || []).find((x) => x.key === 'attendance' && x.applicable);
        setRequired(item ? item.required : null);
      })
      .catch(() => {});
  }, []);

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

  // design L13: a correction request goes to Support as a prefilled ticket
  // (Support / Ops correct it with reason + audit on their attendance screen)
  // Gap to the attendance requirement in the learner's eligibility rule
  // (spec D-01 — proposed 90%), and roughly how many more full classes close it.
  const counted = Math.max(0, (s.totalClasses || 0) - (s.excused || 0));
  const gap = required && s.attendancePct < required ? required - s.attendancePct : 0;
  const moreClasses = gap && required < 100 ? Math.ceil((required * counted - (s.attendancePct || 0) * counted) / (100 - required)) : 0;

  const clock = (v) => (v ? new Date(v).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' }) : '—');
  const correctable = allClasses.filter((c) => ['ABSENT', 'PARTIAL', 'LATE'].includes(c.status));
  const picked = correctable.find((c) => c.id === corrId) || correctable[0];
  const sendCorrection = () => {
    if (!picked) return;
    navigate('/learn/support', {
      state: {
        raise: {
          category: 'Attendance',
          subject: `Attendance correction · ${fmtDate(picked.date)}`,
          reference: [picked.className, picked.batchName, fmtDate(picked.date)].filter(Boolean).join(' · '),
          description: `Recorded: ${picked.status} (${picked.attendedMin || 0} of ${picked.scheduledDurationMin || '?'} min).\nWhat happened: ${corrText}`,
          expected: 'Attendance should be marked as …',
        },
      },
    });
  };

  // design board L13 — 4 KPI tiles, session-wise table | "Attendance galat hai?" request card
  return (
    <div className="ld-page">
      <div className="ld-head">
        <div>
          <h1>My attendance</h1>
          <div className="ld-muted ld-sub">Join/leave events se calculate · grace 10 min{required ? ` · threshold ${required}%` : ''}</div>
        </div>
      </div>

      <div className="ld-grid" style={{ gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 14 }}>
        <div className="ld-card" style={{ gap: 4, padding: 16 }}><span>Overall</span><b style={{ fontSize: 26, color: gap ? '#9a3412' : '#166534' }}>{s.attendancePct || 0}%</b></div>
        <div className="ld-card" style={{ gap: 4, padding: 16 }}><span>Attended / eligible</span><b style={{ fontSize: 26 }}>{(s.present || 0) + (s.late || 0)} / {counted}</b></div>
        <div className="ld-card" style={{ gap: 4, padding: 16 }}><span>Excluded</span><b style={{ fontSize: 26 }}>{s.excused || 0}</b><span className="ld-muted" style={{ fontSize: 13 }}>excused sessions</span></div>
        <div className="ld-card" style={{ gap: 4, padding: 16 }}>
          <span>{required ? `Gap to ${required}%` : 'Requirement'}</span>
          <b style={{ fontSize: 26 }}>{required ? (gap ? `${gap} pts` : 'Met') : '—'}</b>
          <span className="ld-muted" style={{ fontSize: 13 }}>{required ? (gap ? `≈ ${moreClasses} more full session${moreClasses === 1 ? '' : 's'}` : 'requirement met') : 'no rule set yet'}</span>
        </div>
      </div>

      <div className="ld-grid" style={{ gridTemplateColumns: 'minmax(0, 1fr) 380px', flex: 1 }}>
        <section className="ld-card" aria-label="Session-wise">
          <div className="ld-hd" style={{ flexWrap: 'wrap' }}>
            <b style={{ fontSize: 16 }}>Session-wise</b>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {courses.length > 1 && <select className="ld-inp" aria-label="Internship" value={course} onChange={(e) => setCourse(e.target.value)}><option value="">All internships</option>{courses.map((c) => <option key={c} value={c}>{c}</option>)}</select>}
              {batches.length > 1 && <select className="ld-inp" aria-label="Batch" value={batch} onChange={(e) => setBatch(e.target.value)}><option value="">All batches</option>{batches.map((b) => <option key={b} value={b}>{b}</option>)}</select>}
              <input className="ld-inp" type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} aria-label="Start date" />
              <input className="ld-inp" type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} aria-label="End date" />
            </div>
          </div>
          <div className="ld-tablewrap">
            <table className="ld-table attendance-table">
              <thead><tr><th>Date</th><th>Session</th><th>Join</th><th>Leave</th><th>Minutes</th><th>Status</th></tr></thead>
              <tbody>
                {!loading && pagedClasses.length === 0 && <tr><td colSpan={6} className="ld-empty">No classes found</td></tr>}
                {pagedClasses.map((c, i) => (
                  <tr key={`${c.id || c.className}-${i}`}>
                    <td>{fmtDate(c.date)}</td>
                    <td>{c.className}</td>
                    {c.status === 'EXCUSED' ? (
                      <td colSpan={3} className="ld-muted">Excused — not counted</td>
                    ) : (
                      <>
                        <td>{clock(c.firstJoinAt)}</td>
                        <td>{c.online ? 'live' : clock(c.lastLeftAt)}</td>
                        <td>{c.attendedMin || 0}{c.online ? '+' : ''}</td>
                      </>
                    )}
                    <td>
                      <span className={`ld-chip ${c.online ? 'naya' : STATUS_CHIP[c.status] || 'gray'}`}>{c.online ? 'In class' : c.status}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {classes.length > pageSize && (
            <div className="ld-hd" style={{ fontSize: 13 }}>
              <span className="ld-muted">Showing {(page - 1) * pageSize + 1}-{Math.min(page * pageSize, classes.length)} of {classes.length}</span>
              <span style={{ display: 'flex', gap: 6 }}>
                <button type="button" className="ld-btn2 sm" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>←</button>
                <button type="button" className="ld-btn2 sm" disabled={page >= totalPages} onClick={() => setPage((p) => Math.min(totalPages, p + 1))}>→</button>
              </span>
            </div>
          )}
          <div className="ld-muted" style={{ fontSize: 12, marginTop: 'auto' }}>Reconnects merge hote hain — duplicate attendance nahi banta · calculation basis har session par visible</div>
        </section>

        <section className="ld-card" aria-label="Attendance correction">
          <b style={{ fontSize: 16 }}>Attendance galat hai?</b>
          {correctable.length === 0 ? (
            <div className="ld-muted" style={{ fontSize: 13 }}>Koi absent / partial / late session nahi — correction ki zaroorat nahi.</div>
          ) : (
            <>
              <label className="ld-label">Session
                <select className="ld-inp full" style={{ height: 38, fontSize: 14 }} value={picked ? picked.id : ''} onChange={(e) => setCorrId(e.target.value)}>
                  {correctable.map((c) => <option key={c.id} value={c.id}>{c.className} · {fmtDate(c.date)} · {c.status} ({c.attendedMin || 0} min)</option>)}
                </select>
              </label>
              <label className="ld-label">Kya hua
                <textarea className="ld-inp full" style={{ fontSize: 14 }} value={corrText} onChange={(e) => setCorrText(e.target.value)} placeholder="e.g. Network drop hua, phir join kiya par record nahi hua." />
              </label>
              <div className="ld-muted" style={{ height: 60, border: '2px dashed #cbd5e1', borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, textAlign: 'center', padding: 8 }}>Screenshot / proof agle step (ticket) mein attach karein</div>
              <button type="button" className="ld-btn" disabled={corrText.trim().length < 5} onClick={sendCorrection}>Send correction request</button>
            </>
          )}
          <div className="ld-muted" style={{ fontSize: 12, lineHeight: '18px' }}>Correction sirf authorised staff karega — aapko result notification milega.</div>
        </section>
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
