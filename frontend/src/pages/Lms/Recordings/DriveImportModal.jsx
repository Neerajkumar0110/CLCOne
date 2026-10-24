import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Modal, Select, Input, Button, Table, Tooltip, message } from 'antd';
import {
  GoogleOutlined, FolderOpenOutlined, SearchOutlined, CheckCircleFilled, CloudDownloadOutlined,
  DisconnectOutlined, VideoCameraOutlined, ReloadOutlined,
} from '@ant-design/icons';
import { request } from '@/request';
import lmsApi from '../api';
import './driveImport.css';

// Recordings → "Import from Drive": connect a Google account once, pick a
// batch, paste a Drive folder link — every video is matched to that batch's
// class by the date in its file name, shown for review, and the ticked ones
// are downloaded + compressed + published on the server (backend:
// lmsController/driveFolderImport.js).

const STATE = {
  ready: { label: 'Ready', tone: 'blue' },
  has_video: { label: 'Has video', tone: 'gray', tip: 'This class already has a recording — tick to replace it.' },
  imported: { label: 'Imported', tone: 'green' },
  processing: { label: 'Processing', tone: 'amber' },
  failed: { label: 'Failed', tone: 'red' },
  duplicate: { label: 'Same class', tone: 'gray', tip: 'Another video in this folder is going to this class — pick a different class to import this one too.' },
  no_class: { label: 'No class that day', tone: 'gray', tip: 'This batch has no class on the date in the file name — pick a class by hand to import it.' },
  no_date: { label: 'No date in name', tone: 'gray', tip: 'No date found in the file name — pick a class by hand to import it.' },
  future: { label: 'Class not held yet', tone: 'gray' },
};
const TICKABLE = new Set(['ready', 'has_video', 'failed']);

const fmtSize = (b) => (!b ? '' : b >= 1e9 ? `${(b / 1e9).toFixed(2)} GB` : `${Math.round(b / 1e6)} MB`);
const fmtLen = (s) => {
  if (!s) return '';
  const m = Math.round(s / 60);
  return m >= 60 ? `${Math.floor(m / 60)} hr ${m % 60} min` : `${m} min`;
};
const fmtDay = (k) => {
  if (!k) return '—';
  const [y, mo, d] = k.split('-').map(Number);
  return new Date(Date.UTC(y, mo - 1, d)).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });
};

export default function DriveImportModal({ open, onClose, onImported }) {
  const [conn, setConn] = useState(null);
  const [batches, setBatches] = useState([]);
  const [batchId, setBatchId] = useState(null);
  const [folderUrl, setFolderUrl] = useState('');
  const [scanning, setScanning] = useState(false);
  const [scan, setScan] = useState(null); // { folder, via, files, sessions }
  const [rows, setRows] = useState([]); // files with editable sessionId
  const [picked, setPicked] = useState([]);
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState({}); // fileId -> { status, failReason, sessionId }
  const pollRef = useRef(null);
  const doneRef = useRef(null);

  const loadConn = useCallback(async () => {
    const res = await lmsApi.driveStatus();
    if (res && res.success) setConn(res.result);
  }, []);

  useEffect(() => {
    if (!open) return;
    loadConn();
    request.list({ entity: 'batch', options: { items: 500, sortBy: 'name', sortValue: 1 } }).then((res) => {
      setBatches(((res && res.result) || []).map((b) => ({ value: b._id, label: b.name })));
    });
  }, [open, loadConn]);

  // OAuth popup result (backend googleController/callback.js, purpose google-drive)
  useEffect(() => {
    const handler = (e) => {
      if (!e.data || !String(e.data.type || '').startsWith('google-drive-')) return;
      if (e.data.type === 'google-drive-success') {
        message.success(`Google Drive connected${e.data.email ? ` — ${e.data.email}` : ''}.`);
        loadConn();
      } else message.error(e.data.message || 'Could not connect Google Drive.');
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, [loadConn]);

  const connect = async () => {
    const res = await lmsApi.driveConnect();
    const url = res && res.result && res.result.url;
    if (!url) return;
    window.open(url, 'drive-oauth', 'width=520,height=680');
  };
  const disconnect = () =>
    Modal.confirm({
      title: 'Disconnect Google Drive?',
      content: 'Videos already imported stay. Only folders shared as "Anyone with the link" can be scanned until you connect again.',
      onOk: async () => {
        await lmsApi.driveDisconnect();
        loadConn();
      },
    });

  const sessionsById = useMemo(() => new Map(((scan && scan.sessions) || []).map((s) => [s.id, s])), [scan]);

  const stateOf = useCallback(
    (row) => {
      const p = progress[row.fileId];
      if (p && p.sessionId === row.sessionId) {
        if (p.status === 'PROCESSING') return 'processing';
        if (p.status === 'AVAILABLE') return 'imported';
        if (p.status === 'FAILED') return 'failed';
      }
      if (!row.sessionId) return row.dateKey ? 'no_class' : 'no_date';
      const s = sessionsById.get(row.sessionId);
      if (!s) return 'no_class';
      if (!s.past) return 'future';
      const other = rows.find((r) => r.fileId !== row.fileId && r.sessionId === row.sessionId && (picked.includes(r.fileId) || r.claims));
      if (other && !picked.includes(row.fileId)) return 'duplicate';
      if (s.recordingStatus === 'PROCESSING') return 'processing';
      if (s.hasVideo) return 'has_video';
      return 'ready';
    },
    [progress, sessionsById, rows, picked]
  );

  const pollProgress = useCallback(async () => {
    if (!batchId) return;
    const res = await lmsApi.driveProgress(batchId);
    if (!(res && res.success)) return;
    const map = {};
    res.result.forEach((p) => (map[p.fileId] = p));
    setProgress(map);
    const busy = res.result.some((p) => p.status === 'PROCESSING');
    clearTimeout(pollRef.current);
    if (busy) pollRef.current = setTimeout(pollProgress, 6000);
    // refresh the Recordings list as each video finishes
    const doneNow = res.result.filter((p) => p.status !== 'PROCESSING').length;
    if (doneRef.current !== null && doneNow !== doneRef.current && onImported) onImported();
    doneRef.current = doneNow;
  }, [batchId, onImported]);
  useEffect(() => () => clearTimeout(pollRef.current), []);

  const doScan = async () => {
    if (!batchId) return message.warning('Pick a batch first.');
    if (!folderUrl.trim()) return message.warning('Paste the Google Drive folder link.');
    setScanning(true);
    try {
      const res = await lmsApi.driveScan(batchId, folderUrl.trim());
      if (!(res && res.success)) return;
      const r = res.result;
      setScan(r);
      // `claims`: the file the server matched first to its class
      const list = r.files.map((f) => ({ ...f, claims: !!f.sessionId && f.state !== 'duplicate' }));
      setRows(list);
      setPicked(list.filter((f) => f.state === 'ready').map((f) => f.fileId));
      setProgress({});
      doneRef.current = null;
      pollProgress();
    } finally {
      setScanning(false);
    }
  };

  const setSession = (fileId, sessionId) => {
    setRows((rs) => rs.map((r) => (r.fileId === fileId ? { ...r, sessionId: sessionId || null, claims: false } : r)));
    setPicked((p) => (sessionId ? (p.includes(fileId) ? p : [...p, fileId]) : p.filter((x) => x !== fileId)));
  };

  const doImport = async () => {
    const items = rows
      .filter((r) => picked.includes(r.fileId) && TICKABLE.has(stateOf(r)))
      .map((r) => ({ fileId: r.fileId, name: r.name, sessionId: r.sessionId, durationSec: r.durationSec }));
    if (!items.length) return message.warning('Tick at least one video.');
    const seen = new Set();
    if (items.some((i) => (seen.has(i.sessionId) ? true : (seen.add(i.sessionId), false)))) {
      return message.warning('Two ticked videos point to the same class — keep one per class.');
    }
    const replacing = items.filter((i) => (sessionsById.get(i.sessionId) || {}).hasVideo).length;
    const go = async () => {
      setImporting(true);
      try {
        const res = await lmsApi.driveImport(batchId, items);
        if (!(res && res.success)) return;
        message.success(res.result.message);
        (res.result.skipped || []).forEach((s) => message.warning(s.message));
        setPicked([]);
        onImported && onImported();
        pollProgress();
      } finally {
        setImporting(false);
      }
    };
    if (replacing) {
      Modal.confirm({
        title: `Replace ${replacing} existing recording${replacing > 1 ? 's' : ''}?`,
        content: 'Those classes already have a video. The one from Drive will take its place.',
        okText: 'Replace and import',
        onOk: go,
      });
    } else go();
  };

  const counts = useMemo(() => {
    const c = {};
    rows.forEach((r) => {
      const s = stateOf(r);
      c[s] = (c[s] || 0) + 1;
    });
    return c;
  }, [rows, stateOf]);
  const tickedCount = rows.filter((r) => picked.includes(r.fileId) && TICKABLE.has(stateOf(r))).length;

  const sessionOptions = useMemo(
    () =>
      ((scan && scan.sessions) || [])
        .filter((s) => s.past)
        .map((s) => ({
          value: s.id,
          label: `${fmtDay(s.dateKey)} · ${s.title}${s.hasVideo ? '  (has video)' : ''}`,
        })),
    [scan]
  );

  const columns = [
    {
      title: 'Video',
      dataIndex: 'name',
      render: (_, r) => (
        <div className="di-file">
          <VideoCameraOutlined className="di-file-ic" />
          <div className="di-file-txt">
            <div className="di-file-name" title={r.name}>{r.name}</div>
            <div className="di-file-meta">
              {[r.path && r.path.replace(/\/$/, ''), fmtSize(r.size), fmtLen(r.durationSec)].filter(Boolean).join(' · ') || ' '}
            </div>
          </div>
        </div>
      ),
    },
    { title: 'Date in name', dataIndex: 'dateKey', width: 130, render: (k) => <span className={k ? '' : 'di-muted'}>{fmtDay(k)}</span> },
    {
      title: 'Goes to class',
      width: 320,
      render: (_, r) => {
        const st = stateOf(r);
        const locked = st === 'processing' || st === 'imported';
        return (
          <Select
            className="di-class-select"
            size="small"
            showSearch
            allowClear
            disabled={locked}
            placeholder="Pick a class"
            value={r.sessionId || undefined}
            onChange={(v) => setSession(r.fileId, v)}
            options={sessionOptions}
            optionFilterProp="label"
            popupMatchSelectWidth={380}
          />
        );
      },
    },
    {
      title: 'Status',
      width: 150,
      render: (_, r) => {
        const st = stateOf(r);
        const meta = STATE[st] || { label: st, tone: 'gray' };
        const p = progress[r.fileId];
        const tip = st === 'failed' && p ? p.failReason : meta.tip;
        const pill = <span className={`di-pill di-${meta.tone}`}>{st === 'imported' && <CheckCircleFilled />} {meta.label}</span>;
        return tip ? <Tooltip title={tip}>{pill}</Tooltip> : pill;
      },
    },
  ];

  const close = () => {
    clearTimeout(pollRef.current);
    onClose();
  };

  return (
    <Modal open={open} onCancel={close} footer={null} width={1040} className="di-modal" destroyOnClose title={null}>
      <div className="di-head">
        <div className="di-head-ic"><CloudDownloadOutlined /></div>
        <div>
          <h3>Import recordings from Google Drive</h3>
          <p>Paste a folder link. Each video goes to the class on the date in its file name, then the server compresses it and publishes it.</p>
        </div>
      </div>

      <div className="di-step">
        <div className="di-step-no">1</div>
        <div className="di-step-body">
          <div className="di-step-title">Google account</div>
          {!conn ? (
            <div className="di-muted">Checking…</div>
          ) : conn.connected ? (
            <div className="di-conn">
              <span className="di-conn-ok"><GoogleOutlined /> Connected as <b>{conn.email}</b></span>
              <Button size="small" onClick={connect}>Change account</Button>
              <Button size="small" type="text" danger icon={<DisconnectOutlined />} onClick={disconnect}>Disconnect</Button>
              {conn.lastError && <div className="di-warn">{conn.lastError}</div>}
            </div>
          ) : (
            <div className="di-conn">
              <Button type="primary" icon={<GoogleOutlined />} onClick={connect} disabled={!conn.configured}>Connect Google Drive</Button>
              <span className="di-muted">
                {conn.configured
                  ? 'One time only: sign in with the account that can open the recordings folder. Without it, only folders shared as "Anyone with the link" work.'
                  : 'Google sign-in is not configured on the server.'}
              </span>
            </div>
          )}
        </div>
      </div>

      <div className="di-step">
        <div className="di-step-no">2</div>
        <div className="di-step-body">
          <div className="di-step-title">Batch and folder</div>
          <div className="di-form">
            <Select
              showSearch
              placeholder="Batch"
              value={batchId}
              onChange={(v) => {
                setBatchId(v);
                setScan(null);
                setRows([]);
              }}
              options={batches}
              optionFilterProp="label"
              className="di-batch"
            />
            <Input
              prefix={<FolderOpenOutlined />}
              placeholder="https://drive.google.com/drive/folders/…"
              value={folderUrl}
              onChange={(e) => setFolderUrl(e.target.value)}
              onPressEnter={doScan}
              className="di-url"
              allowClear
            />
            <Button type="primary" icon={<SearchOutlined />} loading={scanning} onClick={doScan}>
              Scan folder
            </Button>
          </div>
        </div>
      </div>

      {scan && (
        <div className="di-step di-step-last">
          <div className="di-step-no">3</div>
          <div className="di-step-body">
            <div className="di-results-head">
              <div>
                <div className="di-step-title">
                  {scan.folder.name ? <>“{scan.folder.name}”</> : 'Folder'} · {rows.length} video{rows.length === 1 ? '' : 's'}
                </div>
                <div className="di-chips">
                  {Object.entries(counts).map(([k, n]) => (
                    <span key={k} className={`di-chip di-${(STATE[k] || {}).tone || 'gray'}`}>{n} {(STATE[k] || { label: k }).label.toLowerCase()}</span>
                  ))}
                </div>
              </div>
              <Button size="small" icon={<ReloadOutlined />} onClick={doScan} loading={scanning}>Re-scan</Button>
            </div>
            <Table
              size="small"
              rowKey="fileId"
              className="di-table"
              columns={columns}
              dataSource={rows}
              pagination={rows.length > 50 ? { pageSize: 50, size: 'small' } : false}
              scroll={{ x: 820, y: 420 }}
              rowSelection={{
                selectedRowKeys: picked,
                onChange: (keys) => setPicked(keys),
                getCheckboxProps: (r) => ({ disabled: !TICKABLE.has(stateOf(r)) && !picked.includes(r.fileId) }),
              }}
              locale={{ emptyText: 'No videos in this folder.' }}
            />
            <div className="di-foot">
              <span className="di-muted">
                Videos are processed one at a time on the server and show as <b>Processing</b>, then <b>Available</b>. You can close this window.
              </span>
              <Button type="primary" size="large" icon={<CloudDownloadOutlined />} disabled={!tickedCount} loading={importing} onClick={doImport}>
                Import {tickedCount || ''} video{tickedCount === 1 ? '' : 's'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}
