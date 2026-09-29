import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Card, Collapse, Segmented, Select, Progress, Table, DatePicker, Space, Typography, Empty, Button, Skeleton } from 'antd';
import { ScheduleOutlined, ClockCircleOutlined, CalendarOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { useSelector } from 'react-redux';
import { selectCurrentAdmin } from '@/redux/auth/selectors';
import { LMS_TEACHER_ROLES } from '@/config/roles';
import lmsApi from '@/pages/Lms/api';
import { PageHeading, StatusPill, tablePagination } from '../components/ui';

const { Text } = Typography;

// Wired to GET /api/lms/assessments/admin/curriculum/sessions?batch&track and
// PATCH .../admin/curriculum/sessions/:id/delivery (ported from the
// python-test-platform reference project). `batch` is matched against this
// CRM's real Batch.name (via teacherDashboard's own batch list, same source
// Assignments/Projects/Announcements use) — it used to be 3 hardcoded fake
// time-slot strings with no relation to any real batch at all. Which track
// (FOUNDATION/ELITE) applies is resolved server-side from the batch's own
// course length (services/lms/curriculumTracker.js), and delivery now
// auto-advances one unit per completed live class instead of only being
// set by hand.
const TRACKS = [
  { value: 'FOUNDATION', label: 'Foundation (6-Month)' },
  { value: 'ELITE', label: 'Elite (12-Month)' },
];
const STATUS_TONE = { DELIVERED: 'success', SKIPPED: 'warning', PENDING: 'neutral' };

function isBehindSchedule(s) {
  if (s.status !== 'PENDING' || !s.plannedDate) return false;
  return new Date(s.plannedDate) < new Date();
}
function groupByUnit(sessions) {
  const groups = {};
  for (const s of sessions) {
    if (!groups[s.unit]) groups[s.unit] = [];
    groups[s.unit].push(s);
  }
  return groups;
}

// Shared session list — `onUpdate` present (teacher) shows the date picker
// + action buttons; omitted (student) renders a plain read-only view.
function SessionsList({ sessions, loading, onUpdate }) {
  const grouped = groupByUnit(sessions);
  if (!loading && sessions.length === 0) {
    return <Card><Empty description="No sessions for this batch yet." /></Card>;
  }
  const editable = typeof onUpdate === 'function';
  const baseColumns = [
    { title: 'Code', dataIndex: 'code', width: 100, render: (v) => <Text type="secondary" style={{ fontWeight: 700, fontSize: 12 }}>{v}</Text> },
    {
      title: 'Session',
      dataIndex: 'title',
      render: (title, s) => (
        <Space direction="vertical" size={0}>
          <Text strong>{title}</Text>
          {s.notes && <Text type="secondary" style={{ fontSize: 12 }}>{s.notes}</Text>}
        </Space>
      ),
    },
    { title: 'Hours', dataIndex: 'hours', width: 70, align: 'center', render: (v) => `${v}h` },
    {
      title: 'Status',
      dataIndex: 'status',
      width: 190,
      render: (v, s) => (
        <Space size={4}>
          <StatusPill tone={STATUS_TONE[v]}>{v}</StatusPill>
          {isBehindSchedule(s) && <StatusPill tone="danger">Behind Schedule</StatusPill>}
        </Space>
      ),
    },
    {
      title: 'Delivered on',
      dataIndex: 'actualDate',
      width: 130,
      render: (v) => (v ? <Text type="secondary">{new Date(v).toLocaleDateString()}</Text> : <Text type="secondary">—</Text>),
    },
  ];
  const columns = editable
    ? [
        ...baseColumns.slice(0, 4),
        {
          title: 'Planned date',
          dataIndex: 'plannedDate',
          width: 150,
          render: (v, s) => (
            <DatePicker
              size="small"
              placeholder="Planned date"
              value={v ? dayjs(v) : null}
              onChange={(d) => onUpdate(s.sessionId, { plannedDate: d ? d.format('YYYY-MM-DD') : null })}
            />
          ),
        },
        baseColumns[4],
        {
          title: '',
          width: 230,
          render: (_, s) => (
            <Space wrap size={6}>
              {s.status !== 'DELIVERED' && (
                <Button size="small" onClick={() => onUpdate(s.sessionId, { status: 'DELIVERED', actualDate: dayjs().format('YYYY-MM-DD') })}>
                  Mark Delivered
                </Button>
              )}
              {s.status !== 'SKIPPED' && (
                <Button size="small" onClick={() => onUpdate(s.sessionId, { status: 'SKIPPED' })}>
                  Skip
                </Button>
              )}
              {s.status !== 'PENDING' && (
                <Button size="small" onClick={() => onUpdate(s.sessionId, { status: 'PENDING', actualDate: null })}>
                  Reset
                </Button>
              )}
            </Space>
          ),
        },
      ]
    : baseColumns;

  return (
    <Collapse
      defaultActiveKey={Object.keys(grouped)}
      items={Object.entries(grouped).map(([unit, unitSessions]) => ({
        key: unit,
        label: (
          <Space>
            <b>{unit}</b>
            <Text type="secondary" style={{ fontSize: 12 }}>
              {unitSessions.filter((s) => s.status === 'DELIVERED').length}/{unitSessions.length} delivered
            </Text>
          </Space>
        ),
        children: (
          <Table
            size="small"
            rowKey="sessionId"
            loading={loading}
            dataSource={unitSessions}
            pagination={unitSessions.length > 10 ? tablePagination({ pageSize: 10, size: 'small' }) : false}
            rowClassName={(s) => (isBehindSchedule(s) ? 'lms-row-behind' : '')}
            columns={columns}
          />
        ),
      }))}
    />
  );
}

/* ═══════════ TEACHER — pick a batch, mark delivery ═══════════ */
function TeacherCurriculum() {
  const [track, setTrack] = useState('FOUNDATION');
  const [batches, setBatches] = useState([]); // real Batch rows: { name, classDays, classTime, endTime, ... }
  const [batch, setBatch] = useState('');
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [batchesLoading, setBatchesLoading] = useState(true);

  useEffect(() => {
    lmsApi.teacherDashboard().then((d) => {
      const rows = (d && d.result && d.result.batches) || [];
      setBatches(rows);
      if (rows.length) setBatch(rows[0].name);
    }).finally(() => setBatchesLoading(false));
  }, []);

  // Guards the auto track-correction below to once per batch selection — a
  // teacher's own manual Segmented click afterward is never overridden.
  const autoTrackBatchRef = useRef(null);

  const load = useCallback(async () => {
    if (!batch) { setSessions([]); setLoading(false); return; }
    setLoading(true);
    const res = await lmsApi.assessmentCurriculumSessions({ batch, track });
    const data = (res && res.result) || {};
    // The backend resolves which track (FOUNDATION/ELITE) actually matches
    // this batch's own course length — auto-switch to it the first time
    // this batch is opened, instead of silently showing 0% against the
    // wrong track.
    if (data.resolvedTrack && data.resolvedTrack !== track && autoTrackBatchRef.current !== batch) {
      autoTrackBatchRef.current = batch;
      setTrack(data.resolvedTrack);
      return;
    }
    autoTrackBatchRef.current = batch;
    setSessions(data.sessions || []);
    setLoading(false);
  }, [batch, track]);

  useEffect(() => { load(); }, [load]);

  const activeBatch = batches.find((b) => b.name === batch);

  const progress = useMemo(() => {
    const delivered = sessions.filter((s) => s.status === 'DELIVERED').length;
    const total = sessions.length;
    return { delivered, total, percent: total ? Math.round((delivered / total) * 100) : 0 };
  }, [sessions]);

  const updateDelivery = async (sessionId, patch) => {
    await lmsApi.updateAssessmentDelivery(sessionId, { batch, ...patch });
    load();
  };

  if (batchesLoading) return <Skeleton active paragraph={{ rows: 6 }} style={{ padding: 24 }} />;

  return (
    <div className="lms-portal" style={{ padding: 4 }}>
      <PageHeading
        icon={<ScheduleOutlined />}
        title="Curriculum Delivery Tracker"
        description="Track which sessions have actually been delivered against the planned schedule, per batch."
      />

      {batches.length === 0 ? (
        <Card><Empty description="You have no batches assigned yet." /></Card>
      ) : (
        <>
          <Space direction="vertical" size={12} style={{ width: '100%', marginBottom: 12 }}>
            <Segmented value={track} onChange={setTrack} options={TRACKS.map((t) => ({ value: t.value, label: t.label }))} />
            <Select
              value={batch}
              onChange={setBatch}
              style={{ minWidth: 280 }}
              options={batches.map((b) => ({ value: b.name, label: b.name }))}
              placeholder="Select a batch…"
            />
          </Space>

          {activeBatch && (
            <Space size={16} style={{ marginBottom: 12, color: 'var(--hub-text-soft, #64748b)', fontSize: 13 }} wrap>
              <span><CalendarOutlined /> {activeBatch.classDays || 'Days not set'}</span>
              <span><ClockCircleOutlined /> {activeBatch.classTime && activeBatch.endTime ? `${activeBatch.classTime} – ${activeBatch.endTime}` : 'Time not set'}</span>
              {activeBatch.course && <span>· {activeBatch.course}</span>}
            </Space>
          )}

          <Card size="small" style={{ marginBottom: 16 }}>
            <Space style={{ width: '100%', justifyContent: 'space-between' }} wrap>
              <Text type="secondary" style={{ textTransform: 'uppercase', fontSize: 11, fontWeight: 600 }}>
                {batch} — {TRACKS.find((t) => t.value === track)?.label}
              </Text>
              <Text strong>{progress.delivered} / {progress.total} sessions ({progress.percent}%)</Text>
            </Space>
            <Progress percent={progress.percent} showInfo={false} style={{ marginTop: 8 }} />
          </Card>

          <SessionsList sessions={sessions} loading={loading} onUpdate={updateDelivery} />
        </>
      )}
    </div>
  );
}

/* ═══════════ STUDENT — read-only, own batch ═══════════ */
function StudentCurriculum() {
  const [batch, setBatch] = useState(null); // { name, ... } or null once resolved
  const [sessions, setSessions] = useState([]);
  const [resolvedTrack, setResolvedTrack] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const d = await lmsApi.studentDashboard();
      const enrolment = ((d && d.result && d.result.courses) || []).find((c) => c.batch);
      if (!enrolment) { setLoading(false); return; }
      const res = await lmsApi.assessmentCurriculumSessions({ batch: enrolment.batch });
      const data = (res && res.result) || {};
      setBatch({ name: enrolment.batch, course: enrolment.course });
      setResolvedTrack(data.resolvedTrack);
      setSessions(data.sessions || []);
      setLoading(false);
    })();
  }, []);

  const progress = useMemo(() => {
    const delivered = sessions.filter((s) => s.status === 'DELIVERED').length;
    const total = sessions.length;
    return { delivered, total, percent: total ? Math.round((delivered / total) * 100) : 0 };
  }, [sessions]);

  if (loading) return <Skeleton active paragraph={{ rows: 6 }} style={{ padding: 24 }} />;

  return (
    <div className="lms-portal" style={{ padding: 4 }}>
      <PageHeading
        icon={<ScheduleOutlined />}
        title="Curriculum Progress"
        description="What's actually been covered in your batch so far."
      />

      {!batch ? (
        <Card><Empty description="You're not on a batch yet." /></Card>
      ) : (
        <>
          <Card size="small" style={{ marginBottom: 16 }}>
            <Space style={{ width: '100%', justifyContent: 'space-between' }} wrap>
              <Text type="secondary" style={{ textTransform: 'uppercase', fontSize: 11, fontWeight: 600 }}>
                {batch.name} — {TRACKS.find((t) => t.value === resolvedTrack)?.label || resolvedTrack}
              </Text>
              <Text strong>{progress.delivered} / {progress.total} sessions ({progress.percent}%)</Text>
            </Space>
            <Progress percent={progress.percent} showInfo={false} style={{ marginTop: 8 }} />
          </Card>

          <SessionsList sessions={sessions} loading={loading} />
        </>
      )}
    </div>
  );
}

export default function Curriculum() {
  const admin = useSelector(selectCurrentAdmin) || {};
  return LMS_TEACHER_ROLES.includes(admin.role) ? <TeacherCurriculum /> : <StudentCurriculum />;
}
