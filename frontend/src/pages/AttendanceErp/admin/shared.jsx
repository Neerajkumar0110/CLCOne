import React, { useEffect, useRef, useState } from 'react';
import api from '../api';
import { Modal, ModalHead, useToast, Ic } from '../ui';

// Bits shared by several admin sub-tabs.

let liteCache = null;
let liteAt = 0;
// Sales users: one line with their Workday shift login + today's calls
// (the Sales flow's own data — header Login, dialer, CallRecord).
export const talkLabel = (sec) => (sec >= 3600 ? `${Math.floor(sec / 3600)}h ${Math.round((sec % 3600) / 60)}m` : `${Math.round((sec || 0) / 60)}m`);
export function SalesLine({ s }) {
  if (!s) return null;
  const login = s.loginAt || s.autoStartedAt;
  const t = (d) => new Date(d).toLocaleTimeString('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit' });
  return (
    <div className="e-salesline" title="Sales Workday (header Login) and dialer calls">
      <span className="tag">Sales</span>
      <span>{login ? `Shift ${s.loginAt ? '' : 'auto '}${t(login)}${s.logoutAt ? `–${t(s.logoutAt)}` : ''}` : 'Shift not started'}</span>
      <span>
        📞 <b>{s.calls}</b> · {s.connected} conn · {talkLabel(s.talkSec)}
      </span>
    </div>
  );
}

export function useLite() {
  const [lite, setLite] = useState(liteCache);
  useEffect(() => {
    if (liteCache && Date.now() - liteAt < 60000) return;
    api.get('admin/employees-lite').then((r) => {
      if (r.success) {
        liteCache = r.result;
        liteAt = Date.now();
        setLite(r.result);
      }
    });
  }, []);
  return lite || { list: [], departments: [], leaveTypes: ['Casual', 'Sick', 'Earned', 'Emergency', 'Other'] };
}
export const deptOptions = (lite) => [{ value: 'All', label: 'All' }, ...lite.departments.map((d) => ({ value: d, label: d }))];
export const empOptions = (lite) => [{ value: 'All', label: 'All' }, ...lite.list.map((e) => ({ value: e._id, label: e.name }))];

// Approve / Reject with the rejection-reason dialog (A5)
export function useDecide(onDone) {
  const toast = useToast();
  const [rej, setRej] = useState(null);
  const [reason, setReason] = useState('');
  const [mail, setMail] = useState(true);
  const [busy, setBusy] = useState(false);
  const approve = async (l) => {
    setBusy(true);
    const r = await api.post(`admin/leaves/${l._id}/decide`, { action: 'approve' });
    setBusy(false);
    toast.res(r, 'Leave approved');
    if (r.success) onDone && onDone();
  };
  const reject = (l) => {
    setReason('');
    setMail(true);
    setRej(l);
  };
  const submit = async () => {
    setBusy(true);
    const r = await api.post(`admin/leaves/${rej._id}/decide`, { action: 'reject', reason, email: mail });
    setBusy(false);
    toast.res(r, 'Leave rejected');
    if (r.success) {
      setRej(null);
      onDone && onDone();
    }
  };
  const dialog = (
    <Modal open={!!rej} onClose={() => setRej(null)} label="Reject leave">
      <ModalHead title="Reject leave?" sub={rej ? `${rej.employee} · ${rej.leaveType} · ${rej.label || ''}. The reason goes into the employee's email and portal.` : ''} onClose={() => setRej(null)} />
      <label>
        <span className="e-lbl">Reason for rejection (required)</span>
        <textarea className="e-fld" style={{ minHeight: 84 }} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Month-end admissions push on 28 Nov. Please take 30 Nov instead." autoFocus />
      </label>
      <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 12, color: 'var(--e-ink2)', marginTop: 10 }}>
        <input type="checkbox" checked={mail} onChange={(e) => setMail(e.target.checked)} /> Email the employee
      </label>
      <div className="e-row" style={{ justifyContent: 'flex-end', marginTop: 16 }}>
        <button type="button" className="e-btn" onClick={() => setRej(null)}>
          Cancel
        </button>
        <button type="button" className="e-btn dd" disabled={busy || !reason.trim()} onClick={submit}>
          Reject leave
        </button>
      </div>
    </Modal>
  );
  return { approve, reject, dialog, busy };
}

// "Export ▾" — Excel / CSV / Print
export function ExportMenu({ kind, params, label = 'Export', primary, print }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const toast = useToast();
  useEffect(() => {
    const h = (e) => ref.current && !ref.current.contains(e.target) && setOpen(false);
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);
  const go = async (format) => {
    setOpen(false);
    const ok = await api.download('admin/export', { kind, format, ...(params || {}) }, `${kind}-${new Date().toISOString().slice(0, 10)}.${format}`);
    if (!ok) toast.err('Export failed');
  };
  return (
    <span ref={ref} style={{ position: 'relative' }}>
      <button type="button" className={`e-btn${primary ? ' p' : ''}`} onClick={() => setOpen(!open)} aria-haspopup="menu" aria-expanded={open}>
        <Ic n="download" s={15} /> {label} ▾
      </button>
      {open && (
        <div role="menu" className="e-card" style={{ position: 'absolute', right: 0, top: 40, zIndex: 50, padding: 6, minWidth: 170, boxShadow: '0 10px 30px rgba(15,23,42,.12)' }}>
          <button type="button" role="menuitem" className="e-btn ghost" style={{ width: '100%', justifyContent: 'flex-start' }} onClick={() => go('xlsx')}>
            Excel (.xlsx)
          </button>
          <button type="button" role="menuitem" className="e-btn ghost" style={{ width: '100%', justifyContent: 'flex-start' }} onClick={() => go('csv')}>
            CSV
          </button>
          {print && (
            <button
              type="button"
              role="menuitem"
              className="e-btn ghost"
              style={{ width: '100%', justifyContent: 'flex-start' }}
              onClick={() => {
                setOpen(false);
                window.print();
              }}
            >
              Print
            </button>
          )}
        </div>
      )}
    </span>
  );
}
