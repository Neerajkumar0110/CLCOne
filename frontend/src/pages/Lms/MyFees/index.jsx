import React, { useEffect, useState } from 'react';
import { Empty, Skeleton, Alert, message } from 'antd';
import { useNavigate } from 'react-router-dom';
import lmsApi from '../api';
import '../components/LearnerDesign.css';

// My fees — design board L12: 4 KPI tiles, installments & receipts table |
// pay-next-installment card. Data is unchanged (plan/installments from
// GET /api/lms/my/fees, receipt PDF from GET /api/lms/my/fees/receipt).

function money(amount) {
  return `₹${Number(amount || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
}
function formatDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}
const shortDate = (d) => (d ? new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : '—');

const STATUS_CHIP = { paid: 'hai', created: 'adh', upcoming: 'gray', expired: 'red', cancelled: 'gray', failed: 'red' };
const STATUS_LABEL = { created: 'due', upcoming: 'upcoming' };

export default function MyFees() {
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);
  const [d, setD] = useState(null);
  const [downloading, setDownloading] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await lmsApi.myFees();
        if (alive) setD((res && res.result) || null);
      } catch (e) {
        if (alive) setErr('Could not load your fee details.');
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  if (loading) return <Skeleton active paragraph={{ rows: 8 }} style={{ padding: 24 }} />;
  if (err) return <Alert type="error" showIcon message={err} style={{ margin: 24 }} />;
  if (!d) return <Empty style={{ marginTop: 80 }} description="No fee information on file yet." />;

  const plan = d.plan;
  const feeGrandTotal = Number(plan ? plan.planTotal : d.feeGrandTotal) || 0;
  const feePaid = Number(plan ? plan.paidTotal : d.feePaid) || 0;
  const feeDue = Number(plan ? plan.remaining : d.feeDue) || 0;
  const payUrl = plan && plan.remaining > 0 ? plan.shortUrl : '';
  // design L12: the whole schedule — paid, created and still-upcoming installments
  const allInstallments = plan ? plan.installments : [];
  const next = allInstallments.find((i) => i.status !== 'paid');
  const downloadReceipt = async () => {
    setDownloading(true);
    try {
      await lmsApi.downloadFeeReceipt(`receipt-${d.enrollmentId || 'enrollment'}`);
    } catch (e) {
      message.error('Could not download the receipt.');
    } finally {
      setDownloading(false);
    }
  };
  const paymentTicket = () =>
    navigate('/learn/support', {
      state: { raise: { category: 'Payment', subject: 'Payment issue', reference: (next && next.reference) || d.enrollmentId || '', description: 'Order / reference ID:\nWhat happened:' } },
    });

  return (
    <div className="ld-page">
      <div className="ld-hd">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <h1>My fees</h1>
          <div className="ld-muted" style={{ fontSize: 14 }}>
            {[d.course || 'Your internship', plan && plan.installmentCount > 1 ? `${plan.installmentCount}-installment EMI plan` : null, d.batch && `Batch ${d.batch}`].filter(Boolean).join(' · ')}
          </div>
        </div>
      </div>

      <div className="ld-grid" style={{ gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 14 }}>
        <div className="ld-card" style={{ gap: 4, padding: 16 }}><span>Total fee</span><b style={{ fontSize: 26 }}>{money(feeGrandTotal)}</b></div>
        <div className="ld-card" style={{ gap: 4, padding: 16 }}><span>Paid</span><b style={{ fontSize: 26, color: '#166534' }}>{money(feePaid)}</b></div>
        <div className="ld-card" style={{ gap: 4, padding: 16 }}><span>Outstanding</span><b style={{ fontSize: 26, color: feeDue > 0 ? '#9a3412' : '#166534' }}>{money(feeDue)}</b></div>
        <div className="ld-card" style={{ gap: 4, padding: 16 }}><span>Next due</span><b style={{ fontSize: 26 }}>{next ? formatDate(next.dueAt) : '—'}</b></div>
      </div>

      <div className="ld-grid" style={{ gridTemplateColumns: 'minmax(0, 1fr) 380px', flex: 1 }}>
        <section className="ld-card" aria-label="Installments and receipts">
          <div className="ld-hd">
            <b style={{ fontSize: 16 }}>Installments &amp; receipts</b>
            <button type="button" className="ld-btn2 sm" onClick={downloadReceipt} disabled={downloading}>{downloading ? 'Preparing…' : 'Download receipt (PDF)'}</button>
          </div>
          <div className="ld-tablewrap">
            <table className="ld-table transaction-table">
              <thead><tr><th>#</th><th>Due date</th><th>Amount</th><th>Paid on</th><th>Reference</th><th>Status</th><th>Receipt</th></tr></thead>
              <tbody>
                {allInstallments.length === 0 ? (
                  <tr><td colSpan={7} className="ld-empty">No transaction records found — your payment history will appear here once available.</td></tr>
                ) : (
                  allInstallments.map((ins) => (
                    <tr key={ins.id || `n${ins.installmentNo}`}>
                      <td>{ins.installmentNo}</td>
                      <td>{formatDate(ins.dueAt)}</td>
                      <td>{money(ins.amount)}</td>
                      <td>{shortDate(ins.paidAt)}</td>
                      <td>{ins.reference || '—'}</td>
                      <td><span className={`ld-chip ${STATUS_CHIP[ins.status] || 'gray'}`}>{STATUS_LABEL[ins.status] || ins.status}</span></td>
                      <td>{ins.status === 'paid' ? <button type="button" className="ld-link" onClick={downloadReceipt}>PDF</button> : '—'}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          <div className="ld-soft">A payment shows "Paid" only after the server has verified it with the gateway — the success screen alone is not enough.</div>
          <div className="ld-muted" style={{ fontSize: 13, marginTop: 'auto' }}>Fees, EMI, refund and cancellation terms: <button type="button" className="ld-link" onClick={() => navigate('/learn/policies')}>Course terms</button></div>
        </section>

        <section className="ld-card" aria-label="Pay next installment">
          {next ? (
            <>
              <b style={{ fontSize: 16 }}>Pay installment {next.installmentNo}</b>
              <div style={{ fontSize: 30, fontWeight: 700 }}>{money(next.amount)}</div>
              <div className="ld-muted" style={{ fontSize: 13 }}>UPI · cards · netbanking via Razorpay</div>
              {payUrl ? (
                <a className="ld-btn" href={payUrl} target="_blank" rel="noreferrer">Pay now</a>
              ) : (
                <button type="button" className="ld-btn" disabled>Payment link not ready yet</button>
              )}
              <div className="ld-warn">If payment is not made after the due date, LMS access may be put on hold (per the finance policy). Support and Fees stay open even on hold.</div>
            </>
          ) : (
            <>
              <b style={{ fontSize: 16 }}>No outstanding payment</b>
              <div style={{ fontSize: 30, fontWeight: 700, color: '#166534' }}>{money(0)}</div>
              <div className="ld-muted" style={{ fontSize: 13 }}>Your fee is fully paid. Thank you!</div>
            </>
          )}
          <div style={{ fontSize: 13, fontWeight: 600, marginTop: 6 }}>Payment issue?</div>
          <div className="ld-muted" style={{ fontSize: 13 }}>Raise a ticket with the order / reference ID. Never send card details.</div>
          <button type="button" className="ld-link" style={{ fontSize: 13, marginTop: 'auto' }} onClick={paymentTicket}>Raise payment ticket →</button>
        </section>
      </div>
    </div>
  );
}
