import React, { useEffect, useMemo, useState } from 'react';
import { request } from '@/request';
import { Modal, Button, Input, Select, Tooltip } from 'antd';
import {
  SafetyCertificateOutlined, PlusOutlined, SearchOutlined, ClockCircleOutlined, CheckCircleOutlined, CloseCircleOutlined,
  WarningOutlined, EditOutlined, DeleteOutlined, UserOutlined, TeamOutlined, FileSearchOutlined, AuditOutlined, ThunderboltOutlined,
} from '@ant-design/icons';
import lmsApi from '../api';
import { useLoad, act, askReason, Loading, fmtDate } from './shared';
import '../Policies/policyDesign.css';
import './opsApprovals.css';

// Design A1 · Operations Manager — exception approvals + decision register.
// 2026-11-27 redesign: stats + filterable list; each request opens in a modal
// (evidence as a list, approval trail, what the system applied, actions).
const DECISION_TONE = { PENDING: 'amber', APPROVED: 'green', VALIDATING: 'blue', OPEN: 'violet' };
const STATUS_TONE = { pending: 'amber', approved: 'green', rejected: 'red' };
const STATUS_LABEL = { pending: 'Pending', approved: 'Approved', rejected: 'Rejected' };

// "a; b; c" evidence → list items (auto-detected requests join findings with ";")
const evidenceItems = (s) => String(s || '').split(/;\s+|\n+/).map((x) => x.trim()).filter(Boolean);

function NewRequest({ open, types, onClose, onDone }) {
  const [f, setF] = useState({ type: '', detail: '', learnerName: '', scope: '', evidence: '' });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  // pick a batch → its learners fill the Learner list (LMS testing report #20)
  const [batches, setBatches] = useState([]);
  const [batchId, setBatchId] = useState('');
  const [learners, setLearners] = useState([]);
  useEffect(() => {
    if (!open) return;
    request.list({ entity: 'batch', options: { items: 500, sortBy: 'name', sortValue: 1 } }).then((r) => setBatches(((r && r.result) || []).map((b) => ({ id: b._id, name: b.name }))));
  }, [open]);
  useEffect(() => {
    setLearners([]);
    if (!batchId) return;
    lmsApi.assignmentBatchLearners(batchId).then((r) => setLearners((r && r.result) || []));
  }, [batchId]);
  const save = async () => {
    const r = await act(lmsApi.opsApprovalCreate(f), 'Request raised');
    if (r) {
      setF({ type: '', detail: '', learnerName: '', scope: '', evidence: '' });
      onDone();
    }
  };
  return (
    <Modal open={open} onCancel={onClose} footer={null} width={620} centered destroyOnClose rootClassName="pol-modal">
      <div className="pol-m">
        <div className="pol-m-head">
          <div className="pol-m-tags"><span className="pol-chip violet"><PlusOutlined /> New request</span></div>
          <h3>Raise an exception request</h3>
          <div className="pol-m-meta"><span>An approver decides it · reason + evidence are kept in the audit log</span></div>
        </div>
        <div className="pol-m-body">
          <div className="opx-form">
            <label className="ao-label">Request<select className="ao-inp full" value={f.type} onChange={set('type')}><option value="">Select…</option>{(types || []).map((t) => <option key={t}>{t}</option>)}</select></label>
            <label className="ao-label">Detail (e.g. 5 days)<input className="ao-inp full" value={f.detail} onChange={set('detail')} /></label>
            <label className="ao-label">Batch
              <select className="ao-inp full" value={batchId} onChange={(e) => { const b = batches.find((x) => x.id === e.target.value); setBatchId(e.target.value); setF({ ...f, scope: b ? b.name : f.scope, learnerName: '' }); }}>
                <option value="">— pick a batch (fills the learners)</option>
                {batches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </label>
            <label className="ao-label">Learner
              {learners.length ? (
                <select className="ao-inp full" value={f.learnerName} onChange={set('learnerName')}>
                  <option value="">— whole batch / not one learner</option>
                  {learners.map((l) => <option key={l.id} value={l.name}>{l.name} · {l.email}</option>)}
                </select>
              ) : (
                <input className="ao-inp full" value={f.learnerName} onChange={set('learnerName')} />
              )}
            </label>
            <label className="ao-label opx-full">Scope (batch / milestone / all batches)<input className="ao-inp full" value={f.scope} onChange={set('scope')} /></label>
            <label className="ao-label opx-full">Evidence (mandatory)<textarea className="ao-inp full" style={{ height: 90 }} value={f.evidence} onChange={set('evidence')} /></label>
          </div>
        </div>
        <div className="pol-m-foot">
          <span className="pol-note">Bulk / high-risk requests need a second approver (D-13)</span>
          <div className="pol-m-foot-r">
            <Button onClick={onClose}>Cancel</Button>
            <Button type="primary" disabled={!f.type || !f.evidence.trim()} onClick={save}>Raise request</Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}

export default function OpsApprovals() {
  const { data, loading, err, reload } = useLoad(() => lmsApi.opsApprovals());
  const [raising, setRaising] = useState(false);
  const [viewId, setViewId] = useState(null);
  const [tab, setTab] = useState('pending');
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState(null);

  const decide = (row, decision) =>
    askReason(`${decision === 'approved' ? 'Approve' : 'Reject'} · ${row.type}`, async (reason) => {
      // for a deadline extension the reason may carry the new date ("7 days" / "2026-11-20")
      const r = await act(lmsApi.opsApprovalDecide(row.id, decision, reason), decision === 'approved' ? 'Approved' : 'Rejected');
      if (r) reload();
    });
  const setDecision = (d, status) => act(lmsApi.opsDecisionSet(d.code, status, ''), `${d.code} → ${status}`).then((r) => r && reload());
  // change a decided request's status, edit a pending one, or delete (report #20)
  const changeStatus = (row, status) => askReason(`Change ${row.type} to ${status}`, async (reason) => { const r = await act(lmsApi.opsApprovalStatus(row.id, status, reason), `Now ${status}`); if (r) reload(); });
  const remove = (row) => askReason(`Delete request · ${row.type}`, async (reason) => { const r = await act(lmsApi.opsApprovalRemove(row.id, reason), 'Deleted'); if (r) { setViewId(null); reload(); } });
  const startEdit = (r) => setEditing({ id: r.id, type: r.type, detail: r.detail || '', learnerName: r.learnerName || '', scope: r.scope || '', evidence: r.evidence || '' });
  const saveEdit = async () => { const r = await act(lmsApi.opsApprovalEdit(editing.id, editing), 'Saved'); if (r) { setEditing(null); reload(); } };

  const rows = (data && data.rows) || [];
  const count = useMemo(() => rows.reduce((m, r) => ({ ...m, [r.status]: (m[r.status] || 0) + 1 }), {}), [rows]);
  const highRiskPending = rows.filter((r) => r.status === 'pending' && r.highRisk).length;
  const needle = q.trim().toLowerCase();
  const shown = rows.filter((r) => (tab === 'all' || r.status === tab) && (!needle || `${r.type} ${r.detail} ${r.learnerName} ${r.scope} ${r.evidence} ${r.requestedByName}`.toLowerCase().includes(needle)));
  const v = rows.find((r) => r.id === viewId) || null;
  const decisions = (data && data.decisions) || [];
  const decApproved = decisions.filter((d) => d.status === 'APPROVED').length;

  return (
    <div className="pol opx" style={{ padding: 4 }}>
      <div className="pol-hero">
        <div className="pol-hero-l">
          <span className="pol-hero-ic"><SafetyCertificateOutlined /></span>
          <div>
            <h2>Exception approvals</h2>
            <p>Automation only <b>detects</b> — a person approves any final adverse or consequential decision. Every approval needs a reason and evidence, and is audit-logged.</p>
          </div>
        </div>
        <Button type="primary" size="large" icon={<PlusOutlined />} onClick={() => setRaising(true)}>Raise request</Button>
      </div>

      <Loading loading={loading} err={err} data={data}>
        {data && (
          <>
            <div className="pol-stats">
              <button type="button" className={`pol-stat opx-stat${tab === 'pending' ? ' on' : ''}`} onClick={() => setTab('pending')}><span className="pol-stat-ic amber"><ClockCircleOutlined /></span><div><b>{count.pending || 0}</b><span>Waiting for a decision</span></div></button>
              <div className="pol-stat"><span className="pol-stat-ic violet"><TeamOutlined /></span><div><b>{highRiskPending}</b><span>Pending · need 2 approvers</span></div></div>
              <button type="button" className={`pol-stat opx-stat${tab === 'approved' ? ' on' : ''}`} onClick={() => setTab('approved')}><span className="pol-stat-ic teal"><CheckCircleOutlined /></span><div><b>{count.approved || 0}</b><span>Approved</span></div></button>
              <button type="button" className={`pol-stat opx-stat${tab === 'rejected' ? ' on' : ''}`} onClick={() => setTab('rejected')}><span className="pol-stat-ic opx-red"><CloseCircleOutlined /></span><div><b>{count.rejected || 0}</b><span>Rejected</span></div></button>
            </div>

            <div className="opx-grid">
              <section className="pol-box" aria-label="Requests">
                <div className="opx-hd">
                  <b>Requests</b>
                  <span className="pol-note">Click a request to see the evidence and decide</span>
                </div>
                <div className="pol-tools" style={{ margin: 0 }}>
                  <Input allowClear prefix={<SearchOutlined />} placeholder="Search request, learner, batch, evidence" value={q} onChange={(e) => setQ(e.target.value)} />
                  <div className="pol-pills">
                    {[['pending', 'Pending'], ['approved', 'Approved'], ['rejected', 'Rejected'], ['all', 'All']].map(([k, l]) => (
                      <button key={k} type="button" className={`pol-pill${tab === k ? ' on' : ''}`} onClick={() => setTab(k)}>{l} · {k === 'all' ? rows.length : count[k] || 0}</button>
                    ))}
                  </div>
                </div>
                {shown.length === 0 ? (
                  <div className="pol-empty"><span className="pol-empty-ic"><AuditOutlined /></span><b>{rows.length ? 'Nothing here' : 'No exception requests yet'}</b><span>{tab === 'pending' ? 'No request is waiting for a decision.' : 'Try another filter.'}</span></div>
                ) : (
                  <div className="pol-list" role="list">
                    {shown.map((r) => {
                      const ev = evidenceItems(r.evidence);
                      return (
                        <div key={r.id} role="listitem" tabIndex={0} className={`pol-row opx-row${r.status === 'pending' && r.highRisk ? ' hot' : ''}`} onClick={() => setViewId(r.id)} onKeyDown={(e) => { if (e.key === 'Enter') setViewId(r.id); }}>
                          <span className="pol-row-t">
                            <span className={`opx-ic ${r.status}`}>{r.status === 'approved' ? <CheckCircleOutlined /> : r.status === 'rejected' ? <CloseCircleOutlined /> : <ClockCircleOutlined />}</span>
                            <span style={{ minWidth: 0 }}>
                              <b>{r.type}{r.detail ? ` · ${r.detail}` : ''}</b>
                              <small className="opx-ex">{ev.length > 1 ? `${ev.length} findings · ${ev[0]}` : ev[0] || 'No evidence given'}</small>
                            </span>
                          </span>
                          <span className="pol-row-v">
                            {(r.learnerName || r.scope) && <span className="pol-chip blue" title={[r.learnerName, r.scope].filter(Boolean).join(' · ')}><UserOutlined /> {[r.learnerName, r.scope].filter(Boolean).join(' · ').slice(0, 26)}</span>}
                            {r.highRisk && <span className="pol-chip violet">2 approvers</span>}
                            <span className={`pol-chip ${STATUS_TONE[r.status]}`}>{r.status === 'pending' && r.approvals.length ? '1 of 2 approved' : STATUS_LABEL[r.status]}</span>
                            <span className="opx-by">{r.requestedByName}<small>{fmtDate(r.created)}</small></span>
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}
                <div className="pol-note"><WarningOutlined /> Bulk / high-risk requests (mass message, bulk status, content delete) need a second approver — D-13</div>
              </section>

              <section className="pol-box" aria-label="Decision register">
                <div className="opx-hd">
                  <b>Decision register</b>
                  <span className="pol-note">spec §22.1 · {decApproved}/{decisions.length} approved</span>
                </div>
                <div className="opx-dec-bar"><span style={{ width: `${decisions.length ? (decApproved / decisions.length) * 100 : 0}%` }} /></div>
                <div className="opx-dec">
                  {decisions.map((d) => (
                    <div className="opx-dec-i" key={d.code}>
                      <span className="opx-dec-code">{d.code.replace('D-', '')}</span>
                      <span className="opx-dec-t" title={d.title}>{d.title}</span>
                      <Select size="small" variant="borderless" className={`opx-dec-s ${DECISION_TONE[d.status]}`} value={d.status} onChange={(s) => setDecision(d, s)} popupMatchSelectWidth={false} options={['PENDING', 'APPROVED', 'VALIDATING', 'OPEN'].map((s) => ({ value: s, label: s.charAt(0) + s.slice(1).toLowerCase() }))} />
                    </div>
                  ))}
                </div>
              </section>
            </div>
          </>
        )}
      </Loading>

      <Modal open={!!v} onCancel={() => setViewId(null)} footer={null} width={860} centered destroyOnClose rootClassName="pol-modal">
        {v && (() => {
          const ev = evidenceItems(v.evidence);
          const mine = v.requestedBy === data.me;
          const canAct = v.status === 'pending' && data.canDecide && !mine;
          const steps = v.highRisk ? ['Raised', '1st approval', 'Final decision', 'Applied'] : ['Raised', 'Decision', 'Applied'];
          const at = v.status === 'pending' ? (v.highRisk && v.approvals.length ? 2 : 1) : v.execution && v.execution.status === 'done' ? steps.length : steps.length - 1;
          return (
            <div className="pol-m">
              <div className="pol-m-head">
                <div className="pol-m-tags">
                  <span className={`pol-chip ${STATUS_TONE[v.status]}`}>{STATUS_LABEL[v.status]}</span>
                  {v.highRisk && <span className="pol-chip violet"><TeamOutlined /> High-risk · 2 approvers</span>}
                  {mine && <span className="pol-chip blue">Your request</span>}
                </div>
                <h3>{v.type}{v.detail ? ` · ${v.detail}` : ''}</h3>
                <div className="pol-m-meta">
                  {v.learnerName && <span><UserOutlined /> {v.learnerName}</span>}
                  {v.scope && <span><TeamOutlined /> {v.scope}</span>}
                  <span>Raised by <b>{v.requestedByName}</b>{v.requestedByRole ? ` (${v.requestedByRole})` : ''} · {fmtDate(v.created)}</span>
                </div>
              </div>
              <div className="pol-steps">
                {steps.map((s, i) => (
                  <div key={s} className={`pol-step${i < at ? ' done' : i === at ? ' on' : ''}${v.status === 'rejected' && i === steps.length - 2 ? ' opx-bad' : ''}`}>
                    <i>{i < at ? <CheckCircleOutlined /> : i + 1}</i>
                    <span>{v.status === 'rejected' && i === steps.length - 2 ? 'Rejected' : s}</span>
                  </div>
                ))}
              </div>
              <div className="pol-m-body">
                {v.status !== 'pending' && (
                  <div className={`pol-alert ${v.status === 'approved' ? 'ok' : 'bad'}`}>
                    {v.status === 'approved' ? <CheckCircleOutlined /> : <CloseCircleOutlined />}
                    <span><b>{STATUS_LABEL[v.status]}</b>{v.decidedByName ? ` by ${v.decidedByName}` : ''}{v.decisionReason ? ` — “${v.decisionReason}”` : ''}</span>
                  </div>
                )}
                {v.execution && (
                  <div className={`pol-alert ${v.execution.status === 'done' ? 'ok' : v.execution.status === 'failed' ? 'bad' : 'info'}`}>
                    <ThunderboltOutlined />
                    <span><b>{v.execution.status === 'done' ? 'Applied by the system' : v.execution.status === 'failed' ? 'System could not apply it' : 'Needs a manual step'}:</b> {v.execution.note}</span>
                  </div>
                )}
                {mine && v.status === 'pending' && <div className="pol-alert info"><ClockCircleOutlined /><span>You raised this request, so another approver has to decide it.</span></div>}
                <section className="pol-box">
                  <div className="opx-hd"><span className="pol-cap"><FileSearchOutlined /> Evidence</span>{ev.length > 1 && <span className="pol-chip">{ev.length} findings</span>}</div>
                  {ev.length === 0 ? <div className="pol-note">No evidence given.</div> : ev.length === 1 ? (
                    <div className="opx-ev1">{ev[0]}</div>
                  ) : (
                    <ol className="opx-ev">
                      {ev.map((x, i) => <li key={i}>{x}</li>)}
                    </ol>
                  )}
                </section>
                {(v.approvals || []).length > 0 && (
                  <section className="pol-box">
                    <div className="pol-cap"><AuditOutlined /> Approval trail</div>
                    {v.approvals.map((a, i) => (
                      <div key={i} className="opx-trail"><CheckCircleOutlined /> <b>{a.byName}</b>{a.reason ? ` — “${a.reason}”` : ''}{a.at ? <small> · {fmtDate(a.at)}</small> : null}</div>
                    ))}
                  </section>
                )}
              </div>
              <div className="pol-m-foot">
                <div className="pol-m-foot-r">
                  {v.status === 'pending' && <Button icon={<EditOutlined />} onClick={() => startEdit(v)}>Edit</Button>}
                  {v.status === 'pending' && <Button danger icon={<DeleteOutlined />} onClick={() => remove(v)}>Delete</Button>}
                  {v.status !== 'pending' && data.canDecide && (
                    <Select placeholder="Change status…" style={{ minWidth: 170 }} value={undefined} onChange={(s) => changeStatus(v, s)} options={['pending', 'approved', 'rejected'].filter((s) => s !== v.status).map((s) => ({ value: s, label: `Move to ${STATUS_LABEL[s]}` }))} />
                  )}
                </div>
                <div className="pol-m-foot-r">
                  <Button onClick={() => setViewId(null)}>Close</Button>
                  {canAct && (
                    <>
                      <Button danger onClick={() => decide(v, 'rejected')}>Reject</Button>
                      <Tooltip title={v.highRisk && !v.approvals.length ? 'First of two approvals' : ''}>
                        <Button type="primary" icon={<CheckCircleOutlined />} onClick={() => decide(v, 'approved')}>{v.highRisk && !v.approvals.length ? 'Approve (1 of 2)' : 'Approve'}</Button>
                      </Tooltip>
                    </>
                  )}
                </div>
              </div>
            </div>
          );
        })()}
      </Modal>

      <Modal open={!!editing} onCancel={() => setEditing(null)} footer={null} width={620} centered destroyOnClose rootClassName="pol-modal">
        {editing && (
          <div className="pol-m">
            <div className="pol-m-head">
              <div className="pol-m-tags"><span className="pol-chip amber"><EditOutlined /> Edit request</span></div>
              <h3>{editing.type}</h3>
            </div>
            <div className="pol-m-body">
              <div className="opx-form">
                {[['detail', 'Detail'], ['learnerName', 'Learner'], ['scope', 'Scope']].map(([k, l]) => (
                  <label key={k} className={`ao-label${k === 'scope' ? ' opx-full' : ''}`}>{l}<input className="ao-inp full" value={editing[k]} onChange={(e) => setEditing({ ...editing, [k]: e.target.value })} /></label>
                ))}
                <label className="ao-label opx-full">Evidence<textarea className="ao-inp full" style={{ height: 120 }} value={editing.evidence} onChange={(e) => setEditing({ ...editing, evidence: e.target.value })} /></label>
              </div>
            </div>
            <div className="pol-m-foot">
              <span className="pol-note">Changes are audit-logged</span>
              <div className="pol-m-foot-r">
                <Button onClick={() => setEditing(null)}>Cancel</Button>
                <Button type="primary" onClick={saveEdit}>Save</Button>
              </div>
            </div>
          </div>
        )}
      </Modal>
      <NewRequest open={raising} types={data && data.types} onClose={() => setRaising(false)} onDone={() => { setRaising(false); reload(); }} />
    </div>
  );
}
