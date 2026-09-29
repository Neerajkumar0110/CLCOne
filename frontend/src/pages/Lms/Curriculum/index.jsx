import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Card, Collapse, Segmented, Select, Progress, Table, DatePicker, Space, Typography, Empty, Button, Skeleton } from 'antd';
import { ScheduleOutlined, ClockCircleOutlined, CalendarOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import lmsApi from '@/pages/Lms/api';
import { PageHeading, StatusPill, tablePagination } from '../components/ui';

const { Text } = Typography;

// Wired to GET /api/lms/assessments/admin/curriculum/sessions?batch&track and
// PATCH .../admin/curriculum/sessions/:id/delivery (ported from the
// python-test-platform reference project). `batch` is matched against this
// CRM's real Batch.name (via teacherDashboard's own batch list, same source
// Assignments/Projects/Announcements use) — it used to be 3 hardcoded fake
// time-slot strings with no relation to any real batch at all.
const TRACKS = [
  { value: 'FOUNDATION', label: 'Foundation (6-Month)' },
  { value: 'ELITE', label: 'Elite (12-Month)' },
];
const STATUS_TONE = { DELIVERED: 'success', SKIPPED: 'warning', PENDING: 'neutral' };
const fmtSchedule = (b) => {
  const days = (b?.classDays || '').trim();
  const time = b?.classTime && b?.endTime ? `${b.classTime}–${b.endTime}` : b?.classTime || '';
  return [days, time].filter(Boolean).join(' · ') || 'No schedule set';
};

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

export default function Curriculum() {
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

  const load = useCallback(async () => {
    if (!batch) { setSessions([]); setLoading(false); return; }
    setLoading(true);
    const res = await lmsApi.assessmentCurriculumSessions({ batch, track });
    const data = (res && res.result) || {};
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

  const grouped = groupByUnit(sessions);

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

          {!loading && sessions.length === 0 ? (
            <Card><Empty description="No sessions for this batch yet." /></Card>
          ) : (
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
                columns={[
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
                    title: 'Planned date',
                    dataIndex: 'plannedDate',
                    width: 150,
                    render: (v, s) => (
                      <DatePicker
                        size="small"
                        placeholder="Planned date"
                        value={v ? dayjs(v) : null}
                        onChange={(d) => updateDelivery(s.sessionId, { plannedDate: d ? d.format('YYYY-MM-DD') : null })}
                      />
                    ),
                  },
                  {
                    title: 'Delivered on',
                    dataIndex: 'actualDate',
                    width: 120,
                    render: (v) => (v ? <Text type="secondary">{new Date(v).toLocaleDateString()}</Text> : <Text type="secondary">—</Text>),
                  },
                  {
                    title: '',
                    width: 230,
                    render: (_, s) => (
                      <Space wrap size={6}>
                        {s.status !== 'DELIVERED' && (
                          <Button size="small" onClick={() => updateDelivery(s.sessionId, { status: 'DELIVERED', actualDate: dayjs().format('YYYY-MM-DD') })}>
                            Mark Delivered
                          </Button>
                        )}
                        {s.status !== 'SKIPPED' && (
                          <Button size="small" onClick={() => updateDelivery(s.sessionId, { status: 'SKIPPED' })}>
                            Skip
                          </Button>
                        )}
                        {s.status !== 'PENDING' && (
                          <Button size="small" onClick={() => updateDelivery(s.sessionId, { status: 'PENDING', actualDate: null })}>
                            Reset
                          </Button>
                        )}
                      </Space>
                    ),
                  },
                ]}
              />
            ),
          }))}
        />
          )}
        </>
      )}
    </div>
  );
}
