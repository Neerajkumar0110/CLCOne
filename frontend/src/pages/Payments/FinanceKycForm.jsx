import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Form, Input, Select, Button, Upload, message, Result, Spin, Checkbox } from 'antd';
import { UploadOutlined, CheckCircleFilled, BankOutlined, CloseCircleFilled } from '@ant-design/icons';
import paymentsPublicApi from './publicApi';
import useBrandLogo from '@/hooks/useBrandLogo';
import { INDIA_STATES, INDIA_DISTRICTS } from '@/data/indiaStatesDistricts';

// Finance (EMI) KYC form — reached from the email sent when Sales raises a
// "Finance" request on the Payments page (backend paymentsController/
// finance.js). No CRM login: the token in the URL is the credential. Same
// look as the post-payment KYC form (PublicKycForm.jsx, payments.css).
const fmtInr = (n) => {
  try {
    return Number(n).toLocaleString('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });
  } catch (e) {
    return `₹${n}`;
  }
};

const DOC_FIELDS = [
  ['aadharFront', 'Aadhaar card', 'Front side', true],
  ['aadharBack', 'Aadhaar card', 'Back side', true],
  ['panFront', 'PAN card', 'Front side', true],
  ['photo', 'Your photo', 'Optional', false],
  ['bankProof', 'Cancelled cheque / passbook', 'Optional', false],
];
const REQ = [{ required: true, message: 'Required' }];
const PHONE = [...REQ, { pattern: /^[6-9]\d{9}$/, message: '10-digit mobile number' }];

function Header({ logo }) {
  return (
    <div className="pay-kyc-brand">
      <img src={logo} alt="Career Lab Consulting" />
    </div>
  );
}

export default function FinanceKycForm() {
  const logo = useBrandLogo('logo_public');
  const { token } = useParams();
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [info, setInfo] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [previews, setPreviews] = useState({});
  const [paths, setPaths] = useState({});
  const [uploading, setUploading] = useState({});
  const [selectedState, setSelectedState] = useState('');
  const files = useRef({});

  const load = useCallback(async () => {
    try {
      const res = await paymentsPublicApi.financeStatus(token);
      setInfo(res.result);
      form.setFieldsValue({
        name: res.result.studentName,
        email: res.result.studentEmail,
        mobile: String(res.result.studentPhone || '').replace(/\D/g, '').slice(-10) || undefined,
      });
    } catch (e) {
      setNotFound(true);
    } finally {
      setLoading(false);
    }
  }, [token, form]);
  useEffect(() => {
    load();
  }, [load]);
  useEffect(() => () => Object.values(previews).forEach((u) => URL.revokeObjectURL(u)), []); // eslint-disable-line react-hooks/exhaustive-deps

  const onPick = (field) => (file) => {
    files.current[field] = file;
    setPreviews((p) => {
      if (p[field]) URL.revokeObjectURL(p[field]);
      return { ...p, [field]: URL.createObjectURL(file) };
    });
    setPaths((p) => {
      const n = { ...p };
      delete n[field];
      return n;
    });
    setUploading((p) => ({ ...p, [field]: true }));
    paymentsPublicApi
      .financeUpload(token, file)
      .then((res) => setPaths((p) => ({ ...p, [field]: res.result.path })))
      .catch(() => {
        message.error('Could not upload — please try that file again.');
        setPreviews((p) => {
          const n = { ...p };
          delete n[field];
          return n;
        });
      })
      .finally(() => setUploading((p) => ({ ...p, [field]: false })));
    return false;
  };
  const clearFile = (field) => {
    setPreviews((p) => {
      if (p[field]) URL.revokeObjectURL(p[field]);
      const n = { ...p };
      delete n[field];
      return n;
    });
    setPaths((p) => {
      const n = { ...p };
      delete n[field];
      return n;
    });
  };

  const onSubmit = async (v) => {
    const missing = DOC_FIELDS.filter(([f, , , req]) => req && !paths[f]);
    if (missing.length) {
      message.error(`Please attach: ${missing.map(([, t, s]) => `${t} (${s})`).join(', ')}.`);
      return;
    }
    setSubmitting(true);
    try {
      const { accountHolder, bankName, accountNumber, ifsc, branch, accountType, registeredMobile, confirmAccountNumber, sameWhatsapp, ...rest } = v;
      await paymentsPublicApi.financeSubmit(token, {
        ...rest,
        whatsapp: sameWhatsapp ? v.mobile : v.whatsapp,
        ...paths,
        bank: { accountHolder, bankName, accountNumber, ifsc, branch, accountType, registeredMobile },
      });
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
        <Header logo={logo} />
        <Spin size="large" />
      </div>
    );
  }
  if (notFound) {
    return (
      <div className="pay-kyc-shell pay-kyc-center">
        <Header logo={logo} />
        <div className="pay-kyc-card pay-kyc-card--narrow">
          <Result status="404" title="Link not found" subTitle="This link is invalid or has expired." />
        </div>
      </div>
    );
  }
  if (done || info.submitted) {
    return (
      <div className="pay-kyc-shell pay-kyc-center">
        <Header logo={logo} />
        <div className="pay-kyc-card pay-kyc-card--narrow">
          <Result
            icon={<CheckCircleFilled style={{ color: '#22c55e' }} />}
            title="Submitted"
            subTitle="Thanks — your finance application details have been received. Our team will contact you shortly."
          />
        </div>
      </div>
    );
  }

  return (
    <div className="pay-kyc-shell">
      <Header logo={logo} />
      <div className="pay-kyc-card">
        <div className="pay-kyc-head">
          <BankOutlined className="pay-kyc-head-icon" />
          <div>
            <h2>Finance (EMI) — KYC form</h2>
            <p>
              {info.studentName}
              {info.course ? ` · ${info.course}` : ''}
              {info.financeAmount ? ` · ${fmtInr(info.financeAmount)} to finance` : ''}
              {info.tenureMonths ? ` over ${info.tenureMonths} months` : ''}. Fill every section — it goes to our finance partner.
            </p>
          </div>
        </div>

        <Form form={form} layout="vertical" onFinish={onSubmit} requiredMark={false} initialValues={{ sameWhatsapp: true, accountType: 'Savings' }}>
          <div className="pay-kyc-section-head">Documents</div>
          <p className="pay-kyc-doc-lead">Clear photos from your phone are fine. Aadhaar (both sides) and PAN are required.</p>
          <div className="pay-kyc-doc-grid">
            {DOC_FIELDS.map(([field, title, sub]) => {
              const preview = previews[field];
              return (
                <div className={`pay-kyc-doc-slot${preview ? ' has-file' : ''}`} key={field}>
                  {preview ? (
                    <>
                      <div className="pay-kyc-doc-thumb">
                        <img src={preview} alt={title} />
                        {!uploading[field] && (
                          <button type="button" className="pay-kyc-doc-remove" onClick={() => clearFile(field)} aria-label={`Remove ${title}`}>
                            <CloseCircleFilled />
                          </button>
                        )}
                      </div>
                      <div className="pay-kyc-doc-caption">
                        <span className="pay-kyc-doc-title">{title}</span>
                        <span className="pay-kyc-doc-sub">{sub}</span>
                        {uploading[field] ? (
                          <span className="pay-kyc-doc-status">Uploading…</span>
                        ) : paths[field] ? (
                          <span className="pay-kyc-doc-filename">{files.current[field]?.name}</span>
                        ) : (
                          <span className="pay-kyc-doc-status is-error">Upload failed — tap to retry</span>
                        )}
                      </div>
                    </>
                  ) : (
                    <Upload beforeUpload={onPick(field)} maxCount={1} accept="image/*" showUploadList={false}>
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

          <div className="pay-kyc-section-head">Personal details</div>
          <div className="pay-kyc-grid">
            <Form.Item name="name" label="Full name (as on Aadhaar)" rules={REQ}>
              <Input />
            </Form.Item>
            <Form.Item name="dob" label="Date of birth" rules={REQ}>
              <Input type="date" />
            </Form.Item>
            <Form.Item name="gender" label="Gender" rules={REQ}>
              <Select options={['Male', 'Female', 'Other'].map((g) => ({ value: g, label: g }))} />
            </Form.Item>
            <Form.Item name="fatherName" label="Father's name" rules={REQ}>
              <Input />
            </Form.Item>
            <Form.Item name="motherName" label="Mother's name" rules={REQ}>
              <Input />
            </Form.Item>
            <Form.Item name="email" label="Email" rules={[{ type: 'email', message: 'Enter a valid email' }]}>
              <Input />
            </Form.Item>
            <Form.Item name="mobile" label="Mobile number" rules={PHONE}>
              <Input maxLength={10} inputMode="numeric" />
            </Form.Item>
            <Form.Item name="alternateMobile" label="Alternate mobile (optional)" rules={[{ pattern: /^[6-9]\d{9}$/, message: '10-digit mobile number' }]}>
              <Input maxLength={10} inputMode="numeric" />
            </Form.Item>
            <Form.Item name="occupation" label="Occupation" rules={REQ}>
              <Select options={['Student', 'Salaried', 'Self-employed', 'Not working', 'Other'].map((g) => ({ value: g, label: g }))} />
            </Form.Item>
            <Form.Item name="monthlyIncome" label="Monthly income (family, optional)">
              <Input inputMode="numeric" placeholder="e.g. 30000" />
            </Form.Item>
            <Form.Item name="aadharNumber" label="Aadhaar number" rules={[...REQ, { pattern: /^\d{4}\s?\d{4}\s?\d{4}$/, message: '12 digits' }]}>
              <Input maxLength={14} inputMode="numeric" />
            </Form.Item>
            <Form.Item
              name="panNumber"
              label="PAN number"
              normalize={(v) => (v || '').toUpperCase()}
              rules={[...REQ, { pattern: /^[A-Z]{5}[0-9]{4}[A-Z]$/, message: 'e.g. ABCDE1234F' }]}
            >
              <Input maxLength={10} />
            </Form.Item>
          </div>
          <Form.Item name="sameWhatsapp" valuePropName="checked" style={{ marginBottom: 8 }}>
            <Checkbox>My WhatsApp number is the same as my mobile number</Checkbox>
          </Form.Item>
          <Form.Item noStyle shouldUpdate={(a, b) => a.sameWhatsapp !== b.sameWhatsapp}>
            {({ getFieldValue }) =>
              !getFieldValue('sameWhatsapp') && (
                <Form.Item name="whatsapp" label="WhatsApp number" rules={PHONE}>
                  <Input maxLength={10} inputMode="numeric" />
                </Form.Item>
              )
            }
          </Form.Item>

          <div className="pay-kyc-section-head">Address</div>
          <div className="pay-kyc-grid">
            <Form.Item name="state" label="State" rules={REQ}>
              <Select
                showSearch
                placeholder="Select state"
                optionFilterProp="label"
                options={INDIA_STATES.map((s) => ({ value: s, label: s }))}
                onChange={(v) => {
                  setSelectedState(v);
                  form.setFieldsValue({ district: undefined });
                }}
              />
            </Form.Item>
            <Form.Item name="district" label="District" rules={REQ}>
              <Select
                showSearch
                placeholder={selectedState ? 'Select district' : 'Select state first'}
                optionFilterProp="label"
                disabled={!selectedState}
                options={(INDIA_DISTRICTS[selectedState] || []).map((d) => ({ value: d, label: d }))}
              />
            </Form.Item>
            <Form.Item name="city" label="City" rules={REQ}>
              <Input />
            </Form.Item>
            <Form.Item name="pincode" label="Pin code" rules={[...REQ, { pattern: /^\d{6}$/, message: '6 digits' }]}>
              <Input maxLength={6} inputMode="numeric" />
            </Form.Item>
          </div>
          <Form.Item name="address" label="Full address" rules={REQ}>
            <Input.TextArea rows={3} />
          </Form.Item>

          <div className="pay-kyc-section-head">Bank details</div>
          <div className="pay-kyc-grid">
            <Form.Item name="accountHolder" label="Account holder name" rules={REQ}>
              <Input />
            </Form.Item>
            <Form.Item name="bankName" label="Bank name" rules={REQ}>
              <Input placeholder="e.g. State Bank of India" />
            </Form.Item>
            <Form.Item name="accountNumber" label="Account number" rules={[...REQ, { pattern: /^\d{6,18}$/, message: 'Digits only' }]}>
              <Input inputMode="numeric" />
            </Form.Item>
            <Form.Item
              name="confirmAccountNumber"
              label="Confirm account number"
              dependencies={['accountNumber']}
              rules={[
                ...REQ,
                ({ getFieldValue }) => ({
                  validator: (_, v) => (!v || v === getFieldValue('accountNumber') ? Promise.resolve() : Promise.reject(new Error("Doesn't match"))),
                }),
              ]}
            >
              <Input inputMode="numeric" />
            </Form.Item>
            <Form.Item
              name="ifsc"
              label="IFSC code"
              normalize={(v) => (v || '').toUpperCase()}
              rules={[...REQ, { pattern: /^[A-Z]{4}0[A-Z0-9]{6}$/, message: 'e.g. SBIN0001234' }]}
            >
              <Input maxLength={11} />
            </Form.Item>
            <Form.Item name="branch" label="Branch" rules={REQ}>
              <Input />
            </Form.Item>
            <Form.Item name="accountType" label="Account type" rules={REQ}>
              <Select options={['Savings', 'Current'].map((g) => ({ value: g, label: g }))} />
            </Form.Item>
            <Form.Item name="registeredMobile" label="Mobile registered with bank" rules={PHONE}>
              <Input maxLength={10} inputMode="numeric" />
            </Form.Item>
          </div>

          <Button
            type="primary"
            htmlType="submit"
            block
            size="large"
            loading={submitting}
            disabled={Object.values(uploading).some(Boolean)}
            className="pay-kyc-submit"
          >
            Submit
          </Button>
        </Form>
      </div>
    </div>
  );
}
