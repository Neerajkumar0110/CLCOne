import React, { useState } from 'react';
import { message, Modal, Segmented, Button, Input, Tooltip } from 'antd';
import {
  FundOutlined, FileExcelOutlined, FilePdfOutlined, SearchOutlined, SafetyOutlined, TeamOutlined, AuditOutlined,
  UserAddOutlined, FileProtectOutlined, TrophyOutlined, VideoCameraOutlined, MessageOutlined, CustomerServiceOutlined,
  FlagOutlined, ThunderboltOutlined, FontSizeOutlined, WarningOutlined, SmileOutlined, CheckSquareOutlined, BarChartOutlined,
} from '@ant-design/icons';
import lmsApi from '../api';
import { useLoad, Loading } from './shared';
import './mgmt.css';

// Design A2 · Management KPIs + audit — every number computed server-side
// from the live LMS data (adminOps.js#kpis); "—" means the source isn't
// collected yet, never a made-up value.
// 2026-11-27 redesign: gradient hero, equal-height KPI tiles with a meter,
// equal-height attendance / security cards, audit rows open in a modal.

// icon + gradient per KPI label (falls back to a neutral one)
const KPI_LOOK = [
  [/onboarding/i, UserAddOutlined, 'g1'],
  [/consent/i, FileProtectOutlined, 'g2'],
  [/readiness/i, TrophyOutlined, 'g3'],
  [/recording/i, VideoCameraOutlined, 'g4'],
  [/feedback response/i, MessageOutlined, 'g5'],
  [/sla/i, CustomerServiceOutlined, 'g6'],
  [/milestone/i, FlagOutlined, 'g3'],
  [/automation/i, ThunderboltOutlined, 'g2'],
  [/caption/i, FontSizeOutlined, 'g4'],
  [/incident/i, WarningOutlined, 'g6'],
  [/satisfaction/i, SmileOutlined, 'g5'],
  [/corrective/i, CheckSquareOutlined, 'g1'],
];
const lookOf = (label) => (KPI_LOOK.find(([re]) => re.test(label)) || [null, BarChartOutlined, 'g1']).slice(1);
const pctOf = (v) => {
  const m = String(v == null ? '' : v).match(/^(\d+(?:\.\d+)?)%$/);
  return m ? Number(m[1]) : null;
};
const toneOf = (p) => (p === null ? 'none' : p >= 80 ? 'ok' : p >= 50 ? 'mid' : 'bad');

export default function Mgmt() {
  // period: a month, one day, or a range (LMS testing report #21)
  const [mode, setMode] = useState('month');
  const [month, setMonth] = useState('');
  const [day, setDay] = useState('');
  const [range, setRange] = useState({ from: '', to: '' });
  const period = mode === 'day' && day ? { day } : mode === 'range' && range.from && range.to ? range : { month };
  const key = JSON.stringify(period);
  const { data, loading, err } = useLoad(() => lmsApi.opsKpis(period), [key]);
  const [auditQ, setAuditQ] = useState('');
  const [auditView, setAuditView] = useState(null);
  const exportXlsx = () => lmsApi.opsDownload('kpis/export', { ...period, format: 'xlsx' }, `management-${(data && data.month) || 'period'}.xlsx`.replace(/\s+/g, '-')).catch(() => message.error('Export failed.'));
  // PDF = a clean report page printed to PDF (printing the whole CRM screen came out blank)
  const exportPdf = () => {
    if (!data) return;
    const esc = (v) => String(v == null ? '—' : v).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);
    const w = window.open('', '_blank');
    if (!w) return message.error('Allow pop-ups to export the PDF.');
    w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Management KPIs — ${esc(data.month)}</title><style>body{font:13px/1.45 Arial,sans-serif;color:#0f172a;margin:24px}h1{font-size:20px;margin:0 0 4px}h2{font-size:15px;margin:22px 0 8px}table{border-collapse:collapse;width:100%}th,td{border:1px solid #cbd5e1;padding:5px 7px;text-align:left;vertical-align:top}th{background:#f1f5f9}.k{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}.k div{border:1px solid #cbd5e1;border-radius:6px;padding:8px}.k b{font-size:18px;display:block}small{color:#64748b}@page{margin:14mm}</style></head><body>
<h1>Management KPIs — ${esc(data.month)}</h1><small>CareerLab LMS · generated ${new Date().toLocaleString('en-IN')} · ${esc(data.active)} active learners</small>
<h2>KPIs</h2><div class="k">${data.kpis.map((k) => `<div><b>${esc(k.value)}</b>${esc(k.label)}<br><small>${esc(k.note)}</small></div>`).join('')}</div>
<h2>Attendance by batch (threshold ${esc(thr)}%)</h2><table><tr><th>Batch</th><th>Present</th><th>Seats</th><th>%</th></tr>${data.batches.map((b) => `<tr><td>${esc(b.batch)}</td><td>${esc(b.present)}</td><td>${esc(b.total)}</td><td>${esc(b.pct)}%</td></tr>`).join('') || '<tr><td colspan="4">No finished classes in this period</td></tr>'}</table>
<h2>Audit (${data.audit.length}${data.auditTotal > data.audit.length ? ` of ${data.auditTotal}` : ''})</h2><table><tr><th>Time</th><th>Actor</th><th>Action</th><th>Object</th><th>Old → New</th><th>Reason</th></tr>${data.audit.map((a) => `<tr><td>${esc(new Date(a.at).toLocaleString('en-IN'))}</td><td>${esc(a.actor)}</td><td>${esc(a.module)} · ${esc(a.action)}</td><td>${esc(a.object)}</td><td>${esc(a.change)}</td><td>${esc(a.reason)}</td></tr>`).join('')}</table>
<script>window.onload=function(){setTimeout(function(){window.print()},200)}<\/script></body></html>`);
    w.document.close();
  };
  const thr = (data && data.threshold) || 90;
  const needle = auditQ.trim().toLowerCase();
  const audit = data ? data.audit.filter((a) => !needle || `${a.actor} ${a.module} ${a.action} ${a.object} ${a.change} ${a.reason}`.toLowerCase().includes(needle)) : [];
  const avgAtt = data && data.batches.length ? Math.round((data.batches.reduce((n, b) => n + (Number(b.pct) || 0), 0) / data.batches.length) * 10) / 10 : null;
  const fmt = (at) => new Date(at).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });

  return (
    <div className="mg">
      <div className="mg-hero">
        <div className="mg-hero-l">
          <span className="mg-hero-ic"><FundOutlined /></span>
          <div style={{ minWidth: 0 }}>
            <span className="mg-kicker">Management dashboard</span>
            <h1>{data ? data.month : 'Management'}</h1>
            <p>All programmes · every number is computed live from the LMS · “—” means that source isn&apos;t collected yet{data && data.active != null ? ` · ${data.active} active learners` : ''}</p>
          </div>
        </div>
        <div className="mg-ctrl">
          <Segmented size="small" value={mode} onChange={setMode} options={[{ value: 'month', label: 'Month' }, { value: 'day', label: 'One day' }, { value: 'range', label: 'Date range' }]} />
          <div className="mg-ctrl-row">
            {mode === 'month' && <input type="month" aria-label="Month" className="mg-date" value={month} onChange={(e) => setMonth(e.target.value)} />}
            {mode === 'day' && <input type="date" aria-label="Day" className="mg-date" value={day} onChange={(e) => setDay(e.target.value)} />}
            {mode === 'range' && (
              <>
                <input type="date" aria-label="From" className="mg-date" value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} />
                <input type="date" aria-label="To" className="mg-date" value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} />
              </>
            )}
            <Button icon={<FileExcelOutlined />} onClick={exportXlsx}>XLSX</Button>
            <Button icon={<FilePdfOutlined />} onClick={exportPdf}>PDF</Button>
          </div>
        </div>
      </div>

      <Loading loading={loading} err={err} data={data}>
        {data && (
          <>
            <div className="mg-kpis">
              {data.kpis.map((k) => {
                const [Ic, g] = lookOf(k.label);
                const p = pctOf(k.value);
                const tone = toneOf(p);
                return (
                  <Tooltip key={k.label} title={k.note}>
                    <div className={`mg-k ${tone}`}>
                      <div className="mg-k-top">
                        <span className={`mg-k-ic ${g}`}><Ic /></span>
                        {k.value == null || k.value === '—' ? <span className="mg-k-tag">Not collected</span> : p !== null ? <span className={`mg-k-tag ${tone}`}>{tone === 'ok' ? 'Good' : tone === 'mid' ? 'Watch' : 'Low'}</span> : null}
                      </div>
                      <b className="mg-k-v">{k.value ?? '—'}</b>
                      <span className="mg-k-l">{k.label}</span>
                      <small className="mg-k-n">{k.note}</small>
                      <div className="mg-k-bar"><span style={{ width: `${p === null ? 0 : Math.min(100, p)}%` }} /></div>
                    </div>
                  </Tooltip>
                );
              })}
            </div>

            <div className="mg-row">
              <section className="mg-card" aria-label="Attendance by batch">
                <div className="mg-hd">
                  <span className="mg-hd-ic g3"><TeamOutlined /></span>
                  <div><b>Attendance by batch</b><small>Present + late ÷ student seats in finished classes · target {thr}% (D-01)</small></div>
                  {avgAtt !== null && <span className={`mg-pill ${toneOf(avgAtt)}`}>avg {avgAtt}%</span>}
                </div>
                <div className="mg-card-body">
                  {data.batches.length === 0 ? <div className="mg-empty">No finished classes in this period yet.</div> : data.batches.map((b) => {
                    const pct = Number(b.pct) || 0;
                    const t = pct >= thr ? 'ok' : pct >= thr - 30 ? 'mid' : 'bad';
                    return (
                      <div className="mg-att" key={b.batch}>
                        <span className="mg-att-n" title={b.batch}>{b.batch}</span>
                        <Tooltip title={`${b.present ?? '—'} of ${b.total ?? '—'} seats present`}>
                          <div className="mg-att-trk">
                            <div className={`mg-att-fill ${t}`} style={{ width: `${Math.min(100, pct)}%` }} />
                            <i style={{ left: `${Math.min(100, thr)}%` }} />
                          </div>
                        </Tooltip>
                        <b className={`mg-att-v ${t}`}>{b.pct ?? 0}%</b>
                      </div>
                    );
                  })}
                </div>
                <div className="mg-foot"><i className="mg-legend-line" /> the line on each bar is the {thr}% target</div>
              </section>

              <section className="mg-card" aria-label="Security signals">
                <div className="mg-hd">
                  <span className="mg-hd-ic g6"><SafetyOutlined /></span>
                  <div><b>Security signals</b><small>Concurrent sessions in the last 12 hours</small></div>
                  <span className={`mg-pill ${data.signals.length ? 'mid' : 'ok'}`}>{data.signals.length ? `${data.signals.length} to review` : 'All clear'}</span>
                </div>
                <div className="mg-card-body">
                  {data.signals.length === 0 ? (
                    <div className="mg-clear"><SafetyOutlined /><b>No concurrent sessions</b><span>Nobody was logged in from two places in the last 12 hours.</span></div>
                  ) : data.signals.map((s) => (
                    <div key={s.text} className="mg-sig">
                      <span className="mg-sig-ic"><WarningOutlined /></span>
                      <span className="mg-sig-t">{s.text}</span>
                      <span className="mg-pill mid">{s.label}</span>
                    </div>
                  ))}
                </div>
                <div className="mg-foot">Signals are for review only, not proof · IP/device data restricted to some roles · retention D-09</div>
              </section>
            </div>

            <section className="mg-card mg-audit" aria-label="Audit log">
              <div className="mg-hd">
                <span className="mg-hd-ic g2"><AuditOutlined /></span>
                <div><b>Audit log · {data.month}</b><small>Append-only · {data.audit.length}{data.auditTotal > data.audit.length ? ` of ${data.auditTotal} (export for all)` : ''} events · click a row for details</small></div>
                <Input allowClear prefix={<SearchOutlined />} placeholder="Search actor, action, object, reason" value={auditQ} onChange={(e) => setAuditQ(e.target.value)} style={{ maxWidth: 300 }} />
              </div>
              <div className="mg-tbl">
                <div className="mg-tr mg-th"><span>Time</span><span>Actor</span><span>Action</span><span>Object</span><span>Old → New</span><span>Reason</span></div>
                {audit.length === 0 && <div className="mg-empty">No audit events match.</div>}
                {audit.map((a) => (
                  <div className="mg-tr" key={a.id} role="button" tabIndex={0} onClick={() => setAuditView(a)} onKeyDown={(e) => { if (e.key === 'Enter') setAuditView(a); }}>
                    <span className="mg-time">{fmt(a.at)}</span>
                    <span className="mg-actor"><i>{String(a.actor || '?').trim()[0]}</i><span>{a.actor}</span></span>
                    <span><span className="mg-act">{a.module}</span> <span className="mg-act2">{a.action}</span></span>
                    <span className="mg-obj">{a.object}</span>
                    <span className="mg-chg">{a.change || '—'}</span>
                    <span className="mg-rsn">{a.reason || '—'}</span>
                  </div>
                ))}
              </div>
            </section>
          </>
        )}
      </Loading>

      <Modal open={!!auditView} onCancel={() => setAuditView(null)} footer={null} width={640} centered destroyOnClose rootClassName="mg-modal">
        {auditView && (
          <div className="mg-m">
            <div className="mg-m-head">
              <span className="mg-act">{auditView.module}</span> <span className="mg-act2">{auditView.action}</span>
              <h3>{auditView.object || 'Audit event'}</h3>
              <span>{new Date(auditView.at).toLocaleString('en-IN')} · by <b>{auditView.actor}</b></span>
            </div>
            <div className="mg-m-body">
              <div className="mg-m-cap">Old → New</div>
              <div className="mg-m-box mono">{auditView.change || '—'}</div>
              <div className="mg-m-cap">Reason</div>
              <div className="mg-m-box">{auditView.reason || 'No reason recorded.'}</div>
              {auditView.id && <div className="mg-m-id">Event ID · {auditView.id}</div>}
            </div>
            <div className="mg-m-foot"><Button type="primary" onClick={() => setAuditView(null)}>Close</Button></div>
          </div>
        )}
      </Modal>
    </div>
  );
}
