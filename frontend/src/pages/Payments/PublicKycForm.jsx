import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Form, Input, Button, Upload, message, Result, Spin } from 'antd';
import { UploadOutlined, CheckCircleFilled, ClockCircleOutlined, SafetyCertificateOutlined, CloseCircleFilled } from '@ant-design/icons';
import paymentsPublicApi from './publicApi';
import logo from '@/style/images/Horizontal-1-transparent.png';

const fmtInr = (n) => {
  try {
    return Number(n).toLocaleString('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });
  } catch (e) {
    return `₹${n}`;
  }
};

// PAN back is deliberately not collected — the front alone carries the PAN
// number, name and photo; a back-side scan (usually blank or a signature
// strip) was extra friction with no verification value.
const DOC_FIELDS = [
  ['aadharFront', 'Aadhar card', 'Front side'],
  ['aadharBack', 'Aadhar card', 'Back side'],
  ['panFront', 'PAN card', 'Front side'],
];

function Header() {
  return (
    <div className="pay-kyc-brand">
      <img src={logo} alt="Career Lab Consulting" />
    </div>
  );
}

export default function PublicKycForm() {
  const { token } = useParams();
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [info, setInfo] = useState(null); // { studentName, course, amount, status, shortUrl, kycSubmitted }
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [previews, setPreviews] = useState({});
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

  // Revoke every preview blob URL on unmount so we don't leak memory.
  useEffect(() => {
    return () => Object.values(previews).forEach((url) => URL.revokeObjectURL(url));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onPickFile = (field) => (file) => {
    files.current[field] = file;
    setPreviews((p) => {
      if (p[field]) URL.revokeObjectURL(p[field]);
      return { ...p, [field]: URL.createObjectURL(file) };
    });
    return false; // prevent antd Upload's own auto-upload — we upload on submit
  };

  const clearFile = (field) => {
    delete files.current[field];
    setPreviews((p) => {
      if (p[field]) URL.revokeObjectURL(p[field]);
      const next = { ...p };
      delete next[field];
      return next;
    });
  };

  const onSubmit = async (values) => {
    const missing = DOC_FIELDS.filter(([field]) => !files.current[field]);
    if (missing.length) {
      message.error(`Please attach: ${missing.map(([title, sub]) => `${title} (${sub})`).join(', ')}.`);
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
        <Header />
        <Spin size="large" />
      </div>
    );
  }
  if (notFound) {
    return (
      <div className="pay-kyc-shell pay-kyc-center">
        <Header />
        <div className="pay-kyc-card pay-kyc-card--narrow">
          <Result status="404" title="Link not found" subTitle="This payment link is invalid or has expired." />
        </div>
      </div>
    );
  }
  if (done || info.kycSubmitted) {
    return (
      <div className="pay-kyc-shell pay-kyc-center">
        <Header />
        <div className="pay-kyc-card pay-kyc-card--narrow">
          <Result
            icon={<CheckCircleFilled style={{ color: '#22c55e' }} />}
            title="Submitted"
            subTitle="Thanks — your details have been received. Our team will reach out if anything else is needed."
          />
        </div>
      </div>
    );
  }
  if (info.status !== 'paid') {
    return (
      <div className="pay-kyc-shell pay-kyc-center">
        <Header />
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
      <Header />
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
          <div className="pay-kyc-section-head">Personal details</div>
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

          <div className="pay-kyc-section-head">Documents</div>
          <div className="pay-kyc-doc-grid">
            {DOC_FIELDS.map(([field, title, sub]) => {
              const preview = previews[field];
              return (
                <div className={`pay-kyc-doc-slot${preview ? ' has-file' : ''}`} key={field}>
                  {preview ? (
                    <>
                      <div className="pay-kyc-doc-thumb">
                        <img src={preview} alt={title} />
                        <button type="button" className="pay-kyc-doc-remove" onClick={() => clearFile(field)} aria-label={`Remove ${title}`}>
                          <CloseCircleFilled />
                        </button>
                      </div>
                      <div className="pay-kyc-doc-caption">
                        <span className="pay-kyc-doc-title">{title}</span>
                        <span className="pay-kyc-doc-sub">{sub}</span>
                        <span className="pay-kyc-doc-filename" title={files.current[field]?.name}>
                          {files.current[field]?.name}
                        </span>
                      </div>
                    </>
                  ) : (
                    <Upload beforeUpload={onPickFile(field)} maxCount={1} accept="image/*" showUploadList={false}>
                      <div className="pay-kyc-doc-empty">
                        <UploadOutlined className="pay-kyc-doc-icon" />
                        <span className="pay-kyc-doc-title">{title}</span>
                        <span className="pay-kyc-doc-sub">{sub}</span>
                        <Button size="small">Choose file</Button>
                      </div>
                    </Upload>
                  )}
                </div>
              );
            })}
          </div>

          <Button type="primary" htmlType="submit" block size="large" loading={submitting} className="pay-kyc-submit">
            Submit
          </Button>
        </Form>
      </div>
    </div>
  );
}
