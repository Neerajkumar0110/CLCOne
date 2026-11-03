import React, { useState } from 'react';
import lmsApi from '../api';
import { useLoad, Head, Loading, fmtTime } from './shared';

// Design A9 · Login, device, IP & audit. Logins come from LoginActivity
// (session open/close); device and IP are not captured by the app today, so
// those columns say so instead of inventing values.
export default function Security() {
  const [q, setQ] = useState('');
  const [mod, setMod] = useState('all');
  const [applied, setApplied] = useState({ q: '', module: 'all' });
  const { data, loading, err } = useLoad(() => lmsApi.opsSecurity(applied), [applied.q, applied.module]);

  return (
    <>
      <Head title="Security, login monitoring & audit" sub="Spec §18 · sirf authorised roles · signals review ke liye hain, proof nahi · scope / retention = D-09, D-15" />
      <Loading loading={loading} err={err} data={data}>
        {data && (
          <div className="ao-grid-2" style={{ gridTemplateColumns: 'minmax(0, 1.3fr) minmax(0, 1fr)', gridTemplateRows: 'auto auto', gap: 12 }}>
            <div className="ao-card">
              <div className="ao-hd"><b>Login activity</b><span className="ao-muted" style={{ fontSize: 12 }}>device / IP not captured yet</span></div>
              <div className="ao-tablewrap">
                <table className="ao-table">
                  <thead><tr><th>Time</th><th>User</th><th>Result</th><th>Session</th></tr></thead>
                  <tbody>
                    {data.logins.map((l, i) => (
                      <tr key={i}>
                        <td>{fmtTime(l.at)}</td>
                        <td>{l.user}{l.role ? ` · ${l.role}` : ''}</td>
                        <td><span className="ao-chip hai">OK</span></td>
                        <td className="ao-muted">{l.open ? 'still open' : l.minutes !== null ? `${l.minutes} min` : 'closed'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            <div className="ao-card">
              <div className="ao-hd"><b>Suspicious-pattern alerts</b></div>
              {data.alerts.length === 0 && <div className="ao-empty">No concurrent sessions in the last 12 hours.</div>}
              {data.alerts.map((a) => (
                <div className="ao-li" key={a.text}><span><b>{a.kind}</b> · {a.text}</span><span className="ao-chip adh">Review</span></div>
              ))}
              <div className="ao-muted" style={{ fontSize: 12 }}>Alert par koi automatic action nahi — Ops review karta hai, decision log hota hai</div>
            </div>
            <div className="ao-card">
              <div className="ao-hd">
                <b>Audit log viewer</b>
                <form style={{ display: 'flex', gap: 6 }} onSubmit={(e) => { e.preventDefault(); setApplied({ q, module: mod }); }}>
                  <input className="ao-inp sm" placeholder="Event ID" aria-label="Event ID" style={{ width: 140 }} value={q} onChange={(e) => setQ(e.target.value)} />
                  <select className="ao-inp sm" aria-label="Object" value={mod} onChange={(e) => { setMod(e.target.value); setApplied({ q, module: e.target.value }); }}>
                    <option value="all">All objects</option>
                    {data.modules.map((m) => <option key={m} value={m}>{m}</option>)}
                  </select>
                </form>
              </div>
              <div className="ao-tablewrap">
                <table className="ao-table">
                  <thead><tr><th>Event ID</th><th>Actor</th><th>Action</th><th>Old → new</th><th>Source</th></tr></thead>
                  <tbody>
                    {data.audit.length === 0 && <tr><td colSpan={5} className="ao-empty">No matching events.</td></tr>}
                    {data.audit.map((a) => (
                      <tr key={a.id} title={a.reason}><td><code>{a.eventId}</code></td><td>{a.actor}</td><td>{a.module} · {a.action}</td><td>{a.change}</td><td>{a.source}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="ao-muted" style={{ fontSize: 12 }}>Append-only · edit / delete kisi ke paas nahi</div>
            </div>
            <div className="ao-card">
              <div className="ao-hd"><b>Notice &amp; retention</b><span className="ao-chip naya">D-09 · D-15</span></div>
              {data.retention.map((r) => (
                <div className="ao-li" key={r.label}><span>{r.label}</span><b>{r.value}</b></div>
              ))}
              <div className="ao-muted" style={{ fontSize: 12 }}>Raw video / audio ya personal-device data collect nahi hota</div>
            </div>
          </div>
        )}
      </Loading>
    </>
  );
}
