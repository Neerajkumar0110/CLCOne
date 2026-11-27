import React, { useState } from 'react';
import { Modal, Button, Input } from 'antd';
import {
  HeartOutlined, ReloadOutlined, ThunderboltOutlined, AlertOutlined, CloudServerOutlined, VideoCameraOutlined, DatabaseOutlined,
  GoogleOutlined, CreditCardOutlined, MailOutlined, WhatsAppOutlined, FontSizeOutlined, ApiOutlined, WarningOutlined,
  CheckCircleOutlined, SyncOutlined, AuditOutlined, SaveOutlined, FireOutlined,
} from '@ant-design/icons';
import lmsApi from '../api';
import { useLoad, act, Loading, fmtTime } from '../AdminOps/shared';
import '../AdminOps/mgmt.css';
import '../AdminOps/opsPages.css';

// Design A6 · System health & incidents (now inside LMS → Admin & Ops).
// Same live checks as before (/admin/system-health: DB, mailer, meeting
// provider, Razorpay, incident mode) plus per-job status and integration
// state from /admin/ops/health. Secrets are never returned by either.
// 2026-11-27 redesign: gradient hero, glowing service tiles (click → detail),
// equal-height jobs / incidents cards, incident-mode modal.
const JOB_TONE = { OK: 'ok', PAUSED: 'none', STALE: 'mid', 'NOT RUN': 'none' };
const SVC_IC = [
  [/crm/i, ApiOutlined], [/bigblue|bbb/i, VideoCameraOutlined], [/mongo/i, DatabaseOutlined], [/drive/i, GoogleOutlined],
  [/razorpay/i, CreditCardOutlined], [/mail|smtp/i, MailOutlined], [/whatsapp/i, WhatsAppOutlined], [/transcri/i, FontSizeOutlined],
];
const svcIcon = (name) => (SVC_IC.find(([re]) => re.test(name)) || [null, CloudServerOutlined])[1];
const STATE_LABEL = { ok: 'Healthy', warn: 'Attention', down: 'Down', off: 'Not set up' };

export default function SystemHealth() {
  const base = useLoad(() => lmsApi.systemHealth());
  const extra = useLoad(() => lmsApi.opsHealth());
  const [msg, setMsg] = useState('');
  const [asking, setAsking] = useState(false);
  const [svc, setSvc] = useState(null);
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
      ].filter(Boolean)
    : [];
  const okN = services.filter((s) => s.state === 'ok').length;

  const toggleIncident = async (active, message) => {
    if (await act(lmsApi.toggleIncidentMode(active, message), active ? 'Incident mode ON' : 'Incident mode cleared')) {
      setAsking(false);
      setMsg('');
      base.reload();
    }
  };
  const problems = b && x ? [
    [VideoCameraOutlined, 'Failed recordings', 'need re-processing', b.failedRecordings, 'mid'],
    [ApiOutlined, 'Failed / dead webhooks', 'payment & provider callbacks', b.failedWebhooks, 'bad'],
    [SyncOutlined, 'Failed sync jobs', 'enrolment / LMS sync', x.failedSync.length, 'mid'],
  ] : [];

  return (
    <div className="mg op">
      <div className={`mg-hero sh-hero${inc ? ' inc' : ''}`}>
        <div className="mg-hero-l">
          <span className="mg-hero-ic"><HeartOutlined /></span>
          <div style={{ minWidth: 0 }}>
            <span className="mg-kicker">System health &amp; incidents</span>
            <h1>{inc ? 'Incident mode is ON' : services.length && okN === services.length ? 'All systems healthy' : 'Live status of every service'}</h1>
            <p>Support Manager: view only · LMS Admin: retry / incident mode · secrets are never shown{b ? ` · checked ${fmtTime(b.checkedAt)}` : ''}</p>
          </div>
        </div>
        <div className="op-hero-r">
          {services.length > 0 && <div className="rp-hero-stats"><span><b>{okN}/{services.length}</b><small>services healthy</small></span></div>}
          <Button icon={<ReloadOutlined />} onClick={() => { base.reload(); extra.reload(); }}>Refresh</Button>
        </div>
      </div>
      {inc && <div className="sh-inc"><FireOutlined /> <span><b>Incident mode ON</b>{b.incidentMode.message ? ` · ${b.incidentMode.message}` : ''} · set by {b.incidentMode.setByName} · management alerted</span></div>}

      <Loading loading={base.loading || extra.loading} err={base.err || extra.err} data={b && x}>
        {b && x && (
          <>
            <div className="sh-svcs">
              {services.map((s) => {
                const Ic = svcIcon(s.name);
                return (
                  <button type="button" className={`sh-svc ${s.state || 'off'}`} key={s.name} onClick={() => setSvc(s)}>
                    <span className="sh-svc-top"><span className="sh-svc-ic"><Ic /></span><i className="sh-dot" /></span>
                    <b>{s.name}</b>
                    <small>{s.note}</small>
                  </button>
                );
              })}
            </div>

            <div className="mg-row sh-row">
              <section className="mg-card">
                <div className="mg-hd">
                  <span className="mg-hd-ic g2"><ThunderboltOutlined /></span>
                  <div><b>Background jobs</b><small>Idempotent · retries with backoff · paused from Automation</small></div>
                </div>
                <div className="mg-card-body" style={{ padding: 0, gap: 0 }}>
                  {x.jobs.map((j) => (
                    <div className="sh-job" key={j.name}>
                      <span className={`sh-job-ic ${JOB_TONE[j.state] || 'none'}`}><ThunderboltOutlined /></span>
                      <span className="sh-job-t"><b>{j.label}</b><small>every {j.every} · last run {j.lastRun ? fmtTime(j.lastRun) : '—'}</small></span>
                      <span className={`mg-pill ${JOB_TONE[j.state] || 'none'}`}>{j.state === 'NOT RUN' ? 'Not run' : j.state.charAt(0) + j.state.slice(1).toLowerCase()}</span>
                    </div>
                  ))}
                </div>
                <div className="mg-foot">“Not run” = this server process hasn&apos;t run the job since it started</div>
              </section>

              <section className="mg-card">
                <div className="mg-hd">
                  <span className="mg-hd-ic g6"><AlertOutlined /></span>
                  <div><b>Open incidents &amp; problems</b><small>Things that need someone to act</small></div>
                </div>
                <div className="mg-card-body" style={{ gap: 8 }}>
                  {problems.map(([Ic, t, s, nVal, tone]) => (
                    <div className={`sh-prob ${nVal ? tone : 'ok'}`} key={t}>
                      <span className="sh-prob-ic"><Ic /></span>
                      <span className="sh-prob-t"><b>{t}</b><small>{s}</small></span>
                      <b className="sh-prob-n">{nVal || <CheckCircleOutlined />}</b>
                    </div>
                  ))}
                  <div className="sh-prob info"><span className="sh-prob-ic"><AuditOutlined /></span><span className="sh-prob-t"><b>Audit activity</b><small>last 24 hours</small></span><b className="sh-prob-n">{b.auditActivity24h}</b></div>
                  <div className="sh-bk">
                    <span><SaveOutlined /> Last DB backup <b>managed by MongoDB Atlas</b></span>
                    <span><WarningOutlined /> Last restore drill <b className="warn">not recorded — schedule</b></span>
                  </div>
                </div>
                <div className="mg-foot sh-foot">
                  <span>Admin access is separate from learner sessions</span>
                  <Button type="primary" danger={!inc} icon={<FireOutlined />} onClick={() => (inc ? toggleIncident(false, '') : setAsking(true))}>{inc ? 'Exit incident mode' : 'Enter incident mode'}</Button>
                </div>
              </section>
            </div>
          </>
        )}
      </Loading>

      <Modal open={!!svc} onCancel={() => setSvc(null)} footer={null} width={480} centered destroyOnClose rootClassName="mg-modal">
        {svc && (() => {
          const Ic = svcIcon(svc.name);
          return (
            <div className="mg-m">
              <div className={`mg-m-head sh-m-head ${svc.state || 'off'}`}><span className="mg-act">{STATE_LABEL[svc.state] || svc.state}</span><h3><Ic /> {svc.name}</h3><span>Live check · {b ? fmtTime(b.checkedAt) : ''}</span></div>
              <div className="mg-m-body">
                <div className="mg-m-cap">Status</div>
                <div className="mg-m-box">{svc.note || '—'}</div>
                <div className="mg-m-id">Secrets and credentials for this service are never shown here.</div>
              </div>
              <div className="mg-m-foot"><Button type="primary" onClick={() => setSvc(null)}>Close</Button></div>
            </div>
          );
        })()}
      </Modal>

      <Modal open={asking} onCancel={() => setAsking(false)} footer={null} width={520} centered destroyOnClose rootClassName="mg-modal">
        <div className="mg-m">
          <div className="mg-m-head sh-m-head down"><span className="mg-act">Incident mode</span><h3><FireOutlined /> Enter incident mode</h3><span>Management is alerted · everyone sees the banner until you exit</span></div>
          <div className="mg-m-body">
            <label className="ao-label">What is happening? (shown to management)<Input.TextArea rows={4} value={msg} onChange={(e) => setMsg(e.target.value)} placeholder="e.g. BigBlueButton is down, classes moved to the stand-in room" /></label>
          </div>
          <div className="mg-m-foot" style={{ gap: 8 }}>
            <Button onClick={() => setAsking(false)}>Cancel</Button>
            <Button type="primary" danger icon={<FireOutlined />} onClick={() => toggleIncident(true, msg)}>Turn on</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
