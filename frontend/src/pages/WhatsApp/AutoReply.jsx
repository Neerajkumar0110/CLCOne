import React, { useEffect, useMemo, useState } from 'react';
import { message } from 'antd';
import waApi from './api';

// Messenger › WhatsApp › Auto-reply (admins): when an ad chat opens with
// "Hello! Can I get more info on this?", the customer gets the welcome message
// + their own enquiry-form link at once; when they submit the form, the
// curriculum link (per program, or the default) goes in the same chat.
// Backend: services/whatsapp/autoReply.js.

// same names as the enquiry form (backend corePublicControllers/enquiryForm.js PROGRAMS)
const PROGRAMS = ['Data Science & AI', 'Machine Learning', 'Generative AI & LLMs', 'AI Agents & Automation', 'Data Analytics', 'Python with AI', 'Digital Marketing with AI'];

const fill = (tpl, vars) => String(tpl || '').replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null ? vars[k] : ''));
// WhatsApp-style *bold* in the preview
const WaText = ({ text }) => (
  <>
    {String(text)
      .split(/(\*[^*\n]+\*)/g)
      .map((part, i) => (part.startsWith('*') && part.endsWith('*') && part.length > 2 ? <b key={i}>{part.slice(1, -1)}</b> : <React.Fragment key={i}>{part}</React.Fragment>))}
  </>
);

const box = { background: 'var(--hub-surface, #fff)', border: '1px solid var(--hub-border, #e2e8f0)', borderRadius: 14, padding: 16 };
const label = { display: 'block', fontSize: 12.5, fontWeight: 700, color: 'var(--hub-muted, #64748b)', marginBottom: 6 };
const input = { width: '100%', boxSizing: 'border-box', minHeight: 38, borderRadius: 10, border: '1px solid var(--hub-border, #e2e8f0)', padding: '8px 12px', font: 'inherit', fontSize: 13.5, background: 'var(--hub-surface, #fff)', color: 'var(--hub-text, #0f172a)' };

export default function AutoReply() {
  const [cfg, setCfg] = useState(null);
  const [defaults, setDefaults] = useState(null);
  const [stats, setStats] = useState(null);
  const [err, setErr] = useState('');
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  const load = async () => {
    const r = await waApi.autoReply();
    if (r?.success) {
      setCfg(r.result.config);
      setDefaults(r.result.defaults);
      setStats(r.result.stats);
      setDirty(false);
    } else setErr(r?.message || 'Could not load the auto-reply settings.');
  };
  useEffect(() => {
    load();
  }, []);

  const set = (patch) => {
    setCfg((c) => ({ ...c, ...patch }));
    setDirty(true);
  };
  const linkOf = (p) => ((cfg?.curriculumLinks || []).find((l) => l.program === p) || {}).url || '';
  const setLink = (p, url) => {
    const rest = (cfg.curriculumLinks || []).filter((l) => l.program !== p);
    set({ curriculumLinks: url ? [...rest, { program: p, url }] : rest });
  };

  const save = async () => {
    setSaving(true);
    const r = await waApi.saveAutoReply({
      enabled: cfg.enabled,
      triggers: cfg.triggers,
      anyAdChat: cfg.anyAdChat,
      welcomeText: cfg.welcomeText,
      curriculumText: cfg.curriculumText,
      callWelcomeText: cfg.callWelcomeText,
      defaultCurriculumUrl: cfg.defaultCurriculumUrl,
      curriculumLinks: cfg.curriculumLinks,
      sendToFormOnly: cfg.sendToFormOnly,
    });
    setSaving(false);
    if (r?.success) {
      message.success('Auto-reply saved');
      setCfg(r.result.config);
      setDirty(false);
    } else message.error(r?.message || 'Could not save.');
  };

  const previewWelcome = useMemo(() => (cfg ? fill(cfg.welcomeText, { name: ' Priya', formLink: 'https://clcone.careerlabconsulting.com/public/enquiry?c=…' }) : ''), [cfg]);
  const previewCurriculum = useMemo(
    () => (cfg ? fill(cfg.curriculumText, { name: ' Priya', program: ' for *Data Science & AI*', curriculumLink: linkOf('Data Science & AI') || cfg.defaultCurriculumUrl || '(curriculum link)', callTime: ' in the evening' }) : ''),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [cfg]
  );

  if (err) return <div className="wa-pad" style={{ color: '#dc2626' }}>{err}</div>;
  if (!cfg) return <div className="wa-pad">Loading…</div>;
  const noCurriculum = !cfg.defaultCurriculumUrl && !(cfg.curriculumLinks || []).length;

  return (
    <div className="wa-pad" style={{ display: 'grid', gap: 14 }}>
      <div style={{ ...box, display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'space-between' }}>
        <div>
          <div style={{ fontWeight: 800, fontSize: 15 }}>Ad chat auto-reply</div>
          <div style={{ fontSize: 12.5, color: 'var(--hub-muted, #64748b)', marginTop: 2, maxWidth: 640 }}>
            Customer writes <b>&ldquo;Hello! Can I get more info on this?&rdquo;</b> → gets the welcome + their own form link at once → fills the form → gets the
            curriculum in the same chat. Each customer gets each message once.
          </div>
          {stats && (
            <div style={{ fontSize: 12, marginTop: 6 }}>
              Last {stats.days} days: <b>{stats.welcomes}</b> welcomes sent · <b>{stats.forms}</b> forms filled · <b>{stats.curricula}</b> curricula sent
            </div>
          )}
        </div>
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 10, fontWeight: 700, cursor: 'pointer' }}>
          <input type="checkbox" checked={!!cfg.enabled} onChange={(e) => set({ enabled: e.target.checked })} style={{ width: 20, height: 20, accentColor: '#00a884' }} />
          {cfg.enabled ? 'ON' : 'OFF'}
        </label>
      </div>

      {noCurriculum && (
        <div style={{ ...box, background: 'rgba(217,119,6,.08)', borderColor: 'rgba(217,119,6,.35)', color: '#92400e', fontSize: 13 }}>
          ⚠️ No curriculum link yet — the welcome + form link already go out, but the curriculum is sent only once you add a link below (a PDF on Google
          Drive set to &ldquo;Anyone with the link&rdquo;, or a web page).
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 14 }}>
        {/* step 1 */}
        <div style={box}>
          <div style={{ fontWeight: 800, marginBottom: 10 }}>1 · Welcome message (with the form link)</div>
          <span style={label}>Send it when the message contains (comma-separated)</span>
          <input style={input} value={(cfg.triggers || []).join(', ')} onChange={(e) => set({ triggers: e.target.value.split(',').map((x) => x.trim()) })} />
          <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, margin: '10px 0' }}>
            <input type="checkbox" checked={!!cfg.anyAdChat} onChange={(e) => set({ anyAdChat: e.target.checked })} /> Also for any chat that came from an ad
          </label>
          <span style={label}>Message — keep <code>{'{formLink}'}</code>; <code>{'{name}'}</code> = their first name; *bold* works like WhatsApp</span>
          <textarea style={{ ...input, minHeight: 190, resize: 'vertical' }} value={cfg.welcomeText} onChange={(e) => set({ welcomeText: e.target.value })} />
          {defaults && cfg.welcomeText !== defaults.welcomeText && (
            <button type="button" className="hub-btn" style={{ marginTop: 6 }} onClick={() => set({ welcomeText: defaults.welcomeText })}>Reset to default</button>
          )}
        </div>

        {/* step 2 */}
        <div style={box}>
          <div style={{ fontWeight: 800, marginBottom: 10 }}>2 · Curriculum (after the form)</div>
          <span style={label}>Default curriculum link (used when a program has no link of its own)</span>
          <input style={input} placeholder="https://drive.google.com/…" value={cfg.defaultCurriculumUrl || ''} onChange={(e) => set({ defaultCurriculumUrl: e.target.value.trim() })} />
          <details style={{ margin: '10px 0' }}>
            <summary style={{ cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>Different curriculum per program (optional)</summary>
            <div style={{ display: 'grid', gap: 6, marginTop: 8 }}>
              {PROGRAMS.map((p) => (
                <div key={p} style={{ display: 'grid', gridTemplateColumns: '170px 1fr', gap: 8, alignItems: 'center' }}>
                  <span style={{ fontSize: 12.5 }}>{p}</span>
                  <input style={{ ...input, minHeight: 32 }} placeholder="https://…" value={linkOf(p)} onChange={(e) => setLink(p, e.target.value.trim())} />
                </div>
              ))}
            </div>
          </details>
          <span style={label}>Message — keep <code>{'{curriculumLink}'}</code>; also <code>{'{name}'}</code>, <code>{'{program}'}</code>, <code>{'{callTime}'}</code></span>
          <textarea style={{ ...input, minHeight: 130, resize: 'vertical' }} value={cfg.curriculumText} onChange={(e) => set({ curriculumText: e.target.value })} />
          <span style={{ ...label, marginTop: 12 }}>
            Call screen welcome — the “Send curriculum on WhatsApp” button sends this from the caller’s own WhatsApp, then the InternX-AI curriculum PDF. Use <code>{'{name}'}</code> for the customer’s name
          </span>
          <textarea
            style={{ ...input, minHeight: 100, resize: 'vertical' }}
            value={cfg.callWelcomeText || defaults?.callWelcomeText || ''}
            onChange={(e) => set({ callWelcomeText: e.target.value })}
          />
          <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 12.5, marginTop: 10, color: 'var(--hub-muted, #64748b)' }}>
            <input type="checkbox" checked={!!cfg.sendToFormOnly} onChange={(e) => set({ sendToFormOnly: e.target.checked })} />
            Also WhatsApp the curriculum to people who filled the form from an ad / website link (no chat yet) — only if they ticked the contact consent.
          </label>
        </div>
      </div>

      {/* preview */}
      <div style={{ ...box, background: '#efeae2', borderColor: '#d1d7db' }}>
        <div style={{ fontWeight: 800, marginBottom: 10, color: '#111b21' }}>Preview — what the customer sees</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxWidth: 520 }}>
          <div style={{ alignSelf: 'flex-start', background: '#fff', padding: '7px 10px', borderRadius: 8, fontSize: 13.5, color: '#111b21', boxShadow: '0 1px .5px rgba(0,0,0,.13)' }}>
            Hello! Can I get more info on this?
          </div>
          <div style={{ alignSelf: 'flex-end', background: '#d9fdd3', padding: '7px 10px', borderRadius: 8, fontSize: 13.5, color: '#111b21', whiteSpace: 'pre-wrap', boxShadow: '0 1px .5px rgba(0,0,0,.13)' }}>
            <WaText text={previewWelcome} />
          </div>
          <div style={{ alignSelf: 'center', fontSize: 11.5, color: '#54656f', background: '#fff', padding: '3px 10px', borderRadius: 6 }}>…customer fills the form…</div>
          <div style={{ alignSelf: 'flex-end', background: '#d9fdd3', padding: '7px 10px', borderRadius: 8, fontSize: 13.5, color: '#111b21', whiteSpace: 'pre-wrap', boxShadow: '0 1px .5px rgba(0,0,0,.13)' }}>
            <WaText text={previewCurriculum} />
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', position: 'sticky', bottom: 0 }}>
        {dirty && <span style={{ alignSelf: 'center', fontSize: 12.5, color: '#b45309' }}>Unsaved changes</span>}
        <button type="button" className="hub-btn" disabled={saving || !dirty} onClick={load}>Discard</button>
        <button type="button" className="hub-btn hub-btn-primary" disabled={saving || !dirty} onClick={save}>{saving ? 'Saving…' : 'Save'}</button>
      </div>
    </div>
  );
}
