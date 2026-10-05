import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Input, message, Popconfirm, Empty, Skeleton, Modal, Form, Checkbox } from 'antd';
import {
  FolderOpenOutlined, CloudUploadOutlined, LinkOutlined, FilePdfOutlined, FileImageOutlined,
  PlayCircleOutlined, FileOutlined, EyeOutlined, DownloadOutlined, DeleteOutlined, TagOutlined,
  TeamOutlined, BookOutlined, SearchOutlined,
} from '@ant-design/icons';
import { useSelector } from 'react-redux';
import dayjs from 'dayjs';
import { selectCurrentAdmin } from '@/redux/auth/selectors';
import { LMS_TEACHER_ROLES } from '@/config/roles';
import { request } from '@/request';
import lmsApi from '../api';

// Same "New record" modal look used everywhere else in the LMS (Announcements,
// Assignments, Projects) — see .crud-modal / .crud-form-grid in featureHub.css.
const Lbl = ({ icon, children }) => (
  <span className="crud-lbl"><span className="crud-lbl-icon">{icon}</span>{children}</span>
);

// Admin/Support reach this page embedded in the CRM's own LMS tab
// (ModuleScaffold's 'lmsStudyMaterial'), not just the dedicated Teacher
// panel — the backend's isManager() (liveScope.js, studyMaterial.js) already
// gives them full access to every batch's material, so they get the same
// manage view a teacher does rather than falling through to the student one.
const MGR = ['owner', 'Super Admin', 'Admin', 'Sales Manager', 'Support'];

const KIND_LABEL = { pdf: 'PDF', video: 'Video', image: 'Image', other: 'Other' };
const KIND_COLOR = { pdf: '#dc2626', video: '#7c3aed', image: '#059669', other: '#2563eb' };
const kindIcon = (m) => {
  if (m.sourceType === 'link') return <LinkOutlined />;
  if (m.kind === 'pdf') return <FilePdfOutlined />;
  if (m.kind === 'video') return <PlayCircleOutlined />;
  if (m.kind === 'image') return <FileImageOutlined />;
  return <FileOutlined />;
};

// Recursively walks one dropped filesystem entry (a FileSystemEntry from
// DataTransferItem.webkitGetAsEntry()) into a flat array of real File
// objects, stamping each with webkitRelativePath so a dropped folder
// produces the exact same shape uploadFiles() already expects from the
// native <input webkitdirectory> picker — "Folder/Sub/notes.pdf" either way.
function readEntryAsFiles(entry, pathPrefix = '') {
  return new Promise((resolve) => {
    if (!entry) return resolve([]);
    if (entry.isFile) {
      entry.file(
        (file) => {
          try {
            Object.defineProperty(file, 'webkitRelativePath', { value: pathPrefix + file.name, configurable: true });
          } catch (e) { /* non-fatal — title just falls back to the bare filename */ }
          resolve([file]);
        },
        () => resolve([])
      );
      return;
    }
    if (entry.isDirectory) {
      const reader = entry.createReader();
      const collected = [];
      // readEntries() only returns up to ~100 entries per call by spec —
      // must keep calling it until it returns an empty batch, not just once.
      const readNextBatch = () => {
        reader.readEntries((batch) => {
          if (!batch.length) {
            Promise.all(collected.map((e) => readEntryAsFiles(e, `${pathPrefix}${entry.name}/`))).then((groups) =>
              resolve(groups.flat())
            );
          } else {
            collected.push(...batch);
            readNextBatch();
          }
        }, () => resolve([]));
      };
      readNextBatch();
      return;
    }
    resolve([]);
  });
}

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

function FileCard({ m, canManage, onDelete, selectable, selected, onToggleSelect }) {
  return (
    <div className="material-file-card">
      <div className="material-file-left">
        {selectable && (
          <Checkbox
            checked={selected}
            onChange={() => onToggleSelect(m.id)}
            style={{ marginRight: 4 }}
            onClick={(e) => e.stopPropagation()}
          />
        )}
        <div className="material-pdf-icon" style={{ background: `${KIND_COLOR[m.kind]}1a`, color: KIND_COLOR[m.kind] }}>
          {kindIcon(m)}
        </div>
        <div className="material-file-details">
          <p className="material-file-name" title={m.title}>{m.title}</p>
          <div className="material-file-meta">
            <span>{m.sourceType === 'link' ? 'Link' : (KIND_LABEL[m.kind] || 'Other')}</span>
            {m.subject ? <span>· {m.subject}</span> : null}
            <span>· {m.course ? `${m.courseTitle} (whole course)` : m.batch}</span>
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

function useFilteredRows(rows, search, typeFilter, courseFilter) {
  return useMemo(() => {
    const s = search.trim().toLowerCase();
    return rows.filter((m) => {
      if (typeFilter !== 'all' && m.kind !== typeFilter) return false;
      if (courseFilter !== 'all' && m.course !== courseFilter) return false;
      if (s && !`${m.title} ${m.subject}`.toLowerCase().includes(s)) return false;
      return true;
    });
  }, [rows, search, typeFilter, courseFilter]);
}

function TeacherStudyMaterial() {
  const admin = useSelector(selectCurrentAdmin) || {};
  const isMgr = MGR.includes(admin.role);
  const [rows, setRows] = useState([]);
  const [batches, setBatches] = useState([]);
  const [courses, setCourses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');
  const [courseFilter, setCourseFilter] = useState('all');
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);
  // 'batch' uploads to one batch; 'course' uploads once and reaches every
  // batch of that course (including one added to it later) — see
  // studyMaterial.js's resolveScope on the backend.
  const [uploadScope, setUploadScope] = useState('batch');
  const [uploadBatch, setUploadBatch] = useState(undefined);
  const [uploadCourse, setUploadCourse] = useState(undefined);
  const [uploadSubject, setUploadSubject] = useState('');
  const [dragActive, setDragActive] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkForm] = Form.useForm();
  const fileInputRef = useRef(null);
  const folderInputRef = useRef(null);

  // webkitdirectory/directory aren't real React/HTML props — passing them
  // as JSX attributes (even as "") doesn't reliably flip Chrome/Edge into
  // directory-picker mode, so they have to be set directly on the DOM node.
  // A CALLBACK ref (not useRef + useEffect) — this component returns the
  // <Skeleton> below while `loading` is true, so the real input (and this
  // ref) doesn't exist on the very first render; a useEffect with [] only
  // fires once, right after that first (skeleton) render, while the ref is
  // still null — so it silently did nothing and this never got applied once
  // the real UI mounted. A callback ref instead fires exactly when the node
  // is actually created, whenever that is.
  const setFolderInputRef = useCallback((el) => {
    folderInputRef.current = el;
    if (el) {
      // Both the HTML attribute AND the DOM property — some Chromium builds
      // only honor whichever was set first/last depending on exact version,
      // so this covers it either way rather than picking one.
      el.setAttribute('webkitdirectory', '');
      el.setAttribute('directory', '');
      el.webkitdirectory = true;
      el.directory = true;
    }
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      // teacher/dashboard's `batches`/`courses` are scoped to "this teacher
      // trains/teaches" (Batch.trainer / Course.instructor ∪ batch-derived —
      // see isTeacherOfCourse) — for a manager (Admin/Support) that's empty,
      // since they're never themselves listed as a trainer/instructor, even
      // though the backend already lets them upload to any batch or course.
      // They get the full lists instead, same source Projects/Assignments use.
      const [m, d, courseList] = await Promise.all([
        lmsApi.materials(),
        isMgr ? request.list({ entity: 'batch', options: { items: 500, sortBy: 'name', sortValue: 1 } }) : lmsApi.teacherDashboard(),
        isMgr ? request.list({ entity: 'course', options: { items: 500, sortBy: 'title', sortValue: 1 } }) : null,
      ]);
      setRows((m && m.result) || []);
      const bOpts = isMgr
        ? ((d && d.result) || []).map((b) => ({ value: b.name, label: b.name }))
        : ((d && d.result && d.result.batches) || []).map((b) => ({ value: b.name, label: b.name }));
      setBatches(bOpts);
      if (!uploadBatch && bOpts.length === 1) setUploadBatch(bOpts[0].value);
      const cOpts = isMgr
        ? ((courseList && courseList.result) || []).map((c) => ({ value: c._id, label: c.title }))
        : ((d && d.result && d.result.courses) || []).map((c) => ({ value: c.id, label: c.title }));
      setCourses(cOpts);
      if (!uploadCourse && cOpts.length === 1) setUploadCourse(cOpts[0].value);
    } catch (e) { message.error('Could not load.'); } finally { setLoading(false); }
  }, [uploadBatch, uploadCourse, isMgr]);
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const filtered = useFilteredRows(rows, search, typeFilter, courseFilter);
  const stats = useMemo(() => ({
    total: rows.length,
    pdf: rows.filter((r) => r.kind === 'pdf').length,
    video: rows.filter((r) => r.kind === 'video').length,
    image: rows.filter((r) => r.kind === 'image').length,
    other: rows.filter((r) => r.kind === 'other').length,
  }), [rows]);

  // { batch: X } or { course: X } depending on the toggle — never both, see
  // the backend's resolveScope.
  const scopeField = () => (uploadScope === 'course' ? { course: uploadCourse } : { batch: uploadBatch });
  const scopePicked = () => (uploadScope === 'course' ? !!uploadCourse : !!uploadBatch);

  const uploadFiles = async (fileList) => {
    const files = Array.from(fileList || []);
    if (!files.length) return;
    if (!scopePicked()) { message.warning(`Pick a ${uploadScope} first.`); return; }
    setUploading(true);
    setProgress(0);
    let done = 0;
    let succeeded = 0;
    const failures = [];
    for (const file of files) {
      // A folder picker's FileList carries each file's path inside the
      // folder as webkitRelativePath (e.g. "ReactNative/Week1/notes.pdf") —
      // used as the title so a bulk folder upload stays distinguishable
      // instead of every file showing up just as "notes".
      const title = file.webkitRelativePath || undefined;
      // eslint-disable-next-line no-await-in-loop
      const res = await lmsApi.uploadMaterial(
        { ...scopeField(), subject: uploadSubject, title },
        file,
        (pct) => setProgress(Math.round(((done * 100) + pct) / files.length))
      );
      if (!res || res.success === false) failures.push((res && res.message) || 'Upload failed.');
      else succeeded += 1;
      done += 1;
    }
    setUploading(false);
    setProgress(0);
    // Previously this always claimed every file succeeded regardless of
    // what actually happened — a folder upload makes a partial failure far
    // more likely (one bad file in forty shouldn't look like success), so
    // report the real count and surface WHY the rest failed, grouped by
    // distinct error (antd's toast queue would otherwise just drop most of
    // forty individual "failed" toasts anyway).
    if (succeeded) message.success(`${succeeded} of ${files.length} file${files.length > 1 ? 's' : ''} uploaded.`);
    [...new Set(failures)].forEach((msg) => {
      const count = failures.filter((f) => f === msg).length;
      message.error(`${count} file${count > 1 ? 's' : ''} failed: ${msg}`, 6);
    });
    load();
  };

  const onDrop = (e) => {
    e.preventDefault();
    setDragActive(false);
    const items = e.dataTransfer.items;
    // A dropped FOLDER never shows up in dataTransfer.files — that only
    // ever lists plain files, same as what an <input type="file"> would see
    // if folders simply didn't exist. Recursing it needs the separate
    // DataTransferItem.webkitGetAsEntry() API (Chrome/Edge/Firefox), which
    // doesn't depend on the OS-level directory-picker dialog at all — so
    // this works even where "Upload Folder"'s native dialog quirks don't.
    if (items && items.length && typeof items[0].webkitGetAsEntry === 'function') {
      const entries = Array.from(items).map((it) => it.webkitGetAsEntry()).filter(Boolean);
      Promise.all(entries.map((en) => readEntryAsFiles(en))).then((groups) => uploadFiles(groups.flat()));
    } else {
      uploadFiles(e.dataTransfer.files);
    }
  };

  const submitLink = async () => {
    let v; try { v = await linkForm.validateFields(); } catch (e) { return; }
    if (!scopePicked()) { message.warning(`Pick a ${uploadScope} first.`); return; }
    const res = await lmsApi.addMaterialLink({ ...v, ...scopeField() });
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

  const toggleSelect = (id) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    setSelectedIds((prev) => (prev.size === filtered.length ? new Set() : new Set(filtered.map((m) => m.id))));
  };

  const deleteSelected = async () => {
    const ids = [...selectedIds];
    if (!ids.length) return;
    setBulkDeleting(true);
    let failed = 0;
    for (const id of ids) {
      // eslint-disable-next-line no-await-in-loop
      const res = await lmsApi.deleteMaterial(id);
      if (!res || res.success === false) failed += 1;
    }
    setBulkDeleting(false);
    setSelectedIds(new Set());
    if (failed) message.error(`${failed} of ${ids.length} couldn't be removed.`);
    else message.success(`${ids.length} file${ids.length > 1 ? 's' : ''} removed.`);
    load();
  };

  if (loading) return <Skeleton active paragraph={{ rows: 8 }} style={{ padding: 24 }} />;

  return (
    <div className="study-material-container" style={{ minHeight: 'auto', background: 'transparent', padding: 4 }}>
      <div className="study-material-header">
        <div>
          <h2 className="study-material-title"><FolderOpenOutlined /> Study Material</h2>
          <p className="study-material-subtitle">Upload and manage your study resources for candidates.</p>
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
          {courses.length > 0 && (
            <div className="hub-btn-group" style={{ flexShrink: 0 }}>
              <button
                type="button"
                className={`hub-btn${uploadScope === 'batch' ? ' selected' : ''}`}
                onClick={() => setUploadScope('batch')}
              >
                <TeamOutlined /> Batch
              </button>
              <button
                type="button"
                className={`hub-btn${uploadScope === 'course' ? ' selected' : ''}`}
                onClick={() => setUploadScope('course')}
              >
                <BookOutlined /> Course
              </button>
            </div>
          )}
          {uploadScope === 'course' ? (
            <select className="material-select" value={uploadCourse || ''} onChange={(e) => setUploadCourse(e.target.value || undefined)}>
              <option value="" disabled>Upload to course…</option>
              {courses.map((c) => (
                <option key={c.value} value={c.value} title={c.label}>{c.label}</option>
              ))}
            </select>
          ) : (
            <select className="material-select" value={uploadBatch || ''} onChange={(e) => setUploadBatch(e.target.value || undefined)}>
              <option value="" disabled>Upload to batch…</option>
              {batches.map((b) => (
                <option key={b.value} value={b.value} title={b.label}>{b.label}</option>
              ))}
            </select>
          )}
          <input
            className="material-input"
            placeholder="Subject (optional) — e.g. React Native"
            value={uploadSubject}
            onChange={(e) => setUploadSubject(e.target.value)}
          />
        </div>
        {uploadScope === 'course' && (
          <p style={{ fontSize: 12, color: '#667085', margin: '-10px 0 14px' }}>
            Uploaded once here, this reaches every batch of this course — including one added later — not just candidates currently enrolled.
          </p>
        )}

        <div
          className={`material-upload-area${dragActive ? ' drag-active' : ''}`}
          onClick={() => fileInputRef.current && fileInputRef.current.click()}
          onDragOver={(e) => { e.preventDefault(); setDragActive(true); }}
          onDragLeave={() => setDragActive(false)}
          onDrop={onDrop}
        >
          <div className="material-upload-icon"><CloudUploadOutlined /></div>
          <p className="material-upload-title">Upload Study Material</p>
          <p className="material-upload-description">Drag and drop files (or a whole folder) here, or <span>click to browse</span></p>
          <p className="material-file-info">Supported formats: PDF, DOC, DOCX, PPT, PPTX, JPG, PNG, ZIP (Max size: 50MB)</p>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="material-file-input"
            onChange={(e) => uploadFiles(e.target.files)}
          />
          {/* webkitdirectory/directory are set imperatively above (see the
              useEffect) — lets the native picker select a whole folder;
              every file inside (any depth) lands in the same change event
              with its path on webkitRelativePath. Chrome/Edge/Firefox
              support it; Safari falls back to a normal file picker. */}
          <input
            ref={setFolderInputRef}
            type="file"
            multiple
            className="material-file-input"
            onChange={(e) => uploadFiles(e.target.files)}
          />
          <div style={{ marginTop: 16, display: 'flex', gap: 10, flexWrap: 'wrap' }} onClick={(e) => e.stopPropagation()}>
            <button type="button" className="material-upload-btn" onClick={() => fileInputRef.current && fileInputRef.current.click()}>
              <CloudUploadOutlined /> Choose Files
            </button>
            <button
              type="button"
              className="material-upload-btn"
              style={{ background: '#fff', color: '#2563eb', border: '1px solid #bfdbfe' }}
              onClick={() => folderInputRef.current && folderInputRef.current.click()}
            >
              <FolderOpenOutlined /> Upload Folder
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
              {courses.length > 1 && (
                <select className="material-select-sm" value={courseFilter} onChange={(e) => setCourseFilter(e.target.value)}>
                  <option value="all">All Courses</option>
                  {courses.map((c) => <option key={c.value} value={c.value} title={c.label}>{c.label}</option>)}
                </select>
              )}
              <span className="uploaded-count">{filtered.length} file{filtered.length === 1 ? '' : 's'}</span>
            </div>
          </div>

          {filtered.length > 0 && (
            <div className="material-toolbar" style={{ marginBottom: 10 }}>
              <Checkbox
                checked={filtered.length > 0 && selectedIds.size === filtered.length}
                indeterminate={selectedIds.size > 0 && selectedIds.size < filtered.length}
                onChange={toggleSelectAll}
              >
                Select all
              </Checkbox>
              {selectedIds.size > 0 && (
                <Popconfirm
                  title={`Remove ${selectedIds.size} selected file${selectedIds.size > 1 ? 's' : ''}?`}
                  onConfirm={deleteSelected}
                  okText="Remove"
                  okButtonProps={{ danger: true, loading: bulkDeleting }}
                >
                  <button type="button" className="material-upload-btn" style={{ background: '#fef2f2', color: '#dc2626', border: '1px solid #fecaca' }} disabled={bulkDeleting}>
                    <DeleteOutlined /> Delete selected ({selectedIds.size})
                  </button>
                </Popconfirm>
              )}
            </div>
          )}

          {filtered.length === 0 ? (
            <div className="material-empty-state"><p>No study material uploaded yet.</p></div>
          ) : (
            filtered.map((m) => (
              <FileCard
                key={m.id}
                m={m}
                canManage
                onDelete={onDelete}
                selectable
                selected={selectedIds.has(m.id)}
                onToggleSelect={toggleSelect}
              />
            ))
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
              <TeamOutlined /> Will be added to {uploadScope === 'course' ? 'course' : 'batch'}:{' '}
              <b>
                {uploadScope === 'course'
                  ? (courses.find((c) => c.value === uploadCourse)?.label || `— pick a course above first —`)
                  : (uploadBatch || '— pick a batch above first —')}
              </b>
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
          <p className="study-material-subtitle">Resources shared by your instructor.</p>
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
  return MGR.includes(admin.role) || LMS_TEACHER_ROLES.includes(admin.role) ? <TeacherStudyMaterial /> : <StudentStudyMaterial />;
}
