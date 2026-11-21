import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { message } from 'antd';
import { request } from '@/request';
import { Ic, apiPut, formLink, Skel, ErrorState } from './shared';
import logo from '@/style/images/career-lab-logo.png';

// Form Builder tab (design artboard "4 · Form Builder"): the website capture
// form's fields, order, required marks and copy, with a live preview. Saved by
// PUT /api/lead/capture-form; the hosted page, every channel link, the QR code
// and the embed script draw themselves from it.

const SECTIONS = [['personal', 'PERSONAL INFORMATION'], ['lead', 'LEAD INFORMATION'], ['additional', 'ADDITIONAL INFORMATION']];
const TYPES = ['Text', 'Email', 'Phone', 'Number', 'Dropdown', 'Textarea', 'Checkbox'];
const HINT = { phone: '10-digit check', source: "sets the lead's Source", whatsapp: 'saved as the second number' };
const PH = { name: 'Your full name', email: 'name@example.com', city: 'Your city', phone: '98765 43210', whatsapp: '98765 43210' };

function Toggle({ on, onChange, label, disabled }) {
  return <button type="button" role="switch" aria-checked={on} aria-label={label} className={`ch2-tg${on ? '' : ' off'}`} disabled={disabled} onClick={() => onChange(!on)} />;
}

function PreviewField({ f }) {
  const star = f.required ? <span className="req"> *</span> : null;
  if (f.type === 'Checkbox') return <label className="pchk"><input type="checkbox" defaultChecked tabIndex={-1} /> {f.label}</label>;
  const ph = f.placeholder || PH[f.key] || '';
  let inner;
  if (f.type === 'Dropdown') inner = <span className="pi" style={{ justifyContent: 'space-between' }}><span className="ph">{f.placeholder || (f.options?.[0] ? 'Choose one' : 'Add choices')}</span><span style={{ color: '#5B6B7F' }}>▾</span></span>;
  else if (f.type === 'Phone') inner = <span className="pi"><span style={{ color: '#5B6B7F' }}>+91</span><span className="ph">{ph}</span></span>;
  else if (f.type === 'Textarea') inner = <span className="pi ta"><span className="ph">{ph}</span></span>;
  else inner = <span className="pi"><span className="ph">{ph}</span></span>;
  return <div className="pf"><span>{f.label}{star}</span>{inner}</div>;
}

export default function FormBuilder({ isManager, actionsEl }) {
  const [form, setForm] = useState(null);
  const [orig, setOrig] = useState('');
  const [err, setErr] = useState(false);
  const [saving, setSaving] = useState(false);
  const [open, setOpen] = useState(null);
  const [drag, setDrag] = useState(null);
  const [over, setOver] = useState(null);
  const [msg, setMsg] = useState('');

  const load = () => {
    setErr(false);
    request.get({ entity: 'lead/capture-form' }).then((r) => {
      if (r?.success) {
        setForm(r.result);
        setOrig(JSON.stringify(r.result));
      } else setErr(true);
    });
  };
  useEffect(load, []);
  const dirty = form && JSON.stringify(form) !== orig;
  useEffect(() => {
    if (!dirty) return undefined;
    const warn = (e) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const setField = (key, patch) => setForm((f) => ({ ...f, fields: f.fields.map((x) => (x.key === key ? { ...x, ...patch } : x)) }));
  const ro = !isManager;

  // drop `key` before `beforeKey` (or at the end of `section`)
  const move = (key, section, beforeKey) =>
    setForm((f) => {
      const item = f.fields.find((x) => x.key === key);
      if (!item || key === beforeKey) return f;
      const rest = f.fields.filter((x) => x.key !== key);
      const moved = { ...item, section };
      let idx = beforeKey ? rest.findIndex((x) => x.key === beforeKey) : -1;
      if (idx < 0) {
        const lastInSec = rest.map((x) => x.section).lastIndexOf(section);
        idx = lastInSec < 0 ? rest.length : lastInSec + 1;
      }
      rest.splice(idx, 0, moved);
      return { ...f, fields: rest };
    });
  // keyboard reorder: swap with the neighbour, or step into the next section
  const nudge = (key, dir) =>
    setForm((f) => {
      const list = SECTIONS.flatMap(([s]) => f.fields.filter((x) => x.section === s));
      const i = list.findIndex((x) => x.key === key);
      const a = list[i];
      const nb = list[i + dir];
      if (!nb || nb.section !== a.section) {
        const si = SECTIONS.findIndex(([s]) => s === a.section) + dir;
        if (si < 0 || si >= SECTIONS.length) return f;
        list[i] = { ...a, section: SECTIONS[si][0] };
        return { ...f, fields: list };
      }
      list[i] = nb;
      list[i + dir] = a;
      return { ...f, fields: list };
    });

  const addField = () => {
    const key = `custom_${Date.now().toString(36)}`;
    setForm((f) => ({ ...f, fields: [...f.fields, { key, label: 'New question', type: 'Text', section: 'additional', enabled: true, required: false, placeholder: '', custom: true }] }));
    setOpen(key);
  };
  const removeField = (key) => { setForm((f) => ({ ...f, fields: f.fields.filter((x) => x.key !== key) })); setOpen(null); };

  const save = async () => {
    if (!form) return;
    const bad = form.fields.find((x) => !String(x.label || '').trim());
    if (bad) { setMsg('Every field needs a name.'); setOpen(bad.key); return; }
    const noChoice = form.fields.find((x) => x.enabled && x.type === 'Dropdown' && !(x.options || []).filter(Boolean).length);
    if (noChoice) { setMsg(`Add at least one choice for “${noChoice.label}”.`); setOpen(noChoice.key); return; }
    setSaving(true);
    setMsg('');
    const ordered = SECTIONS.flatMap(([s]) => form.fields.filter((x) => x.section === s));
    const r = await apiPut('lead/capture-form', { ...form, fields: ordered });
    setSaving(false);
    if (r?.success) {
      setForm(r.result);
      setOrig(JSON.stringify(r.result));
      message.success('Form saved — the page, links and embed now show it.');
    } else setMsg(r?.message || 'Could not save the form.');
  };

  const shown = useMemo(() => (form ? SECTIONS.map(([s, t]) => [s, t, form.fields.filter((x) => x.section === s && x.enabled)]) : []), [form]);

  const actions = (
    <>
      <a className="ch2-btn" href={formLink()} target="_blank" rel="noopener noreferrer"><Ic n="ext" />Preview page</a>
      {isManager && <button type="button" className="ch2-btn p" disabled={!dirty || saving} onClick={save}>{saving ? 'Saving…' : dirty ? 'Save form' : 'Saved'}</button>}
    </>
  );

  if (err) return <ErrorState onRetry={load} />;
  if (!form) return <div className="ch2-fb"><Skel h={620} style={{ flex: '999 1 560px' }} /><Skel h={620} style={{ flex: '1 1 380px' }} /></div>;

  return (
    <>
      {actionsEl && createPortal(actions, actionsEl)}
      <div className="ch2-fb">
        <section className="ch2-card ch2-fb-main">
          <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', gap: 10, alignItems: 'center', marginBottom: 6 }}>
            <div>
              <h3 style={{ margin: 0, fontSize: 16 }}>Form fields</h3>
              <p className="mut" style={{ margin: '4px 0 0', fontSize: 12.5 }}>One form for the landing page, the embed code and every channel link · {ro ? 'only management can change it' : 'drag to reorder, click a name to edit'}</p>
            </div>
            {!ro && <button type="button" className="ch2-btn" onClick={addField}><Ic n="plus" />Add field</button>}
          </div>
          <div className="ch2-frow-h"><span /><span>FIELD</span><span>TYPE</span><span>REQUIRED</span><span>SHOW</span></div>

          {SECTIONS.map(([sec, title], si) => {
            const rows = form.fields.filter((x) => x.section === sec);
            return (
              <div key={sec} onDragOver={(e) => { if (drag) { e.preventDefault(); } }} onDrop={(e) => { e.preventDefault(); if (drag && !over) move(drag, sec, null); setDrag(null); setOver(null); }} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div className="ch2-sec" style={si ? { marginTop: 10 } : undefined}>{title}</div>
                {!rows.length && <div className="mut" style={{ fontSize: 12.5, padding: '10px 12px', border: '1px dashed var(--c-line)', borderRadius: 12 }}>Drop a field here</div>}
                {rows.map((f) => (
                  <React.Fragment key={f.key}>
                    <div
                      className={`ch2-frow2${drag === f.key ? ' drag' : ''}${over === f.key ? ' over' : ''}${open === f.key ? ' open' : ''}`}
                      draggable={!ro}
                      onDragStart={(e) => { setDrag(f.key); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', f.key); }}
                      onDragEnd={() => { setDrag(null); setOver(null); }}
                      onDragOver={(e) => { if (drag && drag !== f.key) { e.preventDefault(); e.stopPropagation(); setOver(f.key); } }}
                      onDragLeave={() => setOver((o) => (o === f.key ? null : o))}
                      onDrop={(e) => { e.preventDefault(); e.stopPropagation(); if (drag) move(drag, sec, f.key); setDrag(null); setOver(null); }}
                      style={open === f.key ? { borderRadius: '12px 12px 0 0' } : undefined}
                    >
                      <button type="button" className="ch2-grip" aria-label={`Move ${f.label} — arrow up or down`} disabled={ro} onKeyDown={(e) => { if (e.key === 'ArrowUp') { e.preventDefault(); nudge(f.key, -1); } if (e.key === 'ArrowDown') { e.preventDefault(); nudge(f.key, 1); } }}>⋮⋮</button>
                      <button type="button" className="ch2-fname" aria-expanded={open === f.key} onClick={() => setOpen(open === f.key ? null : f.key)}>
                        <b>{f.label || 'Untitled'}</b>{HINT[f.key] && <span className="mut"> · {HINT[f.key]}</span>}{f.custom && <span className="mut"> · your question</span>}
                      </button>
                      <span className="ch2-ty">{f.type}</span>
                      <Toggle on={!!f.required} label={`${f.label} required`} disabled={ro || f.locked || !f.enabled} onChange={(v) => setField(f.key, { required: v })} />
                      <Toggle on={!!f.enabled} label={`Show ${f.label}`} disabled={ro || f.locked} onChange={(v) => setField(f.key, { enabled: v, ...(v ? {} : { required: false }) })} />
                    </div>
                    {open === f.key && (
                      <div className="ch2-fedit">
                        <label className="ch2-fld">Field name<input className="ch2-in" value={f.label} maxLength={160} disabled={ro} onChange={(e) => setField(f.key, { label: e.target.value })} /></label>
                        <label className="ch2-fld">Type
                          <select className="ch2-in" value={f.type} disabled={ro || !f.custom} onChange={(e) => setField(f.key, { type: e.target.value })}>
                            {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                          </select>
                        </label>
                        <label className="ch2-fld">Section
                          <select className="ch2-in" value={f.section} disabled={ro} onChange={(e) => move(f.key, e.target.value, null)}>
                            {SECTIONS.map(([s, t]) => <option key={s} value={s}>{t[0] + t.slice(1).toLowerCase()}</option>)}
                          </select>
                        </label>
                        {f.type !== 'Checkbox' && <label className="ch2-fld">Placeholder<input className="ch2-in" value={f.placeholder || ''} maxLength={120} disabled={ro} placeholder={PH[f.key] || (f.type === 'Dropdown' ? 'Choose one' : '')} onChange={(e) => setField(f.key, { placeholder: e.target.value })} /></label>}
                        {f.type === 'Dropdown' && (
                          <label className="ch2-fld" style={{ gridColumn: '1 / -1' }}>Choices · one per line
                            <textarea className="ch2-in" rows={4} disabled={ro} value={(f.options || []).join('\n')} onChange={(e) => setField(f.key, { options: e.target.value.split('\n') })} />
                          </label>
                        )}
                        {f.custom && !ro && <div style={{ gridColumn: '1 / -1' }}><button type="button" className="ch2-btn sm d" onClick={() => removeField(f.key)}><Ic n="trash" s={14} />Remove this field</button></div>}
                        {f.locked && <p className="mut" style={{ gridColumn: '1 / -1', margin: 0, fontSize: 12.5 }}>Every lead needs a name and a phone number, so this field always shows and is always required.</p>}
                      </div>
                    )}
                  </React.Fragment>
                ))}
              </div>
            );
          })}

          <div className="ch2-copybox">
            <label>Heading<input className="ch2-in" value={form.headline} maxLength={80} disabled={ro} onChange={(e) => setForm({ ...form, headline: e.target.value })} /></label>
            <label>Sub-heading<input className="ch2-in" value={form.subtext} maxLength={300} disabled={ro} onChange={(e) => setForm({ ...form, subtext: e.target.value })} /></label>
            <label>Button text<input className="ch2-in" value={form.buttonText} maxLength={80} disabled={ro} onChange={(e) => setForm({ ...form, buttonText: e.target.value })} /></label>
            <label>Thank-you message<input className="ch2-in" value={form.thankYouMessage} maxLength={300} disabled={ro} onChange={(e) => setForm({ ...form, thankYouMessage: e.target.value })} /></label>
          </div>
          {msg && <div className="ch2-err" role="alert">{msg}</div>}
          {dirty && isManager && <div className="ch2-savemsg mut">Unsaved changes — press Save form to put them live.</div>}
        </section>

        <section className="ch2-fb-prev" aria-label="Live preview">
          <div className="mut" style={{ fontSize: 12, fontWeight: 700, letterSpacing: '.06em' }}>LIVE PREVIEW</div>
          <div className="ch2-prev">
            <div>
              <div className="brand"><img src={logo} alt="" />CAREER LAB CONSULTING</div>
              <h2>{form.headline}</h2>
              <p style={{ margin: 0, fontSize: 13.5, color: '#5B6B7F' }}>{form.subtext}</p>
            </div>
            {shown.map(([s, t, list]) =>
              list.length ? (
                <React.Fragment key={s}>
                  {!list.every((x) => x.type === 'Checkbox') && <div className="ps">{t}</div>}
                  {list.map((f) => <PreviewField key={f.key} f={f} />)}
                </React.Fragment>
              ) : null
            )}
            <button type="button" className="pbtn" tabIndex={-1}>{form.buttonText}</button>
          </div>
          <div className="ch2-after">
            <Ic n="check" s={22} />
            <span><b>After submit:</b> {form.thankYouMessage}</span>
          </div>
        </section>
      </div>
    </>
  );
}
