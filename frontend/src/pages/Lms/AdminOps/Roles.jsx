import React, { useEffect, useState } from 'react';
import { Modal } from 'antd';
import lmsApi from '../api';
import { useLoad, act, Head, Loading, fmtDate } from './shared';

// Design A4 · LMS Admin — roles & permissions. Counts and users are the real
// accounts per role; matrix edits are a draft until a different manager
// approves them (every step audit-logged).
const COLS = ['View', 'Edit', 'Export', '2nd approval'];

export default function Roles() {
  const [role, setRole] = useState('Support Manager');
  const { data, loading, err, reload } = useLoad(() => lmsApi.opsRoles(role), [role]);
  const [m, setM] = useState(null);
  const [n, setN] = useState(0);
  const [preview, setPreview] = useState(false);
  useEffect(() => {
    if (data) {
      setM(data.draft || data.approved);
      setN(0);
    }
  }, [data]);

  const toggle = (mod, i) => {
    const nx = m[mod].slice();
    nx[i] = nx[i] ? 0 : 1;
    setM({ ...m, [mod]: nx });
    setN(n + 1);
  };
  const submit = async () => {
    if (await act(lmsApi.opsRoleDraft(role, m), 'Sent to Management for approval')) reload();
  };
  const approve = async () => {
    if (await act(lmsApi.opsRoleApprove(role), 'Approved')) reload();
  };

  return (
    <>
      <Head title="Roles & permissions" sub="LMS Admin only · every grant approved + logged · nobody can make themselves Super Admin" />
      <Loading loading={loading} err={err} data={data}>
        {data && m && (
          <div className="ao-grid-2" style={{ gridTemplateColumns: '240px minmax(0, 1fr) 320px' }}>
            <div className="ao-card" style={{ gap: 6 }}>
              <b style={{ fontSize: 14 }}>Roles</b>
              {data.roles.map((r) => (
                <button key={r.key} type="button" className={`ao-r${r.key === role ? ' on' : ''}`} onClick={() => setRole(r.key)} title={r.crmRoles.length ? `CRM role: ${r.crmRoles.join(', ')}` : 'No CRM role mapped yet'}>
                  <span>{r.key === role ? <b>{r.key}</b> : r.key}</span><span className="ao-muted">{r.crmRoles.length ? r.count : '—'}</span>
                </button>
              ))}
            </div>

            <div className="ao-card">
              <div className="ao-hd"><b>{role} · permissions</b><span className="ao-muted" style={{ fontSize: 12 }}>{data.draft ? `draft by ${data.draftByName} · waiting for approval` : 'click to toggle · draft until approved'}</span></div>
              <div className="ao-tablewrap">
                <table className="ao-table center">
                  <thead><tr><th>Module</th>{COLS.map((c) => <th key={c}>{c}</th>)}</tr></thead>
                  <tbody>
                    {data.modules.map((mod) => (
                      <tr key={mod}>
                        <td>{mod}</td>
                        {COLS.map((c, i) => (
                          <td key={c}><button type="button" className={`ao-ck${m[mod][i] ? ' on' : ''}`} aria-label={`${mod} ${c}`} aria-pressed={!!m[mod][i]} onClick={() => toggle(mod, i)}>{m[mod][i] ? '✓' : ''}</button></td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="ao-hd" style={{ marginTop: 'auto', flexWrap: 'wrap' }}>
                <span className="ao-muted" style={{ fontSize: 12 }}>{n ? `${n} unsaved change(s) · needs Management approval` : data.approvedByName ? `Last approved by ${data.approvedByName} · ${fmtDate(data.approvedAt)}` : 'No changes'}</span>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button type="button" className="ao-btn2" onClick={() => setPreview(true)}>Test as {role}</button>
                  {data.draft && data.canApprove && !n ? (
                    <button type="button" className="ao-btn" onClick={approve}>Approve change</button>
                  ) : (
                    <button type="button" className="ao-btn" disabled={!n} onClick={submit}>Submit for approval</button>
                  )}
                </div>
              </div>
            </div>

            <div className="ao-card">
              <div className="ao-hd"><b>Users with this role</b></div>
              {data.users.length === 0 && <div className="ao-muted" style={{ fontSize: 13 }}>No account has this role yet.</div>}
              <div style={{ maxHeight: 180, overflowY: 'auto' }}>
                {data.users.map((u) => (
                  <div className="ao-li" key={u.id}><span><b>{u.name}</b><br /><span className="ao-muted">{u.email}</span></span><span className={`ao-chip ${u.enabled ? 'hai' : 'gray'}`}>{u.enabled ? 'Active' : 'Disabled'}</span></div>
                ))}
              </div>
              <div className="ao-hd" style={{ marginTop: 6 }}><b>Backup admin</b></div>
              {data.backupAdmins.map((b) => (
                <div className="ao-li" key={b.name}><span>{b.name} ({b.role})</span><span className={`ao-chip ${b.enabled ? 'hai' : 'red'}`}>{b.enabled ? 'OK' : 'Disabled'}</span></div>
              ))}
              <div className="ao-li"><span>Incident mode</span><span className="ao-muted">{data.incidentModeTestedAt ? `last used ${fmtDate(data.incidentModeTestedAt)}` : 'never used'}</span></div>
              <div className="ao-hd" style={{ marginTop: 6 }}><b>Recent role changes</b></div>
              <div style={{ fontSize: 12, lineHeight: '18px' }} className="ao-muted">
                {data.recentChanges.length === 0 ? 'None yet.' : data.recentChanges.map((c, i) => <div key={i}>{fmtDate(c.at)} · {c.text} · by {c.by}{c.reason ? ` · ${c.reason}` : ''}</div>)}
              </div>
              <div className="ao-soft" style={{ fontSize: 12, lineHeight: '18px', marginTop: 'auto' }}>Secrets (API keys, DB, OAuth, payment) are never shown in any role's UI.</div>
            </div>
          </div>
        )}
      </Loading>
      <Modal open={preview} title={`What ${role} can do`} footer={null} onCancel={() => setPreview(false)}>
        {m && (
          <ul style={{ paddingLeft: 18, margin: 0 }}>
            {Object.entries(m).filter(([, v]) => v.some(Boolean)).map(([mod, v]) => (
              <li key={mod}>{mod}: {COLS.filter((_, i) => v[i]).join(', ')}</li>
            ))}
            {Object.values(m).every((v) => !v.some(Boolean)) && <li>Nothing — no LMS admin access.</li>}
          </ul>
        )}
      </Modal>
    </>
  );
}
