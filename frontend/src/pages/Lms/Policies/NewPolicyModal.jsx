import React, { useEffect, useState } from 'react';
import { Modal, Form, Input, Select, Checkbox, DatePicker, message } from 'antd';
import {
  FileProtectOutlined, TagOutlined, AppstoreOutlined, FileTextOutlined, LinkOutlined, CalendarOutlined, TeamOutlined, CheckSquareOutlined,
} from '@ant-design/icons';
import { request } from '@/request';
import lmsApi from '../api';

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
      onCreated(res.result && res.result.id);
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
            <span className="crud-modal-title-kicker">New record</span>
            <span className="crud-modal-title-main">New Policy</span>
          </span>
        </span>
      }
      onCancel={onClose}
      onOk={create}
      okText="Save as draft"
      confirmLoading={saving}
      destroyOnClose
      maskClosable={false}
      width={780}
    >
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
  );
}
