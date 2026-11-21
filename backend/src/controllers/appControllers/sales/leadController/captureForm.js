const mongoose = require('mongoose');
const { DEFAULT_FIELDS, DEFAULT_OPTIONS, DEFAULT_COPY } = require('../../../corePublicControllers/leadFormPage');
const { FULL_ACCESS_ROLES } = require('../../../../services/access/salesScope');

// Marketing › Capture Form › Form Builder — the website capture form.
//
//   GET /api/lead/capture-form   every field (on and off) in its order + the page copy
//   PUT /api/lead/capture-form   { fields: [...], headline, subtext, buttonText, thankYouMessage }
//
// One CaptureFormConfig (platform Website) drives the hosted page, its
// YouTube / LinkedIn / … links, the QR code and the embed script.
const TYPES = ['Text', 'Email', 'Phone', 'Number', 'Dropdown', 'Textarea', 'Checkbox'];
const SECTIONS = ['personal', 'lead', 'additional'];
const LOCKED = ['name', 'phone']; // a lead needs both: always shown and required

function shape(cfg) {
  const saved = (cfg && cfg.fields) || [];
  const byKey = new Map(saved.map((f) => [f.key, f]));
  const fields = saved.length
    ? saved.map((f, i) => ({ ...(DEFAULT_FIELDS.find((d) => d.key === f.key) || {}), ...f, sortOrder: f.sortOrder == null ? i : f.sortOrder }))
    : DEFAULT_FIELDS.map((f, i) => ({ ...f, sortOrder: i }));
  // defaults added after the form was saved show up switched off
  DEFAULT_FIELDS.forEach((d) => {
    if (saved.length && !byKey.has(d.key)) fields.push({ ...d, enabled: false, required: false, sortOrder: fields.length });
  });
  const out = fields
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((f) => ({
      key: f.key,
      label: f.label,
      type: f.type || 'Text',
      section: f.section || 'additional',
      enabled: LOCKED.includes(f.key) ? true : !!f.enabled,
      required: LOCKED.includes(f.key) ? true : !!f.required,
      options: f.options && f.options.length ? f.options : DEFAULT_OPTIONS[f.key] || undefined,
      placeholder: f.placeholder || '',
      locked: LOCKED.includes(f.key),
      custom: String(f.key).startsWith('custom_'),
    }));
  const copy = {};
  Object.keys(DEFAULT_COPY).forEach((k) => (copy[k] = (cfg && cfg[k]) || DEFAULT_COPY[k]));
  return { id: cfg ? cfg._id : null, fields: out, ...copy, updated: cfg ? cfg.updated : null };
}

async function get(req, res) {
  const cfg = await mongoose.model('CaptureFormConfig').findOne({ platform: 'Website', removed: false }).lean();
  return res.status(200).json({ success: true, result: shape(cfg), message: 'ok' });
}

async function save(req, res) {
  if (!FULL_ACCESS_ROLES.includes(req.admin.role)) {
    return res.status(403).json({ success: false, result: null, message: 'Only management can change the capture form.' });
  }
  const b = req.body || {};
  const seen = new Set();
  const fields = [];
  for (const f of Array.isArray(b.fields) ? b.fields.slice(0, 40) : []) {
    const key = String((f && f.key) || '').trim();
    if (!/^(custom_)?[A-Za-z0-9_]{1,40}$/.test(key) || seen.has(key)) continue;
    const label = String(f.label || '').trim().slice(0, 160);
    if (!label) return res.status(400).json({ success: false, result: null, message: 'Every field needs a name.' });
    seen.add(key);
    const type = TYPES.includes(f.type) ? f.type : 'Text';
    const options = type === 'Dropdown' ? (Array.isArray(f.options) ? f.options : []).map((o) => String(o).trim().slice(0, 120)).filter(Boolean).slice(0, 30) : undefined;
    if (type === 'Dropdown' && f.enabled && !(options && options.length)) {
      return res.status(400).json({ success: false, result: null, message: `Add at least one choice for "${label}".` });
    }
    fields.push({
      key,
      label,
      type,
      section: SECTIONS.includes(f.section) ? f.section : 'additional',
      enabled: LOCKED.includes(key) ? true : !!f.enabled,
      required: LOCKED.includes(key) ? true : !!f.required && !!f.enabled,
      options,
      placeholder: String(f.placeholder || '').trim().slice(0, 120) || undefined,
      sortOrder: fields.length,
    });
  }
  if (!LOCKED.every((k) => seen.has(k))) {
    return res.status(400).json({ success: false, result: null, message: 'Full name and phone number must stay on the form.' });
  }
  const set = { fields, updated: new Date() };
  for (const k of Object.keys(DEFAULT_COPY)) set[k] = String(b[k] == null ? DEFAULT_COPY[k] : b[k]).trim().slice(0, k === 'subtext' || k === 'thankYouMessage' ? 300 : 80) || DEFAULT_COPY[k];
  const cfg = await mongoose
    .model('CaptureFormConfig')
    .findOneAndUpdate({ platform: 'Website', removed: false }, { $set: set, $setOnInsert: { platform: 'Website', created: new Date() } }, { new: true, upsert: true })
    .lean();
  return res.status(200).json({ success: true, result: shape(cfg), message: 'Form saved.' });
}

module.exports = { get, save };
