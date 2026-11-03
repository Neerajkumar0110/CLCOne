import React, { useState } from 'react';
import { Modal } from 'antd';
import lmsApi from '../api';
import { useLoad, act, Head, Loading, fmtTime } from '../AdminOps/shared';

// Design A6 · System health & incidents (now inside LMS → Admin & Ops).
// Same live checks as before (/admin/system-health: DB, mailer, meeting
// provider, Razorpay, incident mode) plus per-job status and integration
// state from /admin/ops/health. Secrets are never returned by either.
const DOT = { ok: '#16a34a', warn: '#f59e0b', down: '#dc2626', off: '#94a3b8' };
const JOB_CHIP = { OK: 'hai', PAUSED: 'gray', STALE: 'adh', 'NOT RUN': 'gray' };

export default function SystemHealth() {
  const base = useLoad(() => lmsApi.systemHealth());
  const extra = useLoad(() => lmsApi.opsHealth());
  const [msg, setMsg] = useState('');
  const [asking, setAsking] = useState(false);
  const b = base.data;
  const x = extra.data;
  const inc = !!(b && b.incidentMode && b.incidentMode.active);

  const services = x && b
    ? [
        x.services[0],
        { name: 'BigBlueButton', state: b.meetingProvider.live ? 'ok' : 'down', note: b.meetingProvider.live ? x.services[1].note : 'offline stand-in room' },
        { ...x.services[2], state: b.database.ok ? 'ok' : 'down' },
        x.services[3],
        { name: 'Razorpay', state: b.paymentGateway && b.paymentGateway.ok ? 'ok' : 'down', note: b.paymentGateway && b.paymentGateway.ok ? 'reachable' : 'not reachable' },
        { ...x.services[4], state: b.mailer.ok ? x.services[4].state : 'down', note: b.mailer.ok ? x.services[4].note : 'mailer not configured' },
        x.services[5],
        x.services[6],
      ]
    : [];

  const toggleIncident = async (active, message) => {
    if (await act(lmsApi.toggleIncidentMode(active, message), active ? 'Incident mode ON' : 'Incident mode cleared')) {
      setAsking(false);
      setMsg('');
      base.reload();
    }
  };

  return (
    <>
      <Head title="System health & incidents" sub="Support Manager: view only · LMS Admin: retry / incident mode · secrets kabhi nahi dikhte" right={<button type="button" className="ao-btn2 md" onClick={() => { base.reload(); extra.reload(); }}>Refresh</button>} />
      {inc && <div className="ao-incident">Incident mode ON{b.incidentMode.message ? ` · ${b.incidentMode.message}` : ''} · set by {b.incidentMode.setByName} · management alerted</div>}
      <Loading loading={base.loading || extra.loading} err={base.err || extra.err} data={b && x}>
        {b && x && (
          <>
            <div className="ao-kgrid" style={{ gridTemplateColumns: 'repeat(8, minmax(0, 1fr))' }}>
              {services.map((s) => (
                <div className="ao-svc" key={s.name}><b><span className="ao-dot" style={{ background: DOT[s.state] || DOT.off }} />{s.name}</b><span className="ao-muted">{s.note}</span></div>
              ))}
            </div>
            <div className="ao-grid-2" style={{ gridTemplateColumns: 'minmax(0, 1.2fr) minmax(0, 1fr)' }}>
              <div className="ao-card">
                <div className="ao-hd"><b>Background jobs</b><span className="ao-muted" style={{ fontSize: 12 }}>idempotent · retries with backoff</span></div>
                <div className="ao-tablewrap">
                  <table className="ao-table">
                    <thead><tr><th>Job</th><th>Every</th><th>Last run</th><th>Status</th></tr></thead>
                    <tbody>
                      {x.jobs.map((j) => (
                        <tr key={j.name}><td><b>{j.label}</b></td><td>{j.every}</td><td>{j.lastRun ? fmtTime(j.lastRun) : '—'}</td><td><span className={`ao-chip ${JOB_CHIP[j.state] || 'gray'}`}>{j.state}</span></td></tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="ao-muted" style={{ fontSize: 12 }}>"Not run" = this server process hasn't run the job since it started · paused jobs are controlled from Automation</div>
              </div>
              <div className="ao-card">
                <div className="ao-hd"><b>Open incidents / problems</b></div>
                <div className="ao-li"><span><b>Failed recordings</b> · need re-processing</span><span className={`ao-chip ${b.failedRecordings ? 'adh' : 'hai'}`}>{b.failedRecordings || 'None'}</span></div>
                <div className="ao-li"><span><b>Failed / dead webhooks</b></span><span className={`ao-chip ${b.failedWebhooks ? 'red' : 'hai'}`}>{b.failedWebhooks || 'None'}</span></div>
                <div className="ao-li"><span><b>Failed sync jobs</b></span><span className={`ao-chip ${x.failedSync.length ? 'adh' : 'hai'}`}>{x.failedSync.length || 'None'}</span></div>
                <div className="ao-li"><span><b>Audit activity</b> · last 24h</span><b>{b.auditActivity24h}</b></div>
                <div className="ao-hd" style={{ marginTop: 6 }}><b>Backups</b></div>
                <div className="ao-li"><span>Last DB backup</span><b className="ao-muted">managed by MongoDB Atlas</b></div>
                <div className="ao-li"><span>Last restore drill</span><b style={{ color: '#9a3412' }}>not recorded — schedule</b></div>
                <div className="ao-hd" style={{ marginTop: 'auto' }}>
                  <span className="ao-muted" style={{ fontSize: 12 }}>Checked {fmtTime(b.checkedAt)} · admin access learner session se alag</span>
                  <button type="button" className="ao-btn" onClick={() => (inc ? toggleIncident(false, '') : setAsking(true))}>{inc ? 'Exit incident mode' : 'Enter incident mode'}</button>
                </div>
              </div>
            </div>
          </>
        )}
      </Loading>
      <Modal open={asking} title="Enter incident mode" okText="Turn on" onOk={() => toggleIncident(true, msg)} onCancel={() => setAsking(false)}>
        <label className="ao-label">What is happening? (shown to management)<textarea className="ao-inp full" value={msg} onChange={(e) => setMsg(e.target.value)} /></label>
      </Modal>
    </>
  );
}
