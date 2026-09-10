import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Row,
  Col,
  Card,
  Tag,
  Button,
  Alert,
  Skeleton,
  Empty,
  Tooltip,
  message,
  Modal,
  Table,
  Form,
  DatePicker,
  InputNumber,
  Checkbox,
  Input,
} from 'antd';
import dayjs from 'dayjs';
import {
  VideoCameraOutlined,
  ReloadOutlined,
  PlayCircleOutlined,
  LoginOutlined,
  StopOutlined,
  TeamOutlined,
  CalendarOutlined,
  ClockCircleOutlined,
  PlaySquareOutlined,
  FieldTimeOutlined,
  UserAddOutlined,
} from '@ant-design/icons';
import lmsApi from '../api';

// Live Classes — auto-generated per batch/course. No manual meeting link:
// Join asks the backend for a one-time redirect (teacher -> host,
// student -> attendee); the meeting URL is never in the DOM.

const STATUS_META = {
  LIVE: { color: 'red', order: 0, label: 'LIVE' },
  STARTING: { color: 'orange', order: 1, label: 'STARTING…' },
  UPCOMING: { color: 'blue', order: 2, label: 'UPCOMING' },
  SCHEDULED: { color: 'geekblue', order: 3, label: 'SCHEDULED' },
  ENDING: { color: 'orange', order: 4, label: 'ENDING…' },
  RECORDING_PROCESSING: { color: 'purple', order: 5, label: 'RECORDING PROCESSING' },
  RECORDING_AVAILABLE: { color: 'green', order: 6, label: 'RECORDING READY' },
  ENDED: { color: 'default', order: 7, label: 'ENDED' },
  CANCELLED: { color: 'default', order: 9, label: 'CANCELLED' },
};

const d = (v) => {
  if (!v) return '—';
  try {
    return new Date(v).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
  } catch (e) {
    return '—';
  }
};
const t = (v) => {
  if (!v) return '';
  try {
    return new Date(v).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  } catch (e) {
    return '';
  }
};

export default function LiveClasses() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [rows, setRows] = useState([]);
  const [busyId, setBusyId] = useState(null);
  const [attFor, setAttFor] = useState(null);
  const [att, setAtt] = useState([]);
  const [editFor, setEditFor] = useState(null);
  const [editBusy, setEditBusy] = useState(false);
  const [editForm] = Form.useForm();
  const [addFor, setAddFor] = useState(null);
  const [addBusy, setAddBusy] = useState(false);
  const [addForm] = Form.useForm();
  const timer = useRef(null);

  const load = useCallback(async (silent) => {
    if (!silent) setLoading(true);
    setError(null);
    try {
      const res = await lmsApi.liveClasses();
      const list = (res && res.result) || [];
      list.sort((a, b) => {
        const so = (STATUS_META[a.status]?.order ?? 9) - (STATUS_META[b.status]?.order ?? 9);
        return so || new Date(a.scheduledStart || 0) - new Date(b.scheduledStart || 0);
      });
      setRows(list);
    } catch (e) {
      setError('Could not load live classes.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    timer.current = setInterval(() => load(true), 20000);
    return () => clearInterval(timer.current);
  }, [load]);

  const openMeeting = (url) => url && window.open(url, '_blank', 'noopener');

  const onJoin = async (id) => {
    setBusyId(id);
    try {
      const res = await lmsApi.liveClassJoin(id);
      if (res && res.result && res.result.url) openMeeting(res.result.url);
      else message.warning((res && res.message) || 'Could not join.');
    } catch (e) {
      message.error('Could not join.');
    } finally {
      setBusyId(null);
      load(true);
    }
  };
  const onStart = async (id) => {
    setBusyId(id);
    try {
      const res = await lmsApi.liveClassStart(id);
      if (res && res.success === false) message.warning(res.message || 'Could not start.');
      else await onJoin(id);
    } finally {
      setBusyId(null);
      load(true);
    }
  };
  const onEnd = (id) =>
    Modal.confirm({
      title: 'End this class?',
      content: 'Students are disconnected, recording stops and attendance is finalised.',
      okText: 'End class',
      okButtonProps: { danger: true },
      onOk: async () => {
        setBusyId(id);
        try {
          await lmsApi.liveClassEnd(id);
          message.success('Class ended.');
        } finally {
          setBusyId(null);
          load(true);
        }
      },
    });
  const showAtt = async (r) => {
    setAttFor(r);
    setAtt([]);
    try {
      const res = await lmsApi.liveClassAttendance(r.id);
      setAtt((res && res.result) || []);
    } catch (e) {
      /* teacher-only */
    }
  };

  const openEdit = (r) => {
    setEditFor(r);
    editForm.setFieldsValue({
      scheduledStart: r.scheduledStart ? dayjs(r.scheduledStart) : null,
      scheduledDurationMin: r.scheduledDurationMin || 60,
      autoStartAt: !!r.autoStartAt,
    });
  };
  const submitEdit = async () => {
    let v;
    try {
      v = await editForm.validateFields();
    } catch (e) {
      return;
    }
    setEditBusy(true);
    try {
      const res = await lmsApi.liveClassUpdate(editFor.id, {
        scheduledStart: v.scheduledStart ? v.scheduledStart.toISOString() : undefined,
        scheduledDurationMin: v.scheduledDurationMin,
        autoStartAt: !!v.autoStartAt,
      });
      if (res && res.success === false) message.warning(res.message || 'Could not update the class time.');
      else {
        message.success('Class time updated.');
        setEditFor(null);
      }
    } catch (e) {
      message.error('Could not update the class time.');
    } finally {
      setEditBusy(false);
      load(true);
    }
  };

  const openAdd = (r) => {
    setAddFor(r);
    addForm.resetFields();
  };
  const submitAdd = async () => {
    let v;
    try {
      v = await addForm.validateFields();
    } catch (e) {
      return;
    }
    setAddBusy(true);
    try {
      const res = await lmsApi.addBatchStudent(addFor.batchId, { email: v.email.trim(), name: (v.name || '').trim() });
      if (res && res.success === false) message.warning(res.message || 'Could not add the student.');
      else {
        const emailed = res && res.result && res.result.emailed;
        message.success(emailed ? 'Student added — class link emailed.' : 'Student added to the batch.');
        setAddFor(null);
      }
    } catch (e) {
      message.error('Could not add the student.');
    } finally {
      setAddBusy(false);
      load(true);
    }
  };

  const liveNow = rows.filter((r) => r.status === 'LIVE');

  if (loading) {
    return (
      <div className="lms-portal lms-section-live">
        <Skeleton active paragraph={{ rows: 1 }} />
        <Row gutter={[16, 16]} style={{ marginTop: 12 }}>
          {[0, 1, 2].map((i) => (
            <Col xs={24} sm={12} lg={8} key={i}>
              <Card size="small"><Skeleton active paragraph={{ rows: 2 }} /></Card>
            </Col>
          ))}
        </Row>
      </div>
    );
  }

  return (
    <div className="lms-portal lms-section-live">
      <div className="lms-portal-head">
        <div>
          <h2><VideoCameraOutlined /> Live Classes</h2>
          <p>Rooms are created automatically per batch — no meeting links to manage.</p>
        </div>
        <Button icon={<ReloadOutlined />} onClick={() => load()}>Refresh</Button>
      </div>

      {error && <Alert type="error" showIcon message={error} style={{ marginBottom: 16 }} />}

      {liveNow.length > 0 && (
        <Alert
          type="error"
          showIcon
          style={{ marginBottom: 16 }}
          className="lms-livenow"
          message={`LIVE NOW — ${liveNow.length} class${liveNow.length > 1 ? 'es' : ''}`}
          description={
            <div className="lms-livenow-row">
              {liveNow.map((r) => (
                <span key={r.id}>
                  <b>{r.title}</b> · {r.courseTitle} · {r.teacherName}
                  {r.canJoin && (
                    <Button size="small" type="primary" style={{ marginLeft: 8 }} loading={busyId === r.id} onClick={() => onJoin(r.id)}>
                      {r.myRole === 'teacher' ? 'Join as host' : 'JOIN LIVE CLASS'}
                    </Button>
                  )}
                </span>
              ))}
            </div>
          }
        />
      )}

      {rows.length === 0 ? (
        <Card>
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description="No live classes yet. Create a batch (course + teacher + start date + class days) and the schedule appears here automatically."
          />
        </Card>
      ) : (
        <Row gutter={[16, 16]}>
          {rows.map((r) => {
            const meta = STATUS_META[r.status] || { color: 'default', label: r.status };
            const busy = busyId === r.id;
            return (
              <Col xs={24} sm={12} lg={8} key={r.id}>
                <Card size="small" className={`lms-live-card lms-live-${r.lifecycle}`}>
                  <div className="lms-live-top">
                    <Tag color={meta.color}>{meta.label}</Tag>
                    <span className="lms-live-provider">
                      {r.meetingProvider === 'bigbluebutton' ? 'BigBlueButton' : r.meetingProvider === 'jitsi' ? 'Jitsi' : 'Room'}
                      {r.isMock ? ' · mock' : ''}
                    </span>
                  </div>

                  <div className="lms-live-title">{r.title}</div>
                  <div className="lms-live-sub">
                    {r.courseTitle || '—'}{r.batchName ? ` · ${r.batchName}` : ''}
                  </div>

                  <div className="lms-live-meta">
                    <span><TeamOutlined /> {r.teacherName || 'Teacher TBD'}</span>
                    <span><CalendarOutlined /> {d(r.scheduledStart)}</span>
                    <span><ClockCircleOutlined /> {t(r.scheduledStart)}{r.scheduledEnd ? `–${t(r.scheduledEnd)}` : ''}</span>
                    {r.status === 'LIVE' && <span className="lms-live-online">● {r.participantsOnline} online</span>}
                  </div>

                  <div className="lms-live-actions">
                    {r.canStart && (
                      <Button type="primary" size="small" icon={<PlayCircleOutlined />} loading={busy} onClick={() => onStart(r.id)}>
                        Start class
                      </Button>
                    )}
                    {r.canJoin && !r.canStart && (
                      <Button type="primary" size="small" icon={<LoginOutlined />} loading={busy} onClick={() => onJoin(r.id)}>
                        {r.myRole === 'teacher' ? 'Join as host' : 'Join Live Class'}
                      </Button>
                    )}
                    {r.canEnd && (
                      <Button danger size="small" icon={<StopOutlined />} loading={busy} onClick={() => onEnd(r.id)}>
                        End
                      </Button>
                    )}
                    {r.status === 'RECORDING_PROCESSING' && <span className="lms-live-done">Recording processing…</span>}
                    {r.status === 'RECORDING_AVAILABLE' && (
                      <Button size="small" icon={<PlaySquareOutlined />} href="#/lms/recordings">
                        Watch Recording
                      </Button>
                    )}
                    {r.canEditTime && (
                      <Button size="small" icon={<FieldTimeOutlined />} onClick={() => openEdit(r)}>
                        Edit time
                      </Button>
                    )}
                    {r.canAddStudent && (
                      <Button size="small" icon={<UserAddOutlined />} onClick={() => openAdd(r)}>
                        Add student
                      </Button>
                    )}
                    {r.autoStartAt && ['SCHEDULED', 'UPCOMING'].includes(r.status) && (
                      <span className="lms-live-auto">
                        <ClockCircleOutlined /> auto-starts at {t(r.scheduledStart)}
                      </span>
                    )}
                    {r.myRole === 'teacher' && <Button size="small" onClick={() => showAtt(r)}>Attendance</Button>}
                    {['SCHEDULED', 'UPCOMING'].includes(r.status) && r.myRole === 'student' && (
                      <Tooltip title="You can join once the teacher starts the class.">
                        <Button size="small" disabled>Not started</Button>
                      </Tooltip>
                    )}
                    {r.status === 'ENDED' && <span className="lms-live-done">Class ended</span>}
                  </div>
                </Card>
              </Col>
            );
          })}
        </Row>
      )}

      <Modal
        open={!!editFor}
        title={editFor ? `Edit class time — ${editFor.title}` : ''}
        onCancel={() => setEditFor(null)}
        onOk={submitEdit}
        okText="Save time"
        confirmLoading={editBusy}
        destroyOnClose
      >
        <p style={{ marginTop: 0, color: 'rgba(0,0,0,0.45)' }}>
          The class link stays the same — only the scheduled start and length change.
        </p>
        <Form form={editForm} layout="vertical" preserve={false}>
          <Form.Item
            name="scheduledStart"
            label="Scheduled start"
            rules={[{ required: true, message: 'Pick a start date & time.' }]}
          >
            <DatePicker showTime format="ddd, D MMM YYYY HH:mm" style={{ width: '100%' }} minuteStep={5} />
          </Form.Item>
          <Form.Item
            name="scheduledDurationMin"
            label="Duration (minutes)"
            rules={[{ required: true, message: 'Enter a duration.' }]}
          >
            <InputNumber min={5} max={600} step={5} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="autoStartAt" valuePropName="checked">
            <Checkbox>Start the class automatically at this time</Checkbox>
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        open={!!addFor}
        title={addFor ? `Add student — ${addFor.batchName || 'batch'}` : ''}
        onCancel={() => setAddFor(null)}
        onOk={submitAdd}
        okText="Add student"
        confirmLoading={addBusy}
        destroyOnClose
      >
        <p style={{ marginTop: 0, color: 'rgba(0,0,0,0.45)' }}>
          The student is enrolled in this batch, emailed the same class link + schedule, and appears in every
          upcoming class.
        </p>
        <Form form={addForm} layout="vertical" preserve={false}>
          <Form.Item name="name" label="Full name">
            <Input placeholder="e.g. Priya Sharma" autoComplete="off" />
          </Form.Item>
          <Form.Item
            name="email"
            label="Email"
            rules={[
              { required: true, message: 'Enter the student’s email.' },
              { type: 'email', message: 'Enter a valid email address.' },
            ]}
          >
            <Input placeholder="student@example.com" autoComplete="off" />
          </Form.Item>
        </Form>
      </Modal>

      <Modal open={!!attFor} title={attFor ? `Attendance — ${attFor.title}` : ''} footer={null} onCancel={() => setAttFor(null)} width={680}>
        <Table
          size="small"
          rowKey={(x) => x.email || x.name}
          dataSource={att}
          pagination={false}
          locale={{ emptyText: 'No joins recorded yet.' }}
          columns={[
            { title: 'Name', dataIndex: 'name' },
            { title: 'Role', dataIndex: 'role', width: 80 },
            { title: 'First join', dataIndex: 'firstJoinAt', render: (v) => (v ? t(v) : '—'), width: 90 },
            { title: 'Last left', dataIndex: 'lastLeftAt', render: (v) => (v ? t(v) : '—'), width: 90 },
            { title: 'Min', dataIndex: 'totalDurationMin', width: 60 },
            { title: '%', dataIndex: 'attendancePct', width: 60 },
            { title: 'Joins', dataIndex: 'joinCount', width: 60 },
            {
              title: 'Status',
              dataIndex: 'status',
              width: 100,
              render: (v) => (
                <Tag color={v === 'PRESENT' ? 'green' : v === 'LATE' ? 'gold' : v === 'PARTIAL' ? 'orange' : 'default'}>{v}</Tag>
              ),
            },
          ]}
        />
      </Modal>
    </div>
  );
}
