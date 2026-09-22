import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Row,
  Col,
  Card,
  Form,
  Input,
  InputNumber,
  Select,
  Button,
  Table,
  Tag,
  Modal,
  message,
  Empty,
  Skeleton,
  Tooltip,
  Descriptions,
  Image,
  Space,
} from 'antd';
import {
  WalletOutlined,
  QrcodeOutlined,
  CopyOutlined,
  MailOutlined,
  ReloadOutlined,
  EyeOutlined,
  CheckCircleFilled,
  ClockCircleOutlined,
} from '@ant-design/icons';
import { request } from '@/request';
import { getSocket } from '@/socket';
import { BASE_URL } from '@/config/serverApiConfig';
import paymentsApi from './api';

const STATUS_META = {
  created: { color: 'blue', label: 'Awaiting payment' },
  paid: { color: 'green', label: 'Paid' },
  expired: { color: 'default', label: 'Expired' },
  cancelled: { color: 'default', label: 'Cancelled' },
  failed: { color: 'red', label: 'Failed' },
};

const fmtInr = (n) => {
  try {
    return Number(n).toLocaleString('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });
  } catch (e) {
    return `₹${n}`;
  }
};

export default function Payments() {
  const [form] = Form.useForm();
  const [creating, setCreating] = useState(false);
  const [result, setResult] = useState(null); // { shortUrl, qrDataUrl, emailSent, emailError }

  const [courses, setCourses] = useState([]);
  useEffect(() => {
    request
      .listAll({ entity: 'course' })
      .then((r) => setCourses(((r && r.result) || []).filter((c) => c.status !== 'Archived')))
      .catch(() => {});
  }, []);

  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await paymentsApi.list({ limit: 50 });
      setRows((res && res.result) || []);
    } catch (e) {
      /* toast already shown by request layer on hard failure */
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  // Live updates — a payment can go from "Awaiting payment" to "Paid" purely
  // server-side (the student pays on their phone, Razorpay's callback marks
  // it paid — see backend paymentsPublicController/return.js), so the table
  // needs to notice on its own instead of waiting for a manual refresh.
  const resultRef = useRef(null);
  useEffect(() => {
    resultRef.current = result;
  }, [result]);
  useEffect(() => {
    const socket = getSocket();
    const onUpdate = (evt) => {
      load();
      if (evt && resultRef.current && evt.id === resultRef.current.id && evt.status === 'paid') {
        setResult((r) => (r && r.status !== 'paid' ? { ...r, status: 'paid' } : r));
      }
    };
    socket?.on('payments:updated', onUpdate);
    return () => socket?.off('payments:updated', onUpdate);
  }, [load]);

  // Fallback for when no socket is available (serverless deploys have none —
  // see backend/src/socket.js) — keeps the just-created QR panel honest by
  // polling this one payment while it's still showing and unpaid.
  useEffect(() => {
    if (!result || result.status === 'paid') return undefined;
    const t = setInterval(async () => {
      try {
        const res = await paymentsApi.get(result.id);
        if (res?.result?.status === 'paid') {
          setResult((r) => (r && r.status !== 'paid' ? { ...r, status: 'paid' } : r));
          load();
        }
      } catch (e) {
        /* keep polling */
      }
    }, 4000);
    return () => clearInterval(t);
  }, [result, load]);

  // Once the QR panel sees the payment land, show the success state for a
  // beat, then clear the whole panel — the form itself already reset right
  // after the request was created (see onCreate below).
  useEffect(() => {
    if (result?.status !== 'paid') return undefined;
    const t = setTimeout(() => setResult(null), 3000);
    return () => clearTimeout(t);
  }, [result?.status]);

  const onCreate = async (values) => {
    setCreating(true);
    setResult(null);
    try {
      const res = await paymentsApi.create(values);
      if (res && res.success) {
        setResult(res.result);
        message.success('Payment request created.');
        form.resetFields();
        load();
      } else {
        message.error((res && res.message) || 'Could not create the payment request.');
      }
    } catch (e) {
      message.error('Could not create the payment request.');
    } finally {
      setCreating(false);
    }
  };

  const copyLink = (url) => {
    navigator.clipboard?.writeText(url);
    message.success('Link copied.');
  };

  const [busyId, setBusyId] = useState(null);
  const doResend = async (id) => {
    setBusyId(id);
    try {
      const res = await paymentsApi.resend(id);
      if (res && res.success) message.success('Email re-sent.');
      else message.error((res && res.message) || 'Could not send the email.');
    } finally {
      setBusyId(null);
      load();
    }
  };
  const doRefresh = async (id) => {
    setBusyId(id);
    try {
      await paymentsApi.refresh(id);
      load();
    } finally {
      setBusyId(null);
    }
  };

  const [kycFor, setKycFor] = useState(null);
  const [kycLoading, setKycLoading] = useState(false);
  const openKyc = async (row) => {
    setKycFor({ ...row });
    setKycLoading(true);
    try {
      const res = await paymentsApi.get(row.id);
      setKycFor((res && res.result) || null);
    } finally {
      setKycLoading(false);
    }
  };

  const columns = [
    {
      title: 'Student',
      key: 'student',
      render: (_, r) => (
        <div>
          <div style={{ fontWeight: 700, color: 'var(--hub-text)' }}>{r.studentName}</div>
          <div style={{ fontSize: 12, color: 'var(--hub-muted)' }}>{r.studentEmail}</div>
        </div>
      ),
    },
    { title: 'Course', dataIndex: 'course', render: (v) => v || '—' },
    { title: 'Amount', dataIndex: 'amount', render: (v) => <b>{fmtInr(v)}</b> },
    {
      title: 'Status',
      dataIndex: 'status',
      render: (v) => {
        const meta = STATUS_META[v] || { color: 'default', label: v };
        return <Tag color={meta.color}>{meta.label}</Tag>;
      },
    },
    {
      title: 'KYC',
      dataIndex: 'kycSubmitted',
      render: (v, r) =>
        v ? (
          <Tag icon={<CheckCircleFilled />} color="green" style={{ cursor: 'pointer' }} onClick={() => openKyc(r)}>
            Submitted
          </Tag>
        ) : r.status === 'paid' ? (
          <Tag icon={<ClockCircleOutlined />} color="orange">
            Pending
          </Tag>
        ) : (
          <span style={{ color: 'var(--hub-muted)' }}>—</span>
        ),
    },
    {
      title: '',
      key: 'actions',
      render: (_, r) => (
        <Space>
          {r.shortUrl && (
            <Tooltip title="Copy payment link">
              <Button size="small" icon={<CopyOutlined />} onClick={() => copyLink(r.shortUrl)} />
            </Tooltip>
          )}
          {r.status !== 'paid' && (
            <Tooltip title="Re-send email">
              <Button size="small" icon={<MailOutlined />} loading={busyId === r.id} onClick={() => doResend(r.id)} />
            </Tooltip>
          )}
          {r.status !== 'paid' && (
            <Tooltip title="Refresh status from Razorpay">
              <Button size="small" icon={<ReloadOutlined />} loading={busyId === r.id} onClick={() => doRefresh(r.id)} />
            </Tooltip>
          )}
          {r.kycSubmitted && (
            <Tooltip title="View KYC">
              <Button size="small" icon={<EyeOutlined />} onClick={() => openKyc(r)} />
            </Tooltip>
          )}
        </Space>
      ),
    },
  ];

  return (
    <div className="lms-portal pay-hub">
      <div className="lms-portal-head">
        <div>
          <h2>
            <WalletOutlined /> Payments
          </h2>
          <p>Collect a fee payment via Razorpay — link, QR and email in one step.</p>
        </div>
      </div>

      <Row gutter={[20, 20]}>
        <Col xs={24} lg={9}>
          <Card className="pay-form-card" title="New payment request">
            <Form form={form} layout="vertical" onFinish={onCreate} requiredMark={false}>
              <Form.Item name="studentName" label="Student name" rules={[{ required: true, message: 'Enter the student name.' }]}>
                <Input placeholder="Full name" />
              </Form.Item>
              <Form.Item
                name="studentEmail"
                label="Student email"
                rules={[
                  { required: true, message: 'Enter the student email.' },
                  { type: 'email', message: 'Enter a valid email.' },
                ]}
              >
                <Input placeholder="name@example.com" />
              </Form.Item>
              <Form.Item name="course" label="Course">
                <Select
                  showSearch
                  allowClear
                  placeholder="Select a course (optional)"
                  optionFilterProp="label"
                  options={courses.map((c) => ({ value: c.title, label: `${c.code ? c.code + ' — ' : ''}${c.title}` }))}
                />
              </Form.Item>
              <Form.Item name="amount" label="Amount (INR)" rules={[{ required: true, message: 'Enter an amount.' }]}>
                <InputNumber style={{ width: '100%' }} min={1} step={100} placeholder="e.g. 15000" />
              </Form.Item>
              <Form.Item name="notes" label="Notes (optional)">
                <Input.TextArea rows={2} placeholder="Internal note — not shown to the student" />
              </Form.Item>
              <Button type="primary" htmlType="submit" block loading={creating} icon={<QrcodeOutlined />}>
                Generate payment link + QR
              </Button>
            </Form>

            {result && result.status === 'paid' && (
              <div className="pay-success">
                <div className="pay-success-badge">
                  <CheckCircleFilled />
                </div>
                <div className="pay-success-title">Payment received!</div>
                <div className="pay-success-sub">{fmtInr(result.amount)} confirmed</div>
              </div>
            )}
            {result && result.status !== 'paid' && (
              <div className="pay-result">
                <div className="pay-result-qr">
                  <img src={result.qrDataUrl} alt="Payment QR" />
                </div>
                <div className="pay-result-info">
                  <div className="pay-result-link">
                    <Input readOnly value={result.shortUrl} />
                    <Button icon={<CopyOutlined />} onClick={() => copyLink(result.shortUrl)}>
                      Copy
                    </Button>
                  </div>
                  <div className={`pay-result-email ${result.emailSent ? 'is-ok' : 'is-warn'}`}>
                    <MailOutlined /> {result.emailSent ? 'Email sent to the student.' : `Email not sent${result.emailError ? ` — ${result.emailError}` : '.'}`}
                  </div>
                </div>
              </div>
            )}
          </Card>
        </Col>

        <Col xs={24} lg={15}>
          <Card
            className="pay-list-card"
            title="Payment requests"
            extra={
              <Button size="small" icon={<ReloadOutlined />} onClick={load}>
                Refresh
              </Button>
            }
          >
            {loading ? (
              <Skeleton active paragraph={{ rows: 5 }} />
            ) : rows.length === 0 ? (
              <Empty description="No payment requests yet." />
            ) : (
              <Table rowKey="id" size="small" dataSource={rows} columns={columns} pagination={{ pageSize: 10 }} />
            )}
          </Card>
        </Col>
      </Row>

      <Modal open={!!kycFor} title="KYC details" footer={null} onCancel={() => setKycFor(null)} width={680}>
        {kycLoading || !kycFor ? (
          <Skeleton active paragraph={{ rows: 6 }} />
        ) : !kycFor.kyc ? (
          <Empty description="KYC not submitted yet." />
        ) : (
          <>
            <Descriptions column={2} size="small" bordered>
              <Descriptions.Item label="Name">{kycFor.kyc.name}</Descriptions.Item>
              <Descriptions.Item label="Father's name">{kycFor.kyc.fatherName}</Descriptions.Item>
              <Descriptions.Item label="Mother's name">{kycFor.kyc.motherName}</Descriptions.Item>
              <Descriptions.Item label="Pincode">{kycFor.kyc.pincode}</Descriptions.Item>
              <Descriptions.Item label="State">{kycFor.kyc.state}</Descriptions.Item>
              <Descriptions.Item label="District">{kycFor.kyc.district}</Descriptions.Item>
              <Descriptions.Item label="City">{kycFor.kyc.city}</Descriptions.Item>
              <Descriptions.Item label="Address" span={2}>
                {kycFor.kyc.address}
              </Descriptions.Item>
            </Descriptions>
            <div className="pay-kyc-docs">
              {[
                ['Aadhar — front', kycFor.kyc.aadharFront],
                ['Aadhar — back', kycFor.kyc.aadharBack],
                ['PAN — front', kycFor.kyc.panFront],
                ['PAN — back', kycFor.kyc.panBack],
              ].map(([label, path]) => (
                <div className="pay-kyc-doc" key={label}>
                  <div className="pay-kyc-doc-label">{label}</div>
                  {path ? <Image src={`${BASE_URL}${path}`} width={140} /> : <span style={{ color: 'var(--hub-muted)' }}>—</span>}
                </div>
              ))}
            </div>
          </>
        )}
      </Modal>
    </div>
  );
}
