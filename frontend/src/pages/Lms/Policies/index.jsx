import React, { useCallback, useEffect, useState } from 'react';
import {
  Card, Table, Tag, Button, Modal, Form, Input, Select, Checkbox, Space, Empty, Skeleton, message, Typography, DatePicker, Progress, Drawer, Alert,
} from 'antd';
import {
  FileProtectOutlined, PlusOutlined, CloudUploadOutlined, InboxOutlined, EyeOutlined,
  TagOutlined, AppstoreOutlined, FileTextOutlined, LinkOutlined, CalendarOutlined, TeamOutlined, CheckSquareOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import { useSelector } from 'react-redux';
import { selectCurrentAdmin } from '@/redux/auth/selectors';
import { LMS_TEACHER_ROLES } from '@/config/roles';
import { request } from '@/request';
import lmsApi from '../api';

const { Text, Paragraph } = Typography;
const MGR = ['owner', 'Super Admin', 'Admin', 'Sales Manager'];

// Kept in sync by hand with backend/src/config/lmsPolicyCategories.js (same
// convention as config/roles.js — the two packages can't share a literal import).
const CATEGORIES = [
  'Placement Assurance Agreement', 'Program Terms & Conditions', 'Attendance Policy',
  'Assessment & Examination Policy', 'Attempt / Retake Policy', 'Disqualification / Qualification Policy',
  'Project Submission & Evaluation Policy', 'Code of Conduct', 'Class Participation & Camera/Microphone Policy',
  'Academic Integrity / Plagiarism Policy', 'AI Usage Policy', 'Privacy Policy / Data Processing Notice',
  'Communication Consent Policy', 'Refund / Cancellation Policy', 'Leave / Absence Policy',
  'Certificate Eligibility Policy', 'Placement Participation / Interview Policy', 'Project Confidentiality / IP Policy',
  'Recording & Content Usage Policy', 'Payment / Fee / EMI Policy', 'Voucher / Coupon / Offer Terms',
  'Curriculum Change / Batch Transfer Policy', 'Other',
];

const STATUS_COLOR = { draft: 'default', published: 'green', archived: 'red' };

// Same label-with-icon treatment as the CRM's generic Add/Edit modal
// (components/CrudTab — .crud-lbl / .crud-lbl-icon in featureHub.css).
const Lbl = ({ icon, children }) => (
  <span className="crud-lbl"><span className="crud-lbl-icon">{icon}</span>{children}</span>
);

/* ═══════════ MANAGER — create / publish / archive / report ═══════════ */
function ManagePolicies() {
  const [rows, setRows] = useState([]);
  const [courses, setCourses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [form] = Form.useForm();
  const [report, setReport] = useState(null); // { policy, data }
  const [busyId, setBusyId] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [p, c] = await Promise.all([
        lmsApi.listPolicies(),
        request.list({ entity: 'course', options: { items: 300 } }),
      ]);
      setRows((p && p.result) || []);
      setCourses(((c && c.result) || []).map((x) => ({ value: x._id || x.id, label: x.title })));
    } catch (e) {
      message.error('Could not load policies.');
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const create = async () => {
    let v;
    try { v = await form.validateFields(); } catch (e) { return; }
    try {
      const res = await lmsApi.createPolicy({ ...v, effectiveDate: v.effectiveDate ? v.effectiveDate.toISOString() : undefined });
      message.success(res?.message || 'Draft created.');
      setOpen(false); form.resetFields(); load();
    } catch (e) { message.error('Could not create draft.'); }
  };

  const publish = async (row) => {
    setBusyId(row.id);
    try {
      const res = await lmsApi.publishPolicy(row.id);
      message.success(res?.message || 'Published.');
      load();
    } catch (e) { message.error('Publish failed.'); } finally { setBusyId(null); }
  };

  const archive = async (row) => {
    setBusyId(row.id);
    try { await lmsApi.archivePolicy(row.id); message.success('Archived.'); load(); }
    catch (e) { message.error('Archive failed.'); } finally { setBusyId(null); }
  };

  const openReport = async (row) => {
    try {
      const res = await lmsApi.policyReport(row.id);
      setReport({ policy: row, data: res?.result || null });
    } catch (e) { message.error('Could not load report.'); }
  };

  if (loading) return <Skeleton active paragraph={{ rows: 6 }} style={{ padding: 24 }} />;

  return (
    <div className="lms-portal" style={{ padding: 4 }}>
      <div className="lms-portal-head">
        <div><h2><FileProtectOutlined /> Policy & Acknowledgement Centre</h2><p>Upload, version and publish learner-facing policies — publishing auto-creates the acknowledgement requirement and reminds pending students automatically.</p></div>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => { setOpen(true); setTimeout(() => form.setFieldsValue({ category: 'Other', audience: 'all', mandatory: true }), 0); }}>
          New policy
        </Button>
      </div>

      {rows.length === 0 ? <Card><Empty description="No policies yet." /></Card> : (
        <Table
          rowKey="id"
          dataSource={rows}
          pagination={{ pageSize: 12 }}
          columns={[
            { title: 'Title', dataIndex: 'title', render: (v, r) => <span><b>{v}</b> <Text type="secondary">v{r.version}</Text></span> },
            { title: 'Category', dataIndex: 'category', width: 200, render: (v) => <Tag>{v}</Tag> },
            { title: 'Scope', width: 140, render: (_, r) => (r.audience === 'all' ? 'All students' : r.audience === 'batch' ? r.batch : r.courseTitle) },
            { title: 'Mandatory', dataIndex: 'mandatory', width: 100, render: (v) => (v ? <Tag color="volcano">Mandatory</Tag> : <Tag>Optional</Tag>) },
            { title: 'Status', dataIndex: 'status', width: 100, render: (v) => <Tag color={STATUS_COLOR[v]}>{v}</Tag> },
            {
              title: 'Acknowledged', width: 160, render: (_, r) => r.status === 'published'
                ? <Progress percent={r.recipientsCount ? Math.round((r.acknowledgedCount / r.recipientsCount) * 100) : 0} size="small" format={() => `${r.acknowledgedCount || 0}/${r.recipientsCount || 0}`} />
                : '—',
            },
            {
              title: '', width: 220, render: (_, r) => (
                <Space size="small">
                  {r.status === 'draft' && <Button size="small" type="primary" icon={<CloudUploadOutlined />} loading={busyId === r.id} onClick={() => publish(r)}>Publish</Button>}
                  {r.status === 'published' && <Button size="small" danger loading={busyId === r.id} onClick={() => archive(r)}>Archive</Button>}
                  {r.status !== 'draft' && <Button size="small" icon={<EyeOutlined />} onClick={() => openReport(r)}>Report</Button>}
                </Space>
              ),
            },
          ]}
          expandable={{ expandedRowRender: (r) => <Paragraph style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{r.content || <Text type="secondary">No content — see file.</Text>}</Paragraph> }}
        />
      )}

      <Modal
        className="crud-modal"
        open={open}
        title={
          <span className="crud-modal-title">
            <span className="crud-modal-title-icon"><FileProtectOutlined /></span>
            <span>
              <span className="crud-modal-title-kicker">New record</span>
              <span className="crud-modal-title-main">New Policy</span>
            </span>
          </span>
        }
        onCancel={() => setOpen(false)}
        onOk={create}
        okText="Save as draft"
        destroyOnClose
        maskClosable={false}
        width={780}
      >
        <Form form={form} layout="vertical" className="crud-form" preserve={false} scrollToFirstError={{ behavior: 'smooth', block: 'center' }}>
          <div className="crud-form-grid">
            <Form.Item name="title" label={<Lbl icon={<TagOutlined />}>Title</Lbl>} rules={[{ required: true, message: 'Title is required' }]}>
              <Input placeholder="e.g. Attendance Policy" />
            </Form.Item>
            <Form.Item name="category" label={<Lbl icon={<AppstoreOutlined />}>Category</Lbl>}>
              <Select options={CATEGORIES.map((c) => ({ value: c, label: c }))} showSearch />
            </Form.Item>
            <Form.Item name="content" label={<Lbl icon={<FileTextOutlined />}>Policy text</Lbl>} className="crud-form-full" rules={[{ required: true, message: 'Policy text is required' }]}>
              <Input.TextArea rows={6} placeholder="Full policy text learners will read before acknowledging" />
            </Form.Item>
            <Form.Item name="fileUrl" label={<Lbl icon={<LinkOutlined />}>Attached document URL</Lbl>} extra="Optional">
              <Input placeholder="https://..." />
            </Form.Item>
            <Form.Item name="effectiveDate" label={<Lbl icon={<CalendarOutlined />}>Effective date</Lbl>}>
              <DatePicker style={{ width: '100%' }} format="DD MMM YYYY" />
            </Form.Item>
            <Form.Item name="audience" label={<Lbl icon={<TeamOutlined />}>Applies to</Lbl>}>
              <Select options={[{ value: 'all', label: 'All students' }, { value: 'course', label: 'A course' }, { value: 'batch', label: 'A batch' }]} />
            </Form.Item>
            <Form.Item noStyle shouldUpdate={(p, c) => p.audience !== c.audience}>
              {({ getFieldValue }) => {
                const a = getFieldValue('audience');
                if (a === 'course') return <Form.Item name="course" label={<Lbl icon={<AppstoreOutlined />}>Course</Lbl>} rules={[{ required: true, message: 'Pick a course' }]}><Select options={courses} showSearch optionFilterProp="label" /></Form.Item>;
                if (a === 'batch') return <Form.Item name="batch" label={<Lbl icon={<TeamOutlined />}>Batch name</Lbl>} rules={[{ required: true, message: 'Batch name is required' }]}><Input placeholder="Exact batch name" /></Form.Item>;
                return <div />;
              }}
            </Form.Item>
          </div>
          <Form.Item name="mandatory" valuePropName="checked" noStyle>
            <Checkbox style={{ marginTop: 4 }}><CheckSquareOutlined /> Mandatory acknowledgement</Checkbox>
          </Form.Item>
        </Form>
      </Modal>

      <Drawer open={!!report} onClose={() => setReport(null)} title={report ? `${report.policy.title} — acknowledgements` : ''} width={480}>
        {report && report.data && (
          <>
            <Alert
              style={{ marginBottom: 12 }}
              type={report.data.pending ? 'warning' : 'success'}
              message={`${report.data.acknowledged}/${report.data.total} acknowledged · ${report.data.pending} pending`}
            />
            <Table
              rowKey="id" size="small" pagination={{ pageSize: 20 }} dataSource={report.data.rows}
              columns={[
                { title: 'Student', dataIndex: 'student' },
                { title: 'Status', dataIndex: 'status', render: (v) => <Tag color={v === 'acknowledged' ? 'green' : 'default'}>{v}</Tag> },
                { title: 'When', dataIndex: 'acknowledgedAt', render: (v) => (v ? dayjs(v).format('D MMM, HH:mm') : '—') },
              ]}
            />
          </>
        )}
      </Drawer>
    </div>
  );
}

/* ═══════════ TEACHER — read-only ═══════════ */
function ViewPolicies() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    lmsApi.listPolicies({ status: 'published' }).then((r) => setRows((r && r.result) || [])).catch(() => message.error('Load failed')).finally(() => setLoading(false));
  }, []);
  if (loading) return <Skeleton active paragraph={{ rows: 5 }} style={{ padding: 24 }} />;
  return (
    <div className="lms-portal" style={{ padding: 4 }}>
      <div className="lms-portal-head"><div><h2><FileProtectOutlined /> Policies</h2><p>Published policies (view only — managed by admin).</p></div></div>
      {rows.length === 0 ? <Card><Empty description="No published policies." /></Card> : rows.map((r) => (
        <Card key={r.id} size="small" style={{ marginBottom: 12 }} title={<Space><b>{r.title}</b><Tag>{r.category}</Tag><Text type="secondary">v{r.version}</Text></Space>}>
          <Paragraph style={{ whiteSpace: 'pre-wrap', marginBottom: 4 }}>{r.content}</Paragraph>
        </Card>
      ))}
    </div>
  );
}

/* ═══════════ STUDENT — acknowledge ═══════════ */
function StudentPolicies() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState(null);
  const [acking, setAcking] = useState(false);
  const [agree, setAgree] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    lmsApi.myPolicies().then((r) => setRows((r && r.result) || [])).catch(() => message.error('Load failed')).finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(); }, [load]);

  const acknowledge = async () => {
    if (!view) return;
    setAcking(true);
    try {
      await lmsApi.acknowledgePolicy(view.policyId);
      message.success('Acknowledged.');
      setView(null); setAgree(false); load();
    } catch (e) { message.error('Could not acknowledge.'); } finally { setAcking(false); }
  };

  if (loading) return <Skeleton active paragraph={{ rows: 5 }} style={{ padding: 24 }} />;
  const pending = rows.filter((r) => r.status === 'pending');
  const done = rows.filter((r) => r.status === 'acknowledged');

  return (
    <div className="lms-portal" style={{ padding: 4 }}>
      <div className="lms-portal-head"><div><h2><FileProtectOutlined /> Policies & Agreements</h2><p>Read and acknowledge each policy that applies to you.</p></div></div>

      {pending.length > 0 && (
        <>
          <h4 style={{ margin: '4px 0 8px' }}>Pending ({pending.length})</h4>
          {pending.map((r) => (
            <Card key={r.id} size="small" style={{ marginBottom: 10, borderColor: r.mandatory ? '#fa8c16' : undefined }}
              title={<Space><b>{r.title}</b><Tag>{r.category}</Tag>{r.mandatory && <Tag color="volcano">Mandatory</Tag>}</Space>}
              extra={<Button type="primary" icon={<InboxOutlined />} onClick={() => setView(r)}>Read & Acknowledge</Button>}>
              <Paragraph type="secondary" style={{ marginBottom: 0 }} ellipsis={{ rows: 2 }}>{r.content}</Paragraph>
            </Card>
          ))}
        </>
      )}

      <h4 style={{ margin: '16px 0 8px' }}>Acknowledged ({done.length})</h4>
      {done.length === 0 ? <Card><Empty description="Nothing acknowledged yet." /></Card> : done.map((r) => (
        <Card key={r.id} size="small" style={{ marginBottom: 8 }} title={<Space><b>{r.title}</b><Tag color="green">v{r.version}</Tag></Space>}>
          <Text type="secondary">Acknowledged {r.acknowledgedAt ? dayjs(r.acknowledgedAt).format('D MMM YYYY, HH:mm') : ''}</Text>
        </Card>
      ))}

      <Modal
        open={!!view} title={view?.title} width={640} destroyOnClose
        onCancel={() => { setView(null); setAgree(false); }}
        footer={[
          <Button key="c" onClick={() => { setView(null); setAgree(false); }}>Cancel</Button>,
          <Button key="a" type="primary" disabled={!agree} loading={acking} onClick={acknowledge}>I Agree — Acknowledge</Button>,
        ]}
      >
        <div style={{ maxHeight: 360, overflowY: 'auto', border: '1px solid #e3e8ef', borderRadius: 8, padding: 14, marginBottom: 12, whiteSpace: 'pre-wrap' }}>
          {view?.content || 'No content provided.'}
        </div>
        {view?.fileUrl && <p><a href={view.fileUrl} target="_blank" rel="noopener noreferrer">View attached document</a></p>}
        <Checkbox checked={agree} onChange={(e) => setAgree(e.target.checked)}>
          I have read and understood this policy (version {view?.version}) and agree to it.
        </Checkbox>
      </Modal>
    </div>
  );
}

export default function Policies() {
  const admin = useSelector(selectCurrentAdmin) || {};
  if (MGR.includes(admin.role)) return <ManagePolicies />;
  if (LMS_TEACHER_ROLES.includes(admin.role)) return <ViewPolicies />;
  return <StudentPolicies />;
}
