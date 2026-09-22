import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Form, Input, Button, Upload, message, Result, Spin } from 'antd';
import { UploadOutlined, CheckCircleFilled, ClockCircleOutlined, SafetyCertificateOutlined } from '@ant-design/icons';
import paymentsPublicApi from './publicApi';

const fmtInr = (n) => {
  try {
    return Number(n).toLocaleString('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });
  } catch (e) {
    return `₹${n}`;
  }
};

const DOC_FIELDS = [
  ['aadharFront', 'Aadhar card — front'],
  ['aadharBack', 'Aadhar card — back'],
  ['panFront', 'PAN card — front'],
  ['panBack', 'PAN card — back'],
];

export default function PublicKycForm() {
  const { token } = useParams();
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [info, setInfo] = useState(null); // { studentName, course, amount, status, shortUrl, kycSubmitted }
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const files = useRef({});
  const pollTimer = useRef(null);

  const load = useCallback(async () => {
    try {
      const res = await paymentsPublicApi.status(token);
      setInfo(res.result);
      setNotFound(false);
    } catch (e) {
      setNotFound(true);
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    load();
    return () => clearTimeout(pollTimer.current);
  }, [load]);

  // While not yet paid, keep checking — the Razorpay redirect can land here
  // a beat before the callback finishes updating our own DB, and a student
  // may also just open this link before paying.
  useEffect(() => {
    if (!info || info.status === 'paid') return;
    pollTimer.current = setTimeout(load, 4000);
    return () => clearTimeout(pollTimer.current);
  }, [info, load]);

  const onPickFile = (field) => (file) => {
    files.current[field] = file;
    return false; // prevent antd Upload's own auto-upload — we upload on submit
  };

  const onSubmit = async (values) => {
    const missing = DOC_FIELDS.filter(([field]) => !files.current[field]);
    if (missing.length) {
      message.error(`Please attach: ${missing.map(([, label]) => label).join(', ')}.`);
      return;
    }
    setSubmitting(true);
    try {
      const uploaded = {};
      for (const [field] of DOC_FIELDS) {
        const res = await paymentsPublicApi.uploadDoc(token, files.current[field]);
        uploaded[field] = res.result.path;
      }
      await paymentsPublicApi.submitKyc(token, { ...values, ...uploaded });
      setDone(true);
    } catch (e) {
      message.error(e?.response?.data?.message || 'Could not submit — please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="pay-kyc-shell pay-kyc-center">
        <Spin size="large" />
      </div>
    );
  }
  if (notFound) {
    return (
      <div className="pay-kyc-shell pay-kyc-center">
        <Result status="404" title="Link not found" subTitle="This payment link is invalid or has expired." />
      </div>
    );
  }
  if (done || info.kycSubmitted) {
    return (
      <div className="pay-kyc-shell pay-kyc-center">
        <Result
          icon={<CheckCircleFilled style={{ color: '#22c55e' }} />}
          title="Submitted"
          subTitle="Thanks — your details have been received. Our team will reach out if anything else is needed."
        />
      </div>
    );
  }
  if (info.status !== 'paid') {
    return (
      <div className="pay-kyc-shell pay-kyc-center">
        <div className="pay-kyc-waitcard">
          <ClockCircleOutlined className="pay-kyc-wait-icon" />
          <h2>Complete your payment</h2>
          <p>
            {info.studentName}
            {info.course ? ` · ${info.course}` : ''}
          </p>
          <div className="pay-kyc-amount">{fmtInr(info.amount)}</div>
          <a className="pay-kyc-pay-btn" href={info.shortUrl}>
            Pay now
          </a>
          <p className="pay-kyc-wait-note">This page updates automatically once your payment is confirmed.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="pay-kyc-shell">
      <div className="pay-kyc-card">
        <div className="pay-kyc-head">
          <SafetyCertificateOutlined className="pay-kyc-head-icon" />
          <div>
            <h2>Complete your KYC</h2>
            <p>
              Payment of {fmtInr(info.amount)} confirmed for {info.studentName}
              {info.course ? ` (${info.course})` : ''}. Fill this form to finish your enrollment.
            </p>
          </div>
        </div>

        <Form form={form} layout="vertical" onFinish={onSubmit} requiredMark={false}>
          <div className="pay-kyc-grid">
            <Form.Item name="name" label="Full name" rules={[{ required: true, message: 'Required' }]}>
              <Input />
            </Form.Item>
            <Form.Item name="fatherName" label="Father's name" rules={[{ required: true, message: 'Required' }]}>
              <Input />
            </Form.Item>
            <Form.Item name="motherName" label="Mother's name" rules={[{ required: true, message: 'Required' }]}>
              <Input />
            </Form.Item>
            <Form.Item name="state" label="State" rules={[{ required: true, message: 'Required' }]}>
              <Input />
            </Form.Item>
            <Form.Item name="city" label="City" rules={[{ required: true, message: 'Required' }]}>
              <Input />
            </Form.Item>
            <Form.Item name="district" label="District" rules={[{ required: true, message: 'Required' }]}>
              <Input />
            </Form.Item>
            <Form.Item name="pincode" label="Pin code" rules={[{ required: true, message: 'Required' }]}>
              <Input maxLength={6} />
            </Form.Item>
          </div>
          <Form.Item name="address" label="Full address" rules={[{ required: true, message: 'Required' }]}>
            <Input.TextArea rows={3} />
          </Form.Item>

          <div className="pay-kyc-docs-head">Upload documents</div>
          <div className="pay-kyc-doc-grid">
            {DOC_FIELDS.map(([field, label]) => (
              <div className="pay-kyc-doc-slot" key={field}>
                <div className="pay-kyc-doc-label">{label}</div>
                <Upload beforeUpload={onPickFile(field)} maxCount={1} accept="image/*">
                  <Button icon={<UploadOutlined />}>Choose file</Button>
                </Upload>
              </div>
            ))}
          </div>

          <Button type="primary" htmlType="submit" block size="large" loading={submitting} className="pay-kyc-submit">
            Submit
          </Button>
        </Form>
      </div>
    </div>
  );
}
