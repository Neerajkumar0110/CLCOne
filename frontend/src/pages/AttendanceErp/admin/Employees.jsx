import React, { useRef, useState } from 'react';
import axios from 'axios';
import { API_BASE_URL } from '@/config/serverApiConfig';
import storePersist from '@/redux/storePersist';
import api from '../api';
import { B, Drawer, Empty, ErrorState, Ic, ModalHead, Name, Search, Select, Skeleton, Trunc, dateLabel, useLoad, usePager, useToast } from '../ui';

// A8 · Employees — the CRM user accounts themselves (no second employee
// list). Add employee creates the CRM login through /api/admin/create.
const ROLES = ['Admin', 'Sales Manager', 'Team Manager', 'Senior Executive', 'Executive', 'Support', 'Team Leader', 'Assistant Team Leader', 'Sales Intern', 'Finance'];
const createUser = async (body) => {
  const token = storePersist.get('auth')?.current?.token;
  try {
    const r = await axios.post(`${API_BASE_URL}admin/create`, body, { headers: { Authorization: `Bearer ${token}` } });
    return r.data;
  } catch (e) {
    return { success: false, message: e?.response?.data?.message || e.message };
  }
};

export default function Employees({ globalQ }) {
  const toast = useToast();
  const [q, setQ] = useState(globalQ || '');
  const [dept, setDept] = useState('All');
  const [role, setRole] = useState('All');
  const [status, setStatus] = useState('Active');
  const [edit, setEdit] = useState(null); // employee or { _new: true }
  const fileRef = useRef(null);
  const { data, loading, error, reload } = useLoad(() => api.get('admin/employees', { q, dept, role, status }), [q, dept, role, status]);
  const list = (data && data.list) || [];
  const pg = usePager(list, 12);
  const importCsv = async (file) => {
    const text = await file.text();
    const [head, ...lines] = text.split(/\r?\n/).filter((l) => l.trim());
    const cols = head.split(',').map((c) => c.trim().toLowerCase());
    let ok = 0;
    let fail = 0;
    for (const line of lines) {
      const v = line.split(',').map((c) => c.trim());
      const g = (k) => v[cols.indexOf(k)] || '';
      const r = await createUser({ name: g('name').split(' ')[0], surname: g('name').split(' ').slice(1).join(' '), email: g('email'), phone: g('phone'), role: ROLES.includes(g('role')) ? g('role') : 'Executive' });
      if (r.success && r.result) {
        ok += 1;
        await api.put(`admin/employees/${r.result._id}`, { employeeCode: g('code'), department: g('department'), designation: g('designation'), joiningDate: g('joining') || undefined });
      } else fail += 1;
    }
    toast[fail ? 'info' : 'ok'](`Imported ${ok} employee${ok === 1 ? '' : 's'}`, fail ? `${fail} row(s) failed (email already used or missing phone).` : 'Each one got a CRM login.');
    reload(true);
  };
  return (
    <div className="e-page">
      <div className="e-head">
        <div>
          <h1 className="e-h1">Employees</h1>
          <p className="e-sub">These are the CRM user accounts. Adding one here creates the CRM login too. There is no second employee list.</p>
        </div>
        <div className="e-row">
          <button type="button" className="e-btn" onClick={() => fileRef.current && fileRef.current.click()} title="CSV columns: name,email,phone,role,department,designation,code,joining">
            Import CSV
          </button>
          <input ref={fileRef} type="file" accept=".csv" hidden onChange={(e) => e.target.files[0] && importCsv(e.target.files[0])} />
          <button type="button" className="e-btn p" onClick={() => setEdit({ _new: true })}>
            + Add employee
          </button>
        </div>
      </div>
      <div className="e-row">
        <Search value={q} onChange={setQ} placeholder="Search name, email, code" />
        <Select label="Department" value={dept} onChange={setDept} options={['All', ...((data && data.departments) || [])]} />
        <Select label="Role" value={role} onChange={setRole} options={['All', ...ROLES]} />
        <Select label="Status" value={status} onChange={setStatus} options={['Active', 'Disabled', 'All']} />
        <button
          type="button"
          className="e-btn ghost"
          onClick={() => {
            setQ('');
            setDept('All');
            setRole('All');
            setStatus('Active');
          }}
        >
          Reset
        </button>
      </div>
      <section className="e-card">
        {loading && !data ? (
          <Skeleton rows={8} />
        ) : error && !data ? (
          <ErrorState onRetry={() => reload()} />
        ) : list.length === 0 ? (
          <Empty title="No employees match" text="Change or reset the filters." icon="users" />
        ) : (
          <>
            <div className="e-tw e-hide-m">
              <table className="e-tbl" style={{ minWidth: 880 }}>
                <colgroup>
                  <col style={{ width: '28%' }} />
                  <col style={{ width: '11%' }} />
                  <col style={{ width: '14%' }} />
                  <col style={{ width: '17%' }} />
                  <col style={{ width: '13%' }} />
                  <col style={{ width: '11%' }} />
                  <col style={{ width: 70 }} />
                </colgroup>
                <thead>
                  <tr>
                    <th>Employee</th>
                    <th>Code</th>
                    <th>Department</th>
                    <th>Designation</th>
                    <th>Joined</th>
                    <th>Status</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {pg.rows.map((e) => (
                    <tr key={e._id} style={edit && edit._id === e._id ? { background: 'rgba(79,70,229,.05)' } : !e.enabled ? { opacity: 0.6 } : undefined}>
                      <td>
                        <Name name={e.name} sub={e.email} photo={e.photo} />
                      </td>
                      <td>{e.employeeCode || '—'}</td>
                      <td>{e.department || '—'}</td>
                      <td>
                        <Trunc text={e.designation || e.role} />
                      </td>
                      <td>{e.joiningDate ? dateLabel(e.joiningDate) : '—'}</td>
                      <td>
                        <B>{e.enabled ? 'Active' : 'Disabled'}</B>
                        {e.tracked === false && (
                          <B kind="o" sm style={{ marginLeft: 4 }}>
                            Not tracked
                          </B>
                        )}
                        {e.erpRole === 'hr_admin' && (
                          <B kind="bl" sm style={{ marginLeft: 4 }}>
                            HR Admin
                          </B>
                        )}
                      </td>
                      <td>
                        <button type="button" className="e-btn sm" onClick={() => setEdit(e)} aria-label={`Edit ${e.name}`}>
                          Edit
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="e-mcards">
              {pg.rows.map((e) => (
                <div key={e._id} className="e-mcard" onClick={() => setEdit(e)}>
                  <div className="e-row" style={{ flexWrap: 'nowrap' }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <Name name={e.name} sub={[e.employeeCode, e.department, e.designation].filter(Boolean).join(' · ')} />
                    </div>
                    <B>{e.enabled ? 'Active' : 'Disabled'}</B>
                  </div>
                </div>
              ))}
            </div>
            <div className="e-foot">
              <span>
                {data.counts.active} active · {data.counts.disabled} disabled
              </span>
              <pg.Pager />
            </div>
          </>
        )}
      </section>
      <EmployeeDrawer
        emp={edit}
        meta={data}
        onClose={() => setEdit(null)}
        onSaved={() => {
          setEdit(null);
          reload(true);
        }}
        createUser={createUser}
      />
    </div>
  );
}

function EmployeeDrawer({ emp, meta, onClose, onSaved, createUser: create }) {
  const toast = useToast();
  const [f, setF] = useState({});
  const [busy, setBusy] = useState(false);
  React.useEffect(() => {
    if (!emp) return;
    if (emp._new) setF({ name: '', email: '', phone: '', role: 'Executive', employeeCode: '', department: '', designation: '', joiningDate: new Date().toLocaleDateString('en-CA'), shiftName: 'General', reportsTo: '', erpRole: 'employee', tracked: true, enabled: true, leaveAdjust: {}, reason: '' });
    else
      setF({
        name: emp.name,
        employeeCode: emp.employeeCode,
        department: emp.department,
        designation: emp.designation,
        joiningDate: emp.joiningDate ? new Date(emp.joiningDate).toLocaleDateString('en-CA') : '',
        shiftName: emp.shiftName || 'General',
        reportsTo: emp.reportsTo || '',
        erpRole: emp.erpRole || 'employee',
        tracked: emp.tracked !== false,
        enabled: emp.enabled,
        leaveAdjust: emp.leaveAdjust || {},
        reason: '',
      });
  }, [emp]);
  if (!emp) return null;
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const save = async () => {
    setBusy(true);
    let id = emp._id;
    if (emp._new) {
      const parts = String(f.name).trim().split(/\s+/);
      const r = await create({ name: parts.shift(), surname: parts.join(' '), email: f.email, phone: f.phone, role: f.role, reportsTo: f.reportsTo || undefined });
      if (!r.success) {
        setBusy(false);
        return toast.err(r.message || 'Could not create the account');
      }
      id = r.result && r.result._id;
    }
    const body = { ...f };
    delete body.email;
    delete body.phone;
    delete body.role;
    if (emp._new) {
      delete body.name;
      delete body.enabled;
      delete body.leaveAdjust;
    }
    const r2 = await api.put(`admin/employees/${id}`, body);
    setBusy(false);
    toast.res(r2, emp._new ? 'Employee added — CRM login created' : 'Employee saved');
    if (r2.success) onSaved();
  };
  const bal = emp.balance || [];
  return (
    <Drawer open={!!emp} onClose={onClose} label={emp._new ? 'Add employee' : 'Edit employee'}>
      <ModalHead title={emp._new ? 'Add employee' : 'Edit employee'} sub={emp._new ? 'Creates the CRM login and sends the welcome email.' : emp.email} onClose={onClose} />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,minmax(0,1fr))', gap: 12 }}>
        <label style={{ gridColumn: 'span 2' }}>
          <span className="e-lbl">Full name</span>
          <input className="e-fld" value={f.name || ''} onChange={set('name')} />
        </label>
        {emp._new && (
          <>
            <label style={{ gridColumn: 'span 2' }}>
              <span className="e-lbl">Work email</span>
              <input className="e-fld" type="email" value={f.email || ''} onChange={set('email')} />
            </label>
            <label>
              <span className="e-lbl">Phone</span>
              <input className="e-fld" value={f.phone || ''} onChange={set('phone')} />
            </label>
            <label>
              <span className="e-lbl">CRM role</span>
              <select className="e-fld" value={f.role} onChange={set('role')}>
                {ROLES.map((r) => (
                  <option key={r}>{r}</option>
                ))}
              </select>
            </label>
          </>
        )}
        <label>
          <span className="e-lbl">Employee code</span>
          <input className="e-fld" value={f.employeeCode || ''} onChange={set('employeeCode')} placeholder="CLC-031" />
        </label>
        <label>
          <span className="e-lbl">Joining date</span>
          <input className="e-fld" type="date" value={f.joiningDate || ''} onChange={set('joiningDate')} />
        </label>
        <label>
          <span className="e-lbl">Department</span>
          <select className="e-fld" value={f.department || ''} onChange={set('department')}>
            <option value="">—</option>
            {((meta && meta.departments) || []).map((d) => (
              <option key={d}>{d}</option>
            ))}
          </select>
        </label>
        <label>
          <span className="e-lbl">Designation</span>
          <input className="e-fld" value={f.designation || ''} onChange={set('designation')} />
        </label>
        <label>
          <span className="e-lbl">Shift</span>
          <select className="e-fld" value={f.shiftName || 'General'} onChange={set('shiftName')}>
            <option>General</option>
          </select>
        </label>
        <label>
          <span className="e-lbl">Reports to</span>
          <select className="e-fld" value={f.reportsTo || ''} onChange={set('reportsTo')}>
            <option value="">—</option>
            {((meta && meta.managers) || []).map((m) => (
              <option key={m._id} value={m._id}>
                {m.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="e-lbl">ERP role</span>
          <select className="e-fld" value={f.erpRole || 'employee'} onChange={set('erpRole')}>
            <option value="employee">Employee (portal only)</option>
            <option value="hr_admin">HR Admin</option>
          </select>
        </label>
        <label>
          <span className="e-lbl">Track attendance</span>
          <select className="e-fld" value={f.tracked === false ? 'Off' : 'On'} onChange={(e) => setF({ ...f, tracked: e.target.value === 'On' })}>
            <option>On</option>
            <option>Off</option>
          </select>
        </label>
        {!emp._new && (
          <label>
            <span className="e-lbl">Status</span>
            <select className="e-fld" value={f.enabled ? 'Active' : 'Disabled'} onChange={(e) => setF({ ...f, enabled: e.target.value === 'Active' })}>
              <option>Active</option>
              <option>Disabled</option>
            </select>
          </label>
        )}
      </div>
      {!emp._new && (
        <div className="e-note info">
          <b>Leave balance this year:</b> {bal.map((b) => `${b.type} ${b.left} / ${b.total}`).join(' · ')}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(90px,1fr))', gap: 8, marginTop: 10 }}>
            {bal.map((b) => (
              <label key={b.type}>
                <span className="e-lbl">{b.type} ±</span>
                <input className="e-fld" type="number" value={(f.leaveAdjust || {})[b.type] || ''} onChange={(e) => setF({ ...f, leaveAdjust: { ...(f.leaveAdjust || {}), [b.type]: e.target.value } })} placeholder="0" />
              </label>
            ))}
          </div>
          <div style={{ marginTop: 8 }}>Changing status, ERP role or balance asks for a reason and writes an audit row.</div>
        </div>
      )}
      {!emp._new && (
        <label>
          <span className="e-lbl">Reason (needed for status / role / balance)</span>
          <input className="e-fld" value={f.reason || ''} onChange={set('reason')} placeholder="e.g. Carry-forward correction" />
        </label>
      )}
      <div className="e-row" style={{ justifyContent: 'flex-end', marginTop: 'auto' }}>
        <button type="button" className="e-btn" onClick={onClose}>
          Cancel
        </button>
        <button type="button" className="e-btn p" disabled={busy || !f.name || (emp._new && (!f.email || !f.phone))} onClick={save}>
          <Ic n="check" s={14} /> {emp._new ? 'Add employee' : 'Save changes'}
        </button>
      </div>
    </Drawer>
  );
}
