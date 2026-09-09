import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useSelector } from 'react-redux';
import { Table, Tag, Input, Select, Button, Space, Alert, message, Modal, DatePicker } from 'antd';
import { ReloadOutlined, PlaySquareOutlined, DeleteOutlined, SearchOutlined } from '@ant-design/icons';
import { selectCurrentAdmin } from '@/redux/auth/selectors';
import lmsApi from '../api';

const MGR = ['owner', 'Super Admin', 'Admin', 'Sales Manager'];
const STATUS_COLOR = { AVAILABLE: 'green', PROCESSING: 'purple', RECORDING: 'red', FAILED: 'red', NOT_STARTED: 'default', DELETED: 'default' };

export default function Recordings() {
  const admin = useSelector(selectCurrentAdmin) || {};
  const isManager = MGR.includes(admin.role);

  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);
  const [f, setF] = useState({ status: undefined, courseTitle: '', batchName: '', student: '', from: null, to: null });
  const [playing, setPlaying] = useState(null);

  const fetcher = isManager ? lmsApi.adminRecordings : lmsApi.recordings;

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const res = await fetcher({
        status: f.status,
        courseTitle: f.courseTitle || undefined,
        batchName: f.batchName || undefined,
        from: f.from ? f.from.toISOString() : undefined,
        to: f.to ? f.to.toISOString() : undefined,
      });
      setRows((res && res.result) || []);
    } catch (e) {
      setErr('Could not load recordings.');
    } finally {
      setLoading(false);
    }
  }, [f, fetcher]);

  useEffect(() => {
    load();
  }, [load]);

  const courses = useMemo(() => [...new Set(rows.map((r) => r.courseTitle).filter(Boolean))], [rows]);
  const batches = useMemo(() => [...new Set(rows.map((r) => r.batchName).filter(Boolean))], [rows]);

  const play = async (rec) => {
    try {
      const res = await lmsApi.recordingPlay(rec.id);
      const url = res && res.result && res.result.url;
      if (url) setPlaying({ ...rec, url });
      else message.info(`Recording is ${rec.status.toLowerCase()}.`);
    } catch (e) {
      message.error('Not available.');
    }
  };
  const del = (rec) =>
    Modal.confirm({
      title: 'Delete this recording?',
      content: 'The video is removed at the provider; attendance + metadata are kept.',
      okButtonProps: { danger: true },
      onOk: async () => {
        await lmsApi.recordingDelete(rec.id);
        message.success('Recording deleted.');
        load();
      },
    });

  const columns = [
    { title: 'Class', dataIndex: 'className', render: (v, r) => <><b>{v}</b><div style={{ fontSize: 12, color: '#888' }}>{r.courseTitle} · {r.batchName}</div></> },
    { title: 'Teacher', dataIndex: 'teacherName', width: 140 },
    { title: 'Date', dataIndex: 'date', width: 120, render: (v) => (v ? new Date(v).toLocaleDateString() : '—') },
    { title: 'Duration', dataIndex: 'durationMin', width: 90, render: (v) => (v ? `${v} min` : '—') },
    { title: 'Status', dataIndex: 'status', width: 140, render: (v) => <Tag color={STATUS_COLOR[v] || 'default'}>{v}</Tag> },
    ...(isManager ? [{ title: 'Views', dataIndex: 'views', width: 70 }] : []),
    {
      title: '',
      width: 190,
      render: (_, r) => (
        <Space>
          <Button size="small" icon={<PlaySquareOutlined />} disabled={!r.canPlay} onClick={() => play(r)}>
            Watch
          </Button>
          {isManager && r.status !== 'DELETED' && (
            <Button size="small" danger icon={<DeleteOutlined />} onClick={() => del(r)} />
          )}
        </Space>
      ),
    },
  ];

  return (
    <div className="lms-portal">
      <div className="lms-portal-head">
        <div>
          <h2><PlaySquareOutlined /> Recordings</h2>
          <p>{isManager ? 'All class recordings.' : 'Recordings for your classes / enrolled courses.'}</p>
        </div>
        <Button icon={<ReloadOutlined />} onClick={load}>Refresh</Button>
      </div>

      {err && <Alert type="error" showIcon message={err} style={{ marginBottom: 12 }} />}

      <Space wrap style={{ marginBottom: 12 }}>
        <Select
          allowClear placeholder="Course" style={{ width: 200 }} value={f.courseTitle || undefined}
          onChange={(v) => setF((x) => ({ ...x, courseTitle: v || '' }))}
          options={courses.map((c) => ({ value: c, label: c }))}
        />
        <Select
          allowClear placeholder="Batch" style={{ width: 180 }} value={f.batchName || undefined}
          onChange={(v) => setF((x) => ({ ...x, batchName: v || '' }))}
          options={batches.map((c) => ({ value: c, label: c }))}
        />
        {isManager && (
          <Select
            allowClear placeholder="Status" style={{ width: 160 }} value={f.status}
            onChange={(v) => setF((x) => ({ ...x, status: v }))}
            options={['AVAILABLE', 'PROCESSING', 'RECORDING', 'FAILED', 'DELETED'].map((s) => ({ value: s, label: s }))}
          />
        )}
        <DatePicker.RangePicker
          onChange={(v) => setF((x) => ({ ...x, from: v && v[0], to: v && v[1] }))}
        />
      </Space>

      <Table
        rowKey="id"
        size="small"
        loading={loading}
        dataSource={rows}
        columns={columns}
        pagination={{ pageSize: 20, showSizeChanger: true }}
        locale={{ emptyText: 'No recordings.' }}
      />

      <Modal
        open={!!playing}
        title={playing ? playing.className : ''}
        footer={null}
        width={900}
        onCancel={() => setPlaying(null)}
        destroyOnClose
      >
        {playing && playing.url ? (
          <div>
            <p style={{ marginTop: 0 }}>
              <a href={playing.url} target="_blank" rel="noopener">Open recording in a new tab ↗</a>
            </p>
            <iframe title="recording" src={playing.url} style={{ width: '100%', height: 480, border: '1px solid #eee', borderRadius: 8 }} allowFullScreen />
          </div>
        ) : (
          <p>No playback URL yet.</p>
        )}
      </Modal>
    </div>
  );
}
