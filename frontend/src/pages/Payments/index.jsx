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
  Segmented,
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
  BankOutlined,
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

// New payment requests are registration payments — never below this.
// Mirrored server-side in paymentsController/create.js.
const MIN_REGISTRATION_AMOUNT = 5000;

const fmtInr = (n) => {
  try {
    return Number(n).toLocaleString('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });
  } catch (e) {
    return `₹${n}`;
  }
};

export default function Payments() {
  const [form] = Form.useForm();
  // "payment" = Razorpay registration payment (unchanged). "finance" = the
  // candidate pays through a finance partner: no payment link, they get the
  // finance KYC form by email (backend paymentsController/finance.js).
  const [reqType, setReqType] = useState('payment');
  const [listType, setListType] = useState('payment');
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
      if (fee) form.setFieldsValue({ amount: Math.max(fee.installmentAmount, MIN_REGISTRATION_AMOUNT), courseFee: fee.totalFee, financeAmount: fee.totalFee });
    } catch (e) {
      setFeeHint(null);
    }
  };

  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  // "Me" (default, self-only) vs "My Team" — mirrors the same self-or-team
  // rule as Lead Stages/Callbacks (backend/.../paymentsController/scope.js).
  // Never automatic just from being on a team.
  const [teamView, setTeamView] = useState(false);
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await paymentsApi.list({ limit: 50, teamView: teamView ? 1 : undefined });
      setRows((res && res.result) || []);
    } catch (e) {
      /* toast already shown by request layer on hard failure */
    } finally {
      setLoading(false);
    }
  }, [teamView]);
  useEffect(() => {
    load();
  }, [load]);

  const [finRows, setFinRows] = useState([]);
  const [finLoading, setFinLoading] = useState(true);
  const loadFinance = useCallback(async () => {
    setFinLoading(true);
    try {
      const res = await paymentsApi.financeList({ teamView: teamView ? 1 : undefined });
      setFinRows((res && res.result) || []);
    } finally {
      setFinLoading(false);
    }
  }, [teamView]);
  useEffect(() => {
    loadFinance();
  }, [loadFinance]);

  const [stats, setStats] = useState(null);
  const [statsLoading, setStatsLoading] = useState(true);
  useEffect(() => {
    setStatsLoading(true);
    paymentsApi
      .stats()
      .then((res) => setStats((res && res.result) || null))
      .finally(() => setStatsLoading(false));
  }, []);

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
      if (evt && evt.kind === 'finance') {
        loadFinance();
        return;
      }
      load();
      if (evt && resultRef.current && evt.id === resultRef.current.id && evt.status === 'paid') {
        setResult((r) => (r && r.status !== 'paid' ? { ...r, status: 'paid' } : r));
      }
    };
    socket?.on('payments:updated', onUpdate);
    return () => socket?.off('payments:updated', onUpdate);
  }, [load, loadFinance]);

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

  const [finResult, setFinResult] = useState(null);
  const onCreate = async (values) => {
    setCreating(true);
    setResult(null);
    setFinResult(null);
    if (reqType === 'finance') {
      try {
        const res = await paymentsApi.financeCreate(values);
        if (res && res.success) {
          setFinResult(res.result);
          message.success(res.result.emailSent ? 'Finance KYC form emailed to the candidate.' : 'Finance request saved — email not sent.');
          form.resetFields();
          setFeeHint(null);
          setListType('finance');
          loadFinance();
        } else {
          message.error((res && res.message) || 'Could not create the finance request.');
        }
      } catch (e) {
        message.error('Could not create the finance request.');
      } finally {
        setCreating(false);
      }
      return;
    }
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

  // The QR shown right after creating a request is one-time only — nothing
  // persisted the image, just the short URL it encodes. This re-fetches it
  // (backend regenerates from the same short URL, no Razorpay call) so the
  // QR is viewable again any time later — e.g. an admin opening a request a
  // sales person raised earlier previously had no way to see its QR at all.
  const [qrFor, setQrFor] = useState(null);
  const [qrLoading, setQrLoading] = useState(false);
  const showQr = async (row) => {
    setQrFor({ ...row, qrDataUrl: null });
    setQrLoading(true);
    try {
      const res = await paymentsApi.get(row.id);
      if (res?.result?.qrDataUrl) setQrFor((f) => (f && f.id === row.id ? { ...f, qrDataUrl: res.result.qrDataUrl } : f));
      else message.error('Could not load the QR for this request.');
    } finally {
      setQrLoading(false);
    }
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
      title: 'Internship',
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
          {r.shortUrl && (
            <Tooltip title="Show QR">
              <Button className="pay-row-action" type="text" icon={<QrcodeOutlined />} onClick={() => showQr(r)} />
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

  // ── Finance (EMI) applications ─────────────────────────────────────────
  const [finFor, setFinFor] = useState(null);
  const [finBusy, setFinBusy] = useState(null);
  const openFinance = async (row) => {
    setFinFor({ ...row, loading: true });
    const res = await paymentsApi.financeGet(row.id);
    setFinFor(res?.result ? res.result : null);
  };
  const finResend = async (id) => {
    setFinBusy(id);
    try {
      const res = await paymentsApi.financeResend(id);
      if (res && res.success) message.success('Email re-sent.');
      else message.error((res && res.message) || 'Could not send the email.');
    } finally {
      setFinBusy(null);
      loadFinance();
    }
  };
  const finColumns = [
    columns[0],
    columns[1],
    {
      title: 'Finance',
      key: 'fin',
      width: 140,
      render: (_, r) => (
        <div>
          <span className="pay-row-amount">{r.financeAmount ? fmtInr(r.financeAmount) : '—'}</span>
          {r.tenureMonths && <div className="pay-row-inst">{r.tenureMonths} months</div>}
        </div>
      ),
    },
    {
      title: 'KYC form',
      dataIndex: 'status',
      width: 150,
      render: (v, r) =>
        v === 'submitted' ? (
          <span className="pay-pill pay-pill--green pay-pill--clickable" onClick={() => openFinance(r)}>
            <CheckCircleFilled /> Received
          </span>
        ) : (
          <span className={`pay-pill pay-pill--${r.emailSent ? 'orange' : 'red'}`}>
            <ClockCircleOutlined /> {r.emailSent ? 'Sent — pending' : 'Email not sent'}
          </span>
        ),
    },
    {
      title: 'By',
      dataIndex: 'createdByName',
      width: 110,
      render: (v, r) => (
        <div>
          <div>{v || '—'}</div>
          <div className="pay-row-inst">{r.created ? new Date(r.created).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : ''}</div>
        </div>
      ),
    },
    {
      title: '',
      key: 'actions',
      render: (_, r) => (
        <Space size={4}>
          <Tooltip title="Copy KYC form link">
            <Button className="pay-row-action" type="text" icon={<CopyOutlined />} onClick={() => copyLink(r.kycLink)} />
          </Tooltip>
          {r.status !== 'submitted' && (
            <Tooltip title="Re-send email">
              <Button className="pay-row-action" type="text" icon={<MailOutlined />} loading={finBusy === r.id} onClick={() => finResend(r.id)} />
            </Tooltip>
          )}
          <Tooltip title="View details">
            <Button className="pay-row-action" type="text" icon={<EyeOutlined />} onClick={() => openFinance(r)} />
          </Tooltip>
        </Space>
      ),
    },
  ];
  const pendingFin = finRows.filter((r) => r.status !== 'submitted').length;
  const receivedFin = finRows.length - pendingFin;

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
          <Card className="pay-form-card" title={reqType === 'finance' ? 'New finance request' : 'New payment request'}>
            <Segmented
              block
              value={reqType}
              onChange={(v) => {
                setReqType(v);
                setResult(null);
                setFinResult(null);
              }}
              options={[
                { value: 'payment', label: 'Payment', icon: <QrcodeOutlined /> },
                { value: 'finance', label: 'Finance (EMI)', icon: <BankOutlined /> },
              ]}
              style={{ marginBottom: 16 }}
            />
            {reqType === 'finance' && (
              <div className="pay-fee-hint" style={{ marginBottom: 14 }}>
                No payment link — the candidate gets an email with the <b>finance KYC form</b> (Aadhaar, PAN, full bank details,
                WhatsApp number). You'll see it under <b>Finance KYC</b> on the right once they submit.
              </div>
            )}
            <Form
              form={form}
              layout="vertical"
              onFinish={onCreate}
              requiredMark={false}
              initialValues={{ amount: MIN_REGISTRATION_AMOUNT }}
            >
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
              <Form.Item
                name="studentPhone"
                label={reqType === 'finance' ? 'Candidate phone' : 'Candidate phone (optional)'}
                rules={reqType === 'finance' ? [{ required: true, message: 'Enter the candidate phone.' }, { pattern: /^\+?[\d\s-]{10,15}$/, message: 'Enter a valid phone.' }] : []}
              >
                <Input placeholder={reqType === 'finance' ? '10-digit mobile' : 'For future WhatsApp reminders'} />
              </Form.Item>
              <Form.Item name="course" label="Internship" rules={reqType === 'finance' ? [{ required: true, message: 'Select the internship.' }] : []}>
                <Select
                  showSearch
                  allowClear
                  placeholder={reqType === 'finance' ? 'Select an internship' : 'Select an internship (optional)'}
                  optionFilterProp="label"
                  options={courses.map((c) => ({ value: c.title, label: `${c.code ? c.code + ' — ' : ''}${c.title}` }))}
                  onChange={onCourseChange}
                />
              </Form.Item>
              {reqType === 'finance' ? (
                <>
                  <Form.Item name="courseFee" label="Total course fee (INR, incl. GST)">
                    <InputNumber style={{ width: '100%' }} min={0} step={500} placeholder="e.g. 60000" />
                  </Form.Item>
                  <Form.Item name="financeAmount" label="Amount to finance (INR)" rules={[{ required: true, message: 'Enter the amount to finance.' }]}>
                    <InputNumber style={{ width: '100%' }} min={1} step={500} placeholder="e.g. 60000" />
                  </Form.Item>
                  <Form.Item name="tenureMonths" label="Tenure" rules={[{ required: true, message: 'Select the tenure.' }]}>
                    <Select placeholder="Select months" options={[3, 6, 9, 12, 18, 24].map((m) => ({ value: m, label: `${m} months` }))} />
                  </Form.Item>
                </>
              ) : (
              <Form.Item
                name="amount"
                label="Registration Amount (INR)"
                rules={[
                  { required: true, message: 'Enter the registration amount.' },
                  { type: 'number', min: MIN_REGISTRATION_AMOUNT, message: `Registration amount must be at least ₹${MIN_REGISTRATION_AMOUNT}.` },
                ]}
              >
                <InputNumber style={{ width: '100%' }} min={MIN_REGISTRATION_AMOUNT} step={500} placeholder="e.g. 5000" />
              </Form.Item>
              )}
              {feeHint && (
                <div className="pay-fee-hint">
                  <b>{fmtInr(feeHint.totalFee)}</b> total ({fmtInr(feeHint.baseFee)} + 18% GST) · {feeHint.durationMonths} monthly
                  installments of <b>{fmtInr(feeHint.installmentAmount)}</b>
                </div>
              )}
              <Form.Item name="notes" label="Notes (optional)">
                <Input.TextArea rows={2} placeholder="Internal note — not shown to the candidate" />
              </Form.Item>
              <Button type="primary" htmlType="submit" block loading={creating} icon={reqType === 'finance' ? <MailOutlined /> : <QrcodeOutlined />}>
                {reqType === 'finance' ? 'Send finance KYC form' : 'Generate payment link + QR'}
              </Button>
            </Form>

            {finResult && (
              <div className="pay-result">
                <div className="pay-result-info" style={{ width: '100%' }}>
                  <div className="pay-result-link">
                    <Input readOnly value={finResult.kycLink} />
                    <Button icon={<CopyOutlined />} onClick={() => copyLink(finResult.kycLink)}>
                      Copy
                    </Button>
                  </div>
                  <div className={`pay-result-email ${finResult.emailSent ? 'is-ok' : 'is-warn'}`}>
                    <MailOutlined /> {finResult.emailSent ? 'Finance KYC form emailed to the candidate.' : `Email not sent${finResult.emailError ? ` — ${finResult.emailError}` : '.'}`}
                  </div>
                </div>
              </div>
            )}

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
          {!statsLoading && stats && (
            <Card className="pay-list-card" style={{ marginBottom: 16 }}>
              {stats.team && (
                <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
                  <Button
                    size="small"
                    type={!teamView ? 'primary' : 'default'}
                    onClick={() => setTeamView(false)}
                  >
                    Me
                  </Button>
                  <Button
                    size="small"
                    type={teamView ? 'primary' : 'default'}
                    onClick={() => setTeamView(true)}
                  >
                    My Team{stats.team.name ? ` (${stats.team.name})` : ''}
                  </Button>
                </div>
              )}
              <Row gutter={[12, 12]}>
                {[
                  ['today', 'Today'],
                  ['week', 'This Week'],
                  ['month', 'This Month'],
                  ['threeMonth', '3 Months'],
                  ['sixMonth', '6 Months'],
                ].map(([key, label]) => {
                  const w = (teamView ? stats.team : stats.self)?.[key] || { count: 0, amount: 0 };
                  return (
                    <Col xs={12} sm={8} md={24 / 5} key={key}>
                      <div style={{ background: 'var(--hub-bg-soft, #f8fafc)', borderRadius: 10, padding: '10px 12px' }}>
                        <div style={{ fontSize: 11, color: '#64748b', fontWeight: 600 }}>{label}</div>
                        <div style={{ fontSize: 16, fontWeight: 800, marginTop: 2 }}>{fmtInr(w.amount)}</div>
                        <div style={{ fontSize: 11, color: '#94a3b8' }}>{w.count} paid</div>
                      </div>
                    </Col>
                  );
                })}
              </Row>
            </Card>
          )}

          <Card
            className="pay-list-card"
            title={
              <Segmented
                value={listType}
                onChange={setListType}
                options={[
                  { value: 'payment', label: `Payments (${rows.length})` },
                  { value: 'finance', label: `Finance KYC (${receivedFin} received${pendingFin ? ` · ${pendingFin} pending` : ''})` },
                ]}
              />
            }
            extra={
              <Button size="small" icon={<ReloadOutlined />} onClick={listType === 'finance' ? loadFinance : load}>
                Refresh
              </Button>
            }
          >
            {listType === 'finance' ? (
              finLoading ? (
                <Skeleton active paragraph={{ rows: 5 }} />
              ) : finRows.length === 0 ? (
                <Empty description="No finance requests yet." />
              ) : (
                <Table className="pay-table" rowKey="id" dataSource={finRows} columns={finColumns} pagination={{ pageSize: 10 }} scroll={{ x: 'max-content' }} />
              )
            ) : loading ? (
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
                  {kycFor.course || 'No internship'} {kycFor.amount ? `· ${fmtInr(kycFor.amount)}` : ''}
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

      <Modal open={!!finFor} title={null} footer={null} onCancel={() => setFinFor(null)} width={760} className="pay-kyc-modal">
        {!finFor || finFor.loading ? (
          <Skeleton active avatar paragraph={{ rows: 6 }} style={{ padding: 28 }} />
        ) : (
          <div className="pay-kyc-modal-body">
            <div className="pay-kyc-modal-head">
              <div className="pay-kyc-modal-avatar">{initialsOf((finFor.kyc && finFor.kyc.name) || finFor.studentName)}</div>
              <div className="pay-kyc-modal-who">
                <div className="pay-kyc-modal-name">{(finFor.kyc && finFor.kyc.name) || finFor.studentName}</div>
                <div className="pay-kyc-modal-meta">
                  Finance · {finFor.course || 'No internship'}
                  {finFor.financeAmount ? ` · ${fmtInr(finFor.financeAmount)}` : ''}
                  {finFor.tenureMonths ? ` · ${finFor.tenureMonths} months` : ''}
                </div>
              </div>
              {finFor.status === 'submitted' ? (
                <span className="pay-pill pay-pill--green pay-kyc-modal-status">
                  <CheckCircleFilled /> KYC received
                </span>
              ) : (
                <span className="pay-pill pay-pill--orange pay-kyc-modal-status">
                  <ClockCircleOutlined /> KYC pending
                </span>
              )}
            </div>
            {!finFor.kyc ? (
              <Empty description="The candidate hasn't submitted the finance KYC form yet." style={{ padding: '20px 0 4px' }} />
            ) : (
              <>
                {[
                  [
                    'Personal details',
                    [
                      ['Date of birth', finFor.kyc.dob],
                      ['Gender', finFor.kyc.gender],
                      ["Father's name", finFor.kyc.fatherName],
                      ["Mother's name", finFor.kyc.motherName],
                      ['Mobile', finFor.kyc.mobile],
                      ['WhatsApp', finFor.kyc.whatsapp],
                      ['Alternate mobile', finFor.kyc.alternateMobile],
                      ['Email', finFor.kyc.email],
                      ['Occupation', finFor.kyc.occupation],
                      ['Monthly income', finFor.kyc.monthlyIncome],
                      ['Aadhaar no.', finFor.kyc.aadharNumber],
                      ['PAN no.', finFor.kyc.panNumber],
                    ],
                  ],
                  [
                    'Address',
                    [
                      ['State', finFor.kyc.state],
                      ['District', finFor.kyc.district],
                      ['City', finFor.kyc.city],
                      ['Pincode', finFor.kyc.pincode],
                    ],
                  ],
                  [
                    'Bank details',
                    [
                      ['Account holder', finFor.kyc.bank?.accountHolder],
                      ['Bank', finFor.kyc.bank?.bankName],
                      ['Account no.', finFor.kyc.bank?.accountNumber],
                      ['IFSC', finFor.kyc.bank?.ifsc],
                      ['Branch', finFor.kyc.bank?.branch],
                      ['Account type', finFor.kyc.bank?.accountType],
                      ['Bank-registered mobile', finFor.kyc.bank?.registeredMobile],
                    ],
                  ],
                ].map(([label, fields]) => (
                  <React.Fragment key={label}>
                    <div className="pay-kyc-modal-section-label">{label}</div>
                    <div className="pay-kyc-modal-grid">
                      {fields.map(([k, v]) => (
                        <div className="pay-kyc-modal-field" key={k}>
                          <span>{k}</span>
                          <b>{v || '—'}</b>
                        </div>
                      ))}
                    </div>
                    {label === 'Address' && (
                      <div className="pay-kyc-modal-field pay-kyc-modal-field--full">
                        <span>Full address</span>
                        <b>{finFor.kyc.address || '—'}</b>
                      </div>
                    )}
                  </React.Fragment>
                ))}
                <div className="pay-kyc-modal-section-label">Documents</div>
                <Image.PreviewGroup>
                  <div className="pay-kyc-modal-docs">
                    {[
                      ['Aadhaar — front', finFor.kyc.aadharFront],
                      ['Aadhaar — back', finFor.kyc.aadharBack],
                      ['PAN — front', finFor.kyc.panFront],
                      ['Photo', finFor.kyc.photo],
                      ['Cheque / passbook', finFor.kyc.bankProof],
                    ]
                      .filter(([, p], i) => i < 3 || p)
                      .map(([label, path]) => (
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

      <Modal open={!!qrFor} title={qrFor?.studentName ? `QR — ${qrFor.studentName}` : 'QR'} footer={null} onCancel={() => setQrFor(null)} width={360}>
        {qrLoading || !qrFor?.qrDataUrl ? (
          <Skeleton.Image active style={{ width: 280, height: 280 }} />
        ) : (
          <div style={{ textAlign: 'center' }}>
            <img src={qrFor.qrDataUrl} alt="Payment QR" style={{ width: 280, height: 280 }} />
            <div style={{ marginTop: 12 }}>
              <Input readOnly value={qrFor.shortUrl} />
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
