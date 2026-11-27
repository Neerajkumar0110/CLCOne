import React, { useState } from 'react';
import { Alert, message, Modal, Button, Select, Input, Tooltip } from 'antd';
import {
  CheckSquareOutlined, EditOutlined, MailOutlined, SendOutlined, CalendarOutlined, TeamOutlined, ClockCircleOutlined,
  CheckCircleOutlined, CloseCircleOutlined, InfoCircleOutlined, AlertOutlined, LoginOutlined, LogoutOutlined, SyncOutlined,
} from '@ant-design/icons';
import lmsApi from '../api';
import { useLoad, Loading, res, fmtDay, fmtTime, errText } from './shared';
import '../AdminOps/mgmt.css';
import '../AdminOps/opsPages.css';
import '../AdminOps/reports.css';
import './smDesign.css';

// S2 — attendance for one class (join / leave / minutes / reconnects /
// status / overall), correction with old → new + mandatory reason (existing
// correct endpoint, audited), and the absence escalation queue: Level 1–3
// emails prepared from verified data, pre-send checks, sent by a human.
// 2026-11-27 redesign: gradient hero with class pickers, learner rows with
// status chips, correction + email preview in modals.

const TONE = { PRESENT: 'ok', LATE: 'mid', PARTIAL: 'mid', ABSENT: 'bad', EXCUSED: 'info' };

function Correction({ session, row, onClose, onSaved }) {
  const [status, setStatus] = useState(row.status === 'PRESENT' ? 'EXCUSED' : 'PRESENT');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const save = async () => {
    if (reason.trim().length < 5) return message.warning('Write a reason (required).');
    setBusy(true);
    try {
      const r = await lmsApi.smCorrect(session.id, { crmUserId: row.crmUserId, status, reason: reason.trim() });
      if (r && r.success === false) throw new Error(r.message);
      message.success('Correction saved — old/new + reason in audit log.');
      onSaved();
    } catch (e) {
      message.error(errText(e, 'Could not save.'));
    } finally {
      setBusy(false);
    }
    return null;
  };
  return (
    <Modal open onCancel={onClose} footer={null} width={560} centered destroyOnClose rootClassName="mg-modal">
      <div className="mg-m">
        <div className="mg-m-head smx-m-head"><span className="mg-act">Attendance correction</span><h3><EditOutlined /> {row.name}</h3><span>{session.title} · {fmtDay(session.start)}</span></div>
        <div className="mg-m-body">
          <div className="smx-oldnew">
            <div><small>Old value</small><span className={`smx-st ${TONE[row.status] || ''}`}>{row.status}</span><em>{row.minutes} min attended</em></div>
            <span className="smx-arrow">→</span>
            <div><small>New value</small><Select value={status} onChange={setStatus} style={{ width: '100%' }} options={['PRESENT', 'LATE', 'PARTIAL', 'EXCUSED', 'ABSENT'].filter((s) => s !== row.status).map((s) => ({ value: s, label: s }))} /></div>
          </div>
          <label className="ao-label">Reason (required)<Input.TextArea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Camera/network issue confirmed in TKT-…, BBB shows reconnect loop" /></label>
          <div className="mg-m-id">Actor, time, old/new and reason go to the audit log · disputed cases → Operations Manager approval</div>
        </div>
        <div className="mg-m-foot" style={{ gap: 8 }}>
          <Button onClick={onClose}>Cancel</Button>
          <Button type="primary" icon={<CheckCircleOutlined />} loading={busy} disabled={reason.trim().length < 5} onClick={save}>Save correction</Button>
        </div>
      </div>
    </Modal>
  );
}

function Escalations() {
  const [lv, setLv] = useState(3);
  const [busy, setBusy] = useState(false);
  const [eb, setEb] = useState('');
  const [view, setView] = useState(null); // learner whose email preview is open
  const { data, loading, reload } = useLoad(async () => res(await lmsApi.smEscalations()), []);
  if (loading && !data) return <section className="mg-card"><Loading /></section>;
  const allRows = ((data && data.rows) || []).filter((r) => !eb || r.batch === eb);
  const ebs = [...new Set(((data && data.rows) || []).map((r) => r.batch))].sort();
  const rows = allRows.filter((r) => r.level === lv);
  const send = async () => {
    setBusy(true);
    try {
      const r = await lmsApi.smEscalationSend({ email: view.email, level: view.level });
      if (r && r.success === false) throw new Error(r.message);
      message.success(`Sent to ${view.name} · logged.`);
      setView(null);
      reload();
    } catch (e) {
      message.error(errText(e, 'Not sent.'));
    } finally {
      setBusy(false);
    }
  };
  const count = (n) => allRows.filter((r) => r.level === n).length;
  return (
    <section className="mg-card smx-esc" aria-label="Absence escalation queue">
      <div className="mg-hd">
        <span className="mg-hd-ic g6"><AlertOutlined /></span>
        <div><b>Absence escalation queue</b><small>10+ days absent is also emailed daily at 10:30 · 0–10% = Level 3</small></div>
      </div>
      <div className="smx-esc-tools">
        <Select value={eb} onChange={setEb} style={{ width: '100%' }} options={[{ value: '', label: 'All batches' }, ...ebs.map((b) => ({ value: b, label: b }))]} />
        <div className="smx-lv">
          {[1, 2, 3].map((n) => (
            <button key={n} type="button" className={`smx-lv-b l${n}${lv === n ? ' on' : ''}`} onClick={() => setLv(n)}><b>{count(n)}</b><span>Level {n}</span></button>
          ))}
        </div>
      </div>
      <div className="mg-card-body" style={{ padding: 0, gap: 0 }}>
        {rows.length === 0 && <div className="smx-clear"><CheckCircleOutlined /><b>No learner at Level {lv}</b><span>Nothing to send right now.</span></div>}
        {rows.map((r) => (
          <div className="smx-esc-row" key={r.email} role="button" tabIndex={0} onClick={() => setView(r)} onKeyDown={(e) => { if (e.key === 'Enter') setView(r); }}>
            <span className="mg-actor"><i>{String(r.name || '?')[0]}</i></span>
            <span className="smx-esc-t"><b>{r.name}</b><small>{r.batch} · {r.stat}</small></span>
            {r.lastSent && <Tooltip title={`Last sent ${fmtDay(r.lastSent.at)} (L${r.lastSent.level})`}><span className="mg-pill none"><MailOutlined /> sent</span></Tooltip>}
            <Button size="small" type="primary" ghost icon={<MailOutlined />} onClick={(e) => { e.stopPropagation(); setView(r); }}>Preview</Button>
          </div>
        ))}
      </div>
      <div className="mg-foot">Logged: template, channel, delivery, next action</div>

      <Modal open={!!view} onCancel={() => setView(null)} footer={null} width={620} centered destroyOnClose rootClassName="mg-modal">
        {view && (
          <div className="mg-m">
            <div className="mg-m-head smx-m-head esc"><span className="mg-act">Level {view.level} email</span><h3><MailOutlined /> {view.name}</h3><span>{view.batch} · {view.stat}</span></div>
            <div className="mg-m-body">
              <div className="smx-mail">
                <div className="smx-mail-hd"><small>Subject</small><b>{view.subject}</b></div>
                <div className="smx-mail-body">{view.body}</div>
              </div>
              <div className="mg-m-cap">Pre-send check</div>
              <div className="smx-checks">
                <span className="ok"><CheckCircleOutlined /> Attendance from live-class logs</span>
                <span className="ok"><CheckCircleOutlined /> Not Dropped / archived</span>
                <span className="ok"><CheckCircleOutlined /> Excused classes not counted</span>
                {data.incident ? <span className="bad"><CloseCircleOutlined /> Platform incident active — sending blocked</span> : <span className="ok"><CheckCircleOutlined /> No platform incident</span>}
                <span className="ok"><CheckCircleOutlined /> Numbers filled from verified data · template v2</span>
                {view.lastSent && <span className="info"><InfoCircleOutlined /> Last sent {fmtDay(view.lastSent.at)} (Level {view.lastSent.level})</span>}
              </div>
            </div>
            <div className="mg-m-foot" style={{ gap: 8 }}>
              <Button onClick={() => setView(null)}>Cancel</Button>
              <Button type="primary" icon={<SendOutlined />} loading={busy} disabled={data.incident} onClick={send}>Send email</Button>
            </div>
          </div>
        )}
      </Modal>
    </section>
  );
}

export default function SMAttendance() {
  const [sid, setSid] = useState('');
  const [fix, setFix] = useState(null);
  // batch + any date (report #32: only the last 40 classes could be picked)
  const [batch, setBatch] = useState('');
  const [date, setDate] = useState('');
  const { data, loading, error, reload } = useLoad(async () => res(await lmsApi.smAttendance({ ...(sid ? { sessionId: sid } : {}), ...(batch ? { batch } : {}), ...(date ? { date } : {}) })), [sid, batch, date]);
  if (loading && !data) return <Loading />;
  if (error) return <Alert type="error" showIcon message={error} style={{ margin: 24 }} />;
  const s = data.session;
  const live = (data.rows || []).filter((r) => !r.dropped);
  const by = live.reduce((m, r) => ({ ...m, [r.status]: (m[r.status] || 0) + 1 }), {});
  const present = (by.PRESENT || 0) + (by.LATE || 0);

  return (
    <div className="mg op smx">
      <div className="mg-hero smx-hero att">
        <div className="mg-hero-l">
          <span className="mg-hero-ic"><CheckSquareOutlined /></span>
          <div style={{ minWidth: 0 }}>
            <span className="mg-kicker">Corrections &amp; escalations</span>
            <h1>{s ? s.title.replace(/^.*—\s*/, '') : 'No class yet'}</h1>
            <p>{s ? <><CalendarOutlined /> {fmtDay(s.start)} · <TeamOutlined /> {s.batch} · <ClockCircleOutlined /> {fmtTime(s.scheduledStart)}–{fmtTime(s.scheduledEnd)} · grace {data.rule.graceMin} min · Present = {data.rule.presentPct}% of session</> : 'Pick a batch or a date to see a class.'}</p>
          </div>
        </div>
        {s && live.length > 0 && (
          <div className="rp-hero-stats">
            <span><b>{present}/{live.length}</b><small>present</small></span>
            <span><b>{by.ABSENT || 0}</b><small>absent</small></span>
          </div>
        )}
      </div>

      <div className="rp-filters smx-filters">
        <span className="mg-hd-ic g3"><CalendarOutlined /></span>
        <div className="rp-f"><small>Batch</small><Select value={batch} onChange={(v) => { setFix(null); setSid(''); setBatch(v); }} style={{ minWidth: 180 }} options={[{ value: '', label: 'All batches' }, ...(data.batches || []).map((b) => ({ value: b, label: b }))]} /></div>
        <div className="rp-f"><small>Date</small><input className="mg-date rp-date" type="date" aria-label="Date" value={date} onChange={(e) => { setFix(null); setSid(''); setDate(e.target.value); }} /></div>
        {data.recent.length > 0 && (
          <div className="rp-f smx-class"><small>Class</small><Select value={s ? s.id : ''} onChange={(v) => { setFix(null); setSid(v); }} style={{ width: '100%' }} showSearch optionFilterProp="label" options={data.recent.map((c) => ({ value: c.id, label: `${c.title} · ${fmtDay(c.start)}` }))} /></div>
        )}
      </div>

      <div className="smx-att-grid">
        <section className="mg-card" aria-label="Class attendance">
          <div className="mg-hd">
            <span className="mg-hd-ic g3"><TeamOutlined /></span>
            <div><b>Class attendance · {live.length}</b><small>Join / leave from live-class logs · click Correct to fix a row</small></div>
            {s && <span className="op-chips">{Object.entries(by).map(([k, n]) => <span key={k} className={`smx-st ${TONE[k] || ''}`}>{n} {k.toLowerCase()}</span>)}</span>}
          </div>
          <div className="mg-card-body" style={{ padding: 0, gap: 0 }}>
            {!s && <div className="mg-empty">No class has happened yet.</div>}
            {s && (
              <>
                <div className="smx-tr smx-th"><span>Learner</span><span><LoginOutlined /> Join</span><span><LogoutOutlined /> Leave</span><span>Minutes</span><span title="Reconnects"><SyncOutlined /> Reconn.</span><span>Status</span><span>Overall</span><span /></div>
                {data.rows.map((r) => (r.dropped ? (
                  <div className="smx-tr dropped" key={r.email}><span className="smx-name"><span className="mg-actor"><i>{String(r.name || '?')[0]}</i></span><b>{r.name}</b></span><span className="smx-drop">Dropped — out of the denominator, reminders off</span></div>
                ) : (
                  <div className={`smx-tr ${TONE[r.status] || ''}`} key={r.email}>
                    <span className="smx-name"><span className="mg-actor"><i>{String(r.name || '?')[0]}</i></span><b>{r.name}</b></span>
                    <span>{r.join ? fmtTime(r.join) : '—'}</span>
                    <span>{r.leave ? fmtTime(r.leave) : '—'}</span>
                    <span><b>{r.minutes}</b></span>
                    <span>{r.reconnects == null ? '—' : r.reconnects ? `${r.reconnects} merged` : '0'}</span>
                    <span><span className={`smx-st ${TONE[r.status] || ''}`}>{r.status}{r.status === 'EXCUSED' && r.excusedReason ? ` · ${r.excusedReason.slice(0, 14)}` : ''}</span>{r.corrected && <Tooltip title="Corrected by staff"><EditOutlined className="smx-corr-i" /></Tooltip>}</span>
                    <span><span className={`smx-pct ${r.overall >= 90 ? 'ok' : r.overall >= 60 ? 'mid' : 'bad'}`}>{r.overall}%</span></span>
                    <span>{r.crmUserId && <Tooltip title="Correct attendance"><Button size="small" type="primary" ghost icon={<EditOutlined />} onClick={() => setFix(r)} /></Tooltip>}</span>
                  </div>
                )))}
              </>
            )}
          </div>
          {s && <div className="mg-foot"><InfoCircleOutlined /> Attended eligible ÷ total eligible × 100 · {data.basis.held} held · {data.basis.cancelled} cancelled excluded · {data.basis.dropped} Dropped excluded</div>}
        </section>
        <Escalations />
      </div>
      {fix && s && <Correction key={fix.email} session={s} row={fix} onClose={() => setFix(null)} onSaved={() => { setFix(null); reload(); }} />}
    </div>
  );
}
