import React, { useEffect, useMemo, useState } from 'react';
import { Card, Collapse, Segmented, Progress, Table, DatePicker, Space, Typography, Empty, Button } from 'antd';
import { ScheduleOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import lmsApi from '@/pages/Lms/api';
import { PageHeading, StatusPill, tablePagination } from '../components/ui';

const { Text } = Typography;

// Wired to GET /api/lms/assessments/admin/curriculum/sessions?batch&track and
// PATCH .../admin/curriculum/sessions/:id/delivery (ported from the
// python-test-platform reference project).
const TRACKS = [
  { value: 'FOUNDATION', label: 'Foundation (6-Month)' },
  { value: 'ELITE', label: 'Elite (12-Month)' },
];
const BATCHES = ['4:00 PM - 5:30 PM', '6:00 PM - 7:30 PM', '8:00 PM - 9:30 PM'];
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

export default function Curriculum() {
  const [track, setTrack] = useState('FOUNDATION');
  const [batch, setBatch] = useState(BATCHES[0]);
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    const res = await lmsApi.assessmentCurriculumSessions({ batch, track });
    const data = (res && res.result) || {};
    setSessions(data.sessions || []);
    setLoading(false);
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [track, batch]);

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
    </div>
  );
}
