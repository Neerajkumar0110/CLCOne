import React, { useCallback, useEffect, useState } from 'react';
import {
  Card, Table, Tag, Button, Modal, Form, Input, Select, Checkbox, Space, Empty, Skeleton, message, Typography,
} from 'antd';
import {
  SoundOutlined, PlusOutlined, DeleteOutlined, TagOutlined, FileTextOutlined,
  TeamOutlined, ReadOutlined, BellOutlined, FlagOutlined, ExclamationCircleOutlined,
  SearchOutlined, UserOutlined, ClockCircleOutlined, CalendarOutlined, RightOutlined, LeftOutlined,
} from '@ant-design/icons';
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

  const send = async () => {
    let v; try { v = await form.validateFields(); } catch (e) { return; }
    try {
      const res = await lmsApi.createAnnouncement({ ...v, channels: v.channels || ['in_app'] });
      message.success(`Sent to ${res?.result?.recipients ?? 0} candidates (${res?.result?.emailed ?? 0} emailed)`);
      setOpen(false); form.resetFields(); load();
    } catch (e) { message.error('Send failed.'); }
  };

  if (loading) return <Skeleton active paragraph={{ rows: 6 }} style={{ padding: 24 }} />;

  return (
    <div className="lms-portal" style={{ padding: 4 }}>
      <div className="lms-portal-head">
        <div><h2><SoundOutlined /> Announcements</h2><p>Broadcast to a course, a batch, or everyone.</p></div>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => { setOpen(true); setTimeout(() => form.setFieldsValue({ audience: 'course', priority: 'general', channels: ['in_app'] }), 0); }}>
          New announcement
        </Button>
      </div>
      {rows.length === 0 ? (
        <Card><Empty description="Nothing sent yet." /></Card>
      ) : (
        <Table
          rowKey="id"
          dataSource={rows}
          pagination={false}
          columns={[
            { title: 'Title', dataIndex: 'title' },
            { title: 'Priority', render: (_, r) => <Tag color={r.priority === 'important' ? 'red' : 'purple'}>{r.priority === 'important' ? 'Important' : 'General'}</Tag> },
            { title: 'Scope', render: (_, r) => <Tag>{r.audience === 'all' ? 'All' : r.audience === 'batch' ? r.batch : r.courseTitle}</Tag> },
            { title: 'Recipients', dataIndex: 'recipientsCount', width: 100 },
            { title: 'Emailed', dataIndex: 'emailedCount', width: 90 },
            { title: 'Sent', dataIndex: 'sentAt', render: (v) => dayjs(v).format('D MMM, HH:mm') },
            { title: '', width: 50, render: (_, r) => <Button size="small" danger icon={<DeleteOutlined />} onClick={async () => { await lmsApi.deleteAnnouncement(r.id); load(); }} /> },
          ]}
          expandable={{ expandedRowRender: (r) => <Paragraph style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{r.body}</Paragraph> }}
        />
      )}

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
        okText="Send"
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
              <Select options={[{ value: 'course', label: 'A course' }, { value: 'batch', label: 'A batch' }, { value: 'all', label: 'All candidates' }]} />
            </Form.Item>
            <Form.Item noStyle shouldUpdate={(p, c) => p.audience !== c.audience}>
              {({ getFieldValue }) => {
                const a = getFieldValue('audience');
                if (a === 'course') {
                  return (
                    <Form.Item name="course" label={<Lbl icon={<ReadOutlined />}>Course</Lbl>} rules={[{ required: true, message: 'Course is required' }]} className="crud-form-full">
                      <Select options={courses} showSearch optionFilterProp="label" placeholder="Select a course…" />
                    </Form.Item>
                  );
                }
                if (a === 'batch') {
                  return (
                    <Form.Item name="batch" label={<Lbl icon={<TeamOutlined />}>Batch</Lbl>} rules={[{ required: true, message: 'Batch is required' }]} className="crud-form-full">
                      <Select options={batches} showSearch optionFilterProp="label" placeholder="Select a batch…" />
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
            <p>{isTeacher ? 'Sent to your batches and courses.' : 'Updates from your instructors.'}</p>
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
                  <div className={`announcement-card ${important ? 'important' : 'general'}`} key={r.id}>
                    <div className="announcement-card-icon"><SoundOutlined /></div>
                    <div className="announcement-card-body">
                      <div className="announcement-card-title-row">
                        <h3 className="announcement-card-title">{r.title}</h3>
                        <span className={`announcement-type ${important ? 'important' : 'general'}`}>{important ? 'Important' : 'General'}</span>
                      </div>
                      {r.body && <p className="announcement-description">{r.body}</p>}
                      <div className="announcement-meta">
                        <span className="announcement-meta-item"><UserOutlined /> By {r.from}</span>
                        <span className="announcement-meta-item"><ClockCircleOutlined /> {readTime(r.body)} min read</span>
                      </div>
                    </div>
                    <div className="announcement-card-right">
                      <span className="announcement-date"><CalendarOutlined /> {dayjs(r.sentAt).format('D MMM YYYY, hh:mm A')}</span>
                      <span className="announcement-arrow"><RightOutlined /></span>
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
    </div>
  );
}

const MGR = ['owner', 'Super Admin', 'Admin', 'Sales Manager', 'Support'];

export default function Announcements() {
  const admin = useSelector(selectCurrentAdmin) || {};
  if (MGR.includes(admin.role)) return <TeacherAnnouncements />;
  return <ReadOnlyAnnouncements isTeacher={LMS_TEACHER_ROLES.includes(admin.role)} />;
}
