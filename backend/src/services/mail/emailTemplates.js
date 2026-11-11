const mongoose = require('mongoose');

// Email centre runtime (Messenger › Email). Called by services/mail/transport.js
// on every send that carries a `templateKey`:
//   before: apply()  — an admin-edited template replaces subject / html, a
//                      switched-off email is skipped;
//   after:  record() — delivery log row for the counts, plus the last real
//                      email as `sample` and the code's own text turned back
//                      into a {{placeholder}} template as `defaultHtml`.
// Everything here is best-effort: a template / log problem must never stop
// or break the email itself.

const CACHE_MS = 30000;
let cache = { at: 0, rows: new Map() };

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
// a variable whose name ends in "Html" is a ready-made HTML block (a table,
// a list) — inserted as is; every other variable is text and is escaped
const isBlock = (k) => /Html$/.test(k);

async function rows() {
  if (Date.now() - cache.at < CACHE_MS) return cache.rows;
  const list = await mongoose.model('EmailTemplate').find({ removed: false }).select('key kind enabled override subject html').lean();
  cache = { at: Date.now(), rows: new Map(list.map((r) => [r.key, r])) };
  return cache.rows;
}
function invalidate() {
  cache.at = 0;
}

function render(text, vars = {}) {
  return String(text || '').replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (m, k) => (vars[k] === undefined || vars[k] === null ? '' : isBlock(k) ? String(vars[k]) : esc(vars[k])));
}

// The code's own email turned back into a template: each variable's value
// (as it appears in the HTML) becomes {{name}}. Longest values first so a
// short value never eats part of a longer one; values under 3 characters
// are left alone (too likely to match unrelated text).
function toTemplate(text, vars = {}, { html = true } = {}) {
  let out = String(text || '');
  const entries = Object.entries(vars)
    .filter(([, v]) => v !== undefined && v !== null && String(v).trim().length >= 3)
    .map(([k, v]) => [k, html && !isBlock(k) ? esc(v) : String(v)])
    .sort((a, b) => b[1].length - a[1].length);
  for (const [k, v] of entries) out = out.split(v).join(`{{${k}}}`);
  return out;
}

// → { skip: true } | { subject, html } (possibly replaced)
async function apply(options) {
  const key = options.templateKey;
  if (!key) return options;
  const c = require('./emailCatalog').byKey(key);
  if (c && c.locked) return options; // login codes always go exactly as the code builds them
  try {
    const t = (await rows()).get(key);
    if (!t) return options;
    if (t.enabled === false) return { ...options, skip: true };
    if (t.kind === 'system' && t.override) {
      const vars = { email: options.to, ...(options.vars || {}) };
      return { ...options, subject: render(t.subject, vars) || options.subject, html: render(t.html, vars) || options.html, edited: true };
    }
  } catch (e) {
    /* fall back to the code's own email */
  }
  return options;
}

const lastCapture = new Map(); // key -> ms; refresh the stored sample at most every 10 min per email
// passwords / login codes never reach the log or the stored sample
function mask(text, options) {
  const c = require('./emailCatalog').byKey(options.templateKey);
  let out = String(text || '');
  for (const k of (c && c.sensitive) || []) {
    const v = options.vars && options.vars[k];
    if (v && String(v).length >= 3) out = out.split(String(v)).join('••••••').split(esc(v)).join('••••••');
  }
  return out;
}

async function record(options, status, error) {
  try {
    const key = options.templateKey || 'other';
    await mongoose
      .model('EmailDeliveryLog')
      .create({ recipient: String(options.to || '').slice(0, 300), subject: mask(options.subject, options).slice(0, 300), status, error: error ? String(error).slice(0, 300) : '', templateKey: key })
      .catch(() => {});
    if (key === 'other' || status !== 'sent' || key.startsWith('custom-')) return;
    if (Date.now() - (lastCapture.get(key) || 0) < 10 * 60000) return;
    lastCapture.set(key, Date.now());
    const vars = options.vars || {};
    const set = {
      sample: { subject: mask(options.subject, options), html: mask(options.html || `<pre>${esc(options.text || '')}</pre>`, options), to: options.to, at: new Date() },
      variables: Object.keys(vars),
    };
    if (!options.edited) {
      set.defaultSubject = toTemplate(options.subject, vars, { html: false });
      set.defaultHtml = toTemplate(options.html || `<pre>${esc(options.text || '')}</pre>`, vars);
    }
    const name = (require('./emailCatalog').byKey(key) || {}).name || key;
    await mongoose.model('EmailTemplate').updateOne({ key }, { $set: set, $setOnInsert: { kind: 'system', name, created: new Date() } }, { upsert: true });
  } catch (e) {
    /* never affects the send */
  }
}

// The send time an admin set for an email (catalog `timing`), else its default.
async function timing(key) {
  const c = require('./emailCatalog').byKey(key);
  const dflt = c && c.timing ? c.timing.default : null;
  try {
    const row = await mongoose.model('EmailTemplate').findOne({ key }).select('timingValue').lean();
    const v = row && Number(row.timingValue);
    if (c && c.timing && Number.isFinite(v) && v >= c.timing.min && v <= c.timing.max) return v;
  } catch (e) {
    /* default */
  }
  return dflt;
}

module.exports = { apply, record, render, toTemplate, invalidate, esc, timing };
