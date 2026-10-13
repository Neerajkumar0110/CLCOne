import React, { useCallback, useEffect, useState } from 'react';
import { Card, Table, Tag, Button, Modal, Form, Input, Select, Space, Empty, Skeleton, message, Typography, Segmented, Descriptions } from 'antd';
import { CustomerServiceOutlined, PlusOutlined, TagOutlined, FileTextOutlined, WalletOutlined, FlagOutlined, CheckCircleFilled } from '@ant-design/icons';
import dayjs from 'dayjs';
import { getSocket } from '@/socket';
import lmsApi from '../api';

const { Text, Paragraph } = Typography;

// Student Help & Support (LMS panel). Tickets land on the CRM Support page;
// Support is emailed + notified live, and the student is emailed + notified
// live (bell/toast) when it's resolved — backend lmsController/
// supportTickets.js and ticketController/update.js.

// Same label-with-icon treatment as the other LMS modals (Doubts, Projects…).
const Lbl = ({ icon, children }) => (
  <span className="crud-lbl"><span className="crud-lbl-icon">{icon}</span>{children}</span>
);

const STATUS_COLOR = { Open: 'blue', 'In Progress': 'orange', Resolved: 'green' };
const PRIORITY_COLOR = { Low: 'default', Medium: 'blue', High: 'orange', Urgent: 'red' };
const PAY_STATUS_COLOR = { paid: 'green', created: 'blue', expired: 'default', cancelled: 'default', failed: 'red' };
const inr = (n) => (typeof n === 'number' ? `₹${n.toLocaleString('en-IN')}` : '—');
const when = (v) => (v ? dayjs(v).format('D MMM YYYY, h:mm A') : '—');

const paymentLabel = (p) =>
  `${inr(p.amount)}${p.installmentCount > 1 ? ` · installment ${p.installmentNo}/${p.installmentCount}` : ''} · ${p.status}${
    p.paidAt ? ` · paid ${dayjs(p.paidAt).format('D MMM YYYY')}` : ` · ${dayjs(p.created).format('D MMM YYYY')}`
  }`;

// Ticket detail modal building blocks — same tokens as the crud-modal
// (featureHub.css) so the view sits in the same family as every form modal.
const TILE_GRID = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 130px), 1fr))', gap: 10, marginBottom: 14 };
const SECTION = { border: '1px solid var(--hub-border, #e5e7eb)', borderRadius: 12, padding: '12px 14px', marginBottom: 12 };

function InfoTile({ label, children }) {
  return (
    <div style={{ background: 'var(--hub-bg-soft, #f8fafc)', border: '1px solid var(--hub-border, #e5e7eb)', borderRadius: 12, padding: '10px 12px', minWidth: 0 }}>
      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.5, textTransform: 'uppercase', color: 'var(--hub-muted, #8c8c8c)', marginBottom: 4 }}>{label}</div>
      <div style={{ fontWeight: 600, color: 'var(--hub-text, #111827)', overflowWrap: 'anywhere' }}>{children}</div>
    </div>
  );
}

function Section({ icon, title, children }) {
  return (
    <div style={SECTION}>
      <div style={{ marginBottom: 8 }}><Lbl icon={icon}>{title}</Lbl></div>
      {children}
    </div>
  );
}

function PaymentInfo({ snap }) {
  if (!snap) return null;
  return (
    <Descriptions size="small" column={1} bordered>
      <Descriptions.Item label="Amount">{inr(snap.amount)}{snap.installmentCount > 1 ? ` (installment ${snap.installmentNo} of ${snap.installmentCount})` : ''}</Descriptions.Item>
      <Descriptions.Item label="Status"><Tag color={PAY_STATUS_COLOR[snap.status]}>{snap.status}</Tag></Descriptions.Item>
      {snap.course && <Descriptions.Item label="Internship">{snap.course}</Descriptions.Item>}
      {snap.paidAt && <Descriptions.Item label="Paid on">{when(snap.paidAt)}</Descriptions.Item>}
      {snap.razorpayPaymentId && <Descriptions.Item label="Payment ID">{snap.razorpayPaymentId}</Descriptions.Item>}
    </Descriptions>
  );
}

export default function SupportTickets() {
  const [loading, setLoading] = useState(true);
  const [tickets, setTickets] = useState([]);
  const [categories, setCategories] = useState([]);
  const [paymentCategories, setPaymentCategories] = useState([]);
  const [filter, setFilter] = useState('all');
  const [raising, setRaising] = useState(false);
  const [saving, setSaving] = useState(false);
  const [payments, setPayments] = useState(null);
  const [viewing, setViewing] = useState(null);
  const [form] = Form.useForm();
  const category = Form.useWatch('category', form);
  const needsPayment = paymentCategories.includes(category);

  const load = useCallback(async () => {
    const r = await lmsApi.myTickets();
    if (r?.success) {
      setTickets(r.result.tickets || []);
      setCategories(r.result.categories || []);
      setPaymentCategories(r.result.paymentCategories || []);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Live: Support moving a ticket (In Progress / Resolved) pushes an LMS
  // notification over the socket — refresh the list the moment it lands.
  useEffect(() => {
    const socket = getSocket();
    const onNote = (doc) => {
      if (doc?.type === 'ticket.status') load();
    };
    socket?.on('notification:new', onNote);
    return () => socket?.off('notification:new', onNote);
  }, [load]);

  useEffect(() => {
    if (raising && needsPayment && payments === null) {
      lmsApi.myTicketPayments().then((r) => setPayments(r?.success ? r.result : []));
    }
  }, [raising, needsPayment, payments]);

  const submit = async () => {
    const v = await form.validateFields();
    setSaving(true);
    const r = await lmsApi.createTicket({ ...v, payment: needsPayment ? v.payment : undefined });
    setSaving(false);
    if (r?.success) {
      message.success(r.message || 'Ticket raised.');
      setRaising(false);
      form.resetFields();
      load();
    } else {
      message.error(r?.message || 'Could not raise the ticket.');
    }
  };

  if (loading) return <Skeleton active paragraph={{ rows: 6 }} style={{ padding: 24 }} />;

  const rows = filter === 'all' ? tickets : tickets.filter((t) => (filter === 'open' ? t.status !== 'Resolved' : t.status === 'Resolved'));

  return (
    <div className="lms-portal" style={{ padding: 4 }}>
      <div className="lms-portal-head">
        <div>
          <h2><CustomerServiceOutlined /> Help &amp; Support</h2>
          <p>Raise a ticket about payments, invoices, classes or anything else — we&rsquo;ll email you when it&rsquo;s resolved.</p>
        </div>
        <Space>
          <Segmented value={filter} onChange={setFilter} options={[{ label: 'All', value: 'all' }, { label: 'Open', value: 'open' }, { label: 'Resolved', value: 'resolved' }]} />
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setRaising(true)}>Raise a ticket</Button>
        </Space>
      </div>

      {rows.length === 0 ? (
        <Card><Empty description={tickets.length ? 'No tickets here.' : 'You have not raised any tickets yet.'} /></Card>
      ) : (
        <Card bodyStyle={{ padding: 0 }}>
          <Table
            rowKey="_id"
            dataSource={rows}
            pagination={{ pageSize: 10, hideOnSinglePage: true }}
            onRow={(t) => ({ onClick: () => setViewing(t), style: { cursor: 'pointer' } })}
            columns={[
              { title: 'Ticket', dataIndex: 'ticketNo', width: 120, render: (v) => <Text strong>{v}</Text> },
              { title: 'Subject', dataIndex: 'subject', render: (v, t) => <>{v}{t.paymentSnapshot && <Tag icon={<WalletOutlined />} style={{ marginLeft: 8 }}>{inr(t.paymentSnapshot.amount)}</Tag>}</> },
              { title: 'Category', dataIndex: 'category', width: 170 },
              { title: 'Priority', dataIndex: 'priority', width: 100, render: (v) => <Tag color={PRIORITY_COLOR[v]}>{v}</Tag> },
              { title: 'Status', dataIndex: 'status', width: 120, render: (v) => <Tag color={STATUS_COLOR[v]}>{v}</Tag> },
              { title: 'Raised', dataIndex: 'created', width: 180, render: when },
            ]}
          />
        </Card>
      )}

      <Modal
        className="crud-modal"
        open={raising}
        title={
          <span className="crud-modal-title">
            <span className="crud-modal-title-icon"><CustomerServiceOutlined /></span>
            <span>
              <span className="crud-modal-title-kicker">New ticket</span>
              <span className="crud-modal-title-main">Raise a ticket</span>
            </span>
          </span>
        }
        onCancel={() => setRaising(false)}
        onOk={submit}
        okText="Submit ticket"
        confirmLoading={saving}
        destroyOnClose
        maskClosable={false}
        width={600}
      >
        <Form form={form} layout="vertical" preserve={false} className="crud-form" initialValues={{ priority: 'Medium' }}>
          <div className="crud-form-grid">
            <Form.Item name="category" label={<Lbl icon={<TagOutlined />}>Category</Lbl>} rules={[{ required: true, message: 'Pick a category.' }]}>
              <Select placeholder="What is this about?" options={categories.map((c) => ({ value: c, label: c }))} />
            </Form.Item>
            <Form.Item name="priority" label={<Lbl icon={<FlagOutlined />}>Priority</Lbl>}>
              <Select options={['Low', 'Medium', 'High', 'Urgent'].map((p) => ({ value: p, label: p }))} />
            </Form.Item>
            {needsPayment && (
              <Form.Item
                name="payment"
                className="crud-form-full"
                label={<Lbl icon={<WalletOutlined />}>Which payment?</Lbl>}
                extra="Optional — pick the payment this is about so Support sees its details straight away."
              >
                <Select
                  allowClear
                  loading={payments === null}
                  placeholder={payments && payments.length === 0 ? 'No payments on your account yet' : 'Select a payment'}
                  options={(payments || []).map((p) => ({ value: p._id, label: paymentLabel(p) }))}
                />
              </Form.Item>
            )}
            <Form.Item
              name="subject"
              className="crud-form-full"
              label={<Lbl icon={<FileTextOutlined />}>Subject</Lbl>}
              rules={[{ required: true, whitespace: true, message: 'Add a short subject.' }]}
            >
              <Input maxLength={200} placeholder="e.g. Paid my fee but it still shows as due" />
            </Form.Item>
            <Form.Item name="description" className="crud-form-full" label={<Lbl icon={<FileTextOutlined />}>Details</Lbl>}>
              <Input.TextArea rows={4} maxLength={5000} placeholder="Tell us what happened — dates, amounts, screenshots you can describe…" />
            </Form.Item>
          </div>
        </Form>
      </Modal>

      <Modal
        className="crud-modal"
        open={!!viewing}
        onCancel={() => setViewing(null)}
        width={620}
        title={
          viewing && (
            <span className="crud-modal-title">
              <span className="crud-modal-title-icon"><CustomerServiceOutlined /></span>
              <span style={{ minWidth: 0 }}>
                <span className="crud-modal-title-kicker">Ticket · {viewing.ticketNo}</span>
                <span className="crud-modal-title-main">{viewing.subject}</span>
              </span>
            </span>
          )
        }
        footer={<Button onClick={() => setViewing(null)}>Close</Button>}
      >
        {viewing && (
          <>
            <div style={TILE_GRID}>
              <InfoTile label="Status"><Tag color={STATUS_COLOR[viewing.status]} style={{ margin: 0 }}>{viewing.status}</Tag></InfoTile>
              <InfoTile label="Priority"><Tag color={PRIORITY_COLOR[viewing.priority]} style={{ margin: 0 }}>{viewing.priority}</Tag></InfoTile>
              <InfoTile label="Category">{viewing.category}</InfoTile>
              <InfoTile label="Raised on">{when(viewing.created)}</InfoTile>
            </div>

            <Section icon={<FileTextOutlined />} title="Details">
              <Paragraph style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{viewing.description || <Text type="secondary">No extra details added.</Text>}</Paragraph>
            </Section>

            {viewing.paymentSnapshot && (
              <Section icon={<WalletOutlined />} title="Payment">
                <PaymentInfo snap={viewing.paymentSnapshot} />
              </Section>
            )}

            {viewing.status === 'Resolved' ? (
              <div style={{ ...SECTION, background: '#f6ffed', borderColor: '#b7eb8f' }}>
                <Text strong style={{ color: '#389e0d' }}><CheckCircleFilled /> Resolved · {when(viewing.resolvedAt)}</Text>
                <Paragraph style={{ margin: '6px 0 0', whiteSpace: 'pre-wrap' }}>{viewing.resolutionNote || 'Support has marked this ticket resolved.'}</Paragraph>
              </div>
            ) : (
              <div style={{ ...SECTION, background: 'var(--hub-blue-soft, #eff6ff)', borderColor: 'transparent' }}>
                <Text type="secondary">
                  {viewing.status === 'In Progress' ? 'Support is working on this.' : 'Support has been notified.'} You&rsquo;ll get an email and a notification here once it&rsquo;s resolved.
                </Text>
              </div>
            )}
          </>
        )}
      </Modal>
    </div>
  );
}
