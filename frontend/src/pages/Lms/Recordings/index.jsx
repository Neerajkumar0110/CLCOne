import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSelector } from 'react-redux';
import { Table, Tag, Input, Select, Button, Space, Alert, message, Modal, DatePicker, Tooltip, List, Typography } from 'antd';
import { ReloadOutlined, PlaySquareOutlined, DeleteOutlined, SearchOutlined, UploadOutlined, FullscreenOutlined, ExportOutlined, LinkOutlined, CheckCircleOutlined, CloseCircleOutlined, DownloadOutlined } from '@ant-design/icons';
import { selectCurrentAdmin } from '@/redux/auth/selectors';
import { request } from '@/request';
import lmsApi from '../api';

const MGR = ['owner', 'Super Admin', 'Admin', 'Sales Manager', 'Support'];
const STATUS_COLOR = { AVAILABLE: 'green', PROCESSING: 'purple', AWAITING_UPLOAD: 'orange', RECORDING: 'red', FAILED: 'red', NOT_STARTED: 'default', DELETED: 'default' };
const STATUS_LABEL = { AWAITING_UPLOAD: 'AWAITING UPLOAD' };

function fmtBytes(bytes) {
  if (!bytes) return '—';
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export default function Recordings() {
  const admin = useSelector(selectCurrentAdmin) || {};
  const isManager = MGR.includes(admin.role);

  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);
  const [f, setF] = useState({ status: undefined, courseTitle: '', batchName: '', student: '', from: null, to: null });
  const [playing, setPlaying] = useState(null);
  const [uploadingId, setUploadingId] = useState(null);
  const [importingId, setImportingId] = useState(null);
  const [downloadingId, setDownloadingId] = useState(null);
  const [bulkImporting, setBulkImporting] = useState(false);
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
      if (url) setPlaying({ ...rec, url, provider: res.result.provider, downloadUrl: (res.result && res.result.downloadUrl) || null });
      else message.info(`Recording is ${rec.status.toLowerCase()}.`);
    } catch (e) {
      message.error('Not available.');
    }
  };

  // A pasted Google Drive/YouTube link (provider 'external') is never a raw
  // video file, so never downloadable. A BigBlueButton recording's
  // playbackUrl is its HTML "presentation" player page, not a raw file
  // either — downloadable only when the BBB server also exported a
  // video/podcast format (hasDownload, set by the backend off a separate
  // downloadUrl — see liveScope.js's listRecordings). 'mock'/Drive-import
  // rows are always downloadable once playable.
  const canDownload = (r) => r.canPlay && r.provider !== 'external' && (r.provider !== 'bigbluebutton' || r.hasDownload);
  const downloadRecording = async (rec) => {
    setDownloadingId(rec.id);
    try {
      const res = await lmsApi.recordingPlay(rec.id);
      const url = res && res.result && (res.result.downloadUrl || res.result.url);
      if (!url) {
        message.error(`Recording is ${rec.status.toLowerCase()}.`);
        return;
      }
      const a = document.createElement('a');
      a.href = url;
      a.download = `${(rec.className || 'recording').replace(/[^\w\- ]+/g, '').trim()}.mp4`;
      a.rel = 'noopener';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } catch (e) {
      message.error('Download failed.');
    } finally {
      setDownloadingId(null);
    }
  };
  // Manual upload only makes sense when there's no recorder doing it
  // automatically: AWAITING_UPLOAD (the mock provider's "class ended, no
  // recorder of its own" state) or FAILED (any provider, incl. BigBlueButton,
  // as a recovery fallback) or a stale AVAILABLE-with-no-video row that
  // pre-dates this flow. NOT_STARTED/RECORDING/PROCESSING mean either the
  // class hasn't happened yet or BBB is already recording/processing it —
  // showing "Upload recording" there would just be confusing.
  // An 'external' row (a pasted Drive/YouTube/etc. link) always stays
  // upload-eligible too, regardless of hasVideo — that link can go stale or
  // turn out to be unshared/unplayable, and uploading a real file straight
  // to the CRM's own storage (native <video>, no iframe/permissions
  // dependency) is the reliable fix, not re-pasting another external link.
  const canUpload = (r) =>
    (r.status === 'AWAITING_UPLOAD' || r.status === 'FAILED' || r.provider === 'external' || (r.status === 'AVAILABLE' && !r.hasVideo)) &&
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

  // Re-hosts a Drive-linked recording on the CRM's own server instead of
  // relying on Drive's /preview iframe (the "No preview available" failure
  // mode — depends on the viewer's own Google session/cookies, not actually
  // fixable from the sharing dialog alone). Background job on the backend;
  // this just kicks it off and lets the status column reflect PROCESSING.
  const importFromDrive = async (rec) => {
    setImportingId(rec.id);
    try {
      const res = await lmsApi.recordingImportDrive(rec.id);
      if (res && res.success === false) message.error(res.message || 'Import failed.');
      else {
        message.success((res && res.result && res.result.message) || 'Importing from Google Drive…');
        load();
      }
    } catch (e) {
      message.error('Import failed.');
    } finally {
      setImportingId(null);
    }
  };

  const canImportFromDrive = (r) => r.provider === 'external' && r.status !== 'PROCESSING';

  const importAllFromDrive = async () => {
    const targets = rows.filter(canImportFromDrive);
    if (!targets.length) return message.info('Nothing to import — no Drive-linked recordings here.');
    Modal.confirm({
      title: `Import ${targets.length} recording${targets.length > 1 ? 's' : ''} from Google Drive?`,
      content: 'Each one downloads and compresses in the background on the server, one at a time — this can take a while for a lot of classes.',
      onOk: async () => {
        setBulkImporting(true);
        let ok = 0;
        for (const r of targets) {
          try {
            await lmsApi.recordingImportDrive(r.id);
            ok += 1;
          } catch (e) {
            // keep going — report the tally at the end, per-row status still shows FAILED for any that don't make it
          }
        }
        setBulkImporting(false);
        message.success(`Started import for ${ok} of ${targets.length} recordings — watch the Status column.`);
        load();
      },
    });
  };

  // Backfill old recordings (Google Drive, etc.) a whole batch at a time —
  // paste "YYYY-MM-DD, <link>" one per line, each matched to that batch's
  // class scheduled on that date.
  const [bulkOpen, setBulkOpen] = useState(false);
  const [batchOptions, setBatchOptions] = useState([]);
  const [bulkBatchId, setBulkBatchId] = useState(null);
  const [bulkText, setBulkText] = useState('');
  const [bulkSaving, setBulkSaving] = useState(false);
  const [bulkResults, setBulkResults] = useState(null);

  const openBulk = async () => {
    setBulkResults(null);
    setBulkText('');
    setBulkOpen(true);
    try {
      const res = await request.list({ entity: 'batch', options: { items: 500, sortBy: 'name', sortValue: 1 } });
      setBatchOptions(((res && res.result) || []).map((b) => ({ value: b._id, label: b.name })));
    } catch (e) {
      message.error('Could not load batches.');
    }
  };
  const parseBulkLines = () =>
    bulkText
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const idx = line.indexOf(',');
        if (idx === -1) return { date: '', url: '', raw: line };
        return { date: line.slice(0, idx).trim(), url: line.slice(idx + 1).trim(), raw: line };
      });
  const submitBulk = async () => {
    if (!bulkBatchId) return message.warning('Pick a batch first.');
    const links = parseBulkLines();
    if (!links.length) return message.warning('Paste at least one "date, link" line.');
    setBulkSaving(true);
    try {
      const res = await lmsApi.batchBulkAttachRecordingLinks(bulkBatchId, links);
      const results = (res && res.result && res.result.results) || [];
      setBulkResults(results);
      const okCount = results.filter((r) => r.ok).length;
      if (okCount) load();
      message[okCount === results.length ? 'success' : 'warning'](`${okCount} of ${results.length} attached.`);
    } catch (e) {
      message.error('Bulk attach failed.');
    } finally {
      setBulkSaving(false);
    }
  };

  const columns = [
    {
      title: 'Class',
      dataIndex: 'className',
      render: (v, r) => (
        <div>
          <b>{v}</b>
          <div style={{ fontSize: 12, color: 'var(--hub-muted)' }}>{r.courseTitle} · {r.batchName}</div>
        </div>
      ),
    },
    { title: 'Instructor', dataIndex: 'teacherName', width: 140 },
    { title: 'Date', dataIndex: 'date', width: 120, render: (v) => (v ? new Date(v).toLocaleDateString() : '—') },
    { title: 'Duration', dataIndex: 'durationMin', width: 90, render: (v) => (v ? `${v} min` : '—') },
    { title: 'Size', dataIndex: 'sizeBytes', width: 90, render: (v) => fmtBytes(v) },
    { title: 'Status', dataIndex: 'status', width: 140, render: (v) => <Tag color={STATUS_COLOR[v] || 'default'}>{STATUS_LABEL[v] || v}</Tag> },
    ...(isManager
      ? [
          {
            title: 'Views',
            dataIndex: 'views',
            width: 70,
            render: (v, r) => (
              <Tooltip
                title={
                  r.viewerNames && r.viewerNames.length ? (
                    <div>
                      {r.viewerNames.map((n, i) => (
                        <div key={i}>{n}</div>
                      ))}
                    </div>
                  ) : (
                    'No one yet'
                  )
                }
              >
                <span style={{ cursor: 'default', textDecoration: 'underline dotted' }}>{v || 0}</span>
              </Tooltip>
            ),
          },
        ]
      : []),
    {
      title: '',
      width: 340,
      render: (_, r) => (
        <Space>
          <Button size="small" icon={<PlaySquareOutlined />} disabled={!r.canPlay} onClick={() => play(r)}>
            Watch
          </Button>
          {isManager && canDownload(r) && (
            <Button size="small" icon={<DownloadOutlined />} loading={downloadingId === r.id} onClick={() => downloadRecording(r)}>
              Download
            </Button>
          )}
          {canUpload(r) && (
            <Button size="small" icon={<UploadOutlined />} loading={uploadingId === r.id} onClick={() => askUpload(r)}>
              Upload recording
            </Button>
          )}
          {isManager && canImportFromDrive(r) && (
            <Button size="small" icon={<ExportOutlined />} loading={importingId === r.id} onClick={() => importFromDrive(r)}>
              Import from Drive
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
        <Space>
          {isManager && (
            <Button icon={<LinkOutlined />} onClick={openBulk}>Bulk attach recording links</Button>
          )}
          {isManager && (
            <Button icon={<ExportOutlined />} loading={bulkImporting} onClick={importAllFromDrive}>
              Import all from Drive
            </Button>
          )}
          <Button icon={<ReloadOutlined />} onClick={load}>Refresh</Button>
        </Space>
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
        pagination={{ defaultPageSize: 20, pageSizeOptions: ['20', '50', '100', '200'], showSizeChanger: true }}
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
            <span style={{ overflow: 'hidden', minWidth: 0 }}>
              <span
                style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: 600 }}
                title={playing ? playing.className : ''}
              >
                {playing ? playing.className : ''}
              </span>
              {playing && (
                <span style={{ fontSize: 12, fontWeight: 400, opacity: 0.75 }}>
                  {fmtBytes(playing.sizeBytes)}
                  {isManager ? ` · ${playing.views || 0} view${playing.views === 1 ? '' : 's'}` : ''}
                </span>
              )}
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
                  {isManager && canDownload(playing) && (
                    <Tooltip title="Download this recording">
                      <a href={playing.downloadUrl || playing.url} download={`${(playing.className || 'recording').replace(/[^\w\- ]+/g, '').trim()}.mp4`} rel="noopener">
                        <Button size="small" icon={<DownloadOutlined />}>Download</Button>
                      </a>
                    </Tooltip>
                  )}
                </>
              )}
              <Button size="small" onClick={() => setPlaying(null)}>Close</Button>
            </Space>
          </div>
        }
      >
        {playing && playing.url ? (
          // BBB's playback page and an 'external' link (Google Drive's
          // /preview, YouTube, etc. — see liveScope.js's
          // normalizeExternalRecordingUrl) are HTML pages, not raw video
          // streams, so they need an <iframe>; only our own hosted uploads
          // (provider 'mock'/'jitsi', a direct .mp4 file) play in <video>.
          playing.provider === 'bigbluebutton' || playing.provider === 'external' ? (
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

      <Modal
        title="Bulk attach recording links"
        open={bulkOpen}
        onCancel={() => setBulkOpen(false)}
        onOk={submitBulk}
        okText="Attach"
        confirmLoading={bulkSaving}
        width={640}
      >
        <Space direction="vertical" style={{ width: '100%' }} size={12}>
          <Select
            style={{ width: '100%' }}
            placeholder="Batch"
            showSearch
            optionFilterProp="label"
            value={bulkBatchId}
            onChange={setBulkBatchId}
            options={batchOptions}
          />
          <Input.TextArea
            rows={10}
            placeholder={'One class per line: YYYY-MM-DD, https://drive.google.com/...\n2026-07-01, https://drive.google.com/file/d/abc123/view\n2026-07-02, https://drive.google.com/file/d/def456/view'}
            value={bulkText}
            onChange={(e) => setBulkText(e.target.value)}
          />
          <Typography.Text type="secondary" style={{ fontSize: 12.5 }}>
            Each date is matched to that batch's class scheduled on that calendar day. A date with no class
            scheduled is reported below instead of silently skipped.
          </Typography.Text>
          {bulkResults && (
            <List
              size="small"
              bordered
              dataSource={bulkResults}
              style={{ maxHeight: 240, overflowY: 'auto' }}
              renderItem={(r) => (
                <List.Item>
                  {r.ok ? <CheckCircleOutlined style={{ color: '#389e0d' }} /> : <CloseCircleOutlined style={{ color: '#cf1322' }} />}
                  <span style={{ marginLeft: 8 }}>{r.date || '(blank)'}</span>
                  {!r.ok && <span style={{ marginLeft: 8, color: '#889' }}>{r.message}</span>}
                </List.Item>
              )}
            />
          )}
        </Space>
      </Modal>
    </div>
  );
}
