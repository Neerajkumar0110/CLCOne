import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Input, message, Popconfirm, Empty, Skeleton, Modal, Form } from 'antd';
import {
  FolderOpenOutlined, CloudUploadOutlined, LinkOutlined, FilePdfOutlined, FileImageOutlined,
  PlayCircleOutlined, FileOutlined, EyeOutlined, DownloadOutlined, DeleteOutlined, TagOutlined,
  TeamOutlined, BookOutlined, SearchOutlined,
} from '@ant-design/icons';
import { useSelector } from 'react-redux';
import dayjs from 'dayjs';
import { selectCurrentAdmin } from '@/redux/auth/selectors';
import { LMS_TEACHER_ROLES } from '@/config/roles';
import lmsApi from '../api';

// Same "New record" modal look used everywhere else in the LMS (Announcements,
// Assignments, Projects) — see .crud-modal / .crud-form-grid in featureHub.css.
const Lbl = ({ icon, children }) => (
  <span className="crud-lbl"><span className="crud-lbl-icon">{icon}</span>{children}</span>
);

const KIND_LABEL = { pdf: 'PDF', video: 'Video', image: 'Image', other: 'Other' };
const KIND_COLOR = { pdf: '#dc2626', video: '#7c3aed', image: '#059669', other: '#2563eb' };
const kindIcon = (m) => {
  if (m.sourceType === 'link') return <LinkOutlined />;
  if (m.kind === 'pdf') return <FilePdfOutlined />;
  if (m.kind === 'video') return <PlayCircleOutlined />;
  if (m.kind === 'image') return <FileImageOutlined />;
  return <FileOutlined />;
};

function fmtSize(bytes) {
  if (!bytes) return '—';
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function StatCard({ icon, color, label, value }) {
  return (
    <div style={{ flex: '1 1 150px', background: '#fff', border: '1px solid #e5e7eb', borderRadius: 14, padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 12, boxShadow: '0 4px 18px rgba(15,23,42,.04)' }}>
      <div style={{ width: 42, height: 42, borderRadius: 11, background: `${color}1a`, color, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, flexShrink: 0 }}>{icon}</div>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: .3 }}>{label}</div>
        <div style={{ fontSize: 20, fontWeight: 800, color: '#111827' }}>{value}</div>
      </div>
    </div>
  );
}

function FileCard({ m, canManage, onDelete }) {
  return (
    <div className="material-file-card">
      <div className="material-file-left">
        <div className="material-pdf-icon" style={{ background: `${KIND_COLOR[m.kind]}1a`, color: KIND_COLOR[m.kind] }}>
          {kindIcon(m)}
        </div>
        <div className="material-file-details">
          <p className="material-file-name" title={m.title}>{m.title}</p>
          <div className="material-file-meta">
            <span>{m.sourceType === 'link' ? 'Link' : (KIND_LABEL[m.kind] || 'Other')}</span>
            {m.subject ? <span>· {m.subject}</span> : null}
            <span>· {m.batch}</span>
            <span>· {m.teacherName}</span>
            <span>· {dayjs(m.uploadedAt).format('D MMM, HH:mm')}</span>
            {m.sourceType === 'file' ? <span>· {fmtSize(m.sizeBytes)}</span> : null}
          </div>
        </div>
      </div>
      <div className="material-file-actions">
        <a className="material-view-btn" href={m.fileUrl} target="_blank" rel="noreferrer" title="View"><EyeOutlined /></a>
        {m.sourceType === 'file' && (
          <a className="material-download-btn" href={m.fileUrl} download title="Download"><DownloadOutlined /></a>
        )}
        {canManage && (
          <Popconfirm title="Remove this material?" onConfirm={() => onDelete(m.id)} okText="Remove" okButtonProps={{ danger: true }}>
            <button type="button" className="material-delete-btn" title="Delete"><DeleteOutlined /></button>
          </Popconfirm>
        )}
      </div>
    </div>
  );
}

function useFilteredRows(rows, search, typeFilter, batchFilter) {
  return useMemo(() => {
    const s = search.trim().toLowerCase();
    return rows.filter((m) => {
      if (typeFilter !== 'all' && m.kind !== typeFilter) return false;
      if (batchFilter !== 'all' && m.batch !== batchFilter) return false;
      if (s && !`${m.title} ${m.subject}`.toLowerCase().includes(s)) return false;
      return true;
    });
  }, [rows, search, typeFilter, batchFilter]);
}

function TeacherStudyMaterial() {
  const [rows, setRows] = useState([]);
  const [batches, setBatches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');
  const [batchFilter, setBatchFilter] = useState('all');
  const [uploadBatch, setUploadBatch] = useState(undefined);
  const [uploadSubject, setUploadSubject] = useState('');
  const [dragActive, setDragActive] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkForm] = Form.useForm();
  const fileInputRef = useRef(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [m, d] = await Promise.all([lmsApi.materials(), lmsApi.teacherDashboard()]);
      setRows((m && m.result) || []);
      const bOpts = ((d && d.result && d.result.batches) || []).map((b) => ({ value: b.name, label: b.name }));
      setBatches(bOpts);
      if (!uploadBatch && bOpts.length === 1) setUploadBatch(bOpts[0].value);
    } catch (e) { message.error('Could not load.'); } finally { setLoading(false); }
  }, [uploadBatch]);
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const filtered = useFilteredRows(rows, search, typeFilter, batchFilter);
  const stats = useMemo(() => ({
    total: rows.length,
    pdf: rows.filter((r) => r.kind === 'pdf').length,
    video: rows.filter((r) => r.kind === 'video').length,
    image: rows.filter((r) => r.kind === 'image').length,
    other: rows.filter((r) => r.kind === 'other').length,
  }), [rows]);

  const uploadFiles = async (fileList) => {
    const files = Array.from(fileList || []);
    if (!files.length) return;
    if (!uploadBatch) { message.warning('Pick a batch first.'); return; }
    setUploading(true);
    setProgress(0);
    let done = 0;
    for (const file of files) {
      // eslint-disable-next-line no-await-in-loop
      const res = await lmsApi.uploadMaterial(
        { batch: uploadBatch, subject: uploadSubject },
        file,
        (pct) => setProgress(Math.round(((done * 100) + pct) / files.length))
      );
      if (!res || res.success === false) message.error((res && res.message) || `Failed to upload ${file.name}`);
      done += 1;
    }
    setUploading(false);
    setProgress(0);
    message.success(`${files.length} file${files.length > 1 ? 's' : ''} uploaded.`);
    load();
  };

  const onDrop = (e) => {
    e.preventDefault();
    setDragActive(false);
    uploadFiles(e.dataTransfer.files);
  };

  const submitLink = async () => {
    let v; try { v = await linkForm.validateFields(); } catch (e) { return; }
    if (!uploadBatch) { message.warning('Pick a batch first.'); return; }
    const res = await lmsApi.addMaterialLink({ ...v, batch: uploadBatch });
    if (!res || res.success === false) { message.error((res && res.message) || 'Could not add link.'); return; }
    message.success('Link added.');
    setLinkOpen(false);
    linkForm.resetFields();
    load();
  };

  const onDelete = async (id) => {
    const res = await lmsApi.deleteMaterial(id);
    if (!res || res.success === false) { message.error((res && res.message) || 'Could not remove.'); return; }
    load();
  };

  if (loading) return <Skeleton active paragraph={{ rows: 8 }} style={{ padding: 24 }} />;

  return (
    <div className="study-material-container" style={{ minHeight: 'auto', background: 'transparent', padding: 4 }}>
      <div className="study-material-header">
        <div>
          <h2 className="study-material-title"><FolderOpenOutlined /> Study Material</h2>
          <p className="study-material-subtitle">Upload and manage your study resources for students.</p>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 20 }}>
        <StatCard icon={<FolderOpenOutlined />} color="#2563eb" label="Total Files" value={stats.total} />
        <StatCard icon={<FilePdfOutlined />} color="#dc2626" label="PDFs" value={stats.pdf} />
        <StatCard icon={<PlayCircleOutlined />} color="#7c3aed" label="Videos" value={stats.video} />
        <StatCard icon={<FileImageOutlined />} color="#059669" label="Images" value={stats.image} />
        <StatCard icon={<LinkOutlined />} color="#d97706" label="Other Files" value={stats.other} />
      </div>

      <div className="study-material-card">
        <div className="material-toolbar" style={{ marginBottom: 16 }}>
          <select className="material-select" value={uploadBatch || ''} onChange={(e) => setUploadBatch(e.target.value || undefined)}>
            <option value="" disabled>Upload to batch…</option>
            {batches.map((b) => (
              <option key={b.value} value={b.value} title={b.label}>{b.label}</option>
            ))}
          </select>
          <input
            className="material-input"
            placeholder="Subject (optional) — e.g. React Native"
            value={uploadSubject}
            onChange={(e) => setUploadSubject(e.target.value)}
          />
        </div>

        <div
          className={`material-upload-area${dragActive ? ' drag-active' : ''}`}
          onClick={() => fileInputRef.current && fileInputRef.current.click()}
          onDragOver={(e) => { e.preventDefault(); setDragActive(true); }}
          onDragLeave={() => setDragActive(false)}
          onDrop={onDrop}
        >
          <div className="material-upload-icon"><CloudUploadOutlined /></div>
          <p className="material-upload-title">Upload Study Material</p>
          <p className="material-upload-description">Drag and drop files here or <span>click to browse</span></p>
          <p className="material-file-info">Supported formats: PDF, DOC, DOCX, PPT, PPTX, JPG, PNG, ZIP (Max size: 50MB)</p>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="material-file-input"
            onChange={(e) => uploadFiles(e.target.files)}
          />
          <div style={{ marginTop: 16, display: 'flex', gap: 10 }} onClick={(e) => e.stopPropagation()}>
            <button type="button" className="material-upload-btn" onClick={() => fileInputRef.current && fileInputRef.current.click()}>
              <CloudUploadOutlined /> Choose Files
            </button>
            <button
              type="button"
              className="material-upload-btn"
              style={{ background: '#fff', color: '#2563eb', border: '1px solid #bfdbfe' }}
              onClick={() => { linkForm.resetFields(); setLinkOpen(true); }}
            >
              <LinkOutlined /> Paste URL
            </button>
          </div>

          {uploading && (
            <div className="material-upload-progress" style={{ width: '100%', maxWidth: 360 }} onClick={(e) => e.stopPropagation()}>
              <div className="material-progress-header"><span>Uploading…</span><span>{progress}%</span></div>
              <div className="material-progress-bar"><div className="material-progress-fill" style={{ width: `${progress}%` }} /></div>
            </div>
          )}
        </div>

        <div className="uploaded-material-section">
          <div className="uploaded-material-heading">
            <h3>Uploaded Files</h3>
            <div className="material-toolbar">
              <div className="material-search-box">
                <SearchOutlined />
                <input
                  className="material-input"
                  placeholder="Search files by name or subject…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
              <select className="material-select-sm" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
                <option value="all">All Types</option>
                <option value="pdf">PDF</option>
                <option value="video">Video</option>
                <option value="image">Image</option>
                <option value="other">Other</option>
              </select>
              {batches.length > 1 && (
                <select className="material-select-sm" value={batchFilter} onChange={(e) => setBatchFilter(e.target.value)}>
                  <option value="all">All Batches</option>
                  {batches.map((b) => <option key={b.value} value={b.value} title={b.label}>{b.label}</option>)}
                </select>
              )}
              <span className="uploaded-count">{filtered.length} file{filtered.length === 1 ? '' : 's'}</span>
            </div>
          </div>

          {filtered.length === 0 ? (
            <div className="material-empty-state"><p>No study material uploaded yet.</p></div>
          ) : (
            filtered.map((m) => <FileCard key={m.id} m={m} canManage onDelete={onDelete} />)
          )}
        </div>
      </div>

      <Modal
        className="crud-modal"
        open={linkOpen}
        title={
          <span className="crud-modal-title">
            <span className="crud-modal-title-icon"><LinkOutlined /></span>
            <span>
              <span className="crud-modal-title-kicker">New record</span>
              <span className="crud-modal-title-main">Paste a link</span>
            </span>
          </span>
        }
        onCancel={() => setLinkOpen(false)}
        onOk={submitLink}
        okText="Add link"
        destroyOnClose
        maskClosable={false}
        width={520}
      >
        <Form form={linkForm} layout="vertical" preserve={false} className="crud-form">
          <div className="crud-form-grid">
            <Form.Item name="title" label={<Lbl icon={<TagOutlined />}>Title</Lbl>} className="crud-form-full">
              <Input placeholder="e.g. Recorded session — YouTube" />
            </Form.Item>
            <Form.Item name="subject" label={<Lbl icon={<BookOutlined />}>Subject</Lbl>} className="crud-form-full">
              <Input placeholder="e.g. React Native" />
            </Form.Item>
            <Form.Item name="url" label={<Lbl icon={<LinkOutlined />}>URL</Lbl>} rules={[{ required: true, message: 'URL is required' }]} className="crud-form-full">
              <Input placeholder="https://…" />
            </Form.Item>
            <div className="crud-form-full" style={{ fontSize: 12, color: '#667085' }}>
              <TeamOutlined /> Will be added to batch: <b>{uploadBatch || '— pick a batch above first —'}</b>
            </div>
          </div>
        </Form>
      </Modal>
    </div>
  );
}

function StudentStudyMaterial() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');

  useEffect(() => {
    lmsApi.myMaterials().then((r) => setRows((r && r.result) || [])).catch(() => message.error('Load failed')).finally(() => setLoading(false));
  }, []);

  const filtered = useFilteredRows(rows, search, typeFilter, 'all');
  const stats = useMemo(() => ({
    total: rows.length,
    pdf: rows.filter((r) => r.kind === 'pdf').length,
    video: rows.filter((r) => r.kind === 'video').length,
    image: rows.filter((r) => r.kind === 'image').length,
    other: rows.filter((r) => r.kind === 'other').length,
  }), [rows]);

  if (loading) return <Skeleton active paragraph={{ rows: 8 }} style={{ padding: 24 }} />;

  return (
    <div className="study-material-container" style={{ minHeight: 'auto', background: 'transparent', padding: 4 }}>
      <div className="study-material-header">
        <div>
          <h2 className="study-material-title"><FolderOpenOutlined /> Study Material</h2>
          <p className="study-material-subtitle">Resources shared by your teacher.</p>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 20 }}>
        <StatCard icon={<FolderOpenOutlined />} color="#2563eb" label="Total Files" value={stats.total} />
        <StatCard icon={<FilePdfOutlined />} color="#dc2626" label="PDFs" value={stats.pdf} />
        <StatCard icon={<PlayCircleOutlined />} color="#7c3aed" label="Videos" value={stats.video} />
        <StatCard icon={<FileImageOutlined />} color="#059669" label="Images" value={stats.image} />
        <StatCard icon={<LinkOutlined />} color="#d97706" label="Other Files" value={stats.other} />
      </div>

      <div className="study-material-card">
        <div className="uploaded-material-section" style={{ marginTop: 0 }}>
          <div className="uploaded-material-heading">
            <h3>Files</h3>
            <div className="material-toolbar">
              <div className="material-search-box">
                <SearchOutlined />
                <input
                  className="material-input"
                  placeholder="Search files by name or subject…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
              <select className="material-select-sm" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
                <option value="all">All Types</option>
                <option value="pdf">PDF</option>
                <option value="video">Video</option>
                <option value="image">Image</option>
                <option value="other">Other</option>
              </select>
              <span className="uploaded-count">{filtered.length} file{filtered.length === 1 ? '' : 's'}</span>
            </div>
          </div>

          {filtered.length === 0 ? (
            rows.length === 0
              ? <Empty description="No study material has been shared yet." />
              : <div className="material-empty-state"><p>No files match your search.</p></div>
          ) : (
            filtered.map((m) => <FileCard key={m.id} m={m} canManage={false} />)
          )}
        </div>
      </div>
    </div>
  );
}

export default function StudyMaterial() {
  const admin = useSelector(selectCurrentAdmin) || {};
  return LMS_TEACHER_ROLES.includes(admin.role) ? <TeacherStudyMaterial /> : <StudentStudyMaterial />;
}
