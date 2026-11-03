import React, { useEffect, useState } from 'react';
import { message } from 'antd';
import lmsApi from '../api';
import { useLoad, act, Head, Loading, money } from './shared';

// Design A3 · Finance — payments & provisioning. Rows are the real Razorpay
// payment requests; the fix panel shows the payment → learner → batch →
// access chain for the selected row. Card data / secrets are never returned.
const GW_CHIP = { VERIFIED: 'hai', PENDING: 'adh' };
const PROV_CHIP = { DONE: 'hai', FAILED: 'red', PENDING: 'red', WAITING: 'gray' };

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
  const firstProblem = rows.find((r) => r.provisioning.key === 'FAILED' || r.provisioning.key === 'PENDING');
  const selId = sel || (firstProblem || rows[0] || {}).id;

  useEffect(() => {
    if (!selId) return;
    setDetail(null);
    lmsApi.opsPaymentDetail(selId).then((r) => {
      const d = r && r.result;
      setDetail(d || null);
      setBatch('');
      setReason('');
    });
  }, [selId]);

  const recheck = async (id) => {
    const r = await act(lmsApi.opsPaymentRecheck(id));
    if (r) message.info(`Gateway: ${r.gatewayStatus} · CRM: ${r.crmStatus}. ${r.note}`, 6);
  };
  const retry = async () => {
    setBusy(true);
    const r = await act(lmsApi.opsPaymentProvision(selId, { batch: batch || undefined, reason }), 'Provisioning done');
    setBusy(false);
    if (r) {
      reload();
      setSel(selId);
      lmsApi.opsPaymentDetail(selId).then((x) => setDetail(x && x.result));
    }
  };

  const k = data && data.kpis;
  const needsFix = detail && detail.chain.some((c) => !c.ok) && detail.row.gateway === 'VERIFIED';
  return (
    <>
      <Head title="Finance — payments & provisioning" sub="Spec §16 · card data / gateway secrets kabhi nahi dikhte · sirf order / reference ID" />
      <Loading loading={loading} err={err} data={data}>
        {data && (
          <>
            <div className="ao-kgrid">
              <div className="ao-k"><b>{money(k.collected)}</b><span>Collected (this month)</span></div>
              <div className="ao-k"><b>{k.verified}</b><span>Payments verified</span></div>
              <div className="ao-k"><b style={{ color: k.notProvisioned ? '#991b1b' : undefined }}>{k.notProvisioned}</b><span>Paid, not provisioned</span></div>
              <div className="ao-k"><b>{k.duplicateWebhooks}</b><span>Duplicate webhooks blocked</span></div>
              <div className="ao-k"><b>{k.emiDueWeek}</b><span>EMI due this week</span></div>
              <div className="ao-k"><b>{k.refunds}</b><span>Refund requests</span></div>
            </div>
            <div className="ao-grid-2" style={{ gridTemplateColumns: 'minmax(0, 1fr) 380px' }}>
              <div className="ao-card">
                <div className="ao-hd">
                  <b>Payment → enrollment log</b>
                  <form onSubmit={(e) => { e.preventDefault(); setTerm(q); setSel(null); }}>
                    <input aria-label="Search order" placeholder="Search order / reference ID / learner" className="ao-inp sm" style={{ width: 240 }} value={q} onChange={(e) => setQ(e.target.value)} />
                  </form>
                </div>
                <div className="ao-tablewrap">
                  <table className="ao-table small num">
                    <thead><tr><th>Order ID</th><th>Learner</th><th>Amount</th><th>Gateway (server verify)</th><th>Webhooks</th><th>Provisioning</th><th /></tr></thead>
                    <tbody>
                      {rows.length === 0 && <tr><td colSpan={7} className="ao-empty">No payments match.</td></tr>}
                      {rows.map((r) => (
                        <tr key={r.id} className={`click${r.id === selId ? ' sel' : ''}`} onClick={() => setSel(r.id)}>
                          <td>{r.id === selId ? <b>{r.order}</b> : r.order}</td>
                          <td>{r.learner}</td>
                          <td>{money(r.amount)}{r.installment ? ` ${r.installment}` : ''}</td>
                          <td><span className={`ao-chip ${GW_CHIP[r.gateway] || 'gray'}`}>{r.gateway}</span>{r.amountMismatch && <span className="ao-chip red" style={{ marginLeft: 4 }}>Amount mismatch</span>}</td>
                          <td>{r.webhooks}{r.webhooks > 1 && <span className="ao-muted"> ({r.webhooks - 1} dup ignored)</span>}</td>
                          <td><span className={`ao-chip ${PROV_CHIP[r.provisioning.key] || 'gray'}`}>{r.provisioning.text}</span></td>
                          <td onClick={(e) => e.stopPropagation()}>
                            {r.gateway === 'PENDING' && <button type="button" className="ao-btn2 sm" onClick={() => recheck(r.id)}>Recheck</button>}
                            {(r.provisioning.key === 'FAILED' || r.provisioning.key === 'PENDING') && <button type="button" className="ao-btn2 sm" onClick={() => setSel(r.id)}>Fix</button>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="ao-muted" style={{ fontSize: 12, marginTop: 'auto' }}>Browser success screen par trust nahi · same webhook do baar aaye to bhi ek hi learner banta hai (idempotent)</div>
              </div>
              <div className="ao-card">
                {!detail ? (
                  <div className="ao-empty">Select a payment.</div>
                ) : (
                  <>
                    <div className="ao-hd"><b>{detail.row.order} · {needsFix ? 'fix' : 'status'}</b><span className={`ao-chip ${needsFix ? 'red' : 'hai'}`}>{needsFix ? 'Action' : 'OK'}</span></div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      {detail.chain.map((c) => (
                        <div key={c.step} className={`ao-node${c.ok ? '' : ' bad'}`}><span>{c.step}</span><b className={c.ok ? 'ok' : 'no'}>{c.ok ? '✓' : '✗'} {c.text}</b></div>
                      ))}
                    </div>
                    {detail.error && <div className="ao-err">{detail.error}</div>}
                    {needsFix && (
                      <>
                        <label className="ao-label">Assign batch
                          <select className="ao-inp full" value={batch} onChange={(e) => setBatch(e.target.value)}>
                            <option value="">Keep current</option>
                            {detail.batches.map((b) => <option key={b.name} value={b.name}>{b.name} ({b.size}{b.cap ? `/${b.cap}` : ''})</option>)}
                          </select>
                        </label>
                        <label className="ao-label">Reason (audit)<input className="ao-inp full" value={reason} onChange={(e) => setReason(e.target.value)} /></label>
                        <button type="button" className="ao-btn" style={{ marginTop: 'auto' }} disabled={busy || reason.trim().length < 3} onClick={retry}>{busy ? 'Working…' : 'Retry provisioning'}</button>
                        <div className="ao-muted" style={{ fontSize: 12 }}>Welcome email sirf provisioning success ke baad jaayega</div>
                      </>
                    )}
                  </>
                )}
              </div>
            </div>
          </>
        )}
      </Loading>
    </>
  );
}
