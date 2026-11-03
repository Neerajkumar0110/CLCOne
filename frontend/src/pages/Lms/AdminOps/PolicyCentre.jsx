import React, { useEffect, useState } from 'react';
import { Modal, message } from 'antd';
import { useNavigate } from 'react-router-dom';
import lmsApi from '../api';
import { useLoad, act, Head, Loading, fmtDate } from './shared';

// Design A5 · Policy centre (publish & track). Writing / editing the policy
// text stays in LMS → Policies (no second editor); this screen runs the
// draft → review → management approval → published → re-accept workflow and
// tracks acknowledgements per batch.
function steps(sel) {
  if (!sel) return 0;
  if (sel.status === 'published') return 4;
  if (sel.approvalRequestedAt) return 2;
  return 1;
}

export default function PolicyCentre() {
  const navigate = useNavigate();
  const [id, setId] = useState(undefined);
  const { data, loading, err, reload } = useLoad(() => lmsApi.opsPolicies(id), [id]);
  const sel = data && data.selected;
  const [f, setF] = useState({ changeSummary: '', materialChange: true, effectiveDate: '', approverName: '' });
  const [preview, setPreview] = useState(false);
  useEffect(() => {
    if (!sel) return;
    setF({
      changeSummary: sel.changeSummary || '',
      materialChange: sel.materialChange !== false,
      effectiveDate: sel.effectiveDate ? String(sel.effectiveDate).slice(0, 10) : '',
      approverName: sel.approverName || (data.approvers[0] || ''),
    });
  }, [sel && sel.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const send = async () => {
    if (await act(lmsApi.opsPolicySendForApproval(sel.id, f), 'Sent for approval')) reload();
  };
  const publish = async () => {
    if (await act(lmsApi.publishPolicy(sel.id), 'Published — learners notified')) {
      setId(sel.id);
      reload();
    }
  };
  const exportCsv = () => lmsApi.opsDownload(`/lms/policies/${data.acks.policyId}/report`, { format: 'csv' }, `policy-acknowledgements-v${data.acks.version}.csv`).catch(() => message.error('Export failed.'));
  const at = steps(sel);
  const isDraft = sel && sel.status === 'draft';

  return (
    <>
      <Head title="Policy centre" sub="Support Manager draft banata hai · Management publish karta hai · purane versions aur acceptances kabhi delete nahi hote" />
      <Loading loading={loading} err={err} data={data}>
        {data && (
          <div className="ao-grid-2" style={{ gridTemplateColumns: '280px minmax(0, 1fr) 360px' }}>
            <div className="ao-card" style={{ gap: 6 }}>
              <b style={{ fontSize: 14 }}>Policies · {data.list.length}</b>
              {data.list.length === 0 && <div className="ao-muted" style={{ fontSize: 13 }}>No policy yet.</div>}
              {data.list.map((p) => {
                const pid = p.draftId || p.liveId;
                return (
                  <button key={p.slug} type="button" className={`ao-r${sel && (sel.id === p.draftId || sel.id === p.liveId) ? ' on' : ''}`} onClick={() => setId(pid)}>
                    <span><b>{p.title}</b><br /><span className="ao-muted">{[p.liveVersion && `v${p.liveVersion} live`, p.draftVersion && `v${p.draftVersion} draft`].filter(Boolean).join(' · ')}</span></span>
                    <span className={`ao-chip ${p.draftId ? 'adh' : 'hai'}`}>{p.draftId ? 'Draft' : 'Live'}</span>
                  </button>
                );
              })}
              <button type="button" className="ao-btn2" style={{ marginTop: 'auto' }} onClick={() => navigate('/lms/policies')}>+ New policy</button>
            </div>

            <div className="ao-card">
              {!sel ? (
                <div className="ao-empty">Create a policy in LMS → Policies to start the workflow.</div>
              ) : (
                <>
                  <div className="ao-hd"><b>{sel.title} · v{sel.version} ({sel.status})</b><span className="ao-muted" style={{ fontSize: 12 }}>by {sel.createdByName || '—'} · {fmtDate(sel.created)}</span></div>
                  <div className="ao-steps">
                    {['Draft', 'Review', 'Mgmt approval', 'Published', 'Re-accept window'].map((s, i) => (
                      <div key={s} className={`ao-stp${i < at ? ' done' : i === at ? ' on' : ''}`}>{s}</div>
                    ))}
                  </div>
                  <label className="ao-label">Change summary<textarea className="ao-inp full" disabled={!isDraft} value={f.changeSummary} onChange={(e) => setF({ ...f, changeSummary: e.target.value })} /></label>
                  <div style={{ display: 'flex', gap: 12, alignItems: 'center' }} className="ao-soft">
                    <button type="button" className={`ao-tog${f.materialChange ? ' on' : ''}`} disabled={!isDraft} aria-label="Material change" aria-pressed={f.materialChange} onClick={() => setF({ ...f, materialChange: !f.materialChange })}><span /></button>
                    <div>
                      <b>{f.materialChange ? 'Material change — re-acceptance required' : 'Minor change — no re-acceptance'}</b><br />
                      <span className="ao-muted">{f.materialChange ? 'Publish par learners ko notice jaayega; accept karne tak restricted content band' : 'Learners ko sirf notice jaayega, access par asar nahi'}</span>
                    </div>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                    <label className="ao-label">Effective date<input type="date" className="ao-inp full" disabled={!isDraft} value={f.effectiveDate} onChange={(e) => setF({ ...f, effectiveDate: e.target.value })} /></label>
                    <label className="ao-label">Approver<select className="ao-inp full" disabled={!isDraft} value={f.approverName} onChange={(e) => setF({ ...f, approverName: e.target.value })}>{data.approvers.map((a) => <option key={a}>{a}</option>)}</select></label>
                  </div>
                  {sel.approvalRequestedAt && <div className="ao-muted" style={{ fontSize: 12 }}>Sent for approval by {sel.approvalRequestedByName} · {fmtDate(sel.approvalRequestedAt)}</div>}
                  <div className="ao-muted" style={{ fontSize: 12 }}>Checkbox learner ke liye hamesha unticked · acceptance par learner ID + version + time save</div>
                  <div style={{ display: 'flex', gap: 8, marginTop: 'auto', justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                    <button type="button" className="ao-btn2" onClick={() => setPreview(true)}>Preview as learner</button>
                    {isDraft && <button type="button" className="ao-btn2" onClick={send}>{sel.approvalRequestedAt ? 'Update request' : 'Send for approval'}</button>}
                    {isDraft && data.canPublish && sel.approvalRequestedAt && <button type="button" className="ao-btn" onClick={publish}>Approve &amp; publish</button>}
                  </div>
                </>
              )}
            </div>

            <div className="ao-card">
              <div className="ao-hd"><b>Acknowledgements{data.acks ? ` · v${data.acks.version}` : ''}</b></div>
              {!data.acks && <div className="ao-muted" style={{ fontSize: 13 }}>Not published yet — nothing to acknowledge.</div>}
              {data.acks && (
                <>
                  {data.acks.batches.map((b) => (
                    <div className="ao-bar narrow" key={b.batch}>
                      <span>{b.batch}</span>
                      <div className="ao-trk"><div className={`ao-fill ${b.total && b.done / b.total < 0.85 ? 'warn' : 'green'}`} style={{ width: `${b.total ? (b.done / b.total) * 100 : 0}%` }} /></div>
                      <b>{b.done}/{b.total}</b>
                    </div>
                  ))}
                  <div className="ao-hd" style={{ marginTop: 6 }}><b>Pending · {data.acks.pending.length}</b></div>
                  <div style={{ fontSize: 13, lineHeight: '20px' }}>{data.acks.pending.slice(0, 4).join(' · ')}{data.acks.pending.length > 4 ? ` · +${data.acks.pending.length - 4}` : ''}</div>
                  <div className="ao-muted" style={{ fontSize: 12 }}>Pending learners ka LMS access gate se band hai (server-side) · daily reminder job</div>
                  <button type="button" className="ao-btn2 sm" style={{ marginTop: 'auto', alignSelf: 'flex-start' }} onClick={exportCsv}>Export acceptance evidence (CSV) →</button>
                </>
              )}
            </div>
          </div>
        )}
      </Loading>
      <Modal open={preview} title={sel ? `${sel.title} · v${sel.version}` : ''} footer={null} onCancel={() => setPreview(false)} width={640}>
        {sel && (
          <div>
            <div style={{ whiteSpace: 'pre-wrap', maxHeight: 360, overflowY: 'auto', fontSize: 14, lineHeight: '22px' }}>{sel.content || '(no text)'}</div>
            <label style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 16, fontSize: 14 }}><input type="checkbox" disabled /> I have read and accept this policy</label>
          </div>
        )}
      </Modal>
    </>
  );
}
