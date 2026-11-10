import React, { useEffect, useMemo, useState } from 'react';
import { Alert, message } from 'antd';
import lmsApi from '../api';
import { SMPage, useLoad, Loading, res, fmtTime, errText } from './shared';

// S4 — communications centre: templates (list | editor with variable chips
// and send-blocking validation | preview), automation rules (pause / resume
// for an LMS admin, read-only otherwise) and today's delivery log. Templates
// use the existing /admin/communication/templates API.

const KNOWN = ['learner_name', 'batch', 'class_time', 'join_link', 'record_date', 'consecutive_days', 'start_date', 'end_date', 'attendance_pct', 'threshold', 'gap', 'test_name', 'due_date', 'certificate_id', 'pm_name'];
const SAMPLE = { learner_name: 'Arjun Das', batch: 'Evening', class_time: '6:00 PM', join_link: 'https://…/learn/classes', consecutive_days: '12', start_date: '16 Oct', end_date: '27 Oct', record_date: '28 Oct', attendance_pct: '52', threshold: '90', gap: '38', test_name: 'NLP Basics', due_date: '2 Nov', certificate_id: 'CLC-…', pm_name: 'Aman' };
const varsOf = (txt) => [...new Set((String(txt || '').match(/\{\{\s*([a-z0-9_]+)\s*\}\}/gi) || []).map((m) => m.replace(/[{}\s]/g, '')))];
const BLANK = { id: null, name: '', subject: '', html: '', enabled: true, eventKey: '' };
const STATUS_CHIP = { sent: ['hai', 'Delivered'], failed: ['red', 'Bounced / failed'] };

function Editor({ tpl, onSaved }) {
  const [t, setT] = useState(tpl);
  const [busy, setBusy] = useState('');
  const [preview, setPreview] = useState(false);
  useEffect(() => {
    setT(tpl);
    setPreview(false);
  }, [tpl]);
  const vars = useMemo(() => varsOf(`${t.subject} ${t.html}`), [t]);
  const unknown = vars.filter((v) => !KNOWN.includes(v));
  const fill = (s) => String(s || '').replace(/\{\{\s*([a-z0-9_]+)\s*\}\}/gi, (_, k) => SAMPLE[k] || `{{${k}}}`);
  const save = async (asNew) => {
    if (!t.name.trim()) return message.warning('Template ka naam likhein.');
    if (unknown.length) return message.warning(`Unknown variable: ${unknown.join(', ')}`);
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
  };
  return (
    <section className="ld-card" aria-label="Template editor">
      <div className="ld-hd">
        <input className="ld-inp" style={{ flex: 1, fontWeight: 700 }} aria-label="Template name" placeholder="Template name, e.g. Absence L3 warning" value={t.name} onChange={(e) => setT({ ...t, name: e.target.value })} />
        <span className={`ld-chip ${t.enabled ? 'hai' : 'gray'}`}>{t.enabled ? 'ENABLED' : 'DRAFT'}</span>
      </div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
        <span className="ld-muted" style={{ fontSize: 12 }}>Variables:</span>
        {vars.length === 0 && <span className="ld-muted" style={{ fontSize: 12 }}>none — type {'{{learner_name}}'}</span>}
        {vars.map((v) => <span key={v} className={`sm-var${KNOWN.includes(v) ? '' : ' bad'}`}>{v}</span>)}
      </div>
      <input className="ld-inp" aria-label="Subject" placeholder="Subject" value={t.subject} onChange={(e) => setT({ ...t, subject: e.target.value })} />
      {preview ? (
        <div className="sm-mail" style={{ flex: 1 }}><b>Subject: {fill(t.subject)}</b><span style={{ whiteSpace: 'pre-wrap' }}>{fill(t.html).replace(/<[^>]+>/g, '')}</span></div>
      ) : (
        <textarea className="ld-inp" aria-label="Body" style={{ flex: 1, minHeight: 200, padding: 12, lineHeight: '20px', resize: 'vertical' }} placeholder={'Dear {{learner_name}},\n…'} value={t.html} onChange={(e) => setT({ ...t, html: e.target.value })} />
      )}
      {unknown.length > 0 && <div className="pm-alert">Validation: <b>{unknown.join(', ')}</b> — unknown variable, send blocked jab tak theek na ho</div>}
      <label className="pm-check"><input type="checkbox" checked={t.enabled} onChange={(e) => setT({ ...t, enabled: e.target.checked })} /> Enabled (unchecked = draft)</label>
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
        <button type="button" className="ld-btn2" onClick={() => setPreview(!preview)}>{preview ? 'Edit' : 'Preview for Arjun D.'}</button>
        {t.id && <button type="button" className="ld-btn2" disabled={!!busy} onClick={() => save(true)}>New version</button>}
        <button type="button" className="ld-btn" disabled={!!busy || unknown.length > 0} onClick={() => save(false)}>{busy === 'save' ? 'Saving…' : t.id ? 'Save template' : 'Create template'}</button>
      </div>
    </section>
  );
}

export default function SMComms() {
  const [sel, setSel] = useState(null);
  const { data, loading, error, reload } = useLoad(async () => res(await lmsApi.smComms()), []);
  useEffect(() => {
    if (data && sel === null) setSel(data.templates[0] ? data.templates[0].id : 'new');
  }, [data, sel]);
  if (loading && !data) return <Loading />;
  if (error) return <Alert type="error" showIcon message={error} style={{ margin: 24 }} />;
  const cur = sel === 'new' ? BLANK : data.templates.find((t) => t.id === sel) || BLANK;
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
  return (
    <SMPage title="Communications centre">
      <div className="sm-g" style={{ display: 'grid', gridTemplateColumns: '260px minmax(0, 1fr) 400px', gap: 14, flex: 1, minHeight: 0 }}>
        <section className="ld-card" style={{ gap: 4 }} aria-label="Templates">
          <div className="ld-hd" style={{ marginBottom: 6 }}><b style={{ fontSize: 14 }}>Templates</b><button type="button" className="ld-link" style={{ fontSize: 12 }} onClick={() => setSel('new')}>+ New</button></div>
          {data.templates.length === 0 && <div className="ld-empty">Abhi koi saved template nahi — system emails code mein hain. Naya template banayein.</div>}
          {data.templates.map((t) => (
            <button key={t.id} type="button" className={`sm-tp${sel === t.id ? ' on' : ''}`} onClick={() => setSel(t.id)}>
              <b>{t.name}</b>
              <span className="ld-muted">{t.channel} · {t.enabled ? 'enabled' : 'draft'}{t.variables.length ? ` · ${t.variables.length} vars` : ''}</span>
            </button>
          ))}
          {sel === 'new' && <div className="sm-tp on"><b>New template</b><span className="ld-muted">email · draft</span></div>}
        </section>

        <Editor tpl={cur} onSaved={(id) => { if (id) setSel(String(id)); reload(); }} />

        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, minHeight: 0 }}>
          <section className="ld-card" aria-label="Automation rules">
            <div className="ld-hd"><b style={{ fontSize: 14 }}>Automation rules</b><span className="ld-muted" style={{ fontSize: 12 }}>{data.automation.filter((r) => r.running).length} running</span></div>
            {data.automation.filter((r) => r.automated).map((r) => (
              <div key={r.key} className="ld-li" style={{ padding: '8px 0' }}>
                <span>{r.name}<br /><span className="ld-muted" style={{ fontSize: 12 }}>{r.when}</span></span>
                {r.pausable && data.canToggle ? (
                  <button type="button" className={r.running ? 'ld-btn sm' : 'ld-btn2 sm'} onClick={() => toggle(r)}>{r.running ? 'Running · pause' : 'Paused · resume'}</button>
                ) : (
                  <span className={`ld-chip ${r.running ? 'hai' : 'gray'}`}>{r.running ? 'Running' : 'Paused'}</span>
                )}
              </div>
            ))}
            <div className="ld-muted" style={{ fontSize: 12 }}>{data.canToggle ? 'Pause karne par naam log hota hai' : 'Pause / resume sirf LMS admin (Admin & Ops → Automation)'} · Dropped / archived learners auto-excluded</div>
          </section>
          <section className="ld-card" style={{ flex: 1 }} aria-label="Delivery log">
            <div className="ld-hd"><b style={{ fontSize: 14 }}>Delivery log (today)</b><span className="ld-muted" style={{ fontSize: 12 }}>{data.totals.sent} sent · {data.totals.failed} failed</span></div>
            {data.log.length === 0 && <div className="ld-empty">Aaj abhi tak koi email nahi gaya.</div>}
            {data.log.length > 0 && (
              <table className="ld-table" style={{ fontSize: 12 }}>
                <thead><tr><th>Time</th><th>Template</th><th>To</th><th>Status</th></tr></thead>
                <tbody>
                  {data.log.map((l, i) => {
                    const [c, label] = STATUS_CHIP[l.status] || ['gray', l.status];
                    return (
                      <tr key={i}>
                        <td>{fmtTime(l.at)}</td>
                        <td>{l.template}</td>
                        <td>{l.count > 1 ? `${l.count} learners` : l.sample}</td>
                        <td><span className={`ld-chip ${c}`} title={l.error}>{label}{l.count > 1 ? ` ${l.count}` : ''}</span></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </section>
        </div>
      </div>
    </SMPage>
  );
}
