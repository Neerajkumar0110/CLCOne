import React, { useMemo, useRef, useState } from 'react';
import { Alert, message, Modal, Button, Input, Tooltip } from 'antd';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  TeamOutlined, SearchOutlined, UploadOutlined, DownloadOutlined, UserOutlined, CheckCircleOutlined, PauseCircleOutlined,
  StopOutlined, ClockCircleOutlined, TrophyOutlined, LockOutlined, LogoutOutlined, InboxOutlined, MailOutlined, SwapOutlined,
  FileProtectOutlined, CustomerServiceOutlined, IdcardOutlined, WarningOutlined, FileExcelOutlined, RightOutlined,
} from '@ant-design/icons';
import lmsApi from '../api';
import { request } from '@/request';
import { useLoad, Loading, res, errText, downloadCsv } from './shared';
import '../AdminOps/mgmt.css';
import '../AdminOps/opsPages.css';
import './smDesign.css';
import './learners.css';

// S9 — learner management: status pills with counts, roster (onboarding,
// consent, open tickets), status change with the rule for each status
// (On Hold / Deferred apply directly; Dropped / Suspended / Withdrawn go to
// an Ops approval), reset-login link (password never shown), bulk CSV import
// with a validation preview (only valid rows are created) and export.
// 2026-11-27 redesign: gradient hero, icon status cards, learner rows, the
// learner's status change opens in a modal, CSV import preview in a modal.

const STATUSES = ['Active', 'On Hold', 'Dropped', 'Deferred', 'Completed', 'Suspended', 'Withdrawn', 'Archived'];
const ST_LOOK = {
  Active: [CheckCircleOutlined, 'ok'], 'On Hold': [PauseCircleOutlined, 'mid'], Dropped: [LogoutOutlined, 'none'], Deferred: [ClockCircleOutlined, 'info'],
  Completed: [TrophyOutlined, 'ok'], Suspended: [StopOutlined, 'bad'], Withdrawn: [LogoutOutlined, 'none'], Archived: [InboxOutlined, 'none'],
};
const RULES = {
  'On Hold': ['Applied directly (audited)', 'Access and reminders paused by the approved rule · withdrawal is not assumed.', 'Apply On Hold', 'ok'],
  Deferred: ['Applied directly (audited)', 'Moved to a new batch / schedule · old attendance history is kept.', 'Apply Deferred', 'ok'],
  Active: ['Applied directly (audited)', 'Access and reminders back on.', 'Apply Active', 'ok'],
  Dropped: ['Needs Ops Manager approval', 'Out of the attendance denominator · class / feedback reminders stop · access per policy · the learner is notified.', 'Send for approval', 'mid'],
  Suspended: ['Needs Management approval', 'Access blocked immediately · all reminder jobs cancelled.', 'Send for approval', 'bad'],
  Withdrawn: ['Ops + Finance check', 'Refund / dues are checked by Finance · access off · history retained.', 'Send for approval', 'mid'],
};

function parseCsv(text) {
  const lines = String(text || '').split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) return [];
  const split = (l) => l.match(/("([^"]|"")*"|[^,]*)(,|$)/g).map((c) => c.replace(/,$/, '').replace(/^"|"$/g, '').replace(/""/g, '"').trim()).filter((_, i, a) => i < a.length - 1 || _ !== '');
  const head = split(lines[0]).map((h) => h.toLowerCase());
  return lines.slice(1).map((l) => {
    const c = split(l);
    const o = {};
    head.forEach((h, i) => { o[h] = c[i] || ''; });
    return o;
  });
}

export default function SMLearners() {
  const navigate = useNavigate();
  const location = useLocation();
  const [status, setStatus] = useState('');
  const [q, setQ] = useState((location.state && location.state.search) || '');
  const [sel, setSel] = useState(null);
  const [next, setNext] = useState('On Hold');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState('');
  const [imp, setImp] = useState(null);
  const fileRef = useRef(null);
  const { data, loading, error, reload } = useLoad(async () => res(await lmsApi.smLearners()), []);
  const rows = useMemo(() => ((data && data.rows) || []).filter((r) => (!status || r.status === status) && (!q || `${r.name} ${r.email} ${r.enrollmentId}`.toLowerCase().includes(q.toLowerCase()))), [data, status, q]);
  if (loading && !data) return <Loading />;
  if (error) return <Alert type="error" showIcon message={error} style={{ margin: 24 }} />;
  const cur = sel && data.rows.find((r) => r.id === sel);
  const rule = RULES[next];
  const open = (r) => { setSel(r.id); setNext(r.status === 'On Hold' ? 'Active' : 'On Hold'); setReason(''); };

  const apply = async () => {
    if (reason.trim().length < 5) return message.warning('Write the reason + evidence.');
    setBusy('status');
    try {
      const r = await lmsApi.smLearnerStatus(cur.id, { status: next, reason: reason.trim() });
      if (r && r.success === false) throw new Error(r.message);
      message.success(r.message || 'Done.');
      setReason('');
      setSel(null);
      reload();
    } catch (e) {
      message.error(errText(e, 'Could not change status.'));
    } finally {
      setBusy('');
    }
    return null;
  };
  const creds = async () => {
    setBusy('creds');
    try {
      const r = await lmsApi.smLearnerCredentials(cur.id);
      if (r && r.success === false) throw new Error(r.message);
      message.success(r.message || 'Sent.');
    } catch (e) {
      message.error(errText(e, 'Could not send.'));
    } finally {
      setBusy('');
    }
  };
  const onFile = async (file) => {
    if (!file) return null;
    const raw = await (file.text ? file.text() : new Promise((ok, fail) => { const fr = new FileReader(); fr.onload = () => ok(String(fr.result || '')); fr.onerror = fail; fr.readAsText(file); })).catch(() => '');
    const list = parseCsv(raw);
    if (!list.length) return message.error('The CSV is empty or could not be read.');
    const known = new Set(data.rows.map((r) => r.email.toLowerCase()));
    const seen = new Set();
    const batches = new Set(data.batches);
    const checked = list.map((r) => {
      const email = String(r.email || '').toLowerCase();
      let err = '';
      if (!r.name || !email) err = 'name / email missing';
      else if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) err = 'invalid email';
      else if (known.has(email) || seen.has(email)) err = 'duplicate email';
      else if (r.batch && !batches.has(r.batch)) err = 'unknown batch';
      seen.add(email);
      return { ...r, email, err };
    });
    setImp({ file: file.name, rows: checked });
    return null;
  };
  const runImport = async () => {
    const ok = imp.rows.filter((r) => !r.err);
    setBusy('import');
    let made = 0;
    const failed = [];
    for (const r of ok) {
      // eslint-disable-next-line no-await-in-loop
      const out = await request.create({ entity: 'student', jsonData: { name: r.name, email: r.email, phone: r.phone || '', batch: r.batch || '', course: r.course || '', status: 'Active' } }).catch((e) => ({ success: false, message: e.message }));
      if (out && out.success !== false) made += 1;
      else failed.push({ ...r, err: (out && out.message) || 'failed' });
    }
    setBusy('');
    message.success(`${made} learners imported${failed.length ? ` · ${failed.length} failed` : ''}.`);
    setImp(failed.length ? { file: imp.file, rows: failed } : null);
    reload();
  };
  const exportRows = () => downloadCsv('learners.csv', rows.map((r) => ({ Name: r.name, 'Learner ID': r.enrollmentId, Email: r.email, Batch: r.batch, Status: r.status, Onboarding: `${r.onboarding.done}/${r.onboarding.total}`, Consent: r.consent, 'Open tickets': r.openTickets })));
  const valid = imp ? imp.rows.filter((r) => !r.err).length : 0;

  return (
    <div className="mg op lrx">
      <div className="mg-hero lrx-hero">
        <div className="mg-hero-l">
          <span className="mg-hero-ic"><TeamOutlined /></span>
          <div style={{ minWidth: 0 }}>
            <span className="mg-kicker">Learner management</span>
            <h1>Statuses, onboarding &amp; import</h1>
            <p>Change a learner&apos;s status with the right approval, resend login details and bulk-import from CSV. Passwords are never shown or set — only a secure reset link.</p>
          </div>
        </div>
        <div className="op-hero-r">
          <Button icon={<UploadOutlined />} onClick={() => fileRef.current && fileRef.current.click()}>Bulk import CSV</Button>
          <Button icon={<DownloadOutlined />} onClick={exportRows}>Export</Button>
          <input ref={fileRef} type="file" accept=".csv,text/csv" hidden aria-label="CSV file" onChange={(e) => { onFile(e.target.files[0]); e.target.value = ''; }} />
        </div>
      </div>

      <div className="lrx-st">
        <button type="button" className={`lrx-st-b all${!status ? ' on' : ''}`} onClick={() => setStatus('')}><span className="lrx-st-ic"><TeamOutlined /></span><b>{data.total}</b><small>All learners</small></button>
        {STATUSES.map((s) => {
          const [Ic, tone] = ST_LOOK[s];
          return <button key={s} type="button" className={`lrx-st-b ${tone}${status === s ? ' on' : ''}`} onClick={() => setStatus(s)}><span className="lrx-st-ic"><Ic /></span><b>{data.counts[s] || 0}</b><small>{s}</small></button>;
        })}
      </div>

      <section className="mg-card lrx-list">
        <div className="mg-hd">
          <span className="mg-hd-ic g1"><UserOutlined /></span>
          <div><b>{status || 'All learners'} · {rows.length}</b><small>Click a learner to change status or resend login details</small></div>
          <Input allowClear prefix={<SearchOutlined />} placeholder="Search name, learner ID, email" value={q} onChange={(e) => setQ(e.target.value)} style={{ maxWidth: 280 }} />
        </div>
        <div className="mg-card-body" style={{ padding: 0, gap: 0 }}>
          <div className="lrx-tr lrx-th"><span>Learner</span><span>Batch</span><span>Status</span><span><IdcardOutlined /> Onboarding</span><span><FileProtectOutlined /> Consent</span><span><CustomerServiceOutlined /> Tickets</span><span /></div>
          {rows.length === 0 && <div className="mg-empty">No learner found.</div>}
          {rows.slice(0, 200).map((r) => {
            const [Ic, tone] = ST_LOOK[r.status] || [UserOutlined, 'none'];
            const pct = r.onboarding.total ? Math.round((r.onboarding.done / r.onboarding.total) * 100) : 0;
            return (
              <div key={r.id} className={`lrx-tr${r.status === 'Dropped' ? ' dim' : ''}`} role="button" tabIndex={0} onClick={() => open(r)} onKeyDown={(e) => { if (e.key === 'Enter') open(r); }}>
                <span className="lrx-name">
                  <span className="mg-actor"><i>{String(r.name || '?')[0]}</i></span>
                  <span><b>{r.name}</b><small>{r.enrollmentId || 'no ID'} · {r.emailMasked}{!r.hasAccount ? ' · no login' : ''}</small></span>
                </span>
                <span>{r.batch ? <span className="attx-batch">{r.batch}</span> : <span className="lrx-un"><WarningOutlined /> unassigned</span>}</span>
                <span><span className={`smx-st ${tone}`}><Ic /> {r.status}</span>{r.pendingChange && <small className="lrx-pend">pending: {r.pendingChange}</small>}</span>
                <span className="lrx-ob"><i><span style={{ width: `${pct}%` }} /></i><small>{r.onboarding.done}/{r.onboarding.total}</small></span>
                <span><span className={`smx-st ${r.consent === 'pending' ? 'mid' : r.consent === 'accepted' || r.consent === 'done' ? 'ok' : ''}`}>{r.consent}</span></span>
                <span>{r.openTickets ? <span className="smx-st bad">{r.openTickets} open</span> : <span className="lrx-zero">0</span>}</span>
                <span className="lrx-go"><RightOutlined /></span>
              </div>
            );
          })}
        </div>
        {rows.length > 200 && <div className="mg-foot">Showing the first 200 — narrow with search or a status card</div>}
      </section>

      <Modal open={!!cur} onCancel={() => setSel(null)} footer={null} width={620} centered destroyOnClose rootClassName="mg-modal">
        {cur && (() => {
          const [Ic, tone] = ST_LOOK[cur.status] || [UserOutlined, 'none'];
          return (
            <div className="mg-m">
              <div className="mg-m-head lrx-m-head">
                <span className="mg-act"><Ic /> {cur.status}</span>
                <h3>{cur.name}</h3>
                <span>{cur.enrollmentId || 'no ID'} · {cur.emailMasked} · {cur.batch || 'unassigned'}{!cur.hasAccount ? ' · no login yet' : ''}</span>
              </div>
              <div className="mg-m-body">
                <div className="lrx-kv">
                  <div><small>Onboarding</small><b>{cur.onboarding.done}/{cur.onboarding.total}</b></div>
                  <div><small>Consent</small><b>{cur.consent}</b></div>
                  <div><small>Open tickets</small><b>{cur.openTickets}</b></div>
                  <div><small>Status</small><b className={`lrx-kv-st ${tone}`}>{cur.status}</b></div>
                </div>
                <div className="mg-m-cap">Change status to</div>
                <div className="lrx-next">
                  {Object.keys(RULES).filter((k) => k !== cur.status).map((k) => {
                    const [NIc, nt] = ST_LOOK[k];
                    return <button key={k} type="button" className={`lrx-next-b ${nt}${next === k ? ' on' : ''}`} onClick={() => setNext(k)}><NIc /> {k}</button>;
                  })}
                </div>
                {rule && (
                  <div className={`lrx-rule ${rule[3]}`}>
                    {rule[3] === 'ok' ? <CheckCircleOutlined /> : <LockOutlined />}
                    <span><b>{rule[0]}</b><small>{rule[1]}</small></span>
                  </div>
                )}
                <label className="ao-label">Reason + evidence (required)<Input.TextArea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Absent 22 days, 3 calls, L3 email unanswered (TKT-…)" /></label>
                <div className="mg-m-cap">Other actions</div>
                <div className="op-chips">
                  <Button icon={<SwapOutlined />} onClick={() => navigate('/lms/students')}>Transfer batch</Button>
                  <Tooltip title="Sends a secure reset link — the password is never shown"><Button icon={<MailOutlined />} loading={busy === 'creds'} onClick={creds}>{cur.hasAccount ? 'Resend login details' : 'Send invite'}</Button></Tooltip>
                </div>
              </div>
              <div className="mg-m-foot" style={{ gap: 8 }}>
                <Button onClick={() => setSel(null)}>Close</Button>
                <Button type="primary" loading={busy === 'status'} disabled={!rule || reason.trim().length < 5} onClick={apply}>{rule ? rule[2] : 'Pick a status'}</Button>
              </div>
            </div>
          );
        })()}
      </Modal>

      <Modal open={!!imp} onCancel={() => setImp(null)} footer={null} width={760} centered destroyOnClose rootClassName="mg-modal">
        {imp && (
          <div className="mg-m">
            <div className="mg-m-head lrx-m-head"><span className="mg-act"><FileExcelOutlined /> Bulk import preview</span><h3>{imp.file}</h3><span>{imp.rows.length} rows · only valid rows will be imported · columns: name, email, phone, batch, course</span></div>
            <div className="mg-m-body">
              <div className="lrx-kv">
                <div className="ok"><small>Valid</small><b>{valid}</b></div>
                <div className="bad"><small>Duplicate emails</small><b>{imp.rows.filter((r) => r.err === 'duplicate email').length}</b></div>
                <div className="mid"><small>Other errors</small><b>{imp.rows.filter((r) => r.err && r.err !== 'duplicate email').length}</b></div>
              </div>
              <div className="lrx-imp">
                {imp.rows.map((r, i) => (
                  <div key={i} className={`lrx-imp-r${r.err ? ' bad' : ''}`}>
                    {r.err ? <WarningOutlined /> : <CheckCircleOutlined />}
                    <span><b>{r.name || '—'}</b><small>{r.email || '—'}{r.batch ? ` · ${r.batch}` : ''}</small></span>
                    {r.err ? <span className="smx-st bad">{r.err}</span> : <span className="smx-st ok">ready</span>}
                  </div>
                ))}
              </div>
            </div>
            <div className="mg-m-foot" style={{ gap: 8 }}>
              <Button icon={<DownloadOutlined />} disabled={!imp.rows.some((r) => r.err)} onClick={() => downloadCsv('import-errors.csv', imp.rows.filter((r) => r.err))}>Error report</Button>
              <Button onClick={() => setImp(null)}>Cancel</Button>
              <Button type="primary" icon={<UploadOutlined />} loading={busy === 'import'} disabled={!valid} onClick={runImport}>Import {valid} valid row{valid === 1 ? '' : 's'}</Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
