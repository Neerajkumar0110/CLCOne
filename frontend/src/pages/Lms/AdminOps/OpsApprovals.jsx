import React, { useState } from 'react';
import { Modal } from 'antd';
import lmsApi from '../api';
import { useLoad, act, askReason, Head, Loading, fmtDate } from './shared';

// Design A1 · Operations Manager — exception approvals + decision register.
const DECISION_CHIP = { PENDING: 'adh', APPROVED: 'hai', VALIDATING: 'gray', OPEN: 'naya' };

function NewRequest({ open, types, onClose, onDone }) {
  const [f, setF] = useState({ type: '', detail: '', learnerName: '', scope: '', evidence: '' });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const save = async () => {
    const r = await act(lmsApi.opsApprovalCreate(f), 'Request raised');
    if (r) {
      setF({ type: '', detail: '', learnerName: '', scope: '', evidence: '' });
      onDone();
    }
  };
  return (
    <Modal open={open} title="Raise an exception request" onCancel={onClose} onOk={save} okText="Raise request" destroyOnClose>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <label className="ao-label">Request<select className="ao-inp full" value={f.type} onChange={set('type')}><option value="">Select…</option>{(types || []).map((t) => <option key={t}>{t}</option>)}</select></label>
        <label className="ao-label">Detail (e.g. 5 days)<input className="ao-inp full" value={f.detail} onChange={set('detail')} /></label>
        <label className="ao-label">Learner<input className="ao-inp full" value={f.learnerName} onChange={set('learnerName')} /></label>
        <label className="ao-label">Scope (batch / milestone / all batches)<input className="ao-inp full" value={f.scope} onChange={set('scope')} /></label>
        <label className="ao-label">Evidence (mandatory)<textarea className="ao-inp full" value={f.evidence} onChange={set('evidence')} /></label>
      </div>
    </Modal>
  );
}

export default function OpsApprovals() {
  const { data, loading, err, reload } = useLoad(() => lmsApi.opsApprovals());
  const [raising, setRaising] = useState(false);
  const decide = (row, decision) =>
    askReason(`${decision === 'approved' ? 'Approve' : 'Reject'} · ${row.type}`, async (reason) => {
      const r = await act(lmsApi.opsApprovalDecide(row.id, decision, reason), decision === 'approved' ? 'Approved' : 'Rejected');
      if (r) reload();
    });
  const setDecision = (d, status) => act(lmsApi.opsDecisionSet(d.code, status, ''), `${d.code} → ${status}`).then((r) => r && reload());

  return (
    <>
      <Head title="Operations Manager — exception approvals" sub="Automation sirf detect karta hai · final adverse / consequential decision human approve karta hai" right={<button type="button" className="ao-btn2 md" onClick={() => setRaising(true)}>+ Raise request</button>} />
      <Loading loading={loading} err={err} data={data}>
        {data && (
          <div className="ao-grid-2" style={{ gridTemplateColumns: 'minmax(0, 1fr) 360px' }}>
            <div className="ao-card">
              <div className="ao-hd"><b>Pending approvals · {data.pending}</b><span className="ao-muted" style={{ fontSize: 12 }}>reason + evidence mandatory · audit logged</span></div>
              <div className="ao-tablewrap">
                <table className="ao-table">
                  <thead><tr><th>Request</th><th>Learner / scope</th><th>Requested by</th><th>Evidence</th><th>Decision</th></tr></thead>
                  <tbody>
                    {data.rows.length === 0 && <tr><td colSpan={5} className="ao-empty">No exception requests yet.</td></tr>}
                    {data.rows.map((r) => (
                      <tr key={r.id}>
                        <td><b>{r.type}{r.detail ? ` ${r.detail}` : ''}</b>{r.highRisk && <div className="ao-muted" style={{ fontSize: 11 }}>2 approvers</div>}</td>
                        <td>{[r.learnerName, r.scope].filter(Boolean).join(' · ')}</td>
                        <td className="ao-muted">{r.requestedByName}{r.requestedByRole ? ` (${r.requestedByRole})` : ''}<div style={{ fontSize: 11 }}>{fmtDate(r.created)}</div></td>
                        <td className="ao-muted">{r.evidence}</td>
                        <td>
                          {r.status === 'pending' ? (
                            data.canDecide && r.requestedBy !== data.me ? (
                              <div style={{ display: 'flex', gap: 6, flexDirection: 'column', alignItems: 'flex-start' }}>
                                <div style={{ display: 'flex', gap: 6 }}>
                                  <button type="button" className="ao-btn sm" onClick={() => decide(r, 'approved')}>Approve</button>
                                  <button type="button" className="ao-btn2 md" onClick={() => decide(r, 'rejected')}>Reject</button>
                                </div>
                                {r.approvals.length > 0 && <span className="ao-muted" style={{ fontSize: 11 }}>1st: {r.approvals[0].byName}</span>}
                              </div>
                            ) : (
                              <span className="ao-chip gray">{r.requestedBy === data.me ? 'Your request' : 'Pending'}</span>
                            )
                          ) : (
                            <span className={`ao-chip ${r.status === 'approved' ? 'hai' : 'red'}`} title={`${r.decidedByName}: ${r.decisionReason}`}>{r.status}</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="ao-muted" style={{ fontSize: 12, marginTop: 'auto' }}>Bulk / high-risk (mass message, bulk status, content delete) par second approver bhi chahiye — D-13</div>
            </div>
            <div className="ao-card">
              <div className="ao-hd"><b>Decision register</b><span className="ao-muted" style={{ fontSize: 12 }}>spec §22.1</span></div>
              <div>
                {data.decisions.map((d) => (
                  <div className="ao-li" key={d.code}>
                    <span>{d.code} · {d.title}</span>
                    <select aria-label={`${d.code} status`} className={`ao-chip ${DECISION_CHIP[d.status]}`} style={{ border: 0, cursor: 'pointer' }} value={d.status} onChange={(e) => setDecision(d, e.target.value)}>
                      {['PENDING', 'APPROVED', 'VALIDATING', 'OPEN'].map((s) => <option key={s}>{s}</option>)}
                    </select>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </Loading>
      <NewRequest open={raising} types={data && data.types} onClose={() => setRaising(false)} onDone={() => { setRaising(false); reload(); }} />
    </>
  );
}
