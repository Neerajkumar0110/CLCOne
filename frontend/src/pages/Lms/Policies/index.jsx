import React, { useCallback, useEffect, useState } from 'react';
import {
  Card, Table, Tag, Button, Modal, Form, Input, Select, Checkbox, Space, Empty, Skeleton, message, Typography, DatePicker, Progress, Drawer, Alert, Popconfirm,
} from 'antd';
import {
  FileProtectOutlined, PlusOutlined, CloudUploadOutlined, InboxOutlined, EyeOutlined, DeleteOutlined,
  TagOutlined, AppstoreOutlined, FileTextOutlined, LinkOutlined, CalendarOutlined, TeamOutlined, CheckSquareOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import { useSelector } from 'react-redux';
import { useNavigate } from 'react-router-dom';
import { selectCurrentAdmin } from '@/redux/auth/selectors';
import { LMS_TEACHER_ROLES } from '@/config/roles';
import { request } from '@/request';
import lmsApi from '../api';
import '../StudentDashboard/StudentHome.css';
import './StudentConsent.css';

const { Text, Paragraph } = Typography;
const MGR = ['owner', 'Super Admin', 'Admin', 'Sales Manager', 'Support'];

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

  const remove = async (row) => {
    setBusyId(row.id);
    try { await lmsApi.deletePolicy(row.id); message.success('Policy deleted.'); load(); }
    catch (e) { message.error('Delete failed.'); } finally { setBusyId(null); }
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
        <div><h2><FileProtectOutlined /> Policy & Acknowledgement Centre</h2><p>Upload, version and publish learner-facing policies — publishing auto-creates the acknowledgement requirement and reminds pending candidates automatically.</p></div>
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
            { title: 'Scope', width: 140, render: (_, r) => (r.audience === 'all' ? 'All candidates' : r.audience === 'batch' ? r.batch : r.courseTitle) },
            { title: 'Mandatory', dataIndex: 'mandatory', width: 100, render: (v) => (v ? <Tag color="volcano">Mandatory</Tag> : <Tag>Optional</Tag>) },
            { title: 'Status', dataIndex: 'status', width: 100, render: (v) => <Tag color={STATUS_COLOR[v]}>{v}</Tag> },
            {
              title: 'Acknowledged', width: 160, render: (_, r) => r.status === 'published'
                ? <Progress percent={r.recipientsCount ? Math.round((r.acknowledgedCount / r.recipientsCount) * 100) : 0} size="small" format={() => `${r.acknowledgedCount || 0}/${r.recipientsCount || 0}`} />
                : '—',
            },
            {
              title: '', width: 280, render: (_, r) => (
                <Space size="small">
                  {r.status === 'draft' && <Button size="small" type="primary" icon={<CloudUploadOutlined />} loading={busyId === r.id} onClick={() => publish(r)}>Publish</Button>}
                  {r.status === 'published' && <Button size="small" danger loading={busyId === r.id} onClick={() => archive(r)}>Archive</Button>}
                  {r.status !== 'draft' && <Button size="small" icon={<EyeOutlined />} onClick={() => openReport(r)}>Report</Button>}
                  <Popconfirm
                    title="Delete this policy?"
                    description="This removes the document entirely, including its acknowledgement trail — archiving is usually what you want instead."
                    okText="Delete" okButtonProps={{ danger: true }}
                    onConfirm={() => remove(r)}
                  >
                    <Button size="small" danger icon={<DeleteOutlined />} loading={busyId === r.id} />
                  </Popconfirm>
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
              <Select options={[{ value: 'all', label: 'All candidates' }, { value: 'course', label: 'An internship' }, { value: 'batch', label: 'A batch' }]} />
            </Form.Item>
            <Form.Item noStyle shouldUpdate={(p, c) => p.audience !== c.audience}>
              {({ getFieldValue }) => {
                const a = getFieldValue('audience');
                if (a === 'course') return <Form.Item name="course" label={<Lbl icon={<AppstoreOutlined />}>Internship</Lbl>} rules={[{ required: true, message: 'Pick an internship' }]}><Select options={courses} showSearch optionFilterProp="label" /></Form.Item>;
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
                { title: 'Candidate', dataIndex: 'student' },
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

/* ═══════════ STUDENT — consent page (design L1) ═══════════ */
// One page lists every policy that applies to the learner (Accepted / Read /
// Not opened), each readable in a modal, and a single acknowledgement accepts
// all pending ones — each still goes through POST /policies/:id/acknowledge,
// so every policy keeps its own version + time + IP record. Until mandatory
// ones are accepted the server keeps classes, recordings, tests and projects
// locked (requirePoliciesAccepted) and the panel redirects here.
function StudentPolicies() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState(null);
  const [agree, setAgree] = useState(false);
  const [accepting, setAccepting] = useState(false);
  const navigate = useNavigate();

  const load = useCallback(() => {
    setLoading(true);
    lmsApi
      .myPolicies()
      .then((r) => setRows((r && r.result) || []))
      .catch(() => message.error('Load failed'))
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  const open = (r) => {
    setView(r);
    if (!r.openedAt) {
      lmsApi.markPolicyOpened(r.policyId).catch(() => {});
      setRows((xs) => xs.map((x) => (x.id === r.id ? { ...x, openedAt: new Date().toISOString() } : x)));
    }
  };

  const pending = rows.filter((r) => r.status === 'pending');

  const acceptAll = async () => {
    setAccepting(true);
    let failed = 0;
    for (const r of pending) {
      // eslint-disable-next-line no-await-in-loop
      const res = await lmsApi.acknowledgePolicy(r.policyId).catch(() => null);
      if (!res || res.success === false) failed += 1;
    }
    setAccepting(false);
    setAgree(false);
    window.dispatchEvent(new Event('lms:updates'));
    if (failed) {
      message.error(`${failed} polic${failed === 1 ? 'y' : 'ies'} could not be accepted — please try again.`);
      load();
      return;
    }
    message.success('Policies accepted.');
    navigate('/learn');
  };

  if (loading) return <Skeleton active paragraph={{ rows: 5 }} style={{ padding: 24 }} />;

  const chipFor = (r) => {
    if (r.status === 'acknowledged') return <span className="sh-chip ok">Accepted</span>;
    if (r.openedAt) return <span className="sh-chip info">Read</span>;
    return <span className="sh-chip gray">Not opened</span>;
  };
  const mandatoryPending = pending.filter((r) => r.mandatory !== false).length;

  return (
    <div className="sh-root lms-portal">
      <div className="sh-head">
        <div>
          <div className="sh-muted" style={{ fontWeight: 700, letterSpacing: '0.06em', fontSize: 12 }}>ACCOUNT ACTIVATION</div>
          <h1>{pending.length ? 'LMS shuru karne se pehle policies accept karein' : 'Policies & agreements'}</h1>
          <div className="sh-sub">
            {mandatoryPending
              ? 'Jab tak accept nahi hota, classes, recordings, tests aur projects band rahenge — direct link se bhi.'
              : 'Aapne saari zaroori policies accept kar li hain.'}
          </div>
        </div>
      </div>

      <div className="pc-grid">
        <section className="sh-card" aria-label="Your policies">
          <div className="sh-card-hd">
            <b>Aapke liye policies ({rows.length})</b>
          </div>
          {rows.length === 0 ? (
            <Empty description="No policies have been published for you yet." />
          ) : (
            <div>
              {rows.map((r) => (
                <div className="sh-row" key={r.id}>
                  <span style={{ minWidth: 0 }}>
                    <b>{r.title}</b> <span className="sh-muted">v{r.version}</span>
                    {r.mandatory === false && <span className="sh-muted"> · optional</span>}
                    {r.status === 'acknowledged' && r.acknowledgedAt && (
                      <div className="sh-muted">Accepted {dayjs(r.acknowledgedAt).format('D MMM YYYY, HH:mm')}</div>
                    )}
                  </span>
                  <span style={{ display: 'flex', gap: 10, alignItems: 'center', flexShrink: 0 }}>
                    {chipFor(r)}
                    <button type="button" className="sh-link" onClick={() => open(r)}>
                      Open
                    </button>
                  </span>
                </div>
              ))}
            </div>
          )}
          {mandatoryPending > 0 && (
            <div className="sh-muted">
              Locked till accepted: <b>Live Classes · Recordings · Tests · Projects</b>. Support aur yeh page khule rahenge.
            </div>
          )}
        </section>

        {pending.length > 0 && (
          <section className="sh-card" aria-label="Learner policy acknowledgement">
            <div className="sh-card-hd">
              <b>Learner Policy Acknowledgement</b>
            </div>
            <div className="pc-text">
              I confirm that I have been given access to the policies listed here, provided by Career Lab Consulting. I have had the
              opportunity to read them and seek clarification where needed. I agree to follow the applicable policies and use the LMS
              responsibly. I will keep my login credentials confidential, provide accurate information, follow assessment instructions,
              and report technical issues through the designated support channels. I understand that mandatory policy acceptance is
              required before my LMS access is activated.
            </div>
            <Checkbox checked={agree} onChange={(e) => setAgree(e.target.checked)}>
              Maine upar di gayi sabhi policies padh li hain aur main inhe accept karta/karti hoon.
            </Checkbox>
            <div className="pc-meta">
              <div>
                <div className="sh-muted">Saved with acceptance</div>
                <b>Learner ID + version</b>
              </div>
              <div>
                <div className="sh-muted">Timestamp</div>
                <b>Time of accepting (IST)</b>
              </div>
              <div>
                <div className="sh-muted">Audit ref</div>
                <b>IP + device, logged</b>
              </div>
            </div>
            <div className="sh-card-hd" style={{ marginTop: 'auto', flexWrap: 'wrap' }}>
              <button
                type="button"
                className="sh-link"
                onClick={() => navigate('/learn/support', { state: { raise: { category: 'Other', subject: 'Question about a policy', description: 'Policy name:\nMy question:' } } })}
              >
                Kuch samajh nahi aaya? Support se poochein
              </button>
              <Button type="primary" disabled={!agree} loading={accepting} onClick={acceptAll}>
                Accept &amp; continue →
              </Button>
            </div>
          </section>
        )}
      </div>

      <Modal open={!!view} title={view ? `${view.title} · v${view.version}` : ''} width={680} destroyOnClose onCancel={() => setView(null)} footer={<Button onClick={() => setView(null)}>Close</Button>}>
        <div style={{ maxHeight: 420, overflowY: 'auto', border: '1px solid #e3e8ef', borderRadius: 8, padding: 14, marginBottom: 12, whiteSpace: 'pre-wrap' }}>
          {view?.content || 'No content provided.'}
        </div>
        {view?.fileUrl && (
          <p>
            <a href={view.fileUrl} target="_blank" rel="noopener noreferrer">
              View attached document
            </a>
          </p>
        )}
        {view?.effectiveDate && <Text type="secondary">Effective from {dayjs(view.effectiveDate).format('D MMM YYYY')}</Text>}
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
