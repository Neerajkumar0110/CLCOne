import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSelector } from 'react-redux';
import { Table, Tag, Input, Select, Button, Space, Alert, message, Modal, DatePicker, Tooltip } from 'antd';
import { ReloadOutlined, PlaySquareOutlined, DeleteOutlined, SearchOutlined, UploadOutlined, FullscreenOutlined, ExportOutlined } from '@ant-design/icons';
import { selectCurrentAdmin } from '@/redux/auth/selectors';
import lmsApi from '../api';

const MGR = ['owner', 'Super Admin', 'Admin', 'Sales Manager'];
const STATUS_COLOR = { AVAILABLE: 'green', PROCESSING: 'purple', AWAITING_UPLOAD: 'orange', RECORDING: 'red', FAILED: 'red', NOT_STARTED: 'default', DELETED: 'default' };
const STATUS_LABEL = { AWAITING_UPLOAD: 'AWAITING UPLOAD' };

export default function Recordings() {
  const admin = useSelector(selectCurrentAdmin) || {};
  const isManager = MGR.includes(admin.role);

  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);
  const [f, setF] = useState({ status: undefined, courseTitle: '', batchName: '', student: '', from: null, to: null });
  const [playing, setPlaying] = useState(null);
  const [uploadingId, setUploadingId] = useState(null);
  const fileInputRef = useRef(null);
  const uploadTargetRef = useRef(null);
  // The BBB playback iframe has its own tiny internal fullscreen control
  // (easy to miss, and it only fullscreens once BBB's player has finished
  // loading) — calling requestFullscreen() on the <iframe>/<video> element
  // itself instead gives one reliable, always-visible Fullscreen button,
  // and works cross-origin as long as the element carries allowFullScreen
  // (already set below), regardless of what's rendered inside it.
  const mediaRef = useRef(null);
  const goFullscreen = () => {
    const el = mediaRef.current;
    if (!el) return;
    const req = el.requestFullscreen || el.webkitRequestFullscreen || el.msRequestFullscreen;
    if (req) req.call(el);
  };

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
      if (url) setPlaying({ ...rec, url, provider: res.result.provider });
      else message.info(`Recording is ${rec.status.toLowerCase()}.`);
    } catch (e) {
      message.error('Not available.');
    }
  };
  // Manual upload only makes sense when there's no recorder doing it
  // automatically: AWAITING_UPLOAD (the mock provider's "class ended, no
  // recorder of its own" state) or FAILED (any provider, incl. BigBlueButton,
  // as a recovery fallback) or a stale AVAILABLE-with-no-video row that
  // pre-dates this flow. NOT_STARTED/RECORDING/PROCESSING mean either the
  // class hasn't happened yet or BBB is already recording/processing it —
  // showing "Upload recording" there would just be confusing.
  const canUpload = (r) =>
    (r.status === 'AWAITING_UPLOAD' || r.status === 'FAILED' || (r.status === 'AVAILABLE' && !r.hasVideo)) &&
    (isManager || (r.teacherName || '').toLowerCase() === (admin.name || '').toLowerCase());
  const askUpload = (rec) => {
    uploadTargetRef.current = rec;
    fileInputRef.current && fileInputRef.current.click();
  };
  const onFileChosen = async (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    const rec = uploadTargetRef.current;
    if (!file || !rec) return;
    setUploadingId(rec.id);
    try {
      const res = await lmsApi.recordingUpload(rec.id, file);
      if (res && res.success === false) message.error(res.message || 'Upload failed.');
      else {
        message.success((res && res.result && res.result.message) || 'Uploaded — compressing now.');
        load();
      }
    } catch (err) {
      message.error('Upload failed.');
    } finally {
      setUploadingId(null);
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
    { title: 'Class', dataIndex: 'className', render: (v, r) => <><b>{v}</b><div style={{ fontSize: 12, color: 'var(--hub-muted)' }}>{r.courseTitle} · {r.batchName}</div></> },
    { title: 'Instructor', dataIndex: 'teacherName', width: 140 },
    { title: 'Date', dataIndex: 'date', width: 120, render: (v) => (v ? new Date(v).toLocaleDateString() : '—') },
    { title: 'Duration', dataIndex: 'durationMin', width: 90, render: (v) => (v ? `${v} min` : '—') },
    { title: 'Status', dataIndex: 'status', width: 140, render: (v) => <Tag color={STATUS_COLOR[v] || 'default'}>{STATUS_LABEL[v] || v}</Tag> },
    ...(isManager ? [{ title: 'Views', dataIndex: 'views', width: 70 }] : []),
    {
      title: '',
      width: 260,
      render: (_, r) => (
        <Space>
          <Button size="small" icon={<PlaySquareOutlined />} disabled={!r.canPlay} onClick={() => play(r)}>
            Watch
          </Button>
          {canUpload(r) && (
            <Button size="small" icon={<UploadOutlined />} loading={uploadingId === r.id} onClick={() => askUpload(r)}>
              Upload recording
            </Button>
          )}
          {isManager && r.status !== 'DELETED' && (
            <Button size="small" danger icon={<DeleteOutlined />} onClick={() => del(r)} />
          )}
        </Space>
      ),
    },
  ];

  return (
    <div className="lms-portal lms-section-recordings">
      <div className="lms-portal-head">
        <div>
          <h2><PlaySquareOutlined /> Recordings</h2>
          <p>{isManager ? 'All class recordings.' : 'Recordings for your classes / enrolled courses.'}</p>
        </div>
        <Button icon={<ReloadOutlined />} onClick={load}>Refresh</Button>
      </div>

      <input ref={fileInputRef} type="file" accept="video/*" style={{ display: 'none' }} onChange={onFileChosen} />

      {err && <Alert type="error" showIcon message={err} style={{ marginBottom: 12 }} />}

      <Space wrap className="lms-toolbar" style={{ marginBottom: 12 }}>
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
            options={['AVAILABLE', 'AWAITING_UPLOAD', 'PROCESSING', 'RECORDING', 'FAILED', 'DELETED'].map((s) => ({ value: s, label: STATUS_LABEL[s] || s }))}
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
        footer={null}
        closable={false}
        width="100vw"
        style={{ top: 0, margin: 0, maxWidth: 'none', paddingBottom: 0 }}
        className="lms-recording-player-modal"
        bodyStyle={{ padding: 0, background: '#000' }}
        onCancel={() => setPlaying(null)}
        destroyOnClose
        title={
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
            <span
              style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: 600 }}
              title={playing ? playing.className : ''}
            >
              {playing ? playing.className : ''}
            </span>
            <Space size={8} style={{ flexShrink: 0 }}>
              {playing && playing.url && (
                <>
                  <Tooltip title="Fullscreen">
                    <Button size="small" icon={<FullscreenOutlined />} onClick={goFullscreen}>Fullscreen</Button>
                  </Tooltip>
                  <Tooltip title="Open in a new browser tab">
                    <a href={playing.url} target="_blank" rel="noopener">
                      <Button size="small" icon={<ExportOutlined />}>Open in new tab</Button>
                    </a>
                  </Tooltip>
                </>
              )}
              <Button size="small" onClick={() => setPlaying(null)}>Close</Button>
            </Space>
          </div>
        }
      >
        {playing && playing.url ? (
          playing.provider === 'bigbluebutton' ? (
            <iframe
              ref={mediaRef}
              title="recording"
              src={playing.url}
              style={{ width: '100%', height: '100%', border: 0, display: 'block' }}
              allowFullScreen
            />
          ) : (
            <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <video
                ref={mediaRef}
                controls
                autoPlay
                src={playing.url}
                style={{ maxWidth: '100%', maxHeight: '100%', background: '#000' }}
                allowFullScreen
              />
            </div>
          )
        ) : (
          <p style={{ color: '#fff', padding: 24, margin: 0 }}>No playback URL yet.</p>
        )}
      </Modal>
    </div>
  );
}
