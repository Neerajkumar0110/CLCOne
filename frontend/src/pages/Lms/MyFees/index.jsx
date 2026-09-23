import React, { useEffect, useState } from 'react';
import { Empty, Skeleton, Alert, Button, Row } from 'antd';
import { WalletOutlined, BookOutlined, CreditCardOutlined } from '@ant-design/icons';
import lmsApi from '../api';
import KpiTile from '../components/KpiTile';

// Same visual language as the Finance hub's payment detail modal
// (pages/Finance/index.jsx's PaymentDetailModal + the .fin-pm-* rules in
// style/partials/featureHub.css) — reused here rather than reinvented, so a
// student sees the exact same "which month's payment has come in" schedule
// their fee agent does.

function money(amount) {
  const n = Number(amount || 0);
  return `₹${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
function formatDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' });
}
function monthLabel(ins) {
  const d = ins.paidAt || ins.dueAt;
  if (!d) return '—';
  return new Date(d).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
}

const STATUS_BADGE = {
  paid: 'hub-badge-green',
  created: 'hub-badge-yellow',
  upcoming: 'hub-badge-purple',
  expired: 'hub-badge-gray',
  cancelled: 'hub-badge-gray',
  failed: 'hub-badge-red',
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
  const feeGrandTotal = plan ? plan.planTotal : d.feeGrandTotal;
  const feePaid = plan ? plan.paidTotal : d.feePaid;
  const feeDue = plan ? plan.remaining : d.feeDue;
  const payUrl = plan && plan.remaining > 0 ? plan.shortUrl : '';

  return (
    <div className="lms-portal lms-dashboard-shell" style={{ padding: 4 }}>
      <div className="lms-portal-head">
        <div>
          <h2>
            <WalletOutlined /> My Fees
          </h2>
          <p>
            {d.course || 'Your course'}
            {d.batch ? ` · Batch ${d.batch}` : ''}
            {d.enrollmentId ? ` · ${d.enrollmentId}` : ''}
          </p>
        </div>
        {payUrl && (
          <a href={payUrl} target="_blank" rel="noreferrer">
            <Button type="primary" icon={<CreditCardOutlined />}>
              Pay next installment
            </Button>
          </a>
        )}
      </div>

      <Row gutter={[14, 14]} style={{ marginTop: 12 }}>
        <KpiTile title="Total payable" value={money(feeGrandTotal)} tone="slate" icon={<BookOutlined />} />
        <KpiTile title="Paid so far" value={money(feePaid)} tone="green" />
        <KpiTile title="Balance due" value={money(feeDue)} tone={feeDue > 0 ? 'amber' : 'green'} />
      </Row>

      {plan && plan.installments && plan.installments.length > 1 && (
        <div className="fin-pm-section" style={{ marginTop: 16 }}>
          <div className="fin-pm-section-label">
            <span className="fin-pm-section-icon">
              <WalletOutlined />
            </span>
            EMI schedule
          </div>
          <div className="fin-pm-sched-list">
            {plan.installments.map((ins) => (
              <div className={`fin-pm-sched-row ${ins.projected ? 'is-projected' : ''}`} key={ins.installmentNo}>
                <div className="fin-pm-sched-no">
                  {ins.installmentNo}/{plan.installmentCount}
                </div>
                <div className="fin-pm-sched-mid">
                  <div className="fin-pm-sched-month">{monthLabel(ins)}</div>
                  <div className="fin-pm-sched-emails">
                    {ins.projected ? 'Not due yet' : ins.status === 'paid' ? `Paid ${formatDate(ins.paidAt)}` : `Due ${formatDate(ins.dueAt)}`}
                  </div>
                </div>
                <div className="fin-pm-sched-end">
                  <span className={`hub-badge ${STATUS_BADGE[ins.status] || 'hub-badge-gray'}`}>{ins.status}</span>
                  <span className="fin-pm-sched-amount">{money(ins.amount)}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
