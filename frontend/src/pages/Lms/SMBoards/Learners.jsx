import React, { useMemo, useRef, useState } from 'react';
import { Alert, message } from 'antd';
import { useLocation, useNavigate } from 'react-router-dom';
import lmsApi from '../api';
import { request } from '@/request';
import { SMPage, useLoad, Loading, res, errText, downloadCsv } from './shared';

// S9 — learner management: status pills with counts, roster (onboarding,
// consent, open tickets), status change with the rule for each status
// (On Hold / Deferred apply directly; Dropped / Suspended / Withdrawn go to
// an Ops approval), reset-login link (password never shown), bulk CSV import
// with a validation preview (only valid rows are created) and export.

const STATUSES = ['Active', 'On Hold', 'Dropped', 'Deferred', 'Completed', 'Suspended', 'Withdrawn', 'Archived'];
const CHIP = { Active: 'hai', 'On Hold': 'adh', Dropped: 'gray', Deferred: 'naya', Completed: 'hai', Suspended: 'red', Withdrawn: 'gray', Archived: 'gray' };
const RULES = {
  'On Hold': ['Applied directly (audited)', 'Access and reminders paused by the approved rule · withdrawal is not assumed.', 'Apply On Hold'],
  Deferred: ['Applied directly (audited)', 'Moved to a new batch / schedule · old attendance history is kept.', 'Apply Deferred'],
  Active: ['Applied directly (audited)', 'Access and reminders back on.', 'Apply Active'],
  Dropped: ['Needs Ops Manager approval', 'Out of the attendance denominator · class / feedback reminders stop · access per policy · the learner is notified.', 'Send for approval'],
  Suspended: ['Needs Management approval', 'Access blocked immediately · all reminder jobs cancelled.', 'Send for approval'],
  Withdrawn: ['Ops + Finance check', 'Refund / dues Finance dekhega · access band · history retained.', 'Send for approval'],
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

  const apply = async () => {
    if (reason.trim().length < 5) return message.warning('Write the reason + evidence.');
    setBusy('status');
    try {
      const r = await lmsApi.smLearnerStatus(cur.id, { status: next, reason: reason.trim() });
      if (r && r.success === false) throw new Error(r.message);
      message.success(r.message || 'Done.');
      setReason('');
      reload();
    } catch (e) {
      message.error(errText(e, 'Could not change status.'));
    } finally {
      setBusy('');
    }
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
    if (!file) return;
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

  return (
    <SMPage title="Learner management" sub="Statuses · learner management · passwords are never shown / set — only a secure reset link">
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <button type="button" className={`ld-pill${!status ? ' on' : ''}`} style={{ height: 32, fontSize: 12 }} onClick={() => setStatus('')}>All · {data.total}</button>
        {STATUSES.map((s) => <button key={s} type="button" className={`ld-pill${status === s ? ' on' : ''}`} style={{ height: 32, fontSize: 12 }} onClick={() => setStatus(s)}>{s} · {data.counts[s] || 0}</button>)}
      </div>
      <div className="sm-g" style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 360px', gap: 14, flex: 1, minHeight: 0 }}>
        <section className="ld-card" aria-label="Learners">
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <input className="ld-inp" style={{ width: 260 }} placeholder="Search name, learner ID, email" aria-label="Search" value={q} onChange={(e) => setQ(e.target.value)} />
            <button type="button" className="ld-btn2 sm" onClick={() => fileRef.current && fileRef.current.click()}>Bulk import CSV</button>
            <input ref={fileRef} type="file" accept=".csv,text/csv" hidden aria-label="CSV file" onChange={(e) => onFile(e.target.files[0])} />
            <button type="button" className="ld-btn2 sm" onClick={exportRows}>Export</button>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table className="ld-table">
              <thead><tr><th /><th>Learner</th><th>Batch</th><th>Status</th><th>Onboarding</th><th>Consent</th><th>Open tickets</th></tr></thead>
              <tbody>
                {rows.length === 0 && <tr><td colSpan={7} className="ld-muted">No learner found.</td></tr>}
                {rows.slice(0, 200).map((r) => (
                  <tr key={r.id} className={`click${sel === r.id ? ' sm-rowsel' : ''}`} onClick={() => { setSel(r.id); setNext(r.status === 'On Hold' ? 'Active' : 'On Hold'); }}>
                    <td><input type="checkbox" aria-label={`Select ${r.name}`} checked={sel === r.id} readOnly /></td>
                    <td className={r.status === 'Dropped' ? 'ld-muted' : ''}><b>{r.name}</b><br /><span className="ld-muted">{r.enrollmentId || 'no ID'} · {r.emailMasked}{!r.hasAccount ? ' · no login' : ''}</span></td>
                    <td>{r.batch || <span className="ld-muted">unassigned</span>}</td>
                    <td><span className={`ld-chip ${CHIP[r.status] || 'gray'}`}>{r.status}</span>{r.pendingChange && <><br /><span className="ld-muted" style={{ fontSize: 11 }}>pending: {r.pendingChange}</span></>}</td>
                    <td>{r.onboarding.done}/{r.onboarding.total}</td>
                    <td>{r.consent}</td>
                    <td>{r.openTickets}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {imp && (
            <div className="ld-soft" style={{ marginTop: 'auto' }}>
              <b>Bulk import preview ({imp.file}):</b> {imp.rows.length} rows · <span style={{ color: '#166534' }}>{imp.rows.filter((r) => !r.err).length} valid</span> · <span style={{ color: '#991b1b' }}>{imp.rows.filter((r) => r.err === 'duplicate email').length} duplicate emails</span> · <span style={{ color: '#9a3412' }}>{imp.rows.filter((r) => r.err && r.err !== 'duplicate email').length} other errors</span> — only valid rows will be imported
              <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                <button type="button" className="ld-btn sm" disabled={busy === 'import' || !imp.rows.some((r) => !r.err)} onClick={runImport}>{busy === 'import' ? 'Importing…' : 'Import valid rows'}</button>
                <button type="button" className="ld-btn2 sm" disabled={!imp.rows.some((r) => r.err)} onClick={() => downloadCsv('import-errors.csv', imp.rows.filter((r) => r.err))}>Download error report</button>
                <button type="button" className="ld-link" onClick={() => setImp(null)}>Cancel</button>
              </div>
              <div className="ld-muted" style={{ fontSize: 12, marginTop: 4 }}>CSV columns: name, email, phone, batch, course</div>
            </div>
          )}
        </section>
        <section className="ld-card" aria-label="Change status">
          {!cur && <div className="ld-empty">Pick a learner from the table.</div>}
          {cur && (
            <>
              <div className="ld-hd"><b style={{ fontSize: 15 }}>{cur.name} · change status</b><span className={`ld-chip ${CHIP[cur.status] || 'gray'}`}>{cur.status}</span></div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {Object.keys(RULES).filter((k) => k !== cur.status).map((k) => <button key={k} type="button" className={`ld-pill${next === k ? ' on' : ''}`} style={{ height: 32, fontSize: 12 }} onClick={() => setNext(k)}>{k}</button>)}
              </div>
              {rule && <div className="ld-warn" style={{ lineHeight: '20px' }}><b>{rule[0]}</b><br />{rule[1]}</div>}
              <label className="ld-label">Reason + evidence (required)<textarea className="ld-inp" style={{ height: 70, padding: 8, resize: 'none' }} placeholder="22 din absent, 3 calls, L3 email unanswered (TKT-…)" value={reason} onChange={(e) => setReason(e.target.value)} /></label>
              <button type="button" className="ld-btn" disabled={busy === 'status' || !rule} onClick={apply}>{busy === 'status' ? 'Saving…' : rule ? rule[2] : 'Pick a status'}</button>
              <div style={{ borderTop: '1px solid #e2e8f0', paddingTop: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
                <b style={{ fontSize: 14 }}>Other actions</b>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  <button type="button" className="ld-btn2 sm" onClick={() => navigate('/lms/students')}>Transfer batch</button>
                  <button type="button" className="ld-btn2 sm" disabled={busy === 'creds'} onClick={creds}>{cur.hasAccount ? 'Resend login details' : 'Send invite'}</button>
                </div>
              </div>
            </>
          )}
        </section>
      </div>
    </SMPage>
  );
}
