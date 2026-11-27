import React, { useState } from 'react';
import { Modal, message, Button, Input, Select, Tooltip } from 'antd';
import {
  SafetyOutlined, LoginOutlined, DesktopOutlined, MobileOutlined, WarningOutlined, AuditOutlined, CopyOutlined,
  FilterOutlined, SearchOutlined, UserOutlined, FieldTimeOutlined, AlertOutlined, LockOutlined, CheckCircleOutlined,
} from '@ant-design/icons';
import lmsApi from '../api';
import { useLoad, Loading } from './shared';
import './mgmt.css';
import './reports.css';
import './security.css';

// Design A9 · Login, device, IP & audit (LMS testing report #29): a date range,
// a user / learner filter, audit search on any text, readable labels, a
// clickable time with the full record, and copy.
// 2026-11-27 redesign: gradient hero + KPI chips, filter card, equal-height
// login / alert cards, audit rows → modal with the full record.
const iso = (d) => new Date(d).toISOString().slice(0, 10);
const when = (d) => new Date(d).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: '2-digit', hour: '2-digit', minute: '2-digit' });
const copy = (text) => {
  try {
    navigator.clipboard.writeText(text);
    message.success('Copied');
  } catch (e) {
    message.error('Copy failed');
  }
};
const isMobile = (d) => /android|iphone|ipad|mobile/i.test(d || '');

export default function Security() {
  const [f, setF] = useState({ from: iso(Date.now() - 7 * 86400000), to: iso(Date.now()), user: '', q: '', module: 'all' });
  const [applied, setApplied] = useState(f);
  const [open, setOpen] = useState(null);
  const [loginF, setLoginF] = useState('all');
  const { data, loading, err } = useLoad(() => lmsApi.opsSecurity(applied), [JSON.stringify(applied)]);
  const apply = (e) => {
    if (e) e.preventDefault();
    setApplied(f);
  };
  const auditText = (a) => `${when(a.at)} | ${a.eventId} | ${a.label} | ${a.change} | ${a.reason || ''}`;

  const logins = (data && data.logins) || [];
  const openN = logins.filter((l) => l.open).length;
  const newN = logins.filter((l) => l.newDevice || l.newIp).length;
  const shownLogins = logins.filter((l) => loginF === 'all' || (loginF === 'new' ? l.newDevice || l.newIp : l.open));

  return (
    <div className="mg sc">
      <div className="mg-hero sc-hero">
        <div className="mg-hero-l">
          <span className="mg-hero-ic"><SafetyOutlined /></span>
          <div style={{ minWidth: 0 }}>
            <span className="mg-kicker">Security · spec §18 · authorised roles only</span>
            <h1>Login monitoring &amp; audit</h1>
            <p>Who signed in, from which device and IP, and every recorded change. Signals are for review, not proof · scope / retention = D-09, D-15.</p>
          </div>
        </div>
        {data && (
          <div className="rp-hero-stats">
            <span><b>{logins.length}</b><small>logins</small></span>
            <span><b>{openN}</b><small>open now</small></span>
            <span><b>{newN}</b><small>new device / IP</small></span>
            <span><b>{data.alerts.length}</b><small>alerts</small></span>
          </div>
        )}
      </div>

      <form className="rp-filters" onSubmit={apply}>
        <span className="mg-hd-ic g2"><FilterOutlined /></span>
        <div className="rp-f"><small>From</small><input type="date" className="mg-date rp-date" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} /></div>
        <div className="rp-f"><small>To</small><input type="date" className="mg-date rp-date" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} /></div>
        <div className="rp-f"><small>User / learner</small><Input prefix={<UserOutlined />} style={{ width: 210 }} placeholder="Name or email" value={f.user} onChange={(e) => setF({ ...f, user: e.target.value })} aria-label="User filter" /></div>
        <div className="rp-f"><small>Audit search</small><Input prefix={<SearchOutlined />} style={{ width: 240 }} placeholder="Actor, action, reason, event ID" value={f.q} onChange={(e) => setF({ ...f, q: e.target.value })} aria-label="Audit search" /></div>
        <div className="rp-f"><small>Object</small><Select style={{ minWidth: 150 }} value={f.module} onChange={(v) => setF({ ...f, module: v })} options={[{ value: 'all', label: 'All objects' }, ...((data && data.modules) || []).map((m) => ({ value: m, label: m }))]} /></div>
        <Button type="primary" htmlType="submit" className="sc-apply">Apply</Button>
      </form>

      <Loading loading={loading} err={err} data={data}>
        {data && (
          <>
            <div className="mg-row sc-row">
              <section className="mg-card" aria-label="Login activity">
                <div className="mg-hd">
                  <span className="mg-hd-ic g3"><LoginOutlined /></span>
                  <div><b>Login activity · {logins.length}</b><small>Device + IP per session · “new” = not used in the last 30 days</small></div>
                  <span className="sc-seg">
                    {[['all', 'All'], ['new', `New · ${newN}`], ['open', `Open · ${openN}`]].map(([k, l]) => (
                      <button key={k} type="button" className={loginF === k ? 'on' : ''} onClick={() => setLoginF(k)}>{l}</button>
                    ))}
                  </span>
                </div>
                <div className="mg-card-body" style={{ padding: 0, gap: 0 }}>
                  {shownLogins.length === 0 && <div className="mg-empty">No logins here.</div>}
                  {shownLogins.map((l, i) => {
                    const flag = l.newDevice || l.newIp;
                    return (
                      <div className={`sc-login${flag ? ' new' : ''}`} key={i}>
                        <span className="mg-actor"><i>{String(l.user || '?').trim()[0]}</i></span>
                        <span className="sc-login-u"><b>{l.user}</b><small>{l.role || '—'} · {when(l.at)}</small></span>
                        <span className="sc-login-d">
                          <span className="sc-dev">{isMobile(l.device) ? <MobileOutlined /> : <DesktopOutlined />} {l.device || 'Unknown device'}</span>
                          {l.ip && <code>{l.ip}</code>}
                        </span>
                        <span className="sc-login-r">
                          {flag ? <span className="mg-pill mid">{l.newDevice ? 'New device' : 'New IP'}</span> : <span className="mg-pill ok">OK</span>}
                          <small className={l.open ? 'live' : ''}>{l.open ? <><i /> still open</> : l.minutes !== null ? `${l.minutes} min` : 'closed'}</small>
                        </span>
                      </div>
                    );
                  })}
                </div>
              </section>

              <section className="mg-card" aria-label="Suspicious-pattern alerts">
                <div className="mg-hd">
                  <span className="mg-hd-ic g6"><AlertOutlined /></span>
                  <div><b>Suspicious-pattern alerts</b><small>Concurrent sessions and new devices / IPs</small></div>
                  <span className={`mg-pill ${data.alerts.length ? 'mid' : 'ok'}`}>{data.alerts.length ? `${data.alerts.length} to review` : 'All clear'}</span>
                </div>
                <div className="mg-card-body">
                  {data.alerts.length === 0 ? (
                    <div className="mg-clear"><SafetyOutlined /><b>No alerts</b><span>No concurrent sessions or new devices in this range.</span></div>
                  ) : data.alerts.map((a) => (
                    <div className={`sc-alert ${/concurrent/i.test(a.kind) ? 'conc' : ''}`} key={a.text}>
                      <span className="sc-alert-ic">{/concurrent/i.test(a.kind) ? <WarningOutlined /> : isMobile(a.text) ? <MobileOutlined /> : <DesktopOutlined />}</span>
                      <span className="sc-alert-t"><small>{a.kind}</small><b>{a.text}</b></span>
                      <span className="mg-pill mid">Review</span>
                    </div>
                  ))}
                </div>
                <div className="mg-foot">A new-device sign-in also emails the account owner · Ops reviews alerts, the decision is logged</div>
              </section>
            </div>

            <section className="mg-card mg-audit" aria-label="Audit log">
              <div className="mg-hd">
                <span className="mg-hd-ic g1"><AuditOutlined /></span>
                <div><b>Audit log · {data.audit.length}{data.auditTotal > data.audit.length ? ` of ${data.auditTotal}` : ''}</b><small>Append-only · nobody can edit or delete · click a row for the full record</small></div>
                <Button icon={<CopyOutlined />} onClick={() => copy(data.audit.map(auditText).join('\n'))}>Copy all</Button>
              </div>
              <div className="mg-tbl">
                <div className="mg-tr sc-tr mg-th"><span>Time</span><span>What happened</span><span>Old → new</span><span>Reason</span><span>Source</span><span>Event ID</span><span /></div>
                {data.audit.length === 0 && <div className="mg-empty">No matching events.</div>}
                {data.audit.map((a) => (
                  <div className="mg-tr sc-tr" key={a.id} role="button" tabIndex={0} onClick={() => setOpen(a)} onKeyDown={(e) => { if (e.key === 'Enter') setOpen(a); }}>
                    <span className="mg-time">{when(a.at)}</span>
                    <span className="mg-obj" title={a.label}>{a.label}</span>
                    <span className="mg-chg" title={a.change}>{a.change || '—'}</span>
                    <span className="mg-rsn" title={a.reason}>{a.reason || '—'}</span>
                    <span><span className={`sc-src ${a.source === 'job' ? 'job' : ''}`}>{a.source}</span></span>
                    <span><code className="sc-ev">{a.eventId}</code></span>
                    <span><Tooltip title="Copy this event"><Button size="small" type="text" icon={<CopyOutlined />} onClick={(e) => { e.stopPropagation(); copy(auditText(a)); }} /></Tooltip></span>
                  </div>
                ))}
              </div>
            </section>

            <section className="mg-card sc-ret" aria-label="Notice and retention">
              <div className="mg-hd">
                <span className="mg-hd-ic g4"><FieldTimeOutlined /></span>
                <div><b>Notice &amp; retention</b><small>How long each kind of record is kept</small></div>
                <span className="mg-pill none">D-09 · D-15</span>
              </div>
              <div className="sc-ret-grid">
                {data.retention.map((r) => (
                  (() => {
                  const [Ic, g] = /login/i.test(r.label) ? [LoginOutlined, 'g3'] : /audit/i.test(r.label) ? [AuditOutlined, 'g1'] : /record/i.test(r.label) ? [FieldTimeOutlined, 'g4'] : /proctor/i.test(r.label) ? [SafetyOutlined, 'g5'] : [LockOutlined, 'g2'];
                  return (
                    <div className="sc-ret-i" key={r.label}>
                      <span className={`sc-ret-ic ${g}`}><Ic /></span>
                      <div className="sc-ret-t"><small>{r.label}</small><b>{r.value}</b></div>
                    </div>
                  );
                })()
                ))}
              </div>
            </section>
          </>
        )}
      </Loading>

      <Modal open={!!open} onCancel={() => setOpen(null)} footer={null} width={680} centered destroyOnClose rootClassName="mg-modal">
        {open && (
          <div className="mg-m" style={{ userSelect: 'text' }}>
            <div className="mg-m-head sc-m-head">
              <span className="mg-act">{open.module}</span> <span className="mg-act2">{open.action}</span>
              <h3>{open.label}</h3>
              <span>{new Date(open.at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} IST · by <b>{open.actor}</b>{open.role ? ` (${open.role})` : ''}</span>
            </div>
            <div className="mg-m-body">
              <div className="sc-m-kv">
                <span><small>Event ID</small><code>{open.eventId}</code></span>
                <span><small>Source</small><b>{open.source}</b></span>
              </div>
              <div className="mg-m-cap">Old → New</div>
              <div className="mg-m-box mono">{open.change || '—'}</div>
              {open.reason && <><div className="mg-m-cap">Reason</div><div className="mg-m-box">{open.reason}</div></>}
              <div className="mg-m-cap">Full record</div>
              <pre className="sc-pre">{JSON.stringify({ before: open.before, after: open.after, meta: open.meta }, null, 2)}</pre>
            </div>
            <div className="mg-m-foot" style={{ justifyContent: 'space-between' }}>
              <Button icon={<CopyOutlined />} onClick={() => copy(JSON.stringify(open, null, 2))}>Copy record</Button>
              <Button type="primary" icon={<CheckCircleOutlined />} onClick={() => setOpen(null)}>Close</Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
