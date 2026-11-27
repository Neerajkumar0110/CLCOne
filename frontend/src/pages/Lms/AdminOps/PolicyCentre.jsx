import React, { useEffect, useState } from 'react';
import { Button, Input, Modal, Select, Spin, message } from 'antd';
import {
  FileProtectOutlined, PlusOutlined, EditOutlined, CheckCircleOutlined, ClockCircleOutlined, EyeOutlined, DownloadOutlined, SendOutlined, FileTextOutlined, DeleteOutlined, RollbackOutlined, ExclamationCircleOutlined, SafetyCertificateOutlined, RocketOutlined, UserOutlined,
} from '@ant-design/icons';
import lmsApi from '../api';
import NewPolicyModal, { confirmDeletePolicy } from '../Policies/NewPolicyModal';
import { useLoad, act, fmtDate } from './shared';
import '../Policies/policyDesign.css';

// Design A5 · Policy centre (publish & track). Writing the policy text stays
// in LMS → Policies (NewPolicyModal). Flow (2026-11-27):
//   Support writes a draft → picks ONE Admin → "Send for approval"
//   → that Admin approves (or sends it back with a note)
//   → Support publishes → learners accept, tracked per batch.
// The workflow and acknowledgements open in one modal per policy.
const STEPS = ['Draft', 'Sent to Admin', 'Admin approved', 'Published', 'Re-accept window'];
function stageOf(sel) {
  if (!sel) return 0;
  if (sel.status === 'published') return 4;
  if (sel.approvedAt) return 3;
  if (sel.approvalRequestedAt) return 1;
  return 0;
}
const stateOf = (p) => (p.approvedAt ? 'approved' : p.requestedAt || p.approvalRequestedAt ? 'requested' : p.rejectedAt ? 'back' : 'draft');

function Ring({ done, total }) {
  const pct = total ? Math.round((done / total) * 100) : 0;
  const col = pct >= 85 ? '#14b8a6' : '#f59e0b';
  return (
    <div className="pol-ring">
      <div className="pol-ring-c" style={{ background: `conic-gradient(${col} ${pct * 3.6}deg, #f1f5f9 0deg)` }}><span>{pct}%</span></div>
      <div>
        <b style={{ fontSize: 20, fontVariantNumeric: 'tabular-nums' }}>{done}/{total}</b>
        <div className="pol-note">learners have accepted</div>
      </div>
    </div>
  );
}

const ROW_CHIP = {
  requested: ['blue', <ClockCircleOutlined key="i" />, 'Waiting for approval'],
  approved: ['green', <SafetyCertificateOutlined key="i" />, 'Approved — ready to publish'],
  back: ['red', <RollbackOutlined key="i" />, 'Sent back'],
};

export default function PolicyCentre() {
  const [id, setId] = useState(undefined);
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const { data, loading, err, reload } = useLoad(() => lmsApi.opsPolicies(id), [id]);
  const sel = data && data.selected;
  const [f, setF] = useState({ changeSummary: '', materialChange: true, effectiveDate: '', approverId: '' });
  const [preview, setPreview] = useState(false);
  const [backOpen, setBackOpen] = useState(false);
  const [backNote, setBackNote] = useState('');
  const [busy, setBusy] = useState('');
  useEffect(() => {
    if (!sel) return;
    setF({
      changeSummary: sel.changeSummary || '',
      materialChange: sel.materialChange !== false,
      effectiveDate: sel.effectiveDate ? String(sel.effectiveDate).slice(0, 10) : '',
      approverId: sel.approverId || '',
    });
  }, [sel && sel.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const run = async (key, promise, okText, after) => {
    setBusy(key);
    const r = await act(promise, okText);
    setBusy('');
    if (r) {
      if (after) after();
      reload();
    }
  };
  const send = () => {
    if (!f.approverId) return message.warning('Choose the Admin who should approve it.');
    if (f.changeSummary.trim().length < 5) return message.warning('Write a short change summary for the Admin.');
    return run('send', lmsApi.opsPolicySendForApproval(sel.id, f), 'Sent to the Admin for approval');
  };
  const approve = () => run('approve', lmsApi.opsPolicyApprove(sel.id), 'Approved — Support can publish it now');
  const sendBack = () => {
    if (backNote.trim().length < 3) return message.warning('Write why it is sent back.');
    return run('back', lmsApi.opsPolicyReject(sel.id, backNote.trim()), 'Sent back to Support', () => { setBackOpen(false); setBackNote(''); });
  };
  const publish = () => Modal.confirm({
    title: `Publish “${sel.title}”?`,
    content: 'It goes live for the learners it applies to. They are notified, and a mandatory policy locks classes / recordings / tests until they accept.',
    okText: 'Publish now',
    centered: true,
    onOk: () => run('publish', lmsApi.publishPolicy(sel.id), 'Published — learners notified', () => setId(sel.id)),
  });
  const exportCsv = () => lmsApi.opsDownload(`/lms/policies/${data.acks.policyId}/report`, { format: 'csv' }, `policy-acknowledgements-v${data.acks.version}.csv`).catch(() => message.error('Export failed.'));
  const openPolicy = (pid) => {
    setId(pid);
    setOpen(true);
  };

  const at = stageOf(sel);
  const isDraft = sel && sel.status === 'draft';
  const list = (data && data.list) || [];
  const isAdmin = !!(data && data.isAdmin);
  const me = data && data.me;
  const approvers = (data && data.approvers) || [];
  const mine = (p) => p.requestedAt && !p.approvedAt && (!p.approverId || p.approverId === me);
  const forMe = list.filter(mine);
  const waiting = list.filter((p) => p.requestedAt && !p.approvedAt);
  const ready = list.filter((p) => p.draftId && p.approvedAt);
  const loaded = sel && (!id || sel.id === id) && !loading;
  const acks = data && data.acks;
  const ackDone = acks ? acks.batches.reduce((n, b) => n + b.done, 0) : 0;
  const ackTotal = acks ? acks.batches.reduce((n, b) => n + b.total, 0) : 0;
  const st = sel ? stateOf(sel) : 'draft';
  const canEditRequest = isDraft && !isAdmin && st !== 'approved';
  const assignedToMe = sel && isAdmin && (!sel.approverId || sel.approverId === me);
  const approverLabel = (aid) => {
    const a = approvers.find((x) => x.id === aid);
    return a ? `${a.name} (${a.role})` : sel && sel.approverName;
  };

  if (err && !data) return <div className="ao-err">{err}</div>;

  return (
    <div className="pol">
      <NewPolicyModal open={creating} onClose={() => setCreating(false)} onCreated={(newId) => { setCreating(false); if (newId) openPolicy(newId); else reload(); }} />

      <div className="pol-hero">
        <div className="pol-hero-l">
          <span className="pol-hero-ic">{isAdmin ? <SafetyCertificateOutlined /> : <SendOutlined />}</span>
          <div>
            <h2>{isAdmin ? 'Policy approvals' : 'Publish & track'}</h2>
            <p>{isAdmin
              ? 'Support sends a policy to you for approval. Read it, then Approve (Support publishes it) or Send back with a note. A policy you write yourself goes live at once — no approval needed.'
              : 'Write a policy → choose an Admin → Send for approval. When the Admin approves, you publish it and track who has accepted.'}</p>
          </div>
        </div>
        {!isAdmin && <Button type="primary" size="large" icon={<PlusOutlined />} onClick={() => setCreating(true)}>New policy</Button>}
        {isAdmin && <Button size="large" icon={<PlusOutlined />} onClick={() => setCreating(true)}>New policy</Button>}
      </div>

      <div className="pol-flow" aria-label="How a policy goes live">
        {[
          [<EditOutlined key="1" />, 'Support writes', 'Draft'],
          [<SendOutlined key="2" />, 'Sends to an Admin', 'Approval request'],
          [<SafetyCertificateOutlined key="3" />, 'Admin approves', 'or sends back'],
          [<RocketOutlined key="4" />, 'Support publishes', 'Live for learners'],
        ].map(([ic, t, s], i) => (
          <div key={t} className="pol-flow-i"><span className="pol-flow-ic">{ic}</span><span><b>{i + 1}. {t}</b><small>{s}</small></span></div>
        ))}
      </div>

      <div className="pol-stats">
        <div className="pol-stat"><span className="pol-stat-ic violet"><FileProtectOutlined /></span><div><b>{list.length}</b><span>Policies</span></div></div>
        <div className="pol-stat"><span className="pol-stat-ic teal"><CheckCircleOutlined /></span><div><b>{list.filter((p) => p.liveId).length}</b><span>Live</span></div></div>
        <div className="pol-stat"><span className="pol-stat-ic blue"><ClockCircleOutlined /></span><div><b>{isAdmin ? forMe.length : waiting.length}</b><span>{isAdmin ? 'Waiting for your approval' : 'Waiting for Admin approval'}</span></div></div>
        <div className="pol-stat"><span className="pol-stat-ic amber"><RocketOutlined /></span><div><b>{ready.length}</b><span>Approved — ready to publish</span></div></div>
      </div>

      {isAdmin && forMe.length > 0 && (
        <div className="pol-alert info">
          <ExclamationCircleOutlined />
          <span><b>{forMe.length} polic{forMe.length === 1 ? 'y is' : 'ies are'} waiting for your approval</b> · {forMe.map((p) => `${p.title} (from ${p.requestedByName || 'Support'})`).join(', ')}</span>
          <Button type="primary" size="small" onClick={() => openPolicy(forMe[0].draftId)}>Review now</Button>
        </div>
      )}
      {!isAdmin && ready.length > 0 && (
        <div className="pol-alert ok">
          <SafetyCertificateOutlined />
          <span><b>{ready.length} approved polic{ready.length === 1 ? 'y is' : 'ies are'} ready to publish</b> · {ready.map((p) => p.title).join(', ')}</span>
          <Button type="primary" size="small" onClick={() => openPolicy(ready[0].draftId)}>Publish now</Button>
        </div>
      )}

      {loading && !data ? (
        <div className="pol-loading"><Spin /></div>
      ) : list.length === 0 ? (
        <div className="pol-empty">
          <span className="pol-empty-ic"><FileProtectOutlined /></span>
          <b>No policy yet</b>
          <span>Press “New policy” to write one. It starts as a draft; choose an Admin and send it for approval.</span>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreating(true)}>New policy</Button>
        </div>
      ) : (
        <div className="pol-list" role="list">
          {list.map((p) => {
            const pid = p.draftId || p.liveId;
            const chip = p.draftId && ROW_CHIP[stateOf(p)];
            return (
              <button key={p.slug} type="button" role="listitem" className={`pol-row${isAdmin && mine(p) ? ' hot' : ''}`} onClick={() => openPolicy(pid)}>
                <span className="pol-row-t">
                  <span className="pol-card-ic">{p.draftId ? <EditOutlined /> : <FileTextOutlined />}</span>
                  <span style={{ minWidth: 0 }}>
                    <b>{p.title}</b>
                    <small>
                      {!p.draftId ? (p.byAdmin ? `Live · v${p.liveVersion} · published by ${p.createdByName || 'Admin'} (${p.createdByRole || 'Admin'}) — no approval needed` : `Live · v${p.liveVersion}`)
                        : p.approvedAt ? `Approved by ${p.approverName || 'Admin'} · waiting for Support to publish`
                          : p.requestedAt ? `${p.requestedByName || 'Support'} → ${p.approverName || 'Admin'}`
                            : p.liveId ? `Draft v${p.draftVersion} replaces live v${p.liveVersion}` : 'Draft — not sent yet'}
                    </small>
                  </span>
                </span>
                <span className="pol-row-v">
                  {p.byAdmin && <span className="pol-chip violet"><SafetyCertificateOutlined /> Admin policy</span>}
                  {p.liveVersion && <span className="pol-chip green">v{p.liveVersion} live</span>}
                  {p.draftVersion && <span className="pol-chip amber">v{p.draftVersion} draft</span>}
                  {chip && <span className={`pol-chip ${chip[0]}`}>{chip[1]} {chip[2]}</span>}
                </span>
                <span className="go">{isAdmin && mine(p) ? 'Review →' : !isAdmin && p.approvedAt ? 'Publish →' : 'Open →'}</span>
              </button>
            );
          })}
        </div>
      )}

      <Modal open={open} onCancel={() => setOpen(false)} footer={null} width={1080} centered rootClassName="pol-modal">
        {!loaded ? (
          <div className="pol-loading"><Spin /></div>
        ) : (
          <div className="pol-m">
            <div className="pol-m-head">
              <div className="pol-m-tags">
                <span className="pol-chip teal">v{sel.version}</span>
                {sel.category && <span className="pol-chip blue">{sel.category}</span>}
                {sel.byAdmin && <span className="pol-chip violet"><SafetyCertificateOutlined /> Admin policy</span>}
                {sel.status === 'published' ? <span className="pol-chip green">Live</span>
                  : st === 'approved' ? <span className="pol-chip green"><SafetyCertificateOutlined /> Approved — ready to publish</span>
                    : st === 'requested' ? <span className="pol-chip blue"><ClockCircleOutlined /> Waiting for Admin approval</span>
                      : st === 'back' ? <span className="pol-chip red"><RollbackOutlined /> Sent back</span>
                        : <span className="pol-chip amber">Draft</span>}
              </div>
              <h3>{sel.title}</h3>
              <div className="pol-m-meta">
                <span><EditOutlined /> by {sel.createdByName || '—'} · {fmtDate(sel.created)}</span>
                {sel.approvalRequestedAt && <span><SendOutlined /> {sel.approvalRequestedByName} → {sel.approverName || 'Admin'} · {fmtDate(sel.approvalRequestedAt)}</span>}
                {sel.approvedAt && <span><SafetyCertificateOutlined /> Approved by {sel.approvedByName} · {fmtDate(sel.approvedAt)}</span>}
              </div>
            </div>

            <div className="pol-steps">
              {STEPS.map((s, i) => (
                <div key={s} className={`pol-step${i < at ? ' done' : i === at ? ' on' : ''}`}>
                  <i>{i < at ? '✓' : i + 1}</i>
                  <span>{s}</span>
                </div>
              ))}
            </div>

            <div className="pol-m-body">
              {/* one status line, worded for whoever is looking */}
              {sel.status === 'published' && (
                sel.byAdmin ? (
                  <div className="pol-alert admin"><SafetyCertificateOutlined /><span><b>Admin policy — live for learners</b> · published directly by {sel.createdByName || 'Admin'} ({sel.createdByRole || 'Admin'}){sel.publishedAt ? ` · ${fmtDate(sel.publishedAt)}` : ''}. Written by an Admin, so no approval was needed.</span></div>
                ) : (
                  <div className="pol-alert ok"><CheckCircleOutlined /><span><b>Live for learners</b>{sel.approvedByName ? ` · approved by ${sel.approvedByName}` : ''}{sel.publishedAt ? ` · published ${fmtDate(sel.publishedAt)}` : ''}</span></div>
                )
              )}
              {isDraft && st === 'draft' && (
                <div className="pol-alert"><SendOutlined /><span>{isAdmin ? <><b>Draft</b> · not sent for approval yet. As an Admin you can also publish it directly.</> : <><b>Step 1</b> · write a change summary, choose the Admin who should approve it and press “Send for approval”.</>}</span></div>
              )}
              {isDraft && st === 'requested' && (
                <div className="pol-alert info">
                  <ClockCircleOutlined />
                  <span>{assignedToMe
                    ? <><b>{sel.approvalRequestedByName} asked you to approve this policy</b> · {fmtDate(sel.approvalRequestedAt)}. Read the text below, then Approve or Send back.</>
                    : <><b>Waiting for {sel.approverName || 'the Admin'} to approve</b> · sent {fmtDate(sel.approvalRequestedAt)}. {isAdmin ? 'This request was sent to another Admin.' : 'You get a notification when it is approved or sent back.'}</>}</span>
                </div>
              )}
              {isDraft && st === 'approved' && (
                <div className="pol-alert ok">
                  <SafetyCertificateOutlined />
                  <span>{isAdmin
                    ? <><b>Approved by {sel.approvedByName}</b> · Support can publish it now.</>
                    : <><b>{sel.approvedByName} approved it</b> · press “Publish now” to make it live for learners.</>}</span>
                </div>
              )}
              {isDraft && st === 'back' && (
                <div className="pol-alert bad"><RollbackOutlined /><span><b>Sent back by {sel.rejectedByName}</b> · {fmtDate(sel.rejectedAt)}<br />“{sel.rejectNote}”{isAdmin ? '' : ' — fix it and send it for approval again.'}</span></div>
              )}

              <section className="pol-box">
                <div className="pol-cap">Policy text</div>
                <div className="pol-m-text" style={{ maxHeight: 220, overflowY: 'auto', padding: 14 }}>{sel.content || '(no text)'}</div>
              </section>

              <div className="pol-m-grid">
                <section className="pol-box">
                  <div className="pol-cap">{canEditRequest ? 'Send for approval' : 'Approval request'}</div>
                  <div className="pol-lbl">Send to Admin
                    <Select
                      showSearch
                      size="large"
                      disabled={!canEditRequest}
                      placeholder="Choose who approves it"
                      value={f.approverId || undefined}
                      onChange={(v) => setF({ ...f, approverId: v })}
                      optionFilterProp="label"
                      options={approvers.map((a) => ({ value: a.id, label: `${a.name} · ${a.role}` }))}
                      suffixIcon={<UserOutlined />}
                      style={{ width: '100%' }}
                      notFoundContent="No Admin found"
                    />
                    {!canEditRequest && sel.approverId && <span className="pol-note">Sent to {approverLabel(sel.approverId)}</span>}
                  </div>
                  <label className="pol-lbl">Change summary (for the Admin)
                    <textarea disabled={!canEditRequest} placeholder="What this policy / version changes and why" value={f.changeSummary} onChange={(e) => setF({ ...f, changeSummary: e.target.value })} />
                  </label>
                  <button type="button" className={`pol-switch${f.materialChange ? ' on' : ''}`} disabled={!canEditRequest} aria-pressed={f.materialChange} onClick={() => setF({ ...f, materialChange: !f.materialChange })}>
                    <span className="knob" />
                    <span>
                      <b>{f.materialChange ? 'Material change — re-acceptance required' : 'Minor change — no re-acceptance'}</b>
                      <span>{f.materialChange ? 'Learners are notified on publish; restricted content stays locked until they accept' : 'Learners only get a notice; access is not affected'}</span>
                    </span>
                  </button>
                  <label className="pol-lbl">Effective date<input type="date" disabled={!canEditRequest} value={f.effectiveDate} onChange={(e) => setF({ ...f, effectiveDate: e.target.value })} /></label>
                  <div className="pol-note">The checkbox is always unticked for the learner · on acceptance, learner ID + version + time are saved</div>
                </section>

                <section className="pol-box">
                  <div className="pol-cap">Acknowledgements{acks ? ` · v${acks.version}` : ''}</div>
                  {!acks ? (
                    <div className="pol-note">Not published yet — nothing to acknowledge. Once it is live, accepted / pending counts per batch show here.</div>
                  ) : (
                    <>
                      <Ring done={ackDone} total={ackTotal} />
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                        {acks.batches.map((b) => (
                          <div className="pol-bar" key={b.batch}>
                            <span title={b.batch}>{b.batch}</span>
                            <div className="pol-trk"><div className={b.total && b.done / b.total < 0.85 ? 'warn' : ''} style={{ width: `${b.total ? (b.done / b.total) * 100 : 0}%` }} /></div>
                            <b>{b.done}/{b.total}</b>
                          </div>
                        ))}
                      </div>
                      <div className="pol-cap" style={{ marginTop: 4 }}>Pending · {acks.pending.length}</div>
                      {acks.pending.length === 0 ? <div className="pol-note">Everyone has accepted.</div> : (
                        <div className="pol-pending">{acks.pending.map((n, i) => <span key={i} className="pol-chip">{n}</span>)}</div>
                      )}
                      <div className="pol-note">Pending learners' LMS access is locked by the gate (server-side) · daily reminder job</div>
                      <Button icon={<DownloadOutlined />} onClick={exportCsv} style={{ alignSelf: 'flex-start' }}>Export acceptance evidence (CSV)</Button>
                    </>
                  )}
                </section>
              </div>
            </div>

            <div className="pol-m-foot">
              <div className="pol-m-foot-r">
                <Button icon={<EyeOutlined />} onClick={() => setPreview(true)}>Preview as learner</Button>
                {isAdmin && <Button danger icon={<DeleteOutlined />} onClick={() => confirmDeletePolicy(sel, () => { setOpen(false); setId(undefined); reload(); })}>Delete</Button>}
              </div>
              <div className="pol-m-foot-r">
                <Button onClick={() => setOpen(false)}>Close</Button>
                {/* Support */}
                {isDraft && !isAdmin && st !== 'approved' && (
                  <Button type="primary" icon={<SendOutlined />} loading={busy === 'send'} onClick={send}>
                    {st === 'requested' ? 'Update request' : st === 'back' ? 'Send for approval again' : 'Send for approval'}
                  </Button>
                )}
                {isDraft && !isAdmin && st === 'approved' && <Button type="primary" icon={<RocketOutlined />} loading={busy === 'publish'} onClick={publish}>Publish now</Button>}
                {/* Admin */}
                {isDraft && assignedToMe && st === 'requested' && <Button danger icon={<RollbackOutlined />} onClick={() => setBackOpen(true)}>Send back</Button>}
                {isDraft && assignedToMe && st === 'requested' && <Button type="primary" icon={<SafetyCertificateOutlined />} loading={busy === 'approve'} onClick={approve}>Approve</Button>}
                {isDraft && isAdmin && st !== 'requested' && <Button type={st === 'approved' ? 'primary' : 'default'} icon={<RocketOutlined />} loading={busy === 'publish'} onClick={publish}>Publish now</Button>}
              </div>
            </div>
          </div>
        )}
      </Modal>

      <Modal open={backOpen} onCancel={() => setBackOpen(false)} title="Send back to Support" okText="Send back" okButtonProps={{ danger: true, loading: busy === 'back' }} onOk={sendBack} centered destroyOnClose>
        <p style={{ marginTop: 0, color: '#64748b' }}>Tell Support what to change. The draft stays as it is; they fix it and send it for approval again.</p>
        <Input.TextArea rows={4} autoFocus maxLength={1000} showCount placeholder="e.g. Add the leave rules for exam week and fix the effective date." value={backNote} onChange={(e) => setBackNote(e.target.value)} />
      </Modal>

      <Modal open={preview} onCancel={() => setPreview(false)} footer={null} width={720} centered rootClassName="pol-modal">
        {sel && (
          <div className="pol-m">
            <div className="pol-m-head">
              <div className="pol-m-tags"><span className="pol-chip">Learner preview</span><span className="pol-chip teal">v{sel.version}</span></div>
              <h3>{sel.title}</h3>
            </div>
            <div className="pol-m-body">
              <div className="pol-m-text">{sel.content || '(no text)'}</div>
              <label style={{ display: 'flex', gap: 10, alignItems: 'center', fontSize: 14 }}><input type="checkbox" disabled style={{ width: 18, height: 18 }} /> I have read and accept this policy</label>
            </div>
            <div className="pol-m-foot"><span className="pol-note">This is what the learner sees</span><Button onClick={() => setPreview(false)}>Close</Button></div>
          </div>
        )}
      </Modal>
    </div>
  );
}
