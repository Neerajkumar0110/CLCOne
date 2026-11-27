import React, { useEffect, useMemo, useState } from 'react';
import { Alert, message, Modal, Button, Input, Switch, Tooltip } from 'antd';
import {
  MailOutlined, PlusOutlined, ThunderboltOutlined, SendOutlined, CloseCircleOutlined, FileTextOutlined, EyeOutlined,
  EditOutlined, CopyOutlined, SaveOutlined, CheckCircleOutlined, WarningOutlined, HistoryOutlined, NotificationOutlined,
} from '@ant-design/icons';
import lmsApi from '../api';
import { useLoad, Loading, res, fmtTime, errText } from './shared';
import '../AdminOps/mgmt.css';
import '../AdminOps/opsPages.css';
import './smDesign.css';
import './comms.css';

// S4 — communications centre: templates (list | editor with variable chips
// and send-blocking validation | preview), automation rules (pause / resume
// for an LMS admin, read-only otherwise) and today's delivery log. Templates
// use the existing /admin/communication/templates API.
// 2026-11-27 redesign: gradient hero + stats, template cards, the editor
// opens in a wide modal with a live preview, equal-height rules / log cards.

const KNOWN = ['name', 'email', 'course', 'ticket_no', 'learner_email', 'learner_name', 'batch', 'class_time', 'join_link', 'record_date', 'consecutive_days', 'start_date', 'end_date', 'attendance_pct', 'threshold', 'gap', 'test_name', 'due_date', 'certificate_id', 'pm_name'];
const SAMPLE = { learner_name: 'Arjun Das', batch: 'Evening', class_time: '6:00 PM', join_link: 'https://…/learn/classes', consecutive_days: '12', start_date: '16 Oct', end_date: '27 Oct', record_date: '28 Oct', attendance_pct: '52', threshold: '90', gap: '38', test_name: 'NLP Basics', due_date: '2 Nov', certificate_id: 'CLC-…', pm_name: 'Aman' };
const varsOf = (txt) => [...new Set((String(txt || '').match(/\{\{\s*([a-z0-9_]+)\s*\}\}/gi) || []).map((m) => m.replace(/[{}\s]/g, '')))];
const BLANK = { id: null, name: '', subject: '', html: '', enabled: true, eventKey: '' };
const STATUS_TONE = { sent: ['ok', 'Delivered'], failed: ['bad', 'Bounced / failed'] };
const plain = (s) => String(s || '').replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>/gi, '\n\n').replace(/<[^>]+>/g, '');

function Editor({ tpl, onClose, onSaved }) {
  const [t, setT] = useState(tpl);
  const [busy, setBusy] = useState('');
  useEffect(() => { setT(tpl); }, [tpl]);
  const vars = useMemo(() => varsOf(`${t.subject} ${t.html}`), [t]);
  const unknown = vars.filter((v) => !KNOWN.includes(v));
  const fill = (s) => String(s || '').replace(/\{\{\s*([a-z0-9_]+)\s*\}\}/gi, (_, k) => SAMPLE[k] || `{{${k}}}`);
  const insert = (v) => setT((x) => ({ ...x, html: `${x.html}{{${v}}}` }));
  const save = async (asNew) => {
    if (!t.name.trim()) return message.warning('Write the template name.');
    // unknown variables are kept as typed (shown below) — they no longer block the save (report #33)
    if (unknown.length) message.warning(`Not a known variable (kept as typed): ${unknown.join(', ')}`, 5);
    setBusy(asNew ? 'new' : 'save');
    try {
      const body = { name: asNew && t.id ? `${t.name} (new version)` : t.name, subject: t.subject, html: t.html, enabled: t.enabled, eventKey: t.eventKey };
      const r = t.id && !asNew ? await lmsApi.smTemplateUpdate(t.id, body) : await lmsApi.smTemplateCreate(body);
      if (r && r.success === false) throw new Error(r.message);
      message.success(asNew ? 'New version saved.' : 'Template saved.');
      onSaved(res(r) && (res(r)._id || res(r).id));
    } catch (e) {
      message.error(errText(e, 'Could not save.'));
    } finally {
      setBusy('');
    }
    return null;
  };
  return (
    <Modal open onCancel={onClose} footer={null} width={1100} centered destroyOnClose maskClosable={false} rootClassName="mg-modal">
      <div className="mg-m">
        <div className="mg-m-head cm-m-head">
          <span className="mg-act">{t.id ? 'Edit template' : 'New template'}</span>
          <h3><MailOutlined /> {t.name || 'Untitled template'}</h3>
          <span>Email · {t.enabled ? 'enabled — used by the system' : 'draft — not sent'}{vars.length ? ` · ${vars.length} variable(s)` : ''}</span>
        </div>
        <div className="mg-m-body cm-ed">
          <div className="cm-ed-l">
            <label className="ao-label">Template name<Input value={t.name} onChange={(e) => setT({ ...t, name: e.target.value })} placeholder="e.g. Absence L3 warning" /></label>
            <label className="ao-label">Subject<Input value={t.subject} onChange={(e) => setT({ ...t, subject: e.target.value })} placeholder="Subject line" /></label>
            <label className="ao-label cm-body-l">Body<Input.TextArea value={t.html} onChange={(e) => setT({ ...t, html: e.target.value })} placeholder={'Dear {{learner_name}},\n…'} /></label>
            <div className="cm-vars">
              <small>Insert a variable</small>
              <div>{KNOWN.slice(5, 20).map((v) => <button key={v} type="button" className={`cm-var${vars.includes(v) ? ' used' : ''}`} onClick={() => insert(v)}>{v}</button>)}</div>
            </div>
            {unknown.length > 0 && <div className="cm-warn"><WarningOutlined /> Unknown variable{unknown.length > 1 ? 's' : ''}: <b>{unknown.join(', ')}</b> — kept as typed</div>}
          </div>
          <div className="cm-ed-r">
            <div className="cm-pv-cap"><EyeOutlined /> Live preview · as Arjun D. would see it</div>
            <div className="cm-pv">
              <div className="cm-pv-hd"><small>Subject</small><b>{fill(t.subject) || '—'}</b></div>
              <div className="cm-pv-body">{plain(fill(t.html)) || <span className="cm-pv-empty">The body will show here as you type.</span>}</div>
            </div>
          </div>
        </div>
        <div className="mg-m-foot cm-foot">
          <span className="cm-en"><Switch checked={t.enabled} onChange={(v) => setT({ ...t, enabled: v })} /> {t.enabled ? 'Enabled' : 'Draft'}</span>
          <span className="op-chips">
            <Button onClick={onClose}>Cancel</Button>
            {t.id && <Button icon={<CopyOutlined />} loading={busy === 'new'} disabled={!!busy} onClick={() => save(true)}>Save as new version</Button>}
            <Button type="primary" icon={<SaveOutlined />} loading={busy === 'save'} disabled={!!busy} onClick={() => save(false)}>{t.id ? 'Save template' : 'Create template'}</Button>
          </span>
        </div>
      </div>
    </Modal>
  );
}

export default function SMComms() {
  const [sel, setSel] = useState(null); // template id | 'new' | null (closed)
  const [logView, setLogView] = useState(null);
  const { data, loading, error, reload } = useLoad(async () => res(await lmsApi.smComms()), []);
  if (loading && !data) return <Loading />;
  if (error) return <Alert type="error" showIcon message={error} style={{ margin: 24 }} />;
  const cur = sel === 'new' ? BLANK : (sel && data.templates.find((t) => t.id === sel)) || null;
  const toggle = async (r) => {
    try {
      const out = await lmsApi.opsAutomationToggle(r.key, !r.running);
      if (out && out.success === false) throw new Error(out.message);
      message.success(r.running ? 'Paused — reason + name logged.' : 'Resumed.');
      reload();
    } catch (e) {
      message.error(errText(e, 'Could not change.'));
    }
  };
  const rules = data.automation.filter((r) => r.automated);
  const running = data.automation.filter((r) => r.running).length;

  return (
    <div className="mg op cm">
      <div className="mg-hero cm-hero">
        <div className="mg-hero-l">
          <span className="mg-hero-ic"><NotificationOutlined /></span>
          <div style={{ minWidth: 0 }}>
            <span className="mg-kicker">Communications centre</span>
            <h1>Emails, templates &amp; automation</h1>
            <p>Edit the email templates the LMS sends, see which automatic rules are running, and check what went out today. Dropped / archived learners are excluded automatically.</p>
          </div>
        </div>
        <div className="rp-hero-stats">
          <span><b>{data.templates.length}</b><small>templates</small></span>
          <span><b>{running}</b><small>rules running</small></span>
          <span><b>{data.totals.sent}</b><small>sent today</small></span>
          <span><b>{data.totals.failed}</b><small>failed</small></span>
        </div>
      </div>

      <section className="mg-card">
        <div className="mg-hd">
          <span className="mg-hd-ic g5"><FileTextOutlined /></span>
          <div><b>Templates · {data.templates.length}</b><small>Click a template to edit it with a live preview</small></div>
          <Button type="primary" icon={<PlusOutlined />} className="cm-new" onClick={() => setSel('new')}>New template</Button>
        </div>
        <div className="cm-tpls">
          {data.templates.map((t) => (
            <button key={t.id} type="button" className={`cm-tpl${t.enabled ? '' : ' draft'}`} onClick={() => setSel(t.id)}>
              <span className="cm-tpl-top"><span className="cm-tpl-ic"><MailOutlined /></span><span className={`mg-pill ${t.enabled ? 'ok' : 'none'}`}>{t.enabled ? 'Enabled' : 'Draft'}</span></span>
              <b>{t.name}</b>
              <small className="cm-tpl-sub">{t.subject || 'No subject yet'}</small>
              <span className="cm-tpl-foot"><span>{t.channel}</span>{t.variables.length ? <span>{t.variables.length} variable(s)</span> : null}<span className="cm-tpl-edit"><EditOutlined /> Edit</span></span>
            </button>
          ))}
          <button type="button" className="cm-tpl add" onClick={() => setSel('new')}>
            <span className="cm-add-ic"><PlusOutlined /></span>
            <b>New template</b>
            <small className="cm-tpl-sub">Start a blank email template</small>
          </button>
        </div>
      </section>

      <div className="mg-row cm-row">
        <section className="mg-card" aria-label="Automation rules">
          <div className="mg-hd">
            <span className="mg-hd-ic g2"><ThunderboltOutlined /></span>
            <div><b>Automation rules</b><small>{data.canToggle ? 'Pausing logs your name' : 'Pause / resume by LMS admin only (Admin & Ops → Automation)'}</small></div>
            <span className="mg-pill ok">{running} running</span>
          </div>
          <div className="mg-card-body" style={{ padding: 0, gap: 0 }}>
            {rules.map((r) => (
              <div key={r.key} className="cm-rule">
                <span className={`cm-rule-ic ${r.running ? 'on' : ''}`}><ThunderboltOutlined /></span>
                <span className="cm-rule-t"><b>{r.name}</b><small>{r.when}</small></span>
                {r.pausable && data.canToggle ? (
                  <Tooltip title={r.running ? 'Pause' : 'Resume'}><span className="au-sw"><Switch size="small" checked={r.running} onChange={() => toggle(r)} /><b className={r.running ? 'on' : ''}>{r.running ? 'Running' : 'Paused'}</b></span></Tooltip>
                ) : (
                  <span className={`mg-pill ${r.running ? 'ok' : 'none'}`}>{r.running ? 'Running' : 'Paused'}</span>
                )}
              </div>
            ))}
          </div>
        </section>

        <section className="mg-card" aria-label="Delivery log">
          <div className="mg-hd">
            <span className="mg-hd-ic g6"><HistoryOutlined /></span>
            <div><b>Delivery log · today</b><small>Click a row for the details</small></div>
            <span className="op-chips"><span className="mg-pill ok"><SendOutlined /> {data.totals.sent}</span><span className={`mg-pill ${data.totals.failed ? 'bad' : 'none'}`}><CloseCircleOutlined /> {data.totals.failed}</span></span>
          </div>
          <div className="mg-card-body" style={{ padding: 0, gap: 0 }}>
            {data.log.length === 0 && <div className="smx-clear"><MailOutlined /><b>Nothing sent yet today</b><span>Emails will show up here as they go out.</span></div>}
            {data.log.map((l, i) => {
              const [tone, label] = STATUS_TONE[l.status] || ['none', l.status];
              return (
                <div key={i} className={`cm-log ${tone}`} role="button" tabIndex={0} onClick={() => setLogView(l)} onKeyDown={(e) => { if (e.key === 'Enter') setLogView(l); }}>
                  <span className="cm-log-time">{fmtTime(l.at)}</span>
                  <span className="cm-log-t"><b>{l.template}</b><small>{l.count > 1 ? `${l.count} learners` : l.sample}</small></span>
                  <span className={`mg-pill ${tone}`}>{label}{l.count > 1 ? ` · ${l.count}` : ''}</span>
                </div>
              );
            })}
          </div>
        </section>
      </div>

      {cur && <Editor key={String(sel)} tpl={cur} onClose={() => setSel(null)} onSaved={(id) => { setSel(id ? String(id) : null); reload(); }} />}

      <Modal open={!!logView} onCancel={() => setLogView(null)} footer={null} width={520} centered destroyOnClose rootClassName="mg-modal">
        {logView && (
          <div className="mg-m">
            <div className={`mg-m-head cm-m-head ${logView.status === 'failed' ? 'bad' : ''}`}><span className="mg-act">{(STATUS_TONE[logView.status] || [null, logView.status])[1]}</span><h3><MailOutlined /> {logView.template}</h3><span>{fmtTime(logView.at)} today</span></div>
            <div className="mg-m-body">
              <div className="mg-m-cap">Sent to</div>
              <div className="mg-m-box">{logView.count > 1 ? `${logView.count} learners (e.g. ${logView.sample})` : logView.sample}</div>
              {logView.error && <><div className="mg-m-cap">Error</div><div className="mg-m-box mono">{logView.error}</div></>}
              {!logView.error && logView.status === 'sent' && <div className="smx-checks"><span className="ok"><CheckCircleOutlined /> Accepted by the mail server</span></div>}
            </div>
            <div className="mg-m-foot"><Button type="primary" onClick={() => setLogView(null)}>Close</Button></div>
          </div>
        )}
      </Modal>
    </div>
  );
}
