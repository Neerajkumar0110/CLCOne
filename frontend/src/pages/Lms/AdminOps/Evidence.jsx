import React, { useState } from 'react';
import lmsApi from '../api';
import { useLoad, Loading, fmtDate, fmtTime } from './shared';

// Design A10 · Central evidence repository — one list over the records that
// already prove each decision (acceptances, corrections, attempts, uploads,
// tickets, emails, certificates, security signals).
export default function Evidence() {
  const [type, setType] = useState('All');
  const [sel, setSel] = useState(null);
  const { data, loading, err } = useLoad(() => lmsApi.opsEvidence(type), [type]);
  // spec §18 / §20: backup, restore drill, load test — written by deploy/vps scripts
  const ops = useLoad(() => lmsApi.smOpsStatus().catch(() => null), []);
  const rows = (data && data.rows) || [];
  const cur = rows.find((r) => r.id === sel) || rows[0];

  return (
    <>
      <div className="ao-head" style={{ alignItems: 'flex-end' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <h1>Central evidence repository</h1>
          <div className="ao-muted ao-sub">Spec §11.1 · proof of every decision in one place · version, source, access scope, retention class</div>
        </div>
      </div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {((data && data.types) || ['All']).map((t) => (
          <button key={t} type="button" className={`ao-pill${t === type ? ' on' : ''}`} onClick={() => { setType(t); setSel(null); }}>{t}</button>
        ))}
      </div>
      {ops.data && (
        <div className="ao-grid-2" style={{ gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 12 }}>
          {[['backup', 'Daily backup (all 7 DBs + uploads)'], ['restoreDrill', 'Restore drill (scratch DB)'], ['loadTest', 'Load test']].map(([k, label]) => {
            const v = ops.data[k];
            const stale = v && v.at && Date.now() - new Date(v.at) > (k === 'backup' ? 2 : k === 'restoreDrill' ? 8 : 35) * 86400000;
            return (
              <div className="ao-card" key={k} style={{ gap: 4 }}>
                <b>{label}</b>
                {v ? (
                  <>
                    <span className={`ao-chip ${v.ok && !stale ? 'hai' : 'red'}`} style={{ alignSelf: 'flex-start' }}>{v.ok ? (stale ? 'Stale' : 'OK') : 'Failed'}</span>
                    <span className="ao-muted" style={{ fontSize: 12 }}>{fmtDate(v.at)} {fmtTime(v.at)} · {v.summary || ''}</span>
                  </>
                ) : <span className="ao-muted" style={{ fontSize: 12 }}>No report yet — set up the cron jobs for the deploy/vps scripts</span>}
              </div>
            );
          })}
        </div>
      )}
      <Loading loading={loading} err={err} data={data}>
        <div className="ao-grid-2" style={{ gridTemplateColumns: 'minmax(0, 1fr) 340px', gap: 12 }}>
          <div className="ao-card">
            <div className="ao-tablewrap">
              <table className="ao-table">
                <thead><tr><th>Evidence ID</th><th>Type</th><th>Learner</th><th>Linked to</th><th>Ver</th><th>Source</th><th>Time</th><th>Scope</th><th>Retention</th></tr></thead>
                <tbody>
                  {rows.length === 0 && <tr><td colSpan={9} className="ao-empty">No evidence of this type yet.</td></tr>}
                  {rows.map((r) => (
                    <tr key={r.id} className={`click${cur && cur.id === r.id ? ' sel' : ''}`} onClick={() => setSel(r.id)}>
                      <td><code>{r.id}</code></td><td><span className="ao-chip gray">{r.type}</span></td><td>{r.who}</td><td>{r.obj}</td><td>{r.v}</td><td className="ao-muted">{r.src}</td><td className="ao-muted">{fmtDate(r.t)}</td><td>{r.scope}</td><td className="ao-muted">{r.ret}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <div className="ao-card">
            {cur ? (
              <>
                <b style={{ fontSize: 15 }}>{cur.id} · {cur.type.toLowerCase()}</b>
                <div className="ao-li"><span className="ao-muted">Learner</span><b>{cur.who}</b></div>
                <div className="ao-li"><span className="ao-muted">Linked</span><b>{cur.obj}</b></div>
                {(cur.detail || []).map(([k, v]) => (
                  <div className="ao-li" key={k}><span className="ao-muted">{k}</span><b style={{ textAlign: 'right', overflowWrap: 'anywhere' }}>{v && /^\d{4}-\d{2}-\d{2}T/.test(String(v)) ? fmtTime(v) : String(v)}</b></div>
                ))}
                <div className="ao-li"><span className="ao-muted">Source</span><b>{cur.src}</b></div>
                <div className="ao-li"><span className="ao-muted">Retention</span><b>{cur.ret}</b></div>
                <div className="ao-muted" style={{ fontSize: 12, marginTop: 'auto' }}>Learners see only their own, PMs only assigned learners, security events only authorised roles</div>
              </>
            ) : (
              <div className="ao-empty">Select a row.</div>
            )}
          </div>
        </div>
      </Loading>
    </>
  );
}
