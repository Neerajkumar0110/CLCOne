import React, { useState } from 'react';
import api from '../api';
import { B, Bar, Card, DateInp, Empty, ErrorState, Modal, ModalHead, Name, Search, Select, Skeleton, StatusBadges, clock, hm, todayKey, useErpLive, useLoad, usePager, useToast, workColor } from '../ui';
import { ExportMenu, deptOptions, empOptions, useLite, SalesLine } from './shared';

// A3 · Attendance (daily)
const STATUSES = ['All', 'Present', 'Online', 'Inactive', 'Late', 'Short', 'Half Day', 'Leave', 'Absent', 'Needs review', 'Early Logout', 'Not logged in'];
const SUM = [
  ['Present', 'g'],
  ['Late', 'a'],
  ['Short', 'r'],
  ['Half Day', 'v'],
  ['Leave', 'bl'],
  ['Absent', 'r'],
  ['Needs review', 'r'],
];

export function ManualModal({ open, onClose, onDone, preset }) {
  const lite = useLite();
  const toast = useToast();
  const [f, setF] = useState({ adminId: '', date: todayKey(), login: '10:00', logout: '20:30', lunch: '13:00-14:00', reason: '' });
  const [busy, setBusy] = useState(false);
  React.useEffect(() => {
    if (open) setF((x) => ({ ...x, adminId: (preset && preset.adminId) || x.adminId || '', date: (preset && preset.date) || x.date }));
  }, [open, preset]);
  const save = async () => {
    setBusy(true);
    const r = await api.post('admin/attendance/manual', f);
    setBusy(false);
    toast.res(r, 'Manual attendance added');
    if (r.success) {
      onClose();
      onDone && onDone();
    }
  };
  return (
    <Modal open={open} onClose={onClose} label="Manual attendance">
      <ModalHead title="Add manual attendance" sub="For a day with no attendance (client visit, power cut…). The reason goes into the audit log." onClose={onClose} />
      <div className="e-fgrid">
        <label style={{ gridColumn: '1 / -1' }}>
          <span className="e-lbl">Employee</span>
          <select className="e-fld" value={f.adminId} onChange={(e) => setF({ ...f, adminId: e.target.value })}>
            <option value="">Pick an employee</option>
            {lite.list.map((e) => (
              <option key={e._id} value={e._id}>
                {e.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="e-lbl">Date</span>
          <input className="e-fld" type="date" value={f.date} max={todayKey()} onChange={(e) => setF({ ...f, date: e.target.value })} />
        </label>
        <label>
          <span className="e-lbl">Login</span>
          <input className="e-fld" type="time" value={f.login} onChange={(e) => setF({ ...f, login: e.target.value })} />
        </label>
        <label>
          <span className="e-lbl">Logout</span>
          <input className="e-fld" type="time" value={f.logout} onChange={(e) => setF({ ...f, logout: e.target.value })} />
        </label>
        <label>
          <span className="e-lbl">Lunch (HH:MM-HH:MM)</span>
          <input className="e-fld" value={f.lunch} onChange={(e) => setF({ ...f, lunch: e.target.value })} />
        </label>
        <label style={{ gridColumn: '1 / -1' }}>
          <span className="e-lbl">Reason (required)</span>
          <textarea className="e-fld" value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} placeholder="e.g. Was at a client visit, no laptop" />
        </label>
      </div>
      <div className="e-row" style={{ justifyContent: 'flex-end', marginTop: 16 }}>
        <button type="button" className="e-btn" onClick={onClose}>
          Cancel
        </button>
        <button type="button" className="e-btn p" disabled={busy || !f.adminId || !f.reason.trim()} onClick={save}>
          Add attendance
        </button>
      </div>
    </Modal>
  );
}

export function MarkLeaveModal({ open, onClose, onDone, preset }) {
  const lite = useLite();
  const toast = useToast();
  const [f, setF] = useState({ adminId: '', from: todayKey(), to: todayKey(), leaveType: 'Casual', dayType: 'full', reason: '' });
  const [busy, setBusy] = useState(false);
  React.useEffect(() => {
    if (open && preset) setF((x) => ({ ...x, adminId: preset.adminId || x.adminId, from: preset.date || x.from, to: preset.date || x.to }));
  }, [open, preset]);
  const save = async () => {
    setBusy(true);
    const r = await api.post('admin/attendance/mark-leave', f);
    setBusy(false);
    toast.res(r, 'Leave marked');
    if (r.success) {
      onClose();
      onDone && onDone();
    }
  };
  return (
    <Modal open={open} onClose={onClose} label="Mark leave">
      <ModalHead title="Mark leave for an employee" sub="Saved as an approved leave and added to the audit log. The employee is notified." onClose={onClose} />
      <div className="e-fgrid">
        <label style={{ gridColumn: '1 / -1' }}>
          <span className="e-lbl">Employee</span>
          <select className="e-fld" value={f.adminId} onChange={(e) => setF({ ...f, adminId: e.target.value })}>
            <option value="">Pick an employee</option>
            {lite.list.map((e) => (
              <option key={e._id} value={e._id}>
                {e.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="e-lbl">Leave type</span>
          <select className="e-fld" value={f.leaveType} onChange={(e) => setF({ ...f, leaveType: e.target.value })}>
            {lite.leaveTypes.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
        </label>
        <label>
          <span className="e-lbl">From</span>
          <input className="e-fld" type="date" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value, to: e.target.value > f.to ? e.target.value : f.to })} />
        </label>
        <label>
          <span className="e-lbl">To</span>
          <input className="e-fld" type="date" value={f.to} min={f.from} onChange={(e) => setF({ ...f, to: e.target.value })} />
        </label>
        <label>
          <span className="e-lbl">Day type</span>
          <select className="e-fld" value={f.dayType} disabled={f.from !== f.to} onChange={(e) => setF({ ...f, dayType: e.target.value })}>
            <option value="full">Full day</option>
            <option value="first">First half</option>
            <option value="second">Second half</option>
          </select>
        </label>
        <label style={{ gridColumn: '1 / -1' }}>
          <span className="e-lbl">Reason (required)</span>
          <textarea className="e-fld" value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} placeholder="e.g. Called in sick before shift" />
        </label>
      </div>
      <div className="e-row" style={{ justifyContent: 'flex-end', marginTop: 16 }}>
        <button type="button" className="e-btn" onClick={onClose}>
          Cancel
        </button>
        <button type="button" className="e-btn p" disabled={busy || !f.adminId || !f.reason.trim()} onClick={save}>
          Mark leave
        </button>
      </div>
    </Modal>
  );
}

export default function Attendance({ openDetail, globalQ }) {
  const lite = useLite();
  const [q, setQ] = useState(globalQ || '');
  const [date, setDate] = useState(todayKey());
  const [employee, setEmployee] = useState('All');
  const [dept, setDept] = useState('All');
  const [status, setStatus] = useState('All');
  const [more, setMore] = useState(false);
  const [flags, setFlags] = useState({ late: false, early: false, missing: false, under8: false, manual: false });
  const [sel, setSel] = useState({});
  const [modal, setModal] = useState(null);
  const params = { date, employee, dept, status, q, ...Object.fromEntries(Object.entries(flags).filter(([, v]) => v).map(([k]) => [k, '1'])) };
  const { data, loading, error, reload } = useLoad(() => api.get('admin/attendance', params), [date, employee, dept, status, q, JSON.stringify(flags)], { poll: date === todayKey() ? 30000 : 0 });
  useErpLive(() => date === todayKey() && reload(true));
  const rows = (data && data.rows) || [];
  const pg = usePager(rows, 10);
  const reset = () => {
    setQ('');
    setDate(todayKey());
    setEmployee('All');
    setDept('All');
    setStatus('All');
    setFlags({ late: false, early: false, missing: false, under8: false, manual: false });
  };
  const allSel = pg.rows.length > 0 && pg.rows.every((r) => sel[r.employee._id]);
  const S = data && data.settings;
  return (
    <div className="e-page">
      <div className="e-head">
        <div>
          <h1 className="e-h1">Attendance</h1>
          <p className="e-sub">Status is worked out on its own from Settings rules. Every manual change asks for a reason and is saved in the audit log.</p>
        </div>
        <div className="e-row">
          <button type="button" className="e-btn" onClick={() => setModal('leave')}>
            Mark leave
          </button>
          <button type="button" className="e-btn" onClick={() => setModal('manual')}>
            + Manual attendance
          </button>
          <ExportMenu kind="daily" params={{ date }} primary />
        </div>
      </div>

      <section className="e-card e-filters">
        <div className="e-row">
          <Search value={q} onChange={setQ} placeholder="Search name, code, department" />
          <DateInp label="Date" value={date} onChange={(v) => setDate(v || todayKey())} />
          <Select label="Employee" value={employee} onChange={setEmployee} options={empOptions(lite)} style={{ maxWidth: 230 }} />
          <Select label="Department" value={dept} onChange={setDept} options={deptOptions(lite)} />
          <Select label="Status" value={status} onChange={setStatus} options={STATUSES} />
          <button type="button" className="e-btn" onClick={() => setMore(!more)} aria-expanded={more}>
            More filters {more ? '▴' : '▾'}
          </button>
          <button type="button" className="e-btn ghost" onClick={reset}>
            Reset
          </button>
        </div>
        {more && (
          <div className="e-more">
            {[
              ['late', 'Late login'],
              ['early', 'Early logout'],
              ['missing', 'Missing logout'],
              ['under8', `Under ${S ? Math.round(S.requiredMin / 60) : 8}h`],
              ['manual', 'Manually edited'],
            ].map(([k, l]) => (
              <label key={k}>
                <input type="checkbox" checked={flags[k]} onChange={(e) => setFlags({ ...flags, [k]: e.target.checked })} /> {l}
              </label>
            ))}
            <span style={{ flex: 1 }} />
            {S && (
              <span style={{ color: 'var(--e-mut)' }}>
                Shift:{' '}
                <b style={{ color: 'var(--e-ink)' }}>
                  General {S.workStart}–{S.workEnd}
                </b>
              </span>
            )}
          </div>
        )}
      </section>

      {data && (
        <div className="e-row" style={{ gap: 10 }}>
          {SUM.map(([k, c]) => (
            <button key={k} type="button" onClick={() => setStatus(status === k ? 'All' : k)} className="e-card" style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', borderRadius: 10, cursor: 'pointer', borderColor: status === k ? 'var(--e-pri)' : undefined, font: 'inherit', color: 'inherit' }}>
              <B kind={c}>{k}</B>
              <b style={{ fontSize: 16 }}>{data.summary[k] || 0}</b>
            </button>
          ))}
        </div>
      )}

      <section className="e-card">
        {loading && !data ? (
          <Skeleton rows={8} />
        ) : error && !data ? (
          <ErrorState onRetry={() => reload()} />
        ) : rows.length === 0 ? (
          <Empty title="No employees match" text="Change or reset the filters." icon="search" action={<button type="button" className="e-btn" onClick={reset}>Reset filters</button>} />
        ) : (
          <>
            <div className="e-tw e-hide-m">
              <table className="e-tbl" style={{ minWidth: 1060 }}>
                <colgroup>
                  <col style={{ width: 44 }} />
                  <col style={{ width: '23%' }} />
                  <col style={{ width: '7%' }} />
                  <col style={{ width: '9%' }} />
                  <col style={{ width: '8%' }} />
                  <col style={{ width: '8%' }} />
                  <col style={{ width: '7%' }} />
                  <col style={{ width: '17%' }} />
                  <col style={{ width: '13%' }} />
                  <col style={{ width: 80 }} />
                </colgroup>
                <thead>
                  <tr>
                    <th>
                      <input type="checkbox" aria-label="Select all" checked={allSel} onChange={(e) => setSel(Object.fromEntries(pg.rows.map((r) => [r.employee._id, e.target.checked])))} />
                    </th>
                    <th>Employee</th>
                    <th>Login</th>
                    <th>Logout</th>
                    <th>Active</th>
                    <th>Inactive</th>
                    <th>Lunch</th>
                    <th>Total work / {S ? Math.round(S.requiredMin / 60) : 8}h</th>
                    <th>Status</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {pg.rows.map((r) => {
                    const s = r.session;
                    const pct = Math.round((r.totals.work / r.required) * 100);
                    const lost = s && !s.logoutAt && s.status === 'needs_review';
                    return (
                      <tr key={r.employee._id}>
                        <td>
                          <input type="checkbox" aria-label="Select row" checked={!!sel[r.employee._id]} onChange={(e) => setSel({ ...sel, [r.employee._id]: e.target.checked })} />
                        </td>
                        <td>
                          <Name name={r.employee.name} sub={[r.employee.employeeCode, r.employee.department].filter(Boolean).join(' · ') || r.employee.role} photo={r.employee.photo} />
                          <SalesLine s={r.sales} />
                        </td>
                        <td style={r.tags.includes('Late') ? { color: '#B91C1C', fontWeight: 600 } : undefined}>{s ? clock(s.loginAt) : '—'}</td>
                        <td style={r.tags.includes('Early Logout') ? { color: '#B91C1C', fontWeight: 600 } : undefined}>{s ? (s.logoutAt ? clock(s.logoutAt) : lost ? `— lost ${clock(s.lastHeartbeatAt)}` : r.live === 'offline' ? `— lost ${clock(s.since)}` : r.live ? 'Online' : '—') : '—'}</td>
                        <td>{s ? hm(r.totals.active) : '—'}</td>
                        <td>{s ? hm(r.totals.inactive) : '—'}</td>
                        <td>{s ? hm(r.totals.lunch) : '—'}</td>
                        <td>
                          <div className="e-row" style={{ gap: 8, flexWrap: 'nowrap' }}>
                            <b style={{ color: 'var(--e-ink)', width: 62, flex: 'none' }}>{s ? hm(r.totals.work) : '—'}</b>
                            <Bar pct={pct} color={workColor(pct)} style={{ flex: 1 }} />
                          </div>
                        </td>
                        <td>
                          <StatusBadges status={r.status} tags={r.tags.filter((t) => t !== 'Late' || r.status !== 'Late')} />
                        </td>
                        <td>
                          <button type="button" className="e-btn sm" onClick={() => openDetail(r.employee._id, date)} aria-label={`Open timeline of ${r.employee.name}`}>
                            View
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="e-mcards">
              {pg.rows.map((r) => (
                <div key={r.employee._id} className="e-mcard" onClick={() => openDetail(r.employee._id, date)}>
                  <div className="e-row" style={{ flexWrap: 'nowrap' }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <Name name={r.employee.name} sub={`${r.employee.department || r.employee.role} · ${hm(r.totals.work)} / ${Math.round(r.required / 60)}h`} />
                      <SalesLine s={r.sales} />
                    </div>
                    <B>{r.status}</B>
                  </div>
                  {r.session && (
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,minmax(0,1fr))', gap: 8, marginTop: 10, fontSize: 11, color: 'var(--e-mut)' }}>
                      <div>
                        Login<b style={{ display: 'block', color: 'var(--e-ink)', fontSize: 13 }}>{clock(r.session.loginAt)}</b>
                      </div>
                      <div>
                        Logout<b style={{ display: 'block', color: 'var(--e-ink)', fontSize: 13 }}>{r.session.logoutAt ? clock(r.session.logoutAt) : 'Online'}</b>
                      </div>
                      <div>
                        Inactive<b style={{ display: 'block', color: 'var(--e-ink)', fontSize: 13 }}>{hm(r.totals.inactive)}</b>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
            <div className="e-foot">
              <span>
                Showing {pg.from}–{pg.to} of {rows.length}
                {S && ` · red login = late (after ${S.lateAfter}) · red logout = before ${S.workEnd}`}
              </span>
              <pg.Pager />
            </div>
          </>
        )}
      </section>
      <ManualModal open={modal === 'manual'} onClose={() => setModal(null)} onDone={() => reload(true)} />
      <MarkLeaveModal open={modal === 'leave'} onClose={() => setModal(null)} onDone={() => reload(true)} />
    </div>
  );
}
