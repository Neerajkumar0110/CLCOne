import React, { useCallback, useEffect, useState } from 'react';
import {
  Card, Table, Tag, Button, Modal, Form, Input, InputNumber, Select, Checkbox, Space, Empty, Skeleton, message, Typography, Row, Col, Tooltip, AutoComplete,
} from 'antd';
import {
  TrophyOutlined, SafetyCertificateOutlined, ReloadOutlined, DownloadOutlined, TeamOutlined,
  LockOutlined, CheckCircleFilled, ClockCircleOutlined, FileDoneOutlined, EyeOutlined,
  SendOutlined, UploadOutlined, FilePdfOutlined, MailOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import { useSelector } from 'react-redux';
import { useNavigate } from 'react-router-dom';
import { selectCurrentAdmin } from '@/redux/auth/selectors';
import { LMS_TEACHER_ROLES } from '@/config/roles';
import { usePermission } from '@/context/permissionContext';
import { request } from '@/request';
import { BASE_URL } from '@/config/serverApiConfig';
import lmsApi from '../api';
import '../components/LearnerDesign.css';
import { tablePagination } from '../components/ui';

const { Text, Paragraph, Title } = Typography;
const MGR = ['owner', 'Super Admin', 'Admin', 'Sales Manager', 'Support'];

function slug(s) {
  return String(s || 'certificate').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

// Admin/Super Admin/Support/Sales Manager/owner + Teacher — "which batches
// exist, who's in them, who's actually earned a certificate yet" (per-batch
// headcount + roster), reading services/lms/certificatePdf's same
// Issued/Sent gate the student-facing download uses.
function BatchRoster() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(() => new Set());
  const [q, setQ] = useState('');
  const load = useCallback(() => {
    setLoading(true);
    lmsApi.certificateRoster().then((r) => setRows((r && r.result) || [])).catch(() => message.error('Roster load failed')).finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(); }, [load]);

  if (loading) return <Skeleton active paragraph={{ rows: 3 }} />;
  if (!rows.length) return <Empty description="No candidates yet." />;

  // real batches first (A–Z), then test batches, then candidates with no batch
  const kind = (r) => (!r.batch || r.batch === '—' ? 2 : /^QA[-_ ]/i.test(r.batch) ? 1 : 0);
  const sorted = [...rows].sort((x, y) => kind(x) - kind(y) || String(x.batch).localeCompare(String(y.batch)));
  const oneCourse = new Set(rows.map((r) => r.course)).size === 1 ? rows[0].course : null;
  const total = rows.reduce((n, r) => n + r.total, 0);
  const done = rows.reduce((n, r) => n + r.completed, 0);
  const term = q.trim().toLowerCase();
  const match = (st) => !term || [st.name, st.email].some((v) => String(v || '').toLowerCase().includes(term));
  const shown = sorted
    .map((r) => ({ ...r, list: r.students.filter(match) }))
    .filter((r) => !term || r.list.length || String(r.batch).toLowerCase().includes(term));
  const toggle = (k) => setOpen((o) => { const n = new Set(o); n.has(k) ? n.delete(k) : n.add(k); return n; });

  return (
    <div className="cr">
      <div className="cr-top">
        <div className="cr-stats">
          <div><b>{rows.filter((r) => kind(r) !== 2).length}</b><span>Batches</span></div>
          <div><b>{total}</b><span>Candidates</span></div>
          <div className="ok"><b>{done}</b><span>Completed</span></div>
          <div className="wait"><b>{total - done}</b><span>Still learning</span></div>
        </div>
        <Input allowClear className="cr-search" placeholder="Search a candidate or batch" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      {oneCourse && <div className="cr-course">All candidates are on <b>{oneCourse}</b></div>}

      <div className="cr-list">
        {shown.map((r) => {
          const k = r.batch;
          const isOpen = open.has(k) || !!term;
          const pct = r.total ? Math.round((r.completed / r.total) * 100) : 0;
          const label = kind(r) === 2 ? 'No batch assigned' : r.batch;
          return (
            <div key={k} className={`cr-batch ${isOpen ? 'open' : ''}`}>
              <button type="button" className="cr-head" aria-expanded={isOpen} onClick={() => toggle(k)}>
                <span className={`cr-ico k${kind(r)}`}>{kind(r) === 2 ? '?' : String(label).slice(0, 2).toUpperCase()}</span>
                <span className="cr-name">
                  <b title={label}>{label}</b>
                  <small>
                    {kind(r) === 1 && <em className="cr-tag">Test</em>}
                    {r.total} candidate{r.total === 1 ? '' : 's'}
                    {!oneCourse && r.course ? ` · ${r.course}` : ''}
                  </small>
                </span>
                <span className="cr-done">
                  <span className="cr-bar" aria-hidden="true"><i style={{ width: `${pct}%` }} /></span>
                  <span className={r.completed === r.total ? 'all' : ''}>{r.completed}/{r.total} completed</span>
                </span>
                <span className="cr-chev" aria-hidden="true">›</span>
              </button>
              {isOpen && (
                <div className="cr-body">
                  {r.list.length === 0 && <div className="cr-empty">No candidate matches “{q}”.</div>}
                  {r.list.map((st) => (
                    <div key={st.email || st.name} className="cr-row">
                      <span className="cr-av">{String(st.name || '?').trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase()}</span>
                      <span className="cr-who">
                        <b>{st.name}</b>
                        <small>{st.email}</small>
                      </span>
                      <span className="cr-prog">
                        <span className="cr-bar" aria-hidden="true"><i style={{ width: `${Math.min(100, st.progress || 0)}%` }} /></span>
                        <small>{st.progress || 0}% done</small>
                      </span>
                      <span className="cr-status">{st.status ? <Tag>{st.status}</Tag> : null}</span>
                      <span className="cr-cert">
                        {st.certificate ? (
                          <>
                            <Tag color="gold" icon={<SafetyCertificateOutlined />}>{st.certificate.certificateId}{st.certificate.grade ? ` · ${st.certificate.grade}` : ''}</Tag>
                            <Button size="small" icon={<DownloadOutlined />} onClick={() => lmsApi.downloadCertificatePdf(st.certificate.id, false, slug(`${st.name}-${st.certificate.certificateId}`))}>PDF</Button>
                          </>
                        ) : (
                          <span className="cr-not">{st.eligible ? 'Ready to issue' : 'Not earned yet'}</span>
                        )}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// isManagerRole: Admin/Super Admin/Support/Sales Manager/owner aren't a
// trainer on anything, so teacherDashboard()'s "my own courses" list always
// comes back empty for them (same gap fixed earlier for Assignments/
// AssessmentDashboard) — they instead get every course in the system.
// Give anyone a certificate (user ask 2026-11-24): name + email, then either
// our certificate template for the chosen internship with the name filled in,
// or any PDF uploaded here. It is emailed from Career Lab with the PDF attached
// and lands in Issued certificates (ID + verify link). Managers only.
// Name / email box with learner suggestions from the first letters (LMS testing
// report #34) — picking one fills both. Free text still works (anyone can get one).
function LearnerAuto({ value, field, onText, onPick, placeholder, status }) {
  const [opts, setOpts] = useState([]);
  const timer = React.useRef(null);
  const search = (q) => {
    onText(q);
    clearTimeout(timer.current);
    if (String(q || '').trim().length < 2) return setOpts([]);
    timer.current = setTimeout(async () => {
      const r = await request.get({ entity: `lms/announcements/learners?q=${encodeURIComponent(q.trim())}` }).catch(() => null);
      const rows = (r && r.success && r.result) || [];
      setOpts(rows.map((p) => ({ value: `${p.id}`, label: <span><b>{p.name}</b> <span style={{ color: '#64748b' }}>· {p.email}</span></span>, p })));
    }, 250);
  };
  return (
    <AutoComplete
      value={value}
      options={opts}
      onSearch={search}
      onChange={(v, o) => { if (!o || !o.p) onText(v); }}
      onSelect={(v, o) => { if (o && o.p) onPick(o.p); }}
      style={{ width: '100%' }}
      status={status}
    >
      <Input prefix={field === 'email' ? <MailOutlined /> : undefined} placeholder={placeholder} maxLength={field === 'name' ? 80 : 120} />
    </AutoComplete>
  );
}

function SendCertificateCard({ courses, courseId, onSent }) {
  const [f, setF] = useState({ name: '', email: '', course: courseId || null, title: 'Certificate of Completion', mode: 'template' });
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(null);
  // preview of the uploaded PDF + pages taken out (server trims: pdf-pages)
  const [pages, setPages] = useState({ total: 0, removed: [], url: '', loading: false, error: '', template: null });
  const preview = useCallback(async (fl, removed) => {
    setPages((p) => ({ ...p, removed, loading: true, error: '' }));
    const r = await lmsApi.certificatePdfPages(fl, removed, nameRef.current).catch((e) => ({ success: false, message: e?.response?.data?.message || e.message }));
    if (!r?.success) {
      setPages((p) => ({ ...p, loading: false, error: r?.message || 'Preview failed.' }));
      return;
    }
    const bin = atob(r.result.pdf);
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i += 1) arr[i] = bin.charCodeAt(i);
    const url = URL.createObjectURL(new Blob([arr], { type: 'application/pdf' }));
    setPages((p) => {
      if (p.url) URL.revokeObjectURL(p.url);
      return { total: r.result.total, removed, url, loading: false, error: '', template: r.result.template || null };
    });
  }, []);
  // the preview prints the typed name (on our own template) — refresh it when the name settles
  const nameRef = React.useRef('');
  nameRef.current = f.name.trim();
  useEffect(() => {
    if (!file || f.mode !== 'upload') return undefined;
    const t = setTimeout(() => preview(file, pages.removed), 600);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [f.name]);
  const pickFile = (fl) => {
    setFile(fl);
    setPages((p) => {
      if (p.url) URL.revokeObjectURL(p.url);
      return { total: 0, removed: [], url: '', loading: false, error: '' };
    });
    if (fl) preview(fl, []);
  };
  const togglePage = (n) => {
    const removed = pages.removed.includes(n) ? pages.removed.filter((x) => x !== n) : [...pages.removed, n].sort((x, y) => x - y);
    if (removed.length >= pages.total) return message.warning('A certificate needs at least one page.');
    preview(file, removed);
  };
  useEffect(() => {
    setF((x) => (x.course ? x : { ...x, course: courseId || null }));
  }, [courseId]);
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email.trim());
  const ready = f.name.trim() && emailOk && (f.mode === 'upload' ? !!file : !!f.course);

  const send = async () => {
    if (!ready || busy) return;
    setBusy(true);
    setDone(null);
    const courseName = (courses.find((c) => c.value === f.course) || {}).label;
    const r = await lmsApi
      .sendCertificate({
        name: f.name.trim(),
        email: f.email.trim(),
        title: f.title.trim(),
        course: f.course || undefined,
        courseName: f.mode === 'upload' ? courseName : undefined,
        file: f.mode === 'upload' ? file : undefined,
        removePages: f.mode === 'upload' && pages.removed.length ? pages.removed.join(',') : undefined,
      })
      .catch((e) => ({ success: false, message: e?.response?.data?.message || e.message }));
    setBusy(false);
    if (r?.success) {
      message.success(r.message || 'Certificate sent');
      setDone({ ok: true, text: `${r.message || 'Sent'} · ID ${r.result?.certificateId || ''}` });
      setF((x) => ({ ...x, name: '', email: '' }));
      pickFile(null);
      onSent?.();
    } else {
      setDone({ ok: false, text: r?.message || 'Could not send the certificate.' });
      onSent?.();
    }
  };

  return (
    <Card size="small" className="cert-card cert-send" title={<Space><SendOutlined /> Send a certificate — to anyone, by email</Space>}>
      <div className="cert-send-grid">
        <label className="cert-send-fld">
          <span>Name on the certificate</span>
          <LearnerAuto value={f.name} field="name" onText={(v) => set('name', v)} onPick={(p) => setF((x) => ({ ...x, name: p.name, email: p.email }))} placeholder="Type a name — or pick a learner" />
        </label>
        <label className="cert-send-fld">
          <span>Email (the certificate goes here)</span>
          <LearnerAuto value={f.email} field="email" onText={(v) => set('email', v)} onPick={(p) => setF((x) => ({ ...x, name: x.name || p.name, email: p.email }))} placeholder="name@example.com — or type the start of it" status={f.email && !emailOk ? 'error' : undefined} />
        </label>
        <label className="cert-send-fld">
          <span>Internship</span>
          <Select value={f.course} onChange={(v) => set('course', v)} options={courses} placeholder="Internship" allowClear={f.mode === 'upload'} />
        </label>
        <label className="cert-send-fld">
          <span>Certificate title</span>
          <Input value={f.title} onChange={(e) => set('title', e.target.value)} maxLength={120} />
        </label>
      </div>

      <div className="cert-send-modes" role="radiogroup" aria-label="Which certificate">
        <button type="button" role="radio" aria-checked={f.mode === 'template'} className={f.mode === 'template' ? 'on' : ''} onClick={() => set('mode', 'template')}>
          <TrophyOutlined />
          <span><b>Our certificate</b><small>The internship's Career Lab certificate with this name printed on it</small></span>
        </button>
        <button type="button" role="radio" aria-checked={f.mode === 'upload'} className={f.mode === 'upload' ? 'on' : ''} onClick={() => set('mode', 'upload')}>
          <UploadOutlined />
          <span><b>Upload a PDF</b><small>Any certificate PDF you already have — sent exactly as it is</small></span>
        </button>
      </div>

      {f.mode === 'upload' && (
        <label className={`cert-send-drop ${file ? 'has' : ''}`}>
          <input type="file" accept="application/pdf,.pdf" onChange={(e) => pickFile(e.target.files?.[0] || null)} />
          <FilePdfOutlined />
          {file ? (
            <span><b>{file.name}</b> · {(file.size / 1048576).toFixed(1)} MB — click to change</span>
          ) : (
            <span><b>Choose a PDF</b> (up to 10 MB)</span>
          )}
        </label>
      )}

      {f.mode === 'upload' && file && (
        <div className="cert-prev">
          <div className="cert-prev-pages">
            <div className="cert-prev-h">
              <b>Pages</b>
              <small>{pages.total ? `${pages.total - pages.removed.length} of ${pages.total} will be sent` : pages.loading ? 'Reading the PDF…' : ''}</small>
            </div>
            {pages.error && <div className="cert-prev-err">{pages.error}</div>}
            <div className="cert-prev-chips">
              {Array.from({ length: pages.total }, (_, i) => i + 1).map((n) => {
                const gone = pages.removed.includes(n);
                return (
                  <button key={n} type="button" className={gone ? 'gone' : ''} disabled={pages.loading} onClick={() => togglePage(n)} title={gone ? 'Put this page back' : 'Remove this page'}>
                    Page {n}
                    <span aria-hidden="true">{gone ? '↺' : '✕'}</span>
                  </button>
                );
              })}
            </div>
            {pages.total > 1 && !pages.removed.includes(pages.total) && (
              <button type="button" className="cert-prev-last" disabled={pages.loading} onClick={() => togglePage(pages.total)}>
                Remove the last page
              </button>
            )}
            {pages.total > 0 && (
              <div className={`cert-prev-name ${pages.template ? 'ok' : 'warn'}`}>
                {pages.template
                  ? `This is our ${pages.template === 'elite' ? 'Elite' : 'Foundation'} certificate — the name, certificate ID and date are printed on it.`
                  : 'Not one of our certificate templates — it is sent exactly as it is, the name is NOT added to it.'}
              </div>
            )}
            <small className="cert-prev-hint">Removed pages are left out of the email; the preview shows exactly what is sent.</small>
          </div>
          <div className="cert-prev-view">
            {pages.url ? <iframe title="Certificate preview" src={pages.url} /> : <div className="cert-prev-wait">{pages.loading ? 'Loading preview…' : pages.error || ''}</div>}
          </div>
        </div>
      )}

      <div className="cert-send-foot">
        <span className="cert-send-note">
          {done ? <span className={done.ok ? 'ok' : 'err'}>{done.text}</span> : 'Emailed from Career Lab with the PDF attached, and added to Issued certificates with a verify link.'}
        </span>
        <Button type="primary" icon={<SendOutlined />} loading={busy} disabled={!ready} onClick={send}>
          Send certificate
        </Button>
      </div>
    </Card>
  );
}

// Issued certificates as a readable list (a table squeezed into this card broke
// every cell over 3–4 lines): who + email, internship chip, ID, date, status, PDF.
const shortCourse = (c) => String(c || '').replace(/^InternX-AI\s*[—-]\s*/i, '').trim() || '—';
function IssuedList({ rows }) {
  const [q, setQ] = useState('');
  const [limit, setLimit] = useState(8);
  const term = q.trim().toLowerCase();
  const list = (rows || []).filter((r) => !term || [r.student, r.email, r.certificateId, r.course].some((v) => String(v || '').toLowerCase().includes(term)));
  if (!rows || !rows.length) return <div className="cl-empty">No certificates issued yet.</div>;
  return (
    <div className="cl">
      <Input allowClear className="cl-search" placeholder="Search name, email or certificate ID" value={q} onChange={(e) => { setQ(e.target.value); setLimit(8); }} />
      <div className="cl-list">
        {list.slice(0, limit).map((r) => {
          const ok = ['Issued', 'Sent'].includes(r.status);
          return (
            <div key={r.id} className="cl-row">
              <span className="cl-av">{String(r.student || '?').trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase()}</span>
              <div className="cl-who">
                <b title={r.student}>{r.student}</b>
                {r.email && <small title={r.email}>{r.email}</small>}
                <div className="cl-tags">
                  <span className="cl-course" title={r.course}>{shortCourse(r.course)}</span>
                  {r.source === 'Upload' && <span className="cl-src">Uploaded PDF</span>}
                </div>
              </div>
              <div className="cl-meta">
                <span className="cl-id">{r.certificateId || '—'}</span>
                <small>{r.issuedOn ? dayjs(r.issuedOn).format('D MMM YYYY') : '—'}{r.grade ? ` · Grade ${r.grade}` : ''}</small>
              </div>
              <span className={`cl-status ${ok ? 'ok' : ''}`}>{r.status}</span>
              {ok ? (
                <Button size="small" className="cl-pdf" icon={<DownloadOutlined />} onClick={() => lmsApi.downloadCertificatePdf(r.id, false, slug(`${r.student}-${r.certificateId}`))}>
                  PDF
                </Button>
              ) : <span />}
            </div>
          );
        })}
        {!list.length && <div className="cl-empty">No certificate matches “{q}”.</div>}
      </div>
      {list.length > limit && (
        <button type="button" className="cl-more" onClick={() => setLimit((n) => n + 8)}>
          Show more ({list.length - limit})
        </button>
      )}
    </div>
  );
}

function TeacherCertificates({ isManagerRole }) {
  const [courses, setCourses] = useState([]);
  const [courseId, setCourseId] = useState(null);
  const [rule, setRule] = useState(null);
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [ruleForm] = Form.useForm();
  const [issueOpen, setIssueOpen] = useState(false);
  const [issueForm] = Form.useForm();
  const [running, setRunning] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const [d, h] = await Promise.all([
          isManagerRole
            ? request.list({ entity: 'course', options: { items: 500, sortBy: 'title', sortValue: 1 } })
            : lmsApi.teacherDashboard(),
          lmsApi.certHistory(),
        ]);
        const list = isManagerRole
          ? ((d && d.result) || []).map((c) => ({ value: c._id, label: c.title }))
          : ((d && d.result && d.result.courses) || []).map((c) => ({ value: c.id, label: c.title }));
        setCourses(list);
        setHistory((h && h.result) || []);
        if (list[0]) setCourseId(list[0].value);
      } catch (e) { message.error('Load failed'); } finally { setLoading(false); }
    })();
  }, [isManagerRole]);

  const loadRule = useCallback(async (id) => {
    if (!id) return;
    try {
      const res = await lmsApi.certRule(id);
      const r = (res && res.result) || null;
      setRule(r);
      ruleForm.setFieldsValue(r || { minCoursePercent: 100, minAttendancePercent: 0, requireAllAssignments: false, minQuizPercent: 0, autoIssue: true, validMonths: 0, title: 'Certificate of Completion', type: 'Completion' });
    } catch (e) { /* */ }
  }, [ruleForm]);
  useEffect(() => { loadRule(courseId); }, [courseId, loadRule]);

  const saveRule = async () => {
    let v; try { v = await ruleForm.validateFields(); } catch (e) { return; }
    try { await lmsApi.saveCertRule(courseId, v); message.success('Rule saved'); loadRule(courseId); }
    catch (e) { message.error('Save failed'); }
  };
  const runNow = async () => {
    setRunning(true);
    try { const res = await lmsApi.runCertificates(courseId); message.success(res?.message || 'Done'); const h = await lmsApi.certHistory(); setHistory((h && h.result) || []); }
    catch (e) { message.error('Run failed'); } finally { setRunning(false); }
  };
  const issue = async () => {
    let v; try { v = await issueForm.validateFields(); } catch (e) { return; }
    try {
      const res = await lmsApi.issueCertificate({ course: courseId, studentEmail: v.studentEmail, force: v.force });
      message.success(res?.message || 'Done');
      setIssueOpen(false); issueForm.resetFields();
      const h = await lmsApi.certHistory(); setHistory((h && h.result) || []);
    } catch (e) { message.error('Failed'); }
  };

  if (loading) return <Skeleton active paragraph={{ rows: 6 }} style={{ padding: 24 }} />;

  return (
    <div className="lms-portal" style={{ padding: 4 }}>
      <div className="lms-portal-head">
        <div><h2><TrophyOutlined /> Certificates</h2><p>Set the criteria — the system issues them automatically.</p></div>
        <Select style={{ minWidth: 240 }} value={courseId} onChange={setCourseId} options={courses} placeholder="Internship" />
      </div>

      <Card size="small" className="cert-card" title={<Space><TeamOutlined /> Batch roster — who's in which batch, who's completed</Space>}>
        <BatchRoster />
      </Card>

      {isManagerRole && (
        <SendCertificateCard
          courses={courses}
          courseId={courseId}
          onSent={async () => {
            const h = await lmsApi.certHistory();
            setHistory((h && h.result) || []);
          }}
        />
      )}

      {!courseId ? <Card><Empty description="No internships assigned." /></Card> : (
        <Row gutter={[16, 16]} align="stretch" className="cert-row">
          <Col xs={24} lg={10}>
            <Card size="small" className="cert-card cert-fill" title={<Space><SafetyCertificateOutlined /> Issue criteria</Space>}>
              <Form form={ruleForm} layout="vertical" className="cert-rule">
                <div className="cert-rule-2">
                  <Form.Item name="title" label="Certificate title"><Input /></Form.Item>
                  <Form.Item name="type" label="Type"><Select options={['Completion', 'Participation', 'Merit', 'Achievement'].map((v) => ({ value: v, label: v }))} /></Form.Item>
                </div>
                <div className="cert-rule-4">
                  <Form.Item name="minCoursePercent" label="Min internship %"><InputNumber min={0} max={100} addonAfter="%" /></Form.Item>
                  <Form.Item name="minAttendancePercent" label="Min attendance %"><InputNumber min={0} max={100} addonAfter="%" /></Form.Item>
                  <Form.Item name="minQuizPercent" label="Min quiz %"><InputNumber min={0} max={100} addonAfter="%" /></Form.Item>
                  <Form.Item name="validMonths" label="Valid for" tooltip="0 = never expires"><InputNumber min={0} addonAfter="months" /></Form.Item>
                </div>
                <div className="cert-rule-checks">
                  <Form.Item name="requireAllAssignments" valuePropName="checked" noStyle><Checkbox>All assignments evaluated</Checkbox></Form.Item>
                  <Form.Item name="autoIssue" valuePropName="checked" noStyle><Checkbox>Auto-issue</Checkbox></Form.Item>
                  <Form.Item name="enabled" valuePropName="checked" noStyle initialValue><Checkbox>Enabled</Checkbox></Form.Item>
                </div>
                <div className="cert-rule-btns">
                  <Button type="primary" onClick={saveRule}>Save rule</Button>
                  <Button icon={<ReloadOutlined />} loading={running} onClick={runNow}>Re-check all candidates</Button>
                  <Button onClick={() => setIssueOpen(true)}>Issue manually</Button>
                </div>
              </Form>
            </Card>
          </Col>
          <Col xs={24} lg={14}>
            <Card size="small" className="cert-card cert-fill" title={<Space><FileDoneOutlined /> Issued certificates</Space>}>
              <IssuedList rows={history} />
            </Card>
          </Col>
        </Row>
      )}

      {isManagerRole && <ExternalReview />}

      <Modal open={issueOpen} title="Issue certificate manually" onCancel={() => setIssueOpen(false)} onOk={issue} okText="Check & issue" destroyOnClose>
        <Form form={issueForm} layout="vertical" preserve={false}>
          <Form.Item name="studentEmail" label="Candidate email" rules={[{ required: true, type: 'email' }]}><Input /></Form.Item>
          <Form.Item name="force" valuePropName="checked" noStyle><Checkbox>Force (ignore criteria)</Checkbox></Form.Item>
        </Form>
      </Modal>
    </div>
  );
}

/// Design board L8 — certificate preview on the left (520px, dark panel), one
// card per programme on the right (issued: download / copy verify link /
// correction; not yet: the requirement rows), then the public verify preview.
// External (IBM / Microsoft / Google…) certificates — design L8. The learner
// adds the provider's verification link and/or the file; Support verifies.
const EXT_CHIP = { unverified: ['adh', 'Unverified'], verified: ['hai', 'Verified'], rejected: ['red', 'Not verified'] };
function ExternalCertificates() {
  const [rows, setRows] = useState([]);
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ provider: '', title: '', credentialId: '', verifyUrl: '', issuedOn: '' });
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => lmsApi.myExternalCertificates().then((r) => setRows((r && r.result) || [])).catch(() => {}), []);
  useEffect(() => {
    load();
  }, [load]);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const pickFile = async (e) => {
    const fl = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!fl) return;
    if (!/\.(pdf|png|jpe?g)$/i.test(fl.name) || fl.size > 10 * 1024 * 1024) return message.error('PDF / PNG / JPG, max 10 MB');
    setBusy(true);
    const r = await lmsApi.externalCertificateFile(fl).catch(() => null);
    setBusy(false);
    if (r && r.success !== false && r.result) setFile(r.result);
    else message.error((r && r.message) || 'Upload failed.');
    return null;
  };
  const save = async () => {
    setBusy(true);
    const r = await lmsApi.addExternalCertificate({ ...f, file }).catch(() => null);
    setBusy(false);
    if (!r || r.success === false) return message.error((r && r.message) || 'Could not add.');
    setF({ provider: '', title: '', credentialId: '', verifyUrl: '', issuedOn: '' });
    setFile(null);
    setOpen(false);
    load();
    return null;
  };
  const remove = async (c) => {
    const r = await lmsApi.removeExternalCertificate(c.id).catch(() => null);
    if (r && r.success !== false) load();
  };
  return (
    <>
      {rows.map((c) => {
        const chip = EXT_CHIP[c.status] || EXT_CHIP.unverified;
        return (
          <section className="ld-card" key={c.id} aria-label={`${c.provider} certificate`}>
            <div className="ld-hd"><b>{c.provider} · {c.title}</b><span className={`ld-chip ${chip[0]}`}>{chip[1]}</span></div>
            <div className="ld-muted" style={{ fontSize: 13 }}>
              {c.status === 'unverified'
                ? 'Learner-provided upload · provider verification link pending check by Support'
                : `${c.status === 'verified' ? 'Verified' : 'Checked'} by ${c.reviewedByName || 'Support'}${c.reviewedAt ? ` · ${dayjs(c.reviewedAt).format('D MMM YYYY')}` : ''}${c.reviewNote ? ` · ${c.reviewNote}` : ''}`}
            </div>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', fontSize: 13 }}>
              {c.verifyUrl && <a href={c.verifyUrl} target="_blank" rel="noopener noreferrer">Provider verify link</a>}
              {c.file && <a href={`${BASE_URL}${c.file.url}`} target="_blank" rel="noopener noreferrer">{c.file.name}</a>}
              {c.status !== 'verified' && <button type="button" className="ld-link" onClick={() => remove(c)}>Remove</button>}
            </div>
          </section>
        );
      })}
      {open ? (
        <section className="ld-card" aria-label="Add external certificate">
          <b>Add an external certificate</b>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <label className="ld-label">Provider<input className="ld-inp full" maxLength={80} value={f.provider} onChange={set('provider')} placeholder="IBM / Microsoft / Google" /></label>
            <label className="ld-label">Issued on<input className="ld-inp full" type="date" value={f.issuedOn} onChange={set('issuedOn')} /></label>
          </div>
          <label className="ld-label">Certificate name<input className="ld-inp full" maxLength={200} value={f.title} onChange={set('title')} placeholder="Generative AI for Business and Professionals" /></label>
          <label className="ld-label">Provider verification link<input className="ld-inp full" maxLength={500} value={f.verifyUrl} onChange={set('verifyUrl')} placeholder="https://…" /></label>
          <label className="ld-label">Credential ID (optional)<input className="ld-inp full" maxLength={120} value={f.credentialId} onChange={set('credentialId')} /></label>
          <label className="ld-btn2 sm" style={{ alignSelf: 'flex-start' }}>
            <input type="file" accept=".pdf,.png,.jpg,.jpeg" style={{ display: 'none' }} onChange={pickFile} />
            {file ? `✓ ${file.name}` : busy ? 'Uploading…' : 'Certificate file (PDF / image)'}
          </label>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button type="button" className="ld-btn2 sm" onClick={() => setOpen(false)}>Cancel</button>
            <button type="button" className="ld-btn sm" disabled={busy || !f.provider.trim() || !f.title.trim() || (!f.verifyUrl.trim() && !file)} onClick={save}>Add for verification</button>
          </div>
        </section>
      ) : (
        <button type="button" className="ld-link" style={{ fontSize: 13, alignSelf: 'flex-start' }} onClick={() => setOpen(true)}>+ Add an external certificate (IBM / Microsoft…)</button>
      )}
    </>
  );
}

// Support / management: learners' external certificates to check against the
// provider's link, then mark Verified or Not verified (learner is notified).
function ExternalReview() {
  const [rows, setRows] = useState([]);
  const [status, setStatus] = useState('unverified');
  const [busyId, setBusyId] = useState(null);
  const load = useCallback(() => lmsApi.adminExternalCertificates(status).then((r) => setRows((r && r.result) || [])).catch(() => {}), [status]);
  useEffect(() => {
    load();
  }, [load]);
  const decide = (r, decision) => {
    let note = '';
    Modal.confirm({
      title: decision === 'verified' ? `Verify ${r.provider} certificate?` : `Mark ${r.provider} certificate as not verified?`,
      content: <Input.TextArea rows={2} placeholder="Note for the learner (optional)" onChange={(e) => { note = e.target.value; }} />,
      okText: decision === 'verified' ? 'Verified' : 'Not verified',
      okButtonProps: { danger: decision !== 'verified' },
      onOk: async () => {
        setBusyId(r.id);
        const res = await lmsApi.reviewExternalCertificate(r.id, decision, note).catch(() => null);
        setBusyId(null);
        if (!res || res.success === false) return message.error((res && res.message) || 'Could not save.');
        load();
        return null;
      },
    });
  };
  return (
    <Card style={{ marginTop: 16 }} title={<span><SafetyCertificateOutlined /> External certificates (learner-provided)</span>} extra={
      <Select size="small" value={status} onChange={setStatus} style={{ width: 150 }} options={[{ value: 'unverified', label: 'To verify' }, { value: 'verified', label: 'Verified' }, { value: 'rejected', label: 'Not verified' }, { value: '', label: 'All' }]} />
    }>
      <Table
        size="small"
        rowKey="id"
        dataSource={rows}
        pagination={tablePagination({ defaultPageSize: 10 })}
        locale={{ emptyText: <Empty description="Nothing here" /> }}
        columns={[
          { title: 'Learner', render: (_, r) => <><b>{r.studentName}</b><br /><Typography.Text type="secondary">{r.studentEmail}</Typography.Text></> },
          { title: 'Certificate', render: (_, r) => <><b>{r.provider}</b> · {r.title}{r.credentialId ? <><br /><Typography.Text type="secondary">ID {r.credentialId}</Typography.Text></> : null}</> },
          {
            title: 'Proof',
            render: (_, r) => (
              <Space direction="vertical" size={0}>
                {r.verifyUrl && <a href={r.verifyUrl} target="_blank" rel="noopener noreferrer">Provider link</a>}
                {r.file && <a href={`${BASE_URL}${r.file.url}`} target="_blank" rel="noopener noreferrer">{r.file.name}</a>}
              </Space>
            ),
          },
          { title: 'Added', width: 110, render: (_, r) => dayjs(r.created).format('D MMM YY') },
          { title: 'Status', width: 120, render: (_, r) => <Tag color={r.status === 'verified' ? 'green' : r.status === 'rejected' ? 'red' : 'orange'}>{(EXT_CHIP[r.status] || EXT_CHIP.unverified)[1]}</Tag> },
          {
            title: '',
            width: 200,
            render: (_, r) =>
              r.status === 'unverified' ? (
                <Space>
                  <Button size="small" type="primary" loading={busyId === r.id} onClick={() => decide(r, 'verified')}>Verified</Button>
                  <Button size="small" danger disabled={busyId === r.id} onClick={() => decide(r, 'rejected')}>Not verified</Button>
                </Space>
              ) : (
                <Typography.Text type="secondary">{r.reviewedByName}</Typography.Text>
              ),
          },
        ]}
      />
    </Card>
  );
}

function StudentCertificates() {
  const navigate = useNavigate();
  const admin = useSelector(selectCurrentAdmin) || {};
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [sel, setSel] = useState(0);
  useEffect(() => {
    lmsApi.myCertificates().then((r) => setRows((r && r.result) || [])).catch(() => message.error('Load failed')).finally(() => setLoading(false));
  }, []);
  if (loading) return <Skeleton active paragraph={{ rows: 5 }} style={{ padding: 24 }} />;

  const issued = rows.filter((c) => c.eligible);
  const cur = rows[sel] || issued[0] || rows[0];
  const learner = [admin.name, admin.surname].filter(Boolean).join(' ') || 'Learner';
  const verifyLink = (c) => (c.verificationUrl ? new URL(c.verificationUrl, window.location.origin).href : '');
  const copyLink = (c) => {
    const link = verifyLink(c);
    if (!link) return;
    (navigator.clipboard ? navigator.clipboard.writeText(link) : Promise.reject()).then(() => message.success('Verify link copied')).catch(() => message.info(link));
  };
  const correction = (c) =>
    navigate('/learn/support', {
      state: {
        raise: {
          category: 'Certificate',
          subject: `Certificate correction · ${c.certificateId}`,
          reference: [c.title, c.certificateId].filter(Boolean).join(' · '),
          description: 'What is wrong on the certificate (name spelling, programme, date…):',
          expected: 'It should read:',
        },
      },
    });
  const masked = learner.split(' ').map((p, i) => (i === 0 ? p : `${p[0]}.`)).join(' ');

  return (
    <div className="ld-page">
      <div className="ld-head">
        <div>
          <h1>My certificates</h1>
          <div className="ld-muted ld-sub">Career Lab certificates and external ones (IBM / Microsoft) are shown separately</div>
        </div>
      </div>
      {rows.length === 0 ? (
        <div className="ld-card"><div className="ld-empty">Not enrolled in any internship yet.</div></div>
      ) : (
        <div className="ld-grid" style={{ gridTemplateColumns: '520px minmax(0, 1fr)', flex: 1 }}>
          <div className="ld-card" style={{ alignItems: 'center', justifyContent: 'center', background: '#0b1a33', borderColor: '#0b1a33' }} aria-label="Certificate preview">
            <div style={{ width: '100%', maxWidth: 440, minHeight: 600, background: '#fbf6ea', border: '6px double #b08d3c', padding: '36px 30px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, textAlign: 'center', opacity: cur && cur.eligible ? 1 : 0.6 }}>
              <div style={{ fontSize: 12, letterSpacing: '.2em', fontWeight: 700, color: '#0b1a33' }}>CAREER LAB CONSULTING</div>
              <div style={{ fontSize: 13, letterSpacing: '.15em', fontWeight: 700, color: '#0b1a33' }}>INTERN<span style={{ color: '#b08d3c' }}>X</span>-AI</div>
              <div style={{ fontFamily: "'Playfair Display', Georgia, serif", fontSize: 44, fontWeight: 700, color: '#0b1a33', marginTop: 18 }}>CERTIFICATE</div>
              <div style={{ fontSize: 14, letterSpacing: '.25em', color: '#8a6d2b', fontWeight: 600 }}>OF COMPLETION</div>
              <div style={{ fontSize: 13, fontStyle: 'italic', color: '#334155', marginTop: 14 }}>This certificate is proudly presented to</div>
              <div style={{ fontFamily: "'Playfair Display', Georgia, serif", fontSize: 30, color: '#0b1a33', borderBottom: '1px solid #b08d3c', padding: '0 24px 6px' }}>{learner}</div>
              <div style={{ fontSize: 12, fontStyle: 'italic', color: '#334155' }}>For successfully completing the</div>
              <div style={{ fontSize: 18, fontWeight: 700, color: '#0b1a33', textTransform: 'uppercase' }}>{cur ? cur.title || cur.course : ''}</div>
              <div style={{ display: 'flex', gap: 24, marginTop: 'auto', fontSize: 11, color: '#334155' }}>
                <div><b style={{ color: '#0b1a33' }}>CERTIFICATE ID</b><br />{cur && cur.eligible ? cur.certificateId : 'issued on completion'}</div>
                <div><b style={{ color: '#0b1a33' }}>DATE</b><br />{cur && cur.issuedOn ? dayjs(cur.issuedOn).format('D MMM YYYY') : '—'}</div>
              </div>
              {!(cur && cur.eligible) && <div style={{ fontSize: 11, color: '#991b1b', fontWeight: 600 }}>PREVIEW — not unlocked yet</div>}
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 14, minWidth: 0 }}>
            {rows.map((c, i) => (
              <section className="ld-card" key={c.course} aria-label={c.title} style={{ outline: cur === c ? '2px solid #0e7490' : 'none', cursor: 'pointer' }} onClick={() => setSel(i)}>
                <div className="ld-hd"><b>{c.title}{c.track ? ` · ${c.track}` : ''}</b><span className={`ld-chip ${c.eligible ? 'hai' : 'gray'}`}>{c.eligible ? 'Issued' : 'Not yet eligible'}</span></div>
                {c.eligible ? (
                  <>
                    <div className="ld-muted" style={{ fontSize: 13 }}>Issued by Career Lab · {c.issuedOn ? dayjs(c.issuedOn).format('D MMM YYYY') : '—'} · ID {c.certificateId}{c.grade ? ` · Grade ${c.grade}` : ''}</div>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }} onClick={(e) => e.stopPropagation()}>
                      <button type="button" className="ld-btn md" onClick={() => lmsApi.downloadCertificatePdf(c.id, true, slug(`${c.course}-${c.certificateId}`))}>Download PDF</button>
                      {c.verificationUrl && <button type="button" className="ld-btn2" onClick={() => copyLink(c)}>Copy verify link</button>}
                      <button type="button" className="ld-btn2" onClick={() => correction(c)}>Name correction request</button>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="ld-li"><span>{c.durationMonths}-month duration complete</span>{c.durationOk ? <b style={{ color: '#166534' }}>done</b> : <span style={{ color: '#991b1b', fontWeight: 600 }}>missing</span>}</div>
                    <div className="ld-li"><span>Capstone project submitted</span>{c.projectOk ? <b style={{ color: '#166534' }}>done</b> : <span style={{ color: '#991b1b', fontWeight: 600 }}>pending</span>}</div>
                    <div onClick={(e) => e.stopPropagation()}>
                      <button type="button" className="ld-btn2 sm" onClick={() => lmsApi.previewCertificatePdf(c.courseId)}>Preview PDF</button>
                    </div>
                  </>
                )}
              </section>
            ))}
            <ExternalCertificates />
            {issued[0] && (
              <section className="ld-card" aria-label="Public verify page">
                <div className="ld-hd"><b>Public verify page (preview)</b></div>
                <div className="ld-soft" style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <b style={{ color: '#166534' }}>Valid certificate</b>
                  <span>{issued[0].title} · Career Lab Consulting Pvt. Ltd.</span>
                  <span>Issued {issued[0].issuedOn ? dayjs(issued[0].issuedOn).format('D MMM YYYY') : '—'} · {masked}</span>
                  <span className="ld-muted">Marks, contact and login details are never shown</span>
                </div>
              </section>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default function Certificates() {
  const admin = useSelector(selectCurrentAdmin) || {};
  const { canView } = usePermission();
  // everyone with the LMS permission gets the admin page (user ask 2026-11-24);
  // a learner keeps their own certificates view
  const isManagerRole = admin.role !== 'Student' && (MGR.includes(admin.role) || canView('LMS'));
  if (isManagerRole || LMS_TEACHER_ROLES.includes(admin.role)) return <TeacherCertificates isManagerRole={isManagerRole} />;
  return <StudentCertificates />;
}
