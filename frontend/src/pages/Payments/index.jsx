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
  Modal,
  message,
  Empty,
  Skeleton,
  Tooltip,
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

  // Known-plan fee lookup (see backend courseCatalog.js) — auto-fills Amount
  // with the first EMI installment and shows the GST breakdown when the
  // chosen course is one of the catalog's fee plans.
  const [feeHint, setFeeHint] = useState(null);
  const onCourseChange = async (val) => {
    if (!val) {
      setFeeHint(null);
      return;
    }
    try {
      const res = await paymentsApi.courseFee(val);
      const fee = (res && res.result) || null;
      setFeeHint(fee);
      if (fee) form.setFieldsValue({ amount: fee.installmentAmount });
    } catch (e) {
      setFeeHint(null);
    }
  };

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
        setFeeHint(null);
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
  const [planAmount, setPlanAmount] = useState(null);
  const [planBusy, setPlanBusy] = useState(false);
  const [planResult, setPlanResult] = useState(null);
  const openKyc = async (row) => {
    setKycFor({ ...row });
    setPlanAmount(null);
    setPlanResult(null);
    setKycLoading(true);
    try {
      const res = await paymentsApi.get(row.id);
      const result = (res && res.result) || null;
      setKycFor(result);
      if (result && result.plan) setPlanAmount(result.plan.suggestedNextAmount || result.plan.remaining || null);
    } finally {
      setKycLoading(false);
    }
  };

  // Collect another EMI installment right from the modal — "baki" (the
  // remaining balance) is shown above this, the amount defaults to the
  // suggested next installment but the admin can change it to any figure.
  const collectNextInstallment = async () => {
    if (!kycFor || !planAmount || planAmount <= 0) return;
    setPlanBusy(true);
    try {
      const res = await paymentsApi.nextInstallment(kycFor.id, planAmount);
      if (res && res.success) {
        setPlanResult(res.result);
        message.success('Payment link created.');
        load();
        const fresh = await paymentsApi.get(kycFor.id);
        if (fresh && fresh.result) setKycFor(fresh.result);
      } else {
        message.error((res && res.message) || 'Could not create the payment link.');
      }
    } catch (e) {
      message.error('Could not create the payment link.');
    } finally {
      setPlanBusy(false);
    }
  };

  const initialsOf = (name) =>
    String(name || '?')
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((w) => w[0]?.toUpperCase())
      .join('') || '?';

  const columns = [
    {
      title: 'Candidate',
      key: 'student',
      width: 220,
      render: (_, r) => (
        <div className="pay-row-student">
          <div className="pay-row-avatar">{initialsOf(r.studentName)}</div>
          <div className="pay-row-student-info">
            <div className="pay-row-name" title={r.studentName}>
              {r.studentName}
            </div>
            <div className="pay-row-email" title={r.studentEmail}>
              {r.studentEmail}
            </div>
          </div>
        </div>
      ),
    },
    {
      title: 'Course',
      dataIndex: 'course',
      width: 180,
      render: (v) =>
        v ? (
          <span className="pay-row-course" title={v}>
            {v}
          </span>
        ) : (
          <span className="pay-row-muted">—</span>
        ),
    },
    {
      title: 'Amount',
      dataIndex: 'amount',
      width: 110,
      render: (v, r) => (
        <div>
          <span className="pay-row-amount">{fmtInr(v)}</span>
          {r.installmentCount > 1 && (
            <div className="pay-row-inst">
              Inst. {r.installmentNo}/{r.installmentCount}
            </div>
          )}
        </div>
      ),
    },
    {
      title: 'Status',
      dataIndex: 'status',
      width: 130,
      render: (v) => {
        const meta = STATUS_META[v] || { color: 'default', label: v };
        return <span className={`pay-pill pay-pill--${meta.color}`}>{meta.label}</span>;
      },
    },
    {
      title: 'KYC',
      dataIndex: 'kycSubmitted',
      width: 130,
      render: (v, r) =>
        v ? (
          <span className="pay-pill pay-pill--green pay-pill--clickable" onClick={() => openKyc(r)}>
            <CheckCircleFilled /> Submitted
          </span>
        ) : r.status === 'paid' ? (
          <span className="pay-pill pay-pill--orange">
            <ClockCircleOutlined /> Pending
          </span>
        ) : (
          <span className="pay-row-muted">—</span>
        ),
    },
    {
      title: '',
      key: 'actions',
      render: (_, r) => (
        <Space size={4}>
          {r.shortUrl && (
            <Tooltip title="Copy payment link">
              <Button className="pay-row-action" type="text" icon={<CopyOutlined />} onClick={() => copyLink(r.shortUrl)} />
            </Tooltip>
          )}
          {r.status !== 'paid' && (
            <Tooltip title="Re-send email">
              <Button className="pay-row-action" type="text" icon={<MailOutlined />} loading={busyId === r.id} onClick={() => doResend(r.id)} />
            </Tooltip>
          )}
          {r.status !== 'paid' && (
            <Tooltip title="Refresh status from Razorpay">
              <Button className="pay-row-action" type="text" icon={<ReloadOutlined />} loading={busyId === r.id} onClick={() => doRefresh(r.id)} />
            </Tooltip>
          )}
          {(r.kycSubmitted || r.installmentCount > 1) && (
            <Tooltip title={r.kycSubmitted ? 'View KYC' : 'View fee plan'}>
              <Button className="pay-row-action" type="text" icon={<EyeOutlined />} onClick={() => openKyc(r)} />
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
              <Form.Item name="studentName" label="Candidate name" rules={[{ required: true, message: 'Enter the candidate name.' }]}>
                <Input placeholder="Full name" />
              </Form.Item>
              <Form.Item
                name="studentEmail"
                label="Candidate email"
                rules={[
                  { required: true, message: 'Enter the candidate email.' },
                  { type: 'email', message: 'Enter a valid email.' },
                ]}
              >
                <Input placeholder="name@example.com" />
              </Form.Item>
              <Form.Item name="studentPhone" label="Candidate phone (optional)">
                <Input placeholder="For future WhatsApp reminders" />
              </Form.Item>
              <Form.Item name="course" label="Course">
                <Select
                  showSearch
                  allowClear
                  placeholder="Select a course (optional)"
                  optionFilterProp="label"
                  options={courses.map((c) => ({ value: c.title, label: `${c.code ? c.code + ' — ' : ''}${c.title}` }))}
                  onChange={onCourseChange}
                />
              </Form.Item>
              <Form.Item name="amount" label="Amount (INR)" rules={[{ required: true, message: 'Enter an amount.' }]}>
                <InputNumber style={{ width: '100%' }} min={1} step={100} placeholder="e.g. 15000" />
              </Form.Item>
              {feeHint && (
                <div className="pay-fee-hint">
                  <b>{fmtInr(feeHint.totalFee)}</b> total ({fmtInr(feeHint.baseFee)} + 18% GST) · {feeHint.durationMonths} monthly
                  installments of <b>{fmtInr(feeHint.installmentAmount)}</b>
                </div>
              )}
              <Form.Item name="notes" label="Notes (optional)">
                <Input.TextArea rows={2} placeholder="Internal note — not shown to the candidate" />
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
                    <MailOutlined /> {result.emailSent ? 'Email sent to the candidate.' : `Email not sent${result.emailError ? ` — ${result.emailError}` : '.'}`}
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
              <Table
                className="pay-table"
                rowKey="id"
                dataSource={rows}
                columns={columns}
                pagination={{ pageSize: 10 }}
                scroll={{ x: 'max-content' }}
              />
            )}
          </Card>
        </Col>
      </Row>

      <Modal
        open={!!kycFor}
        title={null}
        footer={null}
        onCancel={() => setKycFor(null)}
        width={720}
        className="pay-kyc-modal"
      >
        {kycLoading || !kycFor ? (
          <Skeleton active avatar paragraph={{ rows: 6 }} style={{ padding: 28 }} />
        ) : (
          <div className="pay-kyc-modal-body">
            <div className="pay-kyc-modal-head">
              <div className="pay-kyc-modal-avatar">{initialsOf((kycFor.kyc && kycFor.kyc.name) || kycFor.studentName)}</div>
              <div className="pay-kyc-modal-who">
                <div className="pay-kyc-modal-name">{(kycFor.kyc && kycFor.kyc.name) || kycFor.studentName}</div>
                <div className="pay-kyc-modal-meta">
                  {kycFor.course || 'No course'} {kycFor.amount ? `· ${fmtInr(kycFor.amount)}` : ''}
                </div>
              </div>
              {kycFor.kycSubmitted ? (
                <span className="pay-pill pay-pill--green pay-kyc-modal-status">
                  <CheckCircleFilled /> KYC submitted
                </span>
              ) : (
                <span className="pay-pill pay-pill--orange pay-kyc-modal-status">
                  <ClockCircleOutlined /> KYC pending
                </span>
              )}
            </div>

            {kycFor.plan && (
              <div className="pay-plan">
                <div className="pay-plan-head">
                  <div className="pay-plan-title">
                    Fee plan
                    <span className="pay-plan-badge">
                      Installment {kycFor.installmentNo} of {kycFor.plan.installmentCount}
                    </span>
                  </div>
                  <div className="pay-plan-total">{fmtInr(kycFor.plan.planTotal)} total</div>
                </div>
                <div className="pay-plan-bar">
                  <div
                    className="pay-plan-bar-fill"
                    style={{ width: `${Math.min(100, (kycFor.plan.paidTotal / kycFor.plan.planTotal) * 100 || 0)}%` }}
                  />
                </div>
                <div className="pay-plan-stats">
                  <div className="pay-plan-stat">
                    <span>Paid</span>
                    <b>{fmtInr(kycFor.plan.paidTotal)}</b>
                  </div>
                  <div className="pay-plan-stat">
                    <span>Remaining</span>
                    <b className={kycFor.plan.remaining > 0 ? 'is-due' : ''}>{fmtInr(kycFor.plan.remaining)}</b>
                  </div>
                  {kycFor.plan.remaining > 0 && kycFor.plan.nextInstallmentDueAt && (
                    <div className="pay-plan-stat">
                      <span>Next due</span>
                      <b>
                        {new Date(kycFor.plan.nextInstallmentDueAt).toLocaleDateString('en-IN', {
                          day: 'numeric',
                          month: 'short',
                          year: 'numeric',
                        })}
                      </b>
                    </div>
                  )}
                </div>

                {kycFor.plan.remaining > 0 &&
                  (planResult ? (
                    <div className="pay-plan-collect-result">
                      <img src={planResult.qrDataUrl} alt="Payment QR" />
                      <div className="pay-plan-collect-result-info">
                        <div className="pay-result-link">
                          <Input readOnly size="small" value={planResult.shortUrl} />
                          <Button size="small" icon={<CopyOutlined />} onClick={() => copyLink(planResult.shortUrl)}>
                            Copy
                          </Button>
                        </div>
                        <div className={`pay-result-email ${planResult.emailSent ? 'is-ok' : 'is-warn'}`}>
                          <MailOutlined /> {planResult.emailSent ? 'Email sent to the candidate.' : 'Email not sent.'}
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="pay-plan-collect">
                      <InputNumber
                        className="pay-plan-collect-amount"
                        min={1}
                        step={100}
                        value={planAmount}
                        onChange={setPlanAmount}
                        formatter={(v) => `₹ ${v}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}
                        parser={(v) => v.replace(/[₹,\s]/g, '')}
                      />
                      <Button type="primary" loading={planBusy} onClick={collectNextInstallment}>
                        Collect payment
                      </Button>
                    </div>
                  ))}

                {kycFor.plan.installments.length > 1 && (
                  <div className="pay-plan-installments">
                    {kycFor.plan.installments.map((ins) => {
                      const meta = STATUS_META[ins.status] || { color: 'default', label: ins.status };
                      return (
                        <div className="pay-plan-inst" key={ins.id}>
                          <span className="pay-plan-inst-no">#{ins.installmentNo}</span>
                          <span className="pay-plan-inst-amount">{fmtInr(ins.amount)}</span>
                          <span className={`pay-pill pay-pill--${meta.color}`}>{meta.label}</span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {!kycFor.kyc ? (
              <Empty description="KYC not submitted yet." style={{ padding: '20px 0 4px' }} />
            ) : (
              <>
            <div className="pay-kyc-modal-section-label">Personal details</div>
            <div className="pay-kyc-modal-grid">
              <div className="pay-kyc-modal-field">
                <span>Father's name</span>
                <b>{kycFor.kyc.fatherName || '—'}</b>
              </div>
              <div className="pay-kyc-modal-field">
                <span>Mother's name</span>
                <b>{kycFor.kyc.motherName || '—'}</b>
              </div>
              <div className="pay-kyc-modal-field">
                <span>State</span>
                <b>{kycFor.kyc.state || '—'}</b>
              </div>
              <div className="pay-kyc-modal-field">
                <span>District</span>
                <b>{kycFor.kyc.district || '—'}</b>
              </div>
              <div className="pay-kyc-modal-field">
                <span>City</span>
                <b>{kycFor.kyc.city || '—'}</b>
              </div>
              <div className="pay-kyc-modal-field">
                <span>Pincode</span>
                <b>{kycFor.kyc.pincode || '—'}</b>
              </div>
            </div>
            <div className="pay-kyc-modal-field pay-kyc-modal-field--full">
              <span>Address</span>
              <b>{kycFor.kyc.address || '—'}</b>
            </div>

            <div className="pay-kyc-modal-section-label">Documents</div>
            <Image.PreviewGroup>
              <div className="pay-kyc-modal-docs">
                {[
                  ['Aadhar — front', kycFor.kyc.aadharFront],
                  ['Aadhar — back', kycFor.kyc.aadharBack],
                  ['PAN — front', kycFor.kyc.panFront],
                ].map(([label, path]) => (
                  <div className="pay-kyc-modal-doc" key={label}>
                    <div className="pay-kyc-modal-doc-frame">
                      {path ? <Image src={`${BASE_URL}${path}`} /> : <span className="pay-row-muted">No file</span>}
                    </div>
                    <div className="pay-kyc-modal-doc-label">{label}</div>
                  </div>
                ))}
              </div>
            </Image.PreviewGroup>
              </>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}
