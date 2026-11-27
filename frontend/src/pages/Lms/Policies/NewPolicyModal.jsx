import React, { useEffect, useRef, useState } from 'react';
import { Modal, Form, Input, Select, Checkbox, DatePicker, Button, message } from 'antd';
import { UploadOutlined, PaperClipOutlined } from '@ant-design/icons';
import {
  FileProtectOutlined, TagOutlined, AppstoreOutlined, FileTextOutlined, LinkOutlined, CalendarOutlined, TeamOutlined, CheckSquareOutlined,
} from '@ant-design/icons';
import { request } from '@/request';
import lmsApi from '../api';
import './policyDesign.css';
import { useSelector } from 'react-redux';
import { selectCurrentAdmin } from '@/redux/auth/selectors';

// Delete a policy for everyone (all versions + every learner's pending /
// accepted record) after one confirm — used by both Policies tabs.
export function confirmDeletePolicy(policy, onDone) {
  if (!policy) return;
  Modal.confirm({
    title: `Delete “${policy.title}”?`,
    content: 'It is removed for everyone: all versions, and every learner’s pending or accepted record. Learners will no longer see it and it will not lock anyone’s LMS.',
    okText: 'Delete for everyone',
    okButtonProps: { danger: true },
    cancelText: 'Cancel',
    centered: true,
    onOk: async () => {
      try {
        const r = await lmsApi.deletePolicy(policy.id);
        if (r && r.success === false) throw new Error(r.message);
        message.success((r && r.message) || 'Policy deleted.');
        if (onDone) onDone();
      } catch (e) {
        message.error((e && e.message) || 'Could not delete the policy.');
      }
    },
  });
}

// Upload the policy document — PDF / DOC / DOCX only (LMS testing report #5).
// Writes the served URL into the hidden fileUrl field.
const POLICY_EXTS = ['.pdf', '.doc', '.docx'];
function PolicyFileField({ form }) {
  const url = Form.useWatch('fileUrl', form);
  const [busy, setBusy] = useState(false);
  const inp = useRef(null);
  const pick = async (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file) return;
    const ext = `.${String(file.name).split('.').pop().toLowerCase()}`;
    if (!POLICY_EXTS.includes(ext)) return message.error('Only PDF or Word (.doc / .docx) files can be attached to a policy.');
    if (file.size > 20 * 1024 * 1024) return message.error('The file is larger than 20 MB.');
    const fd = new FormData();
    fd.append('file', file);
    setBusy(true);
    const r = await request.post({ entity: 'lms/policies/upload', jsonData: fd });
    setBusy(false);
    if (!(r && r.success)) return;
    form.setFieldsValue({ fileUrl: r.result.url });
    // learners read text only: the PDF's text goes into "Policy text" (2026-11-27)
    const text = r.result.text || '';
    if (!text) {
      if (ext === '.pdf') message.warning('Could not read text from this PDF (a scanned image?) — please type or paste the policy text.', 6);
      return;
    }
    const cur = String(form.getFieldValue('content') || '').trim();
    if (!cur) {
      form.setFieldsValue({ content: text });
      message.success('Text taken from the PDF — check it in “Policy text”. Learners read this text.');
    } else {
      Modal.confirm({
        title: 'Replace the policy text with the PDF text?',
        content: 'Learners read the policy text, not the PDF. Replace what is typed now with the text read from the PDF?',
        okText: 'Replace',
        cancelText: 'Keep mine',
        centered: true,
        onOk: () => form.setFieldsValue({ content: text }),
      });
    }
  };
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
      <Button icon={<UploadOutlined />} loading={busy} onClick={() => inp.current && inp.current.click()}>
        {busy ? 'Uploading…' : url ? 'Replace file' : 'Upload PDF / Word'}
      </Button>
      <input ref={inp} type="file" accept=".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document" disabled={busy} onChange={pick} style={{ display: 'none' }} tabIndex={-1} aria-hidden="true" />
      {url ? (
        <>
          <PaperClipOutlined style={{ color: '#64748b' }} />
          <a href={url} target="_blank" rel="noreferrer" style={{ fontSize: 13, maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{decodeURIComponent(String(url).split('/').pop())}</a>
          <button type="button" onClick={() => form.setFieldsValue({ fileUrl: '' })} style={{ border: 0, background: 'none', color: '#b91c1c', cursor: 'pointer', fontSize: 12 }}>Remove</button>
        </>
      ) : null}
    </div>
  );
}

// "New policy" form — used by Admin & Ops → Policy centre, the one place
// policies are created; the draft then goes through that screen's
// approval → publish workflow.

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

// Same label-with-icon treatment as the CRM's generic Add/Edit modal
// (components/CrudTab — .crud-lbl / .crud-lbl-icon in featureHub.css).
const Lbl = ({ icon, children }) => (
  <span className="crud-lbl"><span className="crud-lbl-icon">{icon}</span>{children}</span>
);

export default function NewPolicyModal({ open, onClose, onCreated }) {
  const [form] = Form.useForm();
  // owner / Super Admin / Admin: published at once, no approval (2026-11-27)
  const me = useSelector(selectCurrentAdmin) || {};
  const direct = ['owner', 'Super Admin', 'Admin'].includes(me.role);
  const [courses, setCourses] = useState([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open || courses.length) return;
    request
      .list({ entity: 'course', options: { items: 300 } })
      .then((c) => setCourses(((c && c.result) || []).map((x) => ({ value: x._id || x.id, label: x.title }))))
      .catch(() => {});
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const create = async () => {
    let v;
    try { v = await form.validateFields(); } catch (e) { return; }
    setSaving(true);
    try {
      const res = await lmsApi.createPolicy({ ...v, effectiveDate: v.effectiveDate ? v.effectiveDate.toISOString() : undefined });
      if (!res || res.success === false) {
        message.error((res && res.message) || 'Could not create draft.');
        return;
      }
      message.success(res.message || 'Draft created.');
      form.resetFields();
      onCreated(res.result && res.result.id, direct);
    } catch (e) {
      message.error('Could not create draft.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      className="crud-modal"
      open={open}
      title={
        <span className="crud-modal-title">
          <span className="crud-modal-title-icon"><FileProtectOutlined /></span>
          <span>
            <span className="crud-modal-title-kicker">{direct ? 'Admin policy · goes live at once' : 'New record · needs Admin approval'}</span>
            <span className="crud-modal-title-main">New Policy</span>
          </span>
        </span>
      }
      onCancel={onClose}
      onOk={create}
      okText={direct ? 'Publish to learners' : 'Save as draft'}
      confirmLoading={saving}
      destroyOnClose
      maskClosable={false}
      width={780}
    >
      <div className={`pol-alert ${direct ? 'ok' : 'info'}`} style={{ marginBottom: 16 }}>
        <span>{direct
          ? <><b>You are an Admin — no approval needed.</b> When you press “Publish to learners” this policy goes live for everyone it applies to at once (they are notified), and Support sees it as an Admin policy.</>
          : <><b>Saved as a draft.</b> Then open it in “Publish &amp; track”, choose an Admin and send it for approval — after the Admin approves, you publish it.</>}</span>
      </div>
      <Form form={form} layout="vertical" className="crud-form" preserve={false} initialValues={{ category: 'Other', audience: 'all', mandatory: true }} scrollToFirstError={{ behavior: 'smooth', block: 'center' }}>
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
          <Form.Item label={<Lbl icon={<LinkOutlined />}>Policy document</Lbl>} extra="Optional · PDF or Word (.doc / .docx) only, up to 20 MB">
            <PolicyFileField form={form} />
          </Form.Item>
          <Form.Item name="fileUrl" hidden>
            <Input />
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
  );
}
