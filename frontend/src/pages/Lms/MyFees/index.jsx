import React, { useEffect, useState } from 'react';
import { Empty, Skeleton, Alert } from 'antd';
import {
  WalletOutlined,
  BookOutlined,
  CheckCircleOutlined,
  ExclamationCircleOutlined,
  CreditCardOutlined,
  FileTextOutlined,
  DownloadOutlined,
} from '@ant-design/icons';
import lmsApi from '../api';
import '../components/FeesCourses.css';

// Same visual language as the Finance hub's payment detail modal
// (pages/Finance/index.jsx's PaymentDetailModal) — the underlying data
// (plan/installments from GET /api/lms/my/fees) is unchanged, only the
// markup/CSS here is redesigned.

function money(amount) {
  const n = Number(amount || 0);
  return `₹${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
function formatDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' });
}

const STATUS_CLASS = {
  paid: 'txn-status',
  created: 'txn-status pending',
  upcoming: 'txn-status pending',
  expired: 'txn-status pending',
  cancelled: 'txn-status pending',
  failed: 'txn-status pending',
};

export default function MyFees() {
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);
  const [d, setD] = useState(null);

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
  const pct = feeGrandTotal > 0 ? Math.round((feePaid / feeGrandTotal) * 100) : feeDue <= 0 ? 100 : 0;
  const paidInstallments = plan ? plan.installments.filter((i) => !i.projected) : [];

  return (
    <div className="fees-page">
      <div className="page-hero">
        <div className="hero-left">
          <div className="hero-icon">
            <WalletOutlined />
          </div>
          <div className="hero-title">
            <h1>My Fees</h1>
            <p>
              {d.course || 'Your course'}
              {d.batch ? ` · Batch ${d.batch}` : ''}
              {d.enrollmentId ? ` · ${d.enrollmentId}` : ''}
            </p>
          </div>
        </div>
        {payUrl && (
          <a className="hero-action" href={payUrl} target="_blank" rel="noreferrer">
            <button type="button" className="hero-pay-button">
              <CreditCardOutlined /> Pay next installment
            </button>
          </a>
        )}
      </div>

      <div className="fee-stat-grid">
        <div className="fee-stat-card">
          <div className="fee-stat-icon">
            <BookOutlined />
          </div>
          <div className="fee-stat-content">
            <span>Total payable</span>
            <strong>{money(feeGrandTotal)}</strong>
          </div>
        </div>
        <div className="fee-stat-card paid">
          <div className="fee-stat-icon">
            <CheckCircleOutlined />
          </div>
          <div className="fee-stat-content">
            <span>Paid so far</span>
            <strong>{money(feePaid)}</strong>
          </div>
        </div>
        <div className="fee-stat-card balance">
          <div className="fee-stat-icon">
            <ExclamationCircleOutlined />
          </div>
          <div className="fee-stat-content">
            <span>Balance due</span>
            <strong>{money(feeDue)}</strong>
          </div>
        </div>
      </div>

      <div className="fee-main-grid">
        <div className="dashboard-card">
          <div className="card-header">
            <div>
              <h2>Payment Overview</h2>
            </div>
          </div>
          <div className="payment-overview">
            <div className="payment-circle" style={{ '--pct': `${pct}%` }}>
              <div className="payment-circle-content">
                <strong>{pct}%</strong>
                <span>Paid</span>
              </div>
            </div>
            <div className="payment-details">
              <div className="payment-values">
                <div className="payment-value">
                  <span>Total Paid</span>
                  <strong>{money(feePaid)}</strong>
                </div>
                <div className="payment-value">
                  <span>Remaining</span>
                  <strong>{money(feeDue)}</strong>
                </div>
              </div>
              <div className="payment-progress">
                <div className="payment-progress-top">
                  <span>Payment Progress</span>
                  <span>{pct}%</span>
                </div>
                <div className="progress-track" style={{ '--pct': `${pct}%` }}>
                  <span />
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="dashboard-card">
          <div className="payment-success">
            {feeDue <= 0 ? (
              <div className="success-box">
                <div className="success-icon">
                  <CheckCircleOutlined />
                </div>
                <div className="success-content">
                  <strong>No outstanding payment</strong>
                  <p>Your fee is fully paid. Thank you for your payment!</p>
                </div>
              </div>
            ) : (
              <div className="success-box is-due">
                <div className="success-icon">
                  <ExclamationCircleOutlined />
                </div>
                <div className="success-content">
                  <strong>Payment pending</strong>
                  <p>You have a balance of {money(feeDue)} due.</p>
                  {payUrl && (
                    <a className="pay-link" href={payUrl} target="_blank" rel="noreferrer">
                      Pay now →
                    </a>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="dashboard-card transaction-card">
        <div className="card-header">
          <div>
            <h2>Transaction / Fee Details</h2>
          </div>
          <div className="transaction-actions">
            <button type="button" className="download-button" disabled={!paidInstallments.length}>
              <DownloadOutlined /> Download Receipt
            </button>
          </div>
        </div>

        <div className="transaction-table-wrapper">
          <table className="transaction-table">
            <thead>
              <tr>
                <th>DATE</th>
                <th>DESCRIPTION</th>
                <th>AMOUNT</th>
                <th>PAYMENT MODE</th>
                <th>STATUS</th>
                <th>RECEIPT</th>
              </tr>
            </thead>
            <tbody>
              {paidInstallments.length === 0 ? (
                <tr>
                  <td colSpan={6} className="empty-table">
                    <div className="empty-icon">
                      <FileTextOutlined />
                    </div>
                    <strong>No transaction records found</strong>
                    <br />
                    <span>Your payment history will appear here once available.</span>
                  </td>
                </tr>
              ) : (
                paidInstallments.map((ins) => (
                  <tr key={ins.id || ins.installmentNo}>
                    <td>{formatDate(ins.paidAt || ins.dueAt)}</td>
                    <td>
                      Installment {ins.installmentNo}/{plan.installmentCount}
                    </td>
                    <td>{money(ins.amount)}</td>
                    <td>—</td>
                    <td>
                      <span className={STATUS_CLASS[ins.status] || 'txn-status pending'}>{ins.status}</span>
                    </td>
                    <td>—</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
