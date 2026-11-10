import React, { useState } from 'react';
import { message } from 'antd';
import lmsApi from '../api';
import { useLoad, Head, Loading, fmtTime } from './shared';

// Design A2 · Management KPIs + audit — every number computed server-side
// from the live LMS data (adminOps.js#kpis); "—" means the source isn't
// collected yet, never a made-up value.
export default function Mgmt() {
  const [month, setMonth] = useState('');
  const { data, loading, err } = useLoad(() => lmsApi.opsKpis(month), [month]);
  const exportXlsx = () => lmsApi.opsDownload('kpis/export', { month, format: 'xlsx' }, `management-${month || 'this-month'}.xlsx`).catch(() => message.error('Export failed.'));
  const thr = (data && data.threshold) || 90;

  return (
    <>
      <Head
        title={`Management — ${data ? data.month : ''}`}
        sub="All programmes · drill-down only for authorised users"
        right={
          <>
            <input type="month" aria-label="Month" className="ao-inp sm" value={month} onChange={(e) => setMonth(e.target.value)} />
            <button type="button" className="ao-btn2" style={{ height: 34, fontSize: 12 }} onClick={exportXlsx}>Export XLSX</button>
            <button type="button" className="ao-btn2" style={{ height: 34, fontSize: 12 }} onClick={() => window.print()}>Export PDF</button>
          </>
        }
      />
      <Loading loading={loading} err={err} data={data}>
        {data && (
          <>
            <div className="ao-kgrid">
              {data.kpis.map((k) => (
                <div className="ao-k" key={k.label} title={k.note}>
                  <b>{k.value ?? '—'}</b>
                  <span>{k.label}</span>
                  <small>{k.note}</small>
                </div>
              ))}
            </div>
            <div className="ao-grid-2" style={{ gridTemplateColumns: '1fr 1.4fr' }}>
              <div className="ao-card">
                <div className="ao-hd"><b>Attendance by batch vs {thr}%</b></div>
                {data.batches.length === 0 && <div className="ao-empty">No finished classes this month yet.</div>}
                {data.batches.map((b) => (
                  <div className="ao-bar" key={b.batch}>
                    <span>{b.batch}</span>
                    <div className="ao-trk"><div className={`ao-fill${b.pct < thr - 5 ? ' warn' : ''}`} style={{ width: `${Math.min(100, b.pct || 0)}%` }} /></div>
                    <b>{b.pct ?? 0}%</b>
                  </div>
                ))}
                <div className="ao-muted" style={{ fontSize: 12 }}>Present + late out of student seats in finished classes · threshold = D-01 decision</div>
                <div style={{ borderTop: '1px solid #e2e8f0', paddingTop: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <div className="ao-hd"><b>Security signals</b></div>
                  {data.signals.length === 0 && <div className="ao-muted" style={{ fontSize: 13 }}>No concurrent sessions in the last 12 hours.</div>}
                  {data.signals.map((s) => (
                    <div key={s.text} style={{ fontSize: 13, display: 'flex', justifyContent: 'space-between' }}><span>{s.text}</span><span className="ao-chip adh">{s.label}</span></div>
                  ))}
                  <div className="ao-muted" style={{ fontSize: 12 }}>Signals are for review only, not proof · IP/device data restricted to some roles · retention D-09</div>
                </div>
              </div>
              <div className="ao-card">
                <div className="ao-hd"><b>Audit log</b><span className="ao-muted" style={{ fontSize: 12 }}>append-only · no edit/delete</span></div>
                <div className="ao-tablewrap">
                  <table className="ao-table small">
                    <thead><tr><th>Time</th><th>Actor</th><th>Action</th><th>Object</th><th>Old → New</th><th>Reason</th></tr></thead>
                    <tbody>
                      {data.audit.map((a) => (
                        <tr key={a.id}><td>{fmtTime(a.at)}</td><td>{a.actor}</td><td>{a.module} · {a.action}</td><td>{a.object}</td><td>{a.change}</td><td>{a.reason}</td></tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="ao-muted" style={{ fontSize: 12, marginTop: 'auto' }}>Har row: event ID <code>ev_…</code> · source (UI / job) · full log in Security &amp; audit</div>
              </div>
            </div>
          </>
        )}
      </Loading>
    </>
  );
}
