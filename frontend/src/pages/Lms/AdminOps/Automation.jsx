import React from 'react';
import lmsApi from '../api';
import { useLoad, act, Head, Loading, fmtTime } from './shared';

// Design A8 · Automation catalogue — the 16 spec §17.1 workflows plus the gap-fix rules (duplicate classes, approved-request follow-through). Running /
// Paused is the real state of the background job; workflows with no job yet
// say so instead of showing a toggle that does nothing.
export default function Automation() {
  const { data, loading, err, setData } = useLoad(() => lmsApi.opsAutomation());
  const toggle = async (r) => {
    const res = await act(lmsApi.opsAutomationToggle(r.key, !r.running), r.running ? 'Paused' : 'Resumed');
    if (res) setData(res);
  };

  return (
    <>
      <div className="ao-head" style={{ alignItems: 'flex-end' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <h1>Automation catalogue</h1>
          <div className="ao-muted ao-sub">Spec §17.1 · routine work is automatic, a final adverse decision is always made by a person · every rule idempotent + logged</div>
        </div>
        {data && <span className="ao-chip naya" style={{ height: 24, fontSize: 12 }}>{data.running} / {data.total} running</span>}
      </div>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <div className="ao-ph"><b>Phase 1 · Map</b><br /><span className="ao-muted">templates, rules, owners</span></div>
        <div className="ao-ph now"><b>Phase 2 · Quick wins</b> <span className="ao-chip naya">Now</span><br /><span className="ao-muted">reminders, onboarding, daily report</span></div>
        <div className="ao-ph"><b>Phase 3 · Integrations</b><br /><span className="ao-muted">WhatsApp, dashboards</span></div>
        <div className="ao-ph"><b>Phase 4 · Assisted AI</b><br /><span className="ao-muted">FAQ suggest, summaries</span></div>
      </div>
      <Loading loading={loading} err={err} data={data}>
        {data && (
          <div className="ao-card" style={{ flex: 1, minHeight: 0 }}>
            <div className="ao-tablewrap">
              <table className="ao-table">
                <thead><tr><th style={{ width: 170 }}>Workflow</th><th>Trigger</th><th>Automated action</th><th>Human control</th><th style={{ width: 120 }}>Job</th><th style={{ width: 110 }}>State</th></tr></thead>
                <tbody>
                  {data.rows.map((r) => (
                    <tr key={r.key}>
                      <td><b>{r.n}</b></td>
                      <td className="ao-muted">{r.t}</td>
                      <td>{r.a}</td>
                      <td className="ao-muted">{r.h}</td>
                      <td>{r.job ? <span className="ao-muted" style={{ fontSize: 12 }}><code>{r.job}</code>{r.lastRun ? <><br />{fmtTime(r.lastRun)}</> : null}</span> : <span className="ao-chip gray">Not built</span>}</td>
                      <td>
                        {!r.automated ? (
                          <span className="ao-muted" style={{ fontSize: 12 }}>Manual</span>
                        ) : (
                          <button type="button" className={`ao-tg ${r.running ? 'on' : 'off'}`} disabled={!r.pausable || !data.canToggle} title={!r.pausable ? 'Part of the live-class job — always on' : !data.canToggle ? 'Only an LMS admin can pause' : ''} onClick={() => toggle(r)}>
                            {r.running ? 'Running' : 'Paused'}
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </Loading>
    </>
  );
}
