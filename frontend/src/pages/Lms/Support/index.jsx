import React, { useCallback, useEffect, useState } from 'react';
import { Tag, Skeleton, message, Descriptions } from 'antd';
import { CheckCircleFilled } from '@ant-design/icons';
import dayjs from 'dayjs';
import { useLocation, useNavigate } from 'react-router-dom';
import { getSocket } from '@/socket';
import lmsApi from '../api';
import '../components/LearnerDesign.css';

// Student Help & Support (LMS panel). Tickets land on the CRM Support page;
// Support is emailed + notified live, and the student is emailed + notified
// live (bell/toast) when it's resolved — backend lmsController/
// supportTickets.js and ticketController/update.js.

const STATUS_CHIP = { Open: 'naya', 'In Progress': 'adh', Resolved: 'hai' };
const HISTORY_LABEL = {
  created: () => 'Ticket raised',
  status: (h) => (h.status === 'Resolved' ? 'Resolved' : `Moved to ${h.status}`),
  confirmed: () => 'You confirmed it is solved',
  reopened: () => 'Reopened',
};

// First-line answers per category (spec §25 FAQ) shown while raising a
// ticket — "That solved it" closes the form without creating a ticket.
const FAQ = {
  'Payment / Fees': 'Payments show as paid once the gateway confirms them (usually within minutes). If money was debited but the fee still shows due after an hour, attach the payment here and Finance will match it.',
  'Invoice / Receipt': 'Receipts for paid installments are under My Fees. If one is missing or has wrong details, attach the payment and tell us what should change.',
  'Live Class': 'Refresh the class page and use Join again — the link is issued fresh each time. If the class shows the wrong state or a recording is missing, send the class date and what you see; the team verifies the session and escalates confirmed issues.',
  'Internship Content': 'Study material and recordings for your batch are under Study Material and Recordings. Tell us the module / class if something is missing or wrong.',
  Certificate: 'Certificates are issued once every eligibility requirement is met — see My Eligibility. For a name or detail correction, tell us exactly what should change.',
  'Login / Technical': 'Try a hard refresh (Ctrl + Shift + R), another browser, or clearing site data. If it continues, tell us the device/browser and the exact error.',
};
const PAY_STATUS_COLOR = { paid: 'green', created: 'blue', expired: 'default', cancelled: 'default', failed: 'red' };
const inr = (n) => (typeof n === 'number' ? `₹${n.toLocaleString('en-IN')}` : '—');
const when = (v) => (v ? dayjs(v).format('D MMM YYYY, h:mm A') : '—');

const paymentLabel = (p) =>
  `${inr(p.amount)}${p.installmentCount > 1 ? ` · installment ${p.installmentNo}/${p.installmentCount}` : ''} · ${p.status}${
    p.paidAt ? ` · paid ${dayjs(p.paidAt).format('D MMM YYYY')}` : ` · ${dayjs(p.created).format('D MMM YYYY')}`
  }`;

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
  const [saving, setSaving] = useState(false);
  const [payments, setPayments] = useState(null);
  const [viewingId, setViewingId] = useState(null);
  const [reopenNote, setReopenNote] = useState('');
  const [confirming, setConfirming] = useState(null); // 'yes' | 'no' while saving
  const EMPTY = { category: '', priority: 'Medium', subject: '', reference: '', description: '', expected: '', payment: '' };
  const [f, setF] = useState(EMPTY);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));

  const viewing = tickets.find((t) => t._id === viewingId) || tickets[0] || null;

  // The learner's answer once Support resolves a ticket (backend
  // supportTickets.confirm): confirm, or reopen it back to Support.
  const answer = async (resolved) => {
    setConfirming(resolved ? 'yes' : 'no');
    const r = await lmsApi.confirmTicket(viewing._id, resolved, resolved ? undefined : reopenNote);
    setConfirming(null);
    if (!r || r.success === false) {
      message.error((r && r.message) || 'Could not save your answer.');
      return;
    }
    message.success(r.message);
    setReopenNote('');
    setTickets((xs) => xs.map((x) => (x._id === r.result._id ? r.result : x)));
  };
  const needsPayment = paymentCategories.includes(f.category);
  // Other pages link here with { state: { raise: { category, subject, description } } }
  // (e.g. "report a missing recording") — the form opens already filled in.
  const location = useLocation();
  const navigate = useNavigate();
  useEffect(() => {
    const raise = location.state && location.state.raise;
    if (!raise) return;
    setF((x) => ({ ...x, ...raise }));
    navigate(location.pathname, { replace: true, state: null }); // a refresh shouldn't refill it
  }, [location.state, location.pathname, navigate]);

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
    if (needsPayment && payments === null) {
      lmsApi.myTicketPayments().then((r) => setPayments(r?.success ? r.result : []));
    }
  }, [needsPayment, payments]);

  const submit = async () => {
    if (!f.category) return message.error('Pick a category.');
    if (!f.subject.trim()) return message.error('Add a short subject.');
    setSaving(true);
    const r = await lmsApi.createTicket({ ...f, payment: needsPayment && f.payment ? f.payment : undefined });
    setSaving(false);
    if (r?.success) {
      message.success(r.message || 'Ticket raised.');
      setF(EMPTY);
      if (r.result && r.result._id) setViewingId(r.result._id);
      load();
    } else {
      message.error(r?.message || 'Could not raise the ticket.');
    }
    return undefined;
  };

  if (loading) return <Skeleton active paragraph={{ rows: 6 }} style={{ padding: 24 }} />;

  const rows = filter === 'all' ? tickets : tickets.filter((t) => (filter === 'open' ? t.status !== 'Resolved' : t.status === 'Resolved'));
  const history = (viewing && viewing.history) || [];

  // design board L9 — "Naya ticket" form | my tickets + selected ticket history
  return (
    <div className="ld-page">
      <div className="ld-head">
        <h1>Support</h1>
      </div>

      <div className="ld-grid" style={{ gridTemplateColumns: '1fr 1fr', flex: 1 }}>
        <section className="ld-card" aria-label="New ticket" style={{ gap: 12 }}>
          <b style={{ fontSize: 16 }}>Naya ticket</b>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <label className="ld-label">Category
              <select className="ld-inp full" style={{ height: 38, fontSize: 14 }} value={f.category} onChange={set('category')}>
                <option value="">What is this about?</option>
                {categories.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </label>
            <label className="ld-label">Session / test / project ID
              <input className="ld-inp full" style={{ height: 38, fontSize: 14 }} maxLength={200} name="reference" value={f.reference} onChange={set('reference')} placeholder="e.g. S78 · 28 Oct" />
            </label>
          </div>
          <label className="ld-label">Subject
            <input className="ld-inp full" style={{ height: 38, fontSize: 14 }} maxLength={200} name="subject" value={f.subject} onChange={set('subject')} placeholder="e.g. Join button missing" />
          </label>
          {needsPayment && (
            <label className="ld-label">Which payment? (optional)
              <select className="ld-inp full" style={{ height: 38, fontSize: 14 }} value={f.payment} onChange={set('payment')}>
                <option value="">{payments && payments.length === 0 ? 'No payments on your account yet' : 'Select a payment'}</option>
                {(payments || []).map((p) => <option key={p._id} value={p._id}>{paymentLabel(p)}</option>)}
              </select>
            </label>
          )}
          <label className="ld-label">Kya hua?
            <textarea className="ld-inp full" style={{ height: 80, fontSize: 14, resize: 'none' }} maxLength={5000} name="description" value={f.description} onChange={set('description')} placeholder="Tell us what happened — dates, amounts, what you saw on screen…" />
          </label>
          <label className="ld-label">Kya hona chahiye tha?
            <input className="ld-inp full" style={{ height: 38, fontSize: 14 }} maxLength={1000} name="expected" value={f.expected} onChange={set('expected')} placeholder="e.g. Join button dikhna chahiye" />
          </label>
          <div style={{ padding: 12, borderRadius: 8, background: '#fef2f2', fontSize: 13, color: '#991b1b' }}>Password, OTP ya card details kabhi mat bhejein.</div>
          {FAQ[f.category] && (
            <div style={{ padding: 14, borderRadius: 8, background: '#eff6ff', fontSize: 13, lineHeight: '19px', display: 'flex', flexDirection: 'column', gap: 6 }}>
              <b style={{ color: '#1e40af' }}>Suggested answer (FAQ)</b>
              <span>{FAQ[f.category]}</span>
            </div>
          )}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 'auto' }}>
            {FAQ[f.category] && (
              <button type="button" className="ld-btn2" style={{ height: 42 }} onClick={() => { setF(EMPTY); message.success('Glad that helped.'); }}>Isse solve ho gaya</button>
            )}
            <button type="button" className="ld-btn" style={{ height: 42 }} disabled={saving} onClick={submit}>{saving ? 'Submitting…' : 'Ticket submit'}</button>
          </div>
        </section>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, minHeight: 0 }}>
          <section className="ld-card" aria-label="My tickets" style={{ gap: 8 }}>
            <div className="ld-hd">
              <b style={{ fontSize: 16 }}>Mere tickets</b>
              <span style={{ display: 'flex', gap: 6 }}>
                {[['all', 'All'], ['open', 'Open'], ['resolved', 'Resolved']].map(([k, l]) => (
                  <button key={k} type="button" className={`ld-pill${filter === k ? ' on' : ''}`} style={{ height: 28, fontSize: 12 }} onClick={() => setFilter(k)}>{l}</button>
                ))}
              </span>
            </div>
            {rows.length === 0 && <div className="ld-empty">{tickets.length ? 'No tickets here.' : 'You have not raised any tickets yet.'}</div>}
            {rows.map((t) => (
              <button
                key={t._id}
                type="button"
                className="tk-row"
                onClick={() => setViewingId(t._id)}
                style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, padding: '10px 12px', border: `1px solid ${viewing && viewing._id === t._id ? '#0e7490' : '#e2e8f0'}`, borderRadius: 8, fontSize: 13, background: '#fff', fontFamily: 'inherit', textAlign: 'left', cursor: 'pointer', color: '#0f172a' }}
              >
                <span><b>{t.ticketNo}</b> · {t.subject}{t.paymentSnapshot ? ` · ${inr(t.paymentSnapshot.amount)}` : ''}</span>
                <span className={`ld-chip ${STATUS_CHIP[t.status] || 'gray'}`}>{t.status}</span>
              </button>
            ))}
          </section>

          {viewing && (
            <section className="ld-card" aria-label="Ticket history" style={{ flex: 1 }}>
              <div className="ld-hd" style={{ flexWrap: 'wrap' }}>
                <b style={{ fontSize: 16 }}>{viewing.ticketNo} · history</b>
                <span className="ld-muted" style={{ fontSize: 13 }}>{viewing.priority} · {viewing.category}</span>
              </div>
              {(viewing.reference || viewing.description || viewing.expected) && (
                <div className="ld-soft" style={{ whiteSpace: 'pre-wrap' }}>
                  {viewing.reference && <div><span className="ld-muted">About: </span>{viewing.reference}</div>}
                  {viewing.description && <div>{viewing.description}</div>}
                  {viewing.expected && <div><span className="ld-muted">Expected: </span>{viewing.expected}</div>}
                </div>
              )}
              <ol className="tk-history" style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
                {(history.length ? history : [{ action: 'created', at: viewing.created }]).map((h, i, arr) => (
                  <li key={i} style={{ display: 'flex', gap: 12, fontSize: 13, lineHeight: '18px' }}>
                    <i style={{ width: 10, height: 10, borderRadius: 5, marginTop: 4, flexShrink: 0, background: i === arr.length - 1 && viewing.status !== 'Resolved' ? '#0e7490' : '#16a34a' }} />
                    <div>
                      <b>{HISTORY_LABEL[h.action] ? HISTORY_LABEL[h.action](h) : h.status}</b> · {when(h.at)}
                      {h.byName && <span className="ld-muted"> · {h.byName}</span>}
                      {h.note && <><br /><span className="ld-muted">{h.note}</span></>}
                    </div>
                  </li>
                ))}
                {viewing.status !== 'Resolved' && (
                  <li style={{ display: 'flex', gap: 12, fontSize: 13, lineHeight: '18px' }}>
                    <i style={{ width: 10, height: 10, borderRadius: 5, marginTop: 4, flexShrink: 0, background: '#cbd5e1' }} />
                    <div><b>Resolved → aapka confirmation</b><br /><span className="ld-muted">You&rsquo;ll get an email and a notification here once it&rsquo;s resolved.</span></div>
                  </li>
                )}
              </ol>
              {viewing.paymentSnapshot && <PaymentInfo snap={viewing.paymentSnapshot} />}
              {viewing.status === 'Resolved' && (
                <div style={{ marginTop: 'auto', display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <div style={{ color: '#166534', fontWeight: 600, fontSize: 13 }}><CheckCircleFilled /> Resolved · {when(viewing.resolvedAt)}{viewing.resolutionNote ? ` — ${viewing.resolutionNote}` : ''}</div>
                  {viewing.learnerConfirmedAt ? (
                    <span className="ld-muted" style={{ fontSize: 13 }}>You confirmed this on {when(viewing.learnerConfirmedAt)}.</span>
                  ) : (
                    <>
                      <textarea className="ld-inp full" style={{ height: 60 }} maxLength={1000} value={reopenNote} onChange={(e) => setReopenNote(e.target.value)} placeholder="If not — what is still wrong? (optional)" />
                      <div style={{ display: 'flex', gap: 8 }}>
                        <button type="button" className="ld-btn2" disabled={!!confirming} onClick={() => answer(false)}>Abhi bhi issue hai (reopen)</button>
                        <button type="button" className="ld-btn" style={{ height: 40 }} disabled={!!confirming} onClick={() => answer(true)}>Haan, solve ho gaya</button>
                      </div>
                    </>
                  )}
                </div>
              )}
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
