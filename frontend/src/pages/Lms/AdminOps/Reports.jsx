import React, { useState } from 'react';
import { message } from 'antd';
import lmsApi from '../api';
import { useLoad, Head, Loading, fmtTime } from './shared';

// Design A7 · Reports & exports — every button downloads a real file built
// from the live data (adminOps2.js#reportDownload) and lands in the export log.
const RANGES = [
  { key: '30', label: 'Last 30 days', days: 30 },
  { key: '7', label: 'Last 7 days', days: 7 },
  { key: '90', label: 'Last 90 days', days: 90 },
  { key: 'month', label: 'This month' },
];

function rangeDates(key) {
  const now = new Date();
  const iso = (d) => d.toISOString().slice(0, 10);
  if (key === 'month') return { from: iso(new Date(now.getFullYear(), now.getMonth(), 1)), to: iso(now) };
  const r = RANGES.find((x) => x.key === key) || RANGES[0];
  return { from: iso(new Date(now.getTime() - r.days * 864e5)), to: iso(now) };
}

export default function Reports() {
  const { data, loading, err, reload } = useLoad(() => lmsApi.opsReports());
  const [batch, setBatch] = useState('all');
  const [range, setRange] = useState('30');
  const [busy, setBusy] = useState('');

  const download = async (r, f) => {
    const id = `${r.key}.${f}`;
    setBusy(id);
    try {
      await lmsApi.opsDownload(`reports/${r.key}`, { format: f, batch, ...rangeDates(range) }, `${r.key}-${new Date().toISOString().slice(0, 10)}.${f}`);
      reload();
    } catch (e) {
      message.error('Download failed.');
    } finally {
      setBusy('');
    }
  };

  return (
    <>
      <Head title="Reports & exports" sub="Spec §12.4, §19.1 · role ke hisaab se fields filter · har sensitive export log hota hai" />
      <Loading loading={loading} err={err} data={data}>
        {data && (
          <>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <select className="ao-inp" aria-label="Batch" value={batch} onChange={(e) => setBatch(e.target.value)}>
                <option value="all">All batches</option>
                {data.batches.map((b) => <option key={b} value={b}>{b}</option>)}
              </select>
              <select className="ao-inp" aria-label="Range" value={range} onChange={(e) => setRange(e.target.value)}>
                {RANGES.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
              </select>
              <select className="ao-inp" aria-label="Fields" disabled><option>Fields: as per my role</option></select>
              <span className="ao-muted" style={{ fontSize: 12 }}>{data.piiMinimised ? 'PII minimised for your role (emails masked)' : 'Full fields — export is logged'}</span>
            </div>
            <div className="ao-grid-2" style={{ gridTemplateColumns: 'minmax(0, 1.1fr) minmax(0, 1fr)' }}>
              <div className="ao-card" style={{ gap: 0 }}>
                <div className="ao-hd" style={{ paddingBottom: 6 }}><b>Standard reports · {data.reports.length}</b></div>
                {data.reports.map((r) => (
                  <div className="ao-rp" key={r.key}>
                    <span><b>{r.name}</b> {r.restricted ? <span className="ao-chip red">Restricted</span> : r.desc && <span className="ao-muted">· {r.desc}</span>}</span>
                    <span style={{ display: 'flex', gap: 4 }}>
                      {r.formats.map((f) => (
                        <button key={f} type="button" className="ao-btn2 sm" disabled={busy === `${r.key}.${f}`} onClick={() => download(r, f)}>{busy === `${r.key}.${f}` ? '…' : f.toUpperCase()}</button>
                      ))}
                    </span>
                  </div>
                ))}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14, minHeight: 0 }}>
                <div className="ao-card">
                  <div className="ao-hd"><b>Scheduled reports</b></div>
                  {data.scheduled.map((s) => (
                    <div className="ao-rp" key={s.name}>
                      <span><b>{s.name}</b><br /><span className="ao-muted">{s.when}{s.lastRun ? ` · last ${fmtTime(s.lastRun)}` : ''}</span></span>
                      <span className={`ao-chip ${s.state === 'ON' ? 'hai' : 'gray'}`}>{s.state}</span>
                    </div>
                  ))}
                </div>
                <div className="ao-card" style={{ flex: 1 }}>
                  <div className="ao-hd"><b>Export log</b><span className="ao-muted" style={{ fontSize: 12 }}>who · what · filters</span></div>
                  <div className="ao-tablewrap">
                    <table className="ao-table small">
                      <thead><tr><th>When</th><th>By</th><th>Report</th><th>Rows</th><th>Sensitive</th></tr></thead>
                      <tbody>
                        {data.log.length === 0 && <tr><td colSpan={5} className="ao-empty">No exports yet.</td></tr>}
                        {data.log.map((l, i) => (
                          <tr key={i}><td>{fmtTime(l.at)}</td><td>{l.by}</td><td>{l.report}</td><td>{l.rows}</td><td>{l.sensitive ? <span className="ao-chip adh">Yes · logged</span> : <span className="ao-muted">no</span>}</td></tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            </div>
          </>
        )}
      </Loading>
    </>
  );
}
