import React, { useEffect, useState } from 'react';
import { Modal, Button, Tooltip } from 'antd';
import {
  KeyOutlined, CheckOutlined, UserOutlined, SafetyOutlined, HistoryOutlined, EyeOutlined, EditOutlined, ExportOutlined,
  TeamOutlined, SendOutlined, CheckCircleOutlined, LockOutlined, AlertOutlined, ExperimentOutlined,
} from '@ant-design/icons';
import lmsApi from '../api';
import { useLoad, act, Loading, fmtDate } from './shared';
import './mgmt.css';
import './opsPages.css';

// Design A4 · LMS Admin — roles & permissions. Counts and users are the real
// accounts per role; matrix edits are a draft until a different manager
// approves them (every step audit-logged).
// 2026-11-27 redesign: gradient hero, role cards, toggle matrix with column
// icons, users / backup admins / history in side cards, "test as" modal.
const COLS = ['View', 'Edit', 'Export', '2nd approval'];
const COL_IC = [EyeOutlined, EditOutlined, ExportOutlined, SafetyOutlined];

export default function Roles() {
  const [role, setRole] = useState('Support Manager');
  const { data, loading, err, reload } = useLoad(() => lmsApi.opsRoles(role), [role]);
  const [m, setM] = useState(null);
  const [n, setN] = useState(0);
  const [preview, setPreview] = useState(false);
  const [history, setHistory] = useState(false);
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
  const granted = m ? Object.values(m).reduce((s, v) => s + v.filter(Boolean).length, 0) : 0;

  return (
    <div className="mg op">
      <div className="mg-hero rl-hero">
        <div className="mg-hero-l">
          <span className="mg-hero-ic"><KeyOutlined /></span>
          <div style={{ minWidth: 0 }}>
            <span className="mg-kicker">LMS Admin only</span>
            <h1>Roles &amp; permissions</h1>
            <p>Every grant is a draft until another manager approves it, and every step is logged. Nobody can make themselves Super Admin.</p>
          </div>
        </div>
        {data && <div className="rp-hero-stats"><span><b>{data.roles.length}</b><small>roles</small></span><span><b>{data.users.length}</b><small>users in {role}</small></span><span><b>{granted}</b><small>rights granted</small></span></div>}
      </div>

      <Loading loading={loading} err={err} data={data}>
        {data && m && (
          <div className="rl-grid">
            <section className="mg-card rl-roles">
              <div className="mg-hd"><span className="mg-hd-ic g1"><TeamOutlined /></span><div><b>Roles</b><small>Pick one to edit</small></div></div>
              <div className="mg-card-body" style={{ gap: 6 }}>
                {data.roles.map((r) => (
                  <Tooltip key={r.key} placement="right" title={r.crmRoles.length ? `CRM role: ${r.crmRoles.join(', ')}` : 'No CRM role mapped yet'}>
                    <button type="button" className={`rl-role${r.key === role ? ' on' : ''}`} onClick={() => setRole(r.key)}>
                      <span className="rl-role-ic">{r.key.split(' ').map((w) => w[0]).join('').slice(0, 2)}</span>
                      <span className="rl-role-n">{r.key}</span>
                      <span className="rl-role-c">{r.crmRoles.length ? r.count : '—'}</span>
                    </button>
                  </Tooltip>
                ))}
              </div>
            </section>

            <section className="mg-card rl-matrix">
              <div className="mg-hd">
                <span className="mg-hd-ic g2"><KeyOutlined /></span>
                <div><b>{role} · permissions</b><small>{data.draft ? `Draft by ${data.draftByName} · waiting for approval` : 'Click a box to toggle · stays a draft until approved'}</small></div>
                {data.draft && <span className="mg-pill mid">Draft pending</span>}
              </div>
              <div className="mg-card-body" style={{ padding: 0, gap: 0 }}>
                <div className="rl-tr rl-th"><span>Module</span>{COLS.map((c, i) => { const Ic = COL_IC[i]; return <span key={c}><Ic /> {c}</span>; })}</div>
                {data.modules.map((mod) => (
                  <div className="rl-tr" key={mod}>
                    <span className="rl-mod">{mod}</span>
                    {COLS.map((c, i) => (
                      <span key={c}>
                        <button type="button" className={`rl-ck${m[mod][i] ? ' on' : ''}${i === 3 ? ' second' : ''}`} aria-label={`${mod} ${c}`} aria-pressed={!!m[mod][i]} onClick={() => toggle(mod, i)}>{m[mod][i] ? <CheckOutlined /> : null}</button>
                      </span>
                    ))}
                  </div>
                ))}
              </div>
              <div className="mg-foot rl-foot">
                <span className={n ? 'rl-unsaved' : ''}>{n ? `${n} unsaved change(s) · needs Management approval` : data.approvedByName ? `Last approved by ${data.approvedByName} · ${fmtDate(data.approvedAt)}` : 'No changes'}</span>
                <span className="op-chips">
                  <Button icon={<ExperimentOutlined />} onClick={() => setPreview(true)}>Test as {role}</Button>
                  {data.draft && data.canApprove && !n ? (
                    <Button type="primary" icon={<CheckCircleOutlined />} onClick={approve}>Approve change</Button>
                  ) : (
                    <Button type="primary" icon={<SendOutlined />} disabled={!n} onClick={submit}>Submit for approval</Button>
                  )}
                </span>
              </div>
            </section>

            <div className="rl-side">
              <section className="mg-card">
                <div className="mg-hd"><span className="mg-hd-ic g3"><UserOutlined /></span><div><b>Users with this role</b><small>{data.users.length} account(s)</small></div></div>
                <div className="mg-card-body" style={{ padding: 0, gap: 0, maxHeight: 220 }}>
                  {data.users.length === 0 && <div className="mg-empty">No account has this role yet.</div>}
                  {data.users.map((u) => (
                    <div className="rl-user" key={u.id}>
                      <span className="mg-actor"><i>{String(u.name || '?')[0]}</i></span>
                      <span className="rl-user-t"><b>{u.name}</b><small>{u.email}</small></span>
                      <span className={`mg-pill ${u.enabled ? 'ok' : 'none'}`}>{u.enabled ? 'Active' : 'Disabled'}</span>
                    </div>
                  ))}
                </div>
              </section>
              <section className="mg-card">
                <div className="mg-hd"><span className="mg-hd-ic g6"><SafetyOutlined /></span><div><b>Backup admin &amp; safety</b><small>Who can recover access</small></div></div>
                <div className="mg-card-body" style={{ gap: 8 }}>
                  {data.backupAdmins.map((b) => (
                    <div className="rl-safe" key={b.name}><LockOutlined /><span>{b.name} <small>({b.role})</small></span><span className={`mg-pill ${b.enabled ? 'ok' : 'bad'}`}>{b.enabled ? 'OK' : 'Disabled'}</span></div>
                  ))}
                  <div className="rl-safe"><AlertOutlined /><span>Incident mode</span><small>{data.incidentModeTestedAt ? `last used ${fmtDate(data.incidentModeTestedAt)}` : 'never used'}</small></div>
                  <button type="button" className="rl-hist-btn" onClick={() => setHistory(true)}><HistoryOutlined /> Recent role changes ({data.recentChanges.length})</button>
                </div>
                <div className="mg-foot">Secrets (API keys, DB, OAuth, payment) are never shown in any role&apos;s UI.</div>
              </section>
            </div>
          </div>
        )}
      </Loading>

      <Modal open={preview} onCancel={() => setPreview(false)} footer={null} width={560} centered destroyOnClose rootClassName="mg-modal">
        {m && (
          <div className="mg-m">
            <div className="mg-m-head rl-m-head"><span className="mg-act">Test as</span><h3>What {role} can do</h3><span>{granted} right(s) across {Object.values(m).filter((v) => v.some(Boolean)).length} module(s){n ? ' · includes unsaved changes' : ''}</span></div>
            <div className="mg-m-body">
              {Object.values(m).every((v) => !v.some(Boolean)) ? <div className="mg-empty">Nothing — no LMS admin access.</div> : Object.entries(m).filter(([, v]) => v.some(Boolean)).map(([mod, v]) => (
                <div className="rl-can" key={mod}><b>{mod}</b><span className="op-chips">{COLS.map((c, i) => (v[i] ? <span key={c} className={`mg-pill ${i === 3 ? 'mid' : 'ok'}`}>{c}</span> : null))}</span></div>
              ))}
            </div>
            <div className="mg-m-foot"><Button type="primary" onClick={() => setPreview(false)}>Close</Button></div>
          </div>
        )}
      </Modal>

      <Modal open={history} onCancel={() => setHistory(false)} footer={null} width={620} centered destroyOnClose rootClassName="mg-modal">
        {data && (
          <div className="mg-m">
            <div className="mg-m-head rl-m-head"><span className="mg-act">Audit</span><h3>Recent role changes</h3><span>Every grant and role change is logged</span></div>
            <div className="mg-m-body">
              {data.recentChanges.length === 0 ? <div className="mg-empty">None yet.</div> : data.recentChanges.map((c, i) => (
                <div className="rl-chg" key={i}><span className="rl-chg-d">{fmtDate(c.at)}</span><span className="rl-chg-t"><b>{c.text}</b><small>by {c.by}{c.reason ? ` · ${c.reason}` : ''}</small></span></div>
              ))}
            </div>
            <div className="mg-m-foot"><Button type="primary" onClick={() => setHistory(false)}>Close</Button></div>
          </div>
        )}
      </Modal>
    </div>
  );
}
