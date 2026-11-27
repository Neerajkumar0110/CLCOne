import React, { useEffect, useState } from 'react';
import { message, Modal, Button, Input, Select } from 'antd';
import {
  WalletOutlined, CheckCircleOutlined, WarningOutlined, StopOutlined, CalendarOutlined, RollbackOutlined, SearchOutlined,
  CreditCardOutlined, CloseCircleOutlined, ReloadOutlined, ToolOutlined, LockOutlined,
} from '@ant-design/icons';
import lmsApi from '../api';
import { useLoad, act, Loading, money } from './shared';
import './mgmt.css';
import './opsPages.css';

// Design A3 · Finance — payments & provisioning. Rows are the real Razorpay
// payment requests; the fix panel shows the payment → learner → batch →
// access chain for the selected row. Card data / secrets are never returned.
// 2026-11-27 redesign: gradient hero + KPI tiles, payment rows, the chain +
// fix form open in a modal.
const GW_TONE = { VERIFIED: 'ok', PENDING: 'mid' };
const PROV_TONE = { DONE: 'ok', FAILED: 'bad', PENDING: 'bad', WAITING: 'none' };

export default function Finance() {
  const [q, setQ] = useState('');
  const [term, setTerm] = useState('');
  const { data, loading, err, reload } = useLoad(() => lmsApi.opsPayments(term), [term]);
  const [sel, setSel] = useState(null);
  const [detail, setDetail] = useState(null);
  const [batch, setBatch] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  const rows = (data && data.rows) || [];

  useEffect(() => {
    if (!sel) return;
    setDetail(null);
    lmsApi.opsPaymentDetail(sel).then((r) => {
      setDetail((r && r.result) || null);
      setBatch('');
      setReason('');
    });
  }, [sel]);

  const recheck = async (id) => {
    const r = await act(lmsApi.opsPaymentRecheck(id));
    if (r) message.info(`Gateway: ${r.gatewayStatus} · CRM: ${r.crmStatus}. ${r.note}`, 6);
  };
  const retry = async () => {
    setBusy(true);
    const r = await act(lmsApi.opsPaymentProvision(sel, { batch: batch || undefined, reason }), 'Provisioning done');
    setBusy(false);
    if (r) {
      reload();
      lmsApi.opsPaymentDetail(sel).then((x) => setDetail(x && x.result));
    }
  };

  const k = data && data.kpis;
  const needsFix = detail && detail.chain.some((c) => !c.ok) && detail.row.gateway === 'VERIFIED';
  const tiles = k ? [
    [WalletOutlined, 'g3', money(k.collected), 'Collected (this month)', 'ok'],
    [CheckCircleOutlined, 'g2', k.verified, 'Payments verified', 'ok'],
    [WarningOutlined, 'g6', k.notProvisioned, 'Paid, not provisioned', k.notProvisioned ? 'bad' : 'ok'],
    [StopOutlined, 'g1', k.duplicateWebhooks, 'Duplicate webhooks blocked', 'none'],
    [CalendarOutlined, 'g4', k.emiDueWeek, 'EMI due this week', k.emiDueWeek ? 'mid' : 'none'],
    [RollbackOutlined, 'g5', k.refunds, 'Refund requests', k.refunds ? 'mid' : 'none'],
  ] : [];

  return (
    <div className="mg op">
      <div className="mg-hero fn-hero">
        <div className="mg-hero-l">
          <span className="mg-hero-ic"><CreditCardOutlined /></span>
          <div style={{ minWidth: 0 }}>
            <span className="mg-kicker">Finance · spec §16</span>
            <h1>Payments &amp; provisioning</h1>
            <p>Every verified payment should become a learner with a batch and access. Card data and gateway secrets are never shown — only the order / reference ID.</p>
          </div>
        </div>
        <form className="op-hero-search" onSubmit={(e) => { e.preventDefault(); setTerm(q); }}>
          <Input allowClear prefix={<SearchOutlined />} placeholder="Order / reference ID / learner" value={q} onChange={(e) => { setQ(e.target.value); if (!e.target.value) setTerm(''); }} aria-label="Search order" />
          <Button htmlType="submit">Search</Button>
        </form>
      </div>

      <Loading loading={loading} err={err} data={data}>
        {data && (
          <>
            <div className="mg-kpis op-kpis">
              {tiles.map(([Ic, g, v, label, tone]) => (
                <div className={`mg-k ${tone}`} key={label}>
                  <div className="mg-k-top"><span className={`mg-k-ic ${g}`}><Ic /></span></div>
                  <b className="mg-k-v">{v}</b>
                  <span className="mg-k-l">{label}</span>
                </div>
              ))}
            </div>

            <section className="mg-card op-list">
              <div className="mg-hd">
                <span className="mg-hd-ic g3"><CreditCardOutlined /></span>
                <div><b>Payment → enrollment log · {rows.length}</b><small>Click a payment to see its chain and fix provisioning</small></div>
              </div>
              <div className="mg-tbl">
                <div className="mg-tr fn-tr mg-th"><span>Order</span><span>Learner</span><span>Amount</span><span>Gateway (server verify)</span><span>Webhooks</span><span>Provisioning</span><span /></div>
                {rows.length === 0 && (
                  <div className="op-empty"><span className="op-empty-ic g3"><WalletOutlined /></span><b>No payments {term ? 'match' : 'yet'}</b><span>{term ? 'Try another order ID or name.' : 'Razorpay payment requests will show up here.'}</span></div>
                )}
                {rows.map((r) => (
                  <div className={`mg-tr fn-tr${PROV_TONE[r.provisioning.key] === 'bad' ? ' bad' : ''}`} key={r.id} role="button" tabIndex={0} onClick={() => setSel(r.id)} onKeyDown={(e) => { if (e.key === 'Enter') setSel(r.id); }}>
                    <span><code className="sc-ev">{r.order}</code></span>
                    <span className="mg-obj">{r.learner}</span>
                    <span className="fn-amt">{money(r.amount)}{r.installment ? <small> {r.installment}</small> : null}</span>
                    <span className="op-chips"><span className={`mg-pill ${GW_TONE[r.gateway] || 'none'}`}>{r.gateway}</span>{r.amountMismatch && <span className="mg-pill bad">Amount mismatch</span>}</span>
                    <span>{r.webhooks}{r.webhooks > 1 && <small className="mg-rsn"> ({r.webhooks - 1} dup ignored)</small>}</span>
                    <span><span className={`mg-pill ${PROV_TONE[r.provisioning.key] || 'none'}`}>{r.provisioning.text}</span></span>
                    <span onClick={(e) => e.stopPropagation()} className="op-chips">
                      {r.gateway === 'PENDING' && <Button size="small" icon={<ReloadOutlined />} onClick={() => recheck(r.id)}>Recheck</Button>}
                      {PROV_TONE[r.provisioning.key] === 'bad' && <Button size="small" type="primary" danger icon={<ToolOutlined />} onClick={() => setSel(r.id)}>Fix</Button>}
                    </span>
                  </div>
                ))}
              </div>
              <div className="mg-foot"><LockOutlined /> The browser success screen is not trusted · the same webhook arriving twice still creates only one learner (idempotent)</div>
            </section>
          </>
        )}
      </Loading>

      <Modal open={!!sel} onCancel={() => setSel(null)} footer={null} width={620} centered destroyOnClose rootClassName="mg-modal">
        <div className="mg-m">
          <div className="mg-m-head fn-m-head">
            <span className="mg-act">{detail ? (needsFix ? 'Needs a fix' : 'Status') : 'Loading…'}</span>
            <h3>{detail ? detail.row.order : '…'}</h3>
            {detail && <span>{detail.row.learner} · {money(detail.row.amount)} · gateway {detail.row.gateway}</span>}
          </div>
          <div className="mg-m-body">
            {!detail ? <div className="mg-empty">Loading…</div> : (
              <>
                <div className="mg-m-cap">Payment → learner → batch → access</div>
                <div className="op-chain">
                  {detail.chain.map((c, i) => (
                    <div key={c.step} className={`op-node ${c.ok ? 'ok' : 'bad'}`}>
                      <i>{c.ok ? <CheckCircleOutlined /> : <CloseCircleOutlined />}</i>
                      <div><small>Step {i + 1} · {c.step}</small><b>{c.text}</b></div>
                    </div>
                  ))}
                </div>
                {detail.error && <div className="op-err"><WarningOutlined /> {detail.error}</div>}
                {needsFix && (
                  <div className="op-fix">
                    <div className="mg-m-cap">Fix provisioning</div>
                    <label className="ao-label">Assign batch
                      <Select value={batch} onChange={setBatch} style={{ width: '100%' }} options={[{ value: '', label: 'Keep current' }, ...detail.batches.map((b) => ({ value: b.name, label: `${b.name} (${b.size}${b.cap ? `/${b.cap}` : ''})` }))]} />
                    </label>
                    <label className="ao-label">Reason (saved in the audit)<Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. webhook arrived before the batch existed" /></label>
                    <small className="mg-rsn">The welcome email goes only after provisioning succeeds</small>
                  </div>
                )}
              </>
            )}
          </div>
          <div className="mg-m-foot" style={{ gap: 8 }}>
            {detail && detail.row.gateway === 'PENDING' && <Button icon={<ReloadOutlined />} onClick={() => recheck(sel)}>Recheck gateway</Button>}
            <Button onClick={() => setSel(null)}>Close</Button>
            {needsFix && <Button type="primary" icon={<ToolOutlined />} loading={busy} disabled={reason.trim().length < 3} onClick={retry}>Retry provisioning</Button>}
          </div>
        </div>
      </Modal>
    </div>
  );
}
