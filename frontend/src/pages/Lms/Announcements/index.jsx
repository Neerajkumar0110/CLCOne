import React, { useCallback, useEffect, useState } from 'react';
import {
  Card, Table, Tag, Button, Modal, Form, Input, Select, Checkbox, Space, Empty, Skeleton, message, Typography,
} from 'antd';
import {
  SoundOutlined, PlusOutlined, DeleteOutlined, TagOutlined, FileTextOutlined,
  TeamOutlined, ReadOutlined, BellOutlined, FlagOutlined, ExclamationCircleOutlined,
  SearchOutlined, UserOutlined, ClockCircleOutlined, CalendarOutlined, RightOutlined, LeftOutlined, MailOutlined,
} from '@ant-design/icons';
import { AnnouncementModal, plainText, scopeOf } from './AnnouncementView';
import dayjs from 'dayjs';
import { useSelector } from 'react-redux';
import { selectCurrentAdmin } from '@/redux/auth/selectors';
import { LMS_TEACHER_ROLES } from '@/config/roles';
import { request } from '@/request';
import lmsApi from '../api';
import './Announcements.css';

const { Text, Paragraph } = Typography;

// Same label-with-icon treatment as the CRM's generic Add/Edit modal
// (components/CrudTab — see .crud-lbl / .crud-lbl-icon in featureHub.css),
// matching how Lms/Projects and Lms/Assignments build their own modals, so
// every form in the LMS reads as one consistent product.
const Lbl = ({ icon, children }) => (
  <span className="crud-lbl"><span className="crud-lbl-icon">{icon}</span>{children}</span>
);

// Manager-only (Admin/Super Admin/Support/Sales Manager/owner) — the only
// roles createAnnouncement still accepts (engagement.js). Courses/batches
// are loaded system-wide, not scoped to "my own batches" the way the old
// Teacher-authored version was, since a manager isn't a trainer on anything.
function TeacherAnnouncements() {
  const [rows, setRows] = useState([]);
  const [courses, setCourses] = useState([]);
  const [batches, setBatches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [view, setView] = useState(null);
  const [q, setQ] = useState('');
  const [pri, setPri] = useState('all');
  const [form] = Form.useForm();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [a, c, b] = await Promise.all([
        lmsApi.announcements(),
        request.list({ entity: 'course', options: { items: 500, sortBy: 'title', sortValue: 1 } }),
        request.list({ entity: 'batch', options: { items: 500, sortBy: 'name', sortValue: 1 } }),
      ]);
      setRows((a && a.result) || []);
      setCourses(((c && c.result) || []).map((x) => ({ value: x._id, label: x.title })));
      setBatches(((b && b.result) || []).map((x) => ({ value: x.name, label: x.name })));
    } catch (e) { message.error('Could not load.'); } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  // one click = one send: the button stays busy until the server answers
  // (a second click emailed everyone twice — LMS testing report #3)
  const [sending, setSending] = useState(false);
  const send = async () => {
    if (sending) return;
    let v; try { v = await form.validateFields(); } catch (e) { return; }
    setSending(true);
    try {
      const res = await lmsApi.createAnnouncement({ ...v, channels: v.channels || ['in_app'] });
      if (!res || res.success === false) return; // the error toast already says why
      const r = res.result || {};
      message.success(`Sent to ${r.recipients ?? 0} candidate${r.recipients === 1 ? '' : 's'}${r.emailing ? ` — ${r.emailing} email${r.emailing === 1 ? '' : 's'} going out now` : ''}`);
      setOpen(false); form.resetFields(); load();
    } catch (e) { message.error('Send failed.'); } finally { setSending(false); }
  };
  const [found, setFound] = useState([]);
  const findLearners = async (q) => {
    if (String(q || '').trim().length < 2) return;
    const r = await lmsApi.announcementLearners(q);
    const fresh = (r && r.result) || [];
    setFound((prev) => {
      const m = new Map(prev.map((x) => [x.id, x]));
      fresh.forEach((x) => m.set(x.id, x));
      return [...m.values()];
    });
  };

  if (loading) return <Skeleton active paragraph={{ rows: 6 }} style={{ padding: 24 }} />;

  const needle = q.trim().toLowerCase();
  const shown = rows.filter((r) => (pri === 'all' || (r.priority === 'important' ? 'important' : 'general') === pri)
    && (!needle || `${r.title} ${r.body} ${scopeOf(r)}`.toLowerCase().includes(needle)));
  const importantN = rows.filter((r) => r.priority === 'important').length;
  const reached = rows.reduce((n, r) => n + (r.recipientsCount || 0), 0);
  const emailed = rows.reduce((n, r) => n + (r.emailedCount || 0), 0);
  const remove = (r) => Modal.confirm({
    title: `Delete “${r.title}”?`,
    content: 'Learners will no longer see this announcement. Emails already sent cannot be taken back.',
    okText: 'Delete',
    okButtonProps: { danger: true },
    centered: true,
    onOk: async () => {
      await lmsApi.deleteAnnouncement(r.id);
      setView(null);
      message.success('Announcement deleted.');
      load();
    },
  });
  const openNew = () => { setOpen(true); setTimeout(() => form.setFieldsValue({ audience: 'course', priority: 'general', channels: ['in_app'] }), 0); };

  return (
    <div className="pol" style={{ padding: 4 }}>
      <div className="pol-hero">
        <div className="pol-hero-l">
          <span className="pol-hero-ic"><SoundOutlined /></span>
          <div>
            <h2>Announcements</h2>
            <p>Broadcast to an internship, one or more batches, chosen learners or everyone — in-app and by email. Click an announcement to read it.</p>
          </div>
        </div>
        <Button type="primary" size="large" icon={<PlusOutlined />} onClick={openNew}>New announcement</Button>
      </div>

      <div className="pol-stats">
        <div className="pol-stat"><span className="pol-stat-ic violet"><SoundOutlined /></span><div><b>{rows.length}</b><span>Sent</span></div></div>
        <div className="pol-stat"><span className="pol-stat-ic amber"><ExclamationCircleOutlined /></span><div><b>{importantN}</b><span>Important</span></div></div>
        <div className="pol-stat"><span className="pol-stat-ic teal"><BellOutlined /></span><div><b>{reached}</b><span>Recipients reached</span></div></div>
        <div className="pol-stat"><span className="pol-stat-ic blue"><MailOutlined /></span><div><b>{emailed}</b><span>Emails sent</span></div></div>
      </div>

      {rows.length === 0 ? (
        <div className="pol-empty">
          <span className="pol-empty-ic"><SoundOutlined /></span>
          <b>Nothing sent yet</b>
          <span>Send the first announcement to an internship, a batch or everyone.</span>
          <Button type="primary" icon={<PlusOutlined />} onClick={openNew}>New announcement</Button>
        </div>
      ) : (
        <>
          <div className="pol-tools">
            <Input allowClear prefix={<SearchOutlined />} placeholder="Search announcements" value={q} onChange={(e) => setQ(e.target.value)} />
            <div className="pol-pills">
              <button type="button" className={`pol-pill${pri === 'all' ? ' on' : ''}`} onClick={() => setPri('all')}>All · {rows.length}</button>
              <button type="button" className={`pol-pill${pri === 'important' ? ' on' : ''}`} onClick={() => setPri('important')}>Important · {importantN}</button>
              <button type="button" className={`pol-pill${pri === 'general' ? ' on' : ''}`} onClick={() => setPri('general')}>General · {rows.length - importantN}</button>
            </div>
          </div>
          {shown.length === 0 ? (
            <div className="pol-empty"><span className="pol-empty-ic"><SearchOutlined /></span><b>No match</b><span>Try another word or filter.</span></div>
          ) : (
            <div className="pol-list" role="list">
              {shown.map((r) => {
                const important = r.priority === 'important';
                return (
                  <div key={r.id} role="listitem" className="pol-row anm-row" tabIndex={0} onClick={() => setView(r)} onKeyDown={(e) => { if (e.key === 'Enter') setView(r); }}>
                    <span className="pol-row-t">
                      <span className={`pol-card-ic${important ? ' anm-imp' : ''}`}>{important ? <ExclamationCircleOutlined /> : <SoundOutlined />}</span>
                      <span style={{ minWidth: 0 }}>
                        <b>{r.title}</b>
                        <small className="anm-ex">{plainText(r.body)}</small>
                      </span>
                    </span>
                    <span className="pol-row-v">
                      <span className={`pol-chip ${important ? 'red' : 'violet'}`}>{important ? 'Important' : 'General'}</span>
                      <span className="pol-chip blue" title={scopeOf(r)}><TeamOutlined /> {scopeOf(r).length > 28 ? `${scopeOf(r).slice(0, 28)}…` : scopeOf(r)}</span>
                      <span className="pol-chip"><BellOutlined /> {r.recipientsCount || 0}</span>
                      {r.emailedCount ? <span className="pol-chip"><MailOutlined /> {r.emailedCount}</span> : null}
                      <span className="anm-date">{dayjs(r.sentAt).format('D MMM, HH:mm')}</span>
                    </span>
                    <span className="anm-act">
                      <Button size="small" danger type="text" icon={<DeleteOutlined />} aria-label="Delete announcement" onClick={(e) => { e.stopPropagation(); remove(r); }} />
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      <AnnouncementModal item={view} onClose={() => setView(null)} onDelete={remove} />

      <Modal
        className="crud-modal"
        open={open}
        title={
          <span className="crud-modal-title">
            <span className="crud-modal-title-icon"><SoundOutlined /></span>
            <span>
              <span className="crud-modal-title-kicker">New record</span>
              <span className="crud-modal-title-main">New announcement</span>
            </span>
          </span>
        }
        onCancel={() => setOpen(false)}
        onOk={send}
        okText={sending ? 'Sending…' : 'Send'}
        confirmLoading={sending}
        okButtonProps={{ disabled: sending }}
        destroyOnClose
        maskClosable={false}
        width={640}
      >
        <Form form={form} layout="vertical" preserve={false} className="crud-form">
          <div className="crud-form-grid">
            <Form.Item name="title" label={<Lbl icon={<TagOutlined />}>Title</Lbl>} rules={[{ required: true, message: 'Title is required' }]} className="crud-form-full">
              <Input placeholder="e.g. Class rescheduled to 5 PM" />
            </Form.Item>
            <Form.Item name="body" label={<Lbl icon={<FileTextOutlined />}>Message</Lbl>} rules={[{ required: true, message: 'Message is required' }]} className="crud-form-full">
              <Input.TextArea rows={5} />
            </Form.Item>
            <Form.Item name="priority" label={<Lbl icon={<FlagOutlined />}>Priority</Lbl>} className="crud-form-full">
              <Select options={[{ value: 'general', label: 'General' }, { value: 'important', label: 'Important' }]} />
            </Form.Item>
            <Form.Item name="audience" label={<Lbl icon={<TeamOutlined />}>Audience</Lbl>} className="crud-form-full">
              <Select options={[{ value: 'course', label: 'An internship' }, { value: 'batches', label: 'One or more batches' }, { value: 'learners', label: 'Specific learners' }, { value: 'all', label: 'All candidates' }]} />
            </Form.Item>
            <Form.Item noStyle shouldUpdate={(p, c) => p.audience !== c.audience}>
              {({ getFieldValue }) => {
                const a = getFieldValue('audience');
                if (a === 'course') {
                  return (
                    <Form.Item name="course" label={<Lbl icon={<ReadOutlined />}>Internship</Lbl>} rules={[{ required: true, message: 'Internship is required' }]} className="crud-form-full">
                      <Select options={courses} showSearch optionFilterProp="label" placeholder="Select an internship…" />
                    </Form.Item>
                  );
                }
                if (a === 'batch' || a === 'batches') {
                  return (
                    <Form.Item name="batches" label={<Lbl icon={<TeamOutlined />}>Batches</Lbl>} rules={[{ required: true, message: 'Pick one or more batches' }]} className="crud-form-full">
                      <Select mode="multiple" options={batches.map((x) => ({ value: x.label, label: x.label }))} showSearch optionFilterProp="label" placeholder="Pick one or more batches…" />
                    </Form.Item>
                  );
                }
                if (a === 'learners') {
                  return (
                    <Form.Item name="learnerIds" label={<Lbl icon={<TeamOutlined />}>Learners</Lbl>} rules={[{ required: true, message: 'Pick at least one learner' }]} className="crud-form-full">
                      <Select
                        mode="multiple"
                        showSearch
                        filterOption={false}
                        onSearch={findLearners}
                        placeholder="Type a name or the start of an email…"
                        notFoundContent="Type 2+ letters"
                        options={found.map((x) => ({ value: x.id, label: `${x.name} · ${x.email}` }))}
                      />
                    </Form.Item>
                  );
                }
                return null;
              }}
            </Form.Item>
            <Form.Item name="channels" label={<Lbl icon={<BellOutlined />}>Send via</Lbl>} className="crud-form-full">
              <Checkbox.Group options={[{ label: 'In-app notification', value: 'in_app' }, { label: 'Email', value: 'email' }]} />
            </Form.Item>
          </div>
        </Form>
      </Modal>
    </div>
  );
}

// Reading time is derived straight from the real announcement body (≈200
// words/min, same convention as the deterministic-thumbnail helpers used
// elsewhere in the LMS) — never a fabricated number.
const readTime = (body) => {
  const words = (body || '').trim().split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words / 200));
};

// Read-only view — used by both Teacher and Student. Sending/managing
// announcements is manager-only (Admin/Super Admin/Support); a Teacher used
// to get the full create UI here too, but now just sees what's been sent
// for their own batches/courses (see engagement.js's myAnnouncements).
function ReadOnlyAnnouncements({ isTeacher }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('all');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [view, setView] = useState(null);

  useEffect(() => {
    lmsApi.myAnnouncements().then((r) => setRows((r && r.result) || [])).catch(() => message.error('Load failed')).finally(() => setLoading(false));
  }, []);

  const importantCount = rows.filter((r) => r.priority === 'important').length;
  const generalCount = rows.filter((r) => r.priority !== 'important').length;

  const filtered = rows.filter((r) => {
    if (tab !== 'all' && (r.priority === 'important' ? 'important' : 'general') !== tab) return false;
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      if (!r.title.toLowerCase().includes(q) && !(r.body || '').toLowerCase().includes(q)) return false;
    }
    return true;
  });

  useEffect(() => { setPage(1); }, [tab, search]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const pageRows = filtered.slice((page - 1) * pageSize, page * pageSize);

  if (loading) return <Skeleton active paragraph={{ rows: 6 }} style={{ padding: 24 }} />;

  return (
    <div className="announcements-page">
      <div className="announcement-hero">
        <div className="announcement-hero-left">
          <div className="announcement-icon"><SoundOutlined /></div>
          <div>
            <span className="announcement-kicker">Stay Informed</span>
            <h1>Announcements</h1>
            <p>{isTeacher ? 'Sent to your batches and internships.' : 'Updates from your project managers.'}</p>
          </div>
        </div>
        <div className="stay-updated">Stay<br />Updated</div>
      </div>

      <div className="announcement-content">
        <div className="announcement-filter">
          <div className="announcement-tabs">
            <button type="button" className={`announcement-tab ${tab === 'all' ? 'active' : ''}`} onClick={() => setTab('all')}>
              <BellOutlined /> All <span className="announcement-count">{rows.length}</span>
            </button>
            <button type="button" className={`announcement-tab important ${tab === 'important' ? 'active' : ''}`} onClick={() => setTab('important')}>
              <ExclamationCircleOutlined /> Important <span className="announcement-count">{importantCount}</span>
            </button>
            <button type="button" className={`announcement-tab general ${tab === 'general' ? 'active' : ''}`} onClick={() => setTab('general')}>
              <SoundOutlined /> General <span className="announcement-count">{generalCount}</span>
            </button>
          </div>
          <div className="announcement-search">
            <SearchOutlined />
            <input type="text" placeholder="Search announcements…" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
        </div>

        {filtered.length === 0 ? (
          <div className="announcement-empty"><Empty description="No announcements." /></div>
        ) : (
          <>
            <div className="announcement-list">
              {pageRows.map((r) => {
                const important = r.priority === 'important';
                return (
                  <div className={`announcement-card ${important ? 'important' : 'general'}`} key={r.id} role="button" tabIndex={0} style={{ cursor: 'pointer' }} onClick={() => setView(r)} onKeyDown={(e) => { if (e.key === 'Enter') setView(r); }}>
                    <div className="announcement-card-icon"><SoundOutlined /></div>
                    <div className="announcement-card-body">
                      <div className="announcement-card-title-row">
                        <h3 className="announcement-card-title">{r.title}</h3>
                        <span className={`announcement-type ${important ? 'important' : 'general'}`}>{important ? 'Important' : 'General'}</span>
                      </div>
                      {r.body && <p className="announcement-description">{plainText(r.body)}</p>}
                      <div className="announcement-meta">
                        <span className="announcement-meta-item"><CalendarOutlined /> {dayjs(r.sentAt).format('D MMM YYYY, hh:mm A')}</span>
                        <span className="announcement-meta-item"><UserOutlined /> By {r.from}</span>
                        {r.scope && <span className="announcement-meta-item"><TeamOutlined /> {r.scope}</span>}
                        <span className="announcement-meta-item"><ClockCircleOutlined /> {readTime(r.body)} min read</span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="announcement-pagination">
              <span>Showing {filtered.length === 0 ? 0 : (page - 1) * pageSize + 1}–{Math.min(page * pageSize, filtered.length)} of {filtered.length} announcements</span>
              <div className="pagination-right">
                <button type="button" className="pagination-button" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}><LeftOutlined /></button>
                <button type="button" className="pagination-button active">{page}</button>
                <button type="button" className="pagination-button" disabled={page >= totalPages} onClick={() => setPage((p) => Math.min(totalPages, p + 1))}><RightOutlined /></button>
                <select className="pagination-select" value={pageSize} onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1); }}>
                  <option value={10}>10 / page</option>
                  <option value={20}>20 / page</option>
                  <option value={50}>50 / page</option>
                </select>
              </div>
            </div>
          </>
        )}
      </div>
      <AnnouncementModal item={view} onClose={() => setView(null)} />
    </div>
  );
}

const MGR = ['owner', 'Super Admin', 'Admin', 'Sales Manager', 'Support'];

export default function Announcements() {
  const admin = useSelector(selectCurrentAdmin) || {};
  if (MGR.includes(admin.role)) return <TeacherAnnouncements />;
  return <ReadOnlyAnnouncements isTeacher={LMS_TEACHER_ROLES.includes(admin.role)} />;
}
