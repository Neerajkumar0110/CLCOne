import React, { useMemo, useState } from 'react';
import { Card, Collapse, Segmented, Progress, Table, DatePicker, Space, Typography, Empty, Button } from 'antd';
import { ScheduleOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { PageHeading, StatusPill, tablePagination } from '../components/ui';

const { Text } = Typography;

// UI-only mock — wire to GET /api/admin/curriculum/sessions?batch&track and
// PATCH /api/admin/curriculum/sessions/:id/delivery once the backend exists.
// Field shape and status vocabulary (PENDING/DELIVERED/SKIPPED) match that
// reference API 1:1 so swapping the mock for a real fetch is a drop-in.
const TRACKS = [
  { value: 'FOUNDATION', label: 'Foundation (6-Month)' },
  { value: 'ELITE', label: 'Elite (12-Month)' },
];
const BATCHES = ['4:00 PM - 5:30 PM', '6:00 PM - 7:30 PM', '8:00 PM - 9:30 PM'];
const STATUS_TONE = { DELIVERED: 'success', SKIPPED: 'warning', PENDING: 'neutral' };

const MOCK_SESSIONS = {
  FOUNDATION: [
    { sessionId: 's1', code: 'F-U1-01', unit: 'Unit 1 — HTML, CSS & JS Foundations', title: 'HTML5 semantics & forms', hours: 3, order: 1, status: 'DELIVERED', plannedDate: '2026-08-04', actualDate: '2026-08-04', notes: null },
    { sessionId: 's2', code: 'F-U1-02', unit: 'Unit 1 — HTML, CSS & JS Foundations', title: 'CSS layout — flexbox & grid', hours: 3, order: 2, status: 'DELIVERED', plannedDate: '2026-08-06', actualDate: '2026-08-06', notes: null },
    { sessionId: 's3', code: 'F-U1-03', unit: 'Unit 1 — HTML, CSS & JS Foundations', title: 'JS fundamentals & DOM', hours: 4, order: 3, status: 'DELIVERED', plannedDate: '2026-08-08', actualDate: '2026-08-09', notes: null },
    { sessionId: 's4', code: 'F-U2-01', unit: 'Unit 2 — React Basics', title: 'Components & props', hours: 3, order: 4, status: 'DELIVERED', plannedDate: '2026-08-11', actualDate: '2026-08-11', notes: null },
    { sessionId: 's5', code: 'F-U2-02', unit: 'Unit 2 — React Basics', title: 'State & hooks', hours: 3, order: 5, status: 'SKIPPED', plannedDate: '2026-08-13', actualDate: null, notes: 'Public holiday — moved to next slot.' },
    { sessionId: 's6', code: 'F-U2-03', unit: 'Unit 2 — React Basics', title: 'Forms & events', hours: 3, order: 6, status: 'PENDING', plannedDate: '2026-09-05', actualDate: null, notes: null },
    { sessionId: 's7', code: 'F-U3-01', unit: 'Unit 3 — Backend with Node & Express', title: 'REST API basics', hours: 4, order: 7, status: 'PENDING', plannedDate: '2026-09-08', actualDate: null, notes: null },
  ],
  ELITE: [
    { sessionId: 'e1', code: 'E-U1-01', unit: 'Unit 1 — Foundations', title: 'Advanced JS & TypeScript', hours: 4, order: 1, status: 'DELIVERED', plannedDate: '2026-08-05', actualDate: '2026-08-05', notes: null },
    { sessionId: 'e2', code: 'E-U2-01', unit: 'Unit 2 — System Design', title: 'Scalable architecture patterns', hours: 4, order: 2, status: 'PENDING', plannedDate: '2026-09-02', actualDate: null, notes: null },
  ],
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
  const [batch, setBatch] = useState(BATCHES[0]);
  const [sessionsByTrack, setSessionsByTrack] = useState(MOCK_SESSIONS);

  const sessions = sessionsByTrack[track] || [];
  const progress = useMemo(() => {
    const delivered = sessions.filter((s) => s.status === 'DELIVERED').length;
    const total = sessions.length;
    return { delivered, total, percent: total ? Math.round((delivered / total) * 100) : 0 };
  }, [sessions]);

  const updateDelivery = (sessionId, updates) => {
    setSessionsByTrack((prev) => ({
      ...prev,
      [track]: prev[track].map((s) => (s.sessionId === sessionId ? { ...s, ...updates } : s)),
    }));
  };

  const grouped = groupByUnit(sessions);

  return (
    <div className="lms-portal" style={{ padding: 4 }}>
      <PageHeading
        icon={<ScheduleOutlined />}
        title="Curriculum Delivery Tracker"
        description="Track which sessions have actually been delivered against the planned schedule, per batch."
      />

      <Space direction="vertical" size={12} style={{ width: '100%', marginBottom: 12 }}>
        <Segmented value={track} onChange={setTrack} options={TRACKS.map((t) => ({ value: t.value, label: t.label }))} />
        <Segmented value={batch} onChange={setBatch} options={BATCHES} />
      </Space>

      <Card size="small" style={{ marginBottom: 16 }}>
        <Space style={{ width: '100%', justifyContent: 'space-between' }}>
          <Text type="secondary" style={{ textTransform: 'uppercase', fontSize: 11, fontWeight: 600 }}>
            Progress — {TRACKS.find((t) => t.value === track)?.label}
          </Text>
          <Text strong>{progress.delivered} / {progress.total} sessions ({progress.percent}%)</Text>
        </Space>
        <Progress percent={progress.percent} showInfo={false} style={{ marginTop: 8 }} />
      </Card>

      {sessions.length === 0 ? (
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
      <Text type="secondary" style={{ display: 'block', marginTop: 8, fontSize: 12 }}>
        Showing sample data — live sessions will replace this once wired to the backend.
      </Text>
    </div>
  );
}
