import React, { useState } from 'react';
import { message, Modal, Select, Table, Button, Tooltip } from 'antd';
import {
  FileTextOutlined, UserOutlined, TeamOutlined, TrophyOutlined, ProjectOutlined, FileProtectOutlined, MailOutlined,
  WarningOutlined, VideoCameraOutlined, CustomerServiceOutlined, MessageOutlined, SafetyOutlined, EyeOutlined,
  DownloadOutlined, ClockCircleOutlined, HistoryOutlined, FilterOutlined, LockOutlined, CalendarOutlined, BarChartOutlined,
} from '@ant-design/icons';
import { request } from '@/request';
import lmsApi from '../api';
import { useLoad, Loading, fmtTime } from './shared';
import './mgmt.css';
import './reports.css';
import ReportPreview from './ReportPreview';

// Design A7 · Reports & exports — every button downloads a real file built
// from the live data (adminOps2.js#reportDownload) and lands in the export log.
// 2026-11-27 redesign: gradient hero + filter card, report tiles, equal-height
// scheduled / export-log cards, preview in a gradient modal.
const RANGES = [
  { key: '30', label: 'Last 30 days', days: 30 },
  { key: '7', label: 'Last 7 days', days: 7 },
  { key: '90', label: 'Last 90 days', days: 90 },
  { key: 'month', label: 'This month' },
  { key: 'custom', label: 'Custom dates…' },
];
const REPORT_LOOK = [
  [/learner 360/i, UserOutlined, 'g1'],
  [/attendance/i, TeamOutlined, 'g3'],
  [/assessment/i, TrophyOutlined, 'g4'],
  [/project/i, ProjectOutlined, 'g2'],
  [/policy/i, FileProtectOutlined, 'g1'],
  [/communication/i, MailOutlined, 'g5'],
  [/incident/i, WarningOutlined, 'g6'],
  [/recording/i, VideoCameraOutlined, 'g4'],
  [/ticket/i, CustomerServiceOutlined, 'g6'],
  [/feedback/i, MessageOutlined, 'g5'],
  [/security|audit|login/i, SafetyOutlined, 'g2'],
];
const lookOf = (name) => (REPORT_LOOK.find(([re]) => re.test(name)) || [null, BarChartOutlined, 'g3']).slice(1);
const FMT_TONE = { csv: 'csv', xlsx: 'xlsx', pdf: 'pdf' };

function rangeDates(key, custom) {
  if (key === 'custom' && custom && custom.from && custom.to) return { from: custom.from, to: custom.to };
  const now = new Date();
  const iso = (d) => d.toISOString().slice(0, 10);
  if (key === 'month') return { from: iso(new Date(now.getFullYear(), now.getMonth(), 1)), to: iso(now) };
  const r = RANGES.find((x) => x.key === key) || RANGES[0];
  return { from: iso(new Date(now.getTime() - r.days * 864e5)), to: iso(now) };
}

export default function Reports() {
  const { data, loading, err, reload } = useLoad(() => lmsApi.opsReports());
  // several batches at once; custom dates; field set; preview (LMS testing report #22)
  const [batches, setBatches] = useState([]);
  const batch = batches.length ? batches.join(',') : 'all';
  const [range, setRange] = useState('30');
  const [custom, setCustom] = useState({ from: '', to: '' });
  const [fields, setFields] = useState('role');
  const [busy, setBusy] = useState('');
  const [preview, setPreview] = useState(null);
  const [pvReport, setPvReport] = useState(null); // the report whose preview is open
  const [pvDay, setPvDay] = useState(null); // one day (YYYY-MM-DD) or null = whole period
  const [pvLoading, setPvLoading] = useState(false);
  const params = () => ({ batch, fields, ...rangeDates(range, custom) });
  const showPreview = async (r, day = null) => {
    setBusy(`${r.key}.preview`);
    setPvReport(r);
    setPvDay(day);
    setPvLoading(true);
    const q = new URLSearchParams({ ...params(), ...(day ? { from: day, to: day } : {}), format: 'json' }).toString();
    const out = await request.get({ entity: `lms/admin/ops/reports/${r.key}?${q}` });
    setBusy('');
    setPvLoading(false);
    if (out && out.success) setPreview(out.result);
  };
  const closePreview = () => { setPreview(null); setPvReport(null); setPvDay(null); };

  const download = async (r, f) => {
    const id = `${r.key}.${f}`;
    setBusy(id);
    try {
      await lmsApi.opsDownload(`reports/${r.key}`, { format: f, ...params() }, `${r.key}-${new Date().toISOString().slice(0, 10)}.${f}`);
      reload();
    } catch (e) {
      message.error('Download failed.');
    } finally {
      setBusy('');
    }
  };
  const rd = rangeDates(range, custom);

  return (
    <div className="mg rp">
      <div className="mg-hero rp-hero">
        <div className="mg-hero-l">
          <span className="mg-hero-ic"><FileTextOutlined /></span>
          <div style={{ minWidth: 0 }}>
            <span className="mg-kicker">Reports &amp; exports</span>
            <h1>Download any LMS report</h1>
            <p>Preview first, then export as CSV, XLSX or PDF · fields are filtered by your role · every sensitive export is logged (spec §12.4, §19.1)</p>
          </div>
        </div>
        {data && (
          <div className="rp-hero-stats">
            <span><b>{data.reports.length}</b><small>reports</small></span>
            <span><b>{data.log.length}</b><small>exports logged</small></span>
            <span><b>{data.scheduled.filter((s) => s.state === 'ON').length}/{data.scheduled.length}</b><small>schedules on</small></span>
          </div>
        )}
      </div>

      <Loading loading={loading} err={err} data={data}>
        {data && (
          <>
            <section className="rp-filters">
              <span className="mg-hd-ic g2"><FilterOutlined /></span>
              <div className="rp-f">
                <small>Batches</small>
                <Select mode="multiple" allowClear aria-label="Batches" style={{ minWidth: 240 }} placeholder="All batches" value={batches} onChange={setBatches} options={data.batches.map((b) => ({ value: b, label: b }))} maxTagCount="responsive" />
              </div>
              <div className="rp-f">
                <small>Period</small>
                <Select value={range} onChange={setRange} style={{ minWidth: 160 }} options={RANGES.map((r) => ({ value: r.key, label: r.label }))} />
              </div>
              {range === 'custom' && (
                <div className="rp-f">
                  <small>From – to</small>
                  <span style={{ display: 'flex', gap: 6 }}>
                    <input type="date" className="mg-date rp-date" aria-label="From" value={custom.from} onChange={(e) => setCustom({ ...custom, from: e.target.value })} />
                    <input type="date" className="mg-date rp-date" aria-label="To" value={custom.to} onChange={(e) => setCustom({ ...custom, to: e.target.value })} />
                  </span>
                </div>
              )}
              <div className="rp-f">
                <small>Fields</small>
                <Select value={fields} onChange={setFields} style={{ minWidth: 230 }} options={[{ value: 'role', label: 'All allowed for my role' }, { value: 'basic', label: 'Without contact details' }]} />
              </div>
              <div className="rp-f-note">
                <span className={`mg-pill ${data.piiMinimised ? 'mid' : 'ok'}`}>{data.piiMinimised ? <><LockOutlined /> PII masked</> : 'Full fields'}</span>
                <small><CalendarOutlined /> {rd.from} → {rd.to}</small>
              </div>
            </section>

            <section className="mg-card rp-reports">
              <div className="mg-hd">
                <span className="mg-hd-ic g1"><BarChartOutlined /></span>
                <div><b>Standard reports · {data.reports.length}</b><small>Click Preview to see the rows before you download</small></div>
              </div>
              <div className="rp-grid">
                {data.reports.map((r) => {
                  const [Ic, g] = lookOf(r.name);
                  return (
                    <div className={`rp-tile${r.restricted ? ' locked' : ''}`} key={r.key}>
                      <div className="rp-tile-top">
                        <span className={`rp-tile-ic ${g}`}><Ic /></span>
                        <div style={{ minWidth: 0 }}>
                          <b>{r.name}</b>
                          {r.restricted ? <span className="mg-pill bad"><LockOutlined /> Restricted</span> : <small>{r.desc || 'Live data'}</small>}
                        </div>
                      </div>
                      <div className="rp-tile-act">
                        <Button size="small" icon={<EyeOutlined />} loading={busy === `${r.key}.preview`} onClick={() => showPreview(r)}>Preview</Button>
                        <span className="rp-fmts">
                          {r.formats.map((f) => (
                            <Tooltip key={f} title={`Download ${f.toUpperCase()}`}>
                              <button type="button" className={`rp-fmt ${FMT_TONE[f] || ''}`} disabled={busy === `${r.key}.${f}`} onClick={() => download(r, f)}>
                                {busy === `${r.key}.${f}` ? '…' : <><DownloadOutlined /> {f.toUpperCase()}</>}
                              </button>
                            </Tooltip>
                          ))}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>

            <div className="mg-row">
              <section className="mg-card" aria-label="Scheduled reports">
                <div className="mg-hd">
                  <span className="mg-hd-ic g4"><ClockCircleOutlined /></span>
                  <div><b>Scheduled reports</b><small>Sent automatically by email</small></div>
                </div>
                <div className="mg-card-body">
                  {data.scheduled.map((s) => (
                    <div className={`rp-sch${s.state === 'ON' ? ' on' : ''}`} key={s.name}>
                      <span className="rp-sch-ic"><ClockCircleOutlined /></span>
                      <span className="rp-sch-t"><b>{s.name}</b><small>{s.when}{s.lastRun ? ` · last ${fmtTime(s.lastRun)}` : ''}</small></span>
                      <span className={`mg-pill ${s.state === 'ON' ? 'ok' : 'none'}`}>{s.state === 'ON' ? 'On' : 'Not set up'}</span>
                    </div>
                  ))}
                </div>
                <div className="mg-foot">Schedules run from the server · recipients by role</div>
              </section>

              <section className="mg-card" aria-label="Export log">
                <div className="mg-hd">
                  <span className="mg-hd-ic g6"><HistoryOutlined /></span>
                  <div><b>Export log</b><small>Who exported what, with which filters</small></div>
                  <span className="mg-pill none">{data.log.length}</span>
                </div>
                <div className="mg-card-body" style={{ padding: 0, gap: 0 }}>
                  {data.log.length === 0 && <div className="mg-empty">No exports yet.</div>}
                  {data.log.map((l, i) => (
                    <div className="rp-log" key={i}>
                      <span className="mg-actor"><i>{String(l.by || '?').trim()[0]}</i></span>
                      <span className="rp-log-t"><b>{l.report}</b><small>{l.by} · {fmtTime(l.at)}</small></span>
                      <span className="rp-log-n">{l.rows}<small>rows</small></span>
                      {l.sensitive ? <span className="mg-pill mid">Sensitive</span> : <span className="mg-pill none">Normal</span>}
                    </div>
                  ))}
                </div>
                <div className="mg-foot">Append-only · sensitive exports flagged for review</div>
              </section>
            </div>
          </>
        )}
      </Loading>

      <ReportPreview preview={preview} loading={pvLoading} day={pvDay} onDay={(d) => pvReport && showPreview(pvReport, d)} rangeLabel={`${rd.from} → ${rd.to}`} onClose={closePreview} />
    </div>
  );
}
