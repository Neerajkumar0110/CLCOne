const mongoose = require('mongoose');
const { CRM_ADMIN_ROLES } = require('../../../../config/roles');
const { CATALOG, byKey } = require('../../../../services/mail/emailCatalog');
const tpl = require('../../../../services/mail/emailTemplates');
const sched = require('../../../../services/mail/emailSchedule');
const previews = require('../../../../services/mail/emailPreviews');

// Messenger › Email — Email centre (admin only).
//   GET    /api/email-center               every email: what, to whom, when, counts, status
//   GET    /api/email-center/item/:key     one email: template, default, last real email, recent sends
//   PUT    /api/email-center/item/:key     save (system: edit / switch off / timing · custom: everything)
//   POST   /api/email-center/item/:key/reset   system: back to the code's own email
//   POST   /api/email-center/item/:key/test    send it to me with sample values
//   POST   /api/email-center/custom        new custom email
//   DELETE /api/email-center/item/:key     custom only
//   POST   /api/email-center/preview       render subject / html with sample values

const M = (n) => mongoose.model(n);
const ok = (res, result, message) => res.status(200).json({ success: true, result, message });
const bad = (res, code, message) => res.status(code).json({ success: false, result: null, message });
const isAdmin = (a) => !!(a && CRM_ADMIN_ROLES.includes(a.role));
const nameOf = (a) => [a && a.name, a && a.surname].filter(Boolean).join(' ') || (a && a.email) || 'admin';
const DAY = 86400000;

const SAMPLE = {
  name: 'Asha Verma',
  email: 'asha@example.com',
  first: 'Asha',
  batch: 'AI-ML Batch 12',
  course: 'AI & ML Internship',
  classTitle: 'Python basics — Class 4',
  classTime: 'Mon, 17 Nov, 6:00 pm',
  startTime: 'Mon, 17 Nov, 6:00 pm',
  joinLink: 'https://clcone.careerlabconsulting.com/#/learn/classes',
  portalLink: 'https://clcone.careerlabconsulting.com/#/learn',
};
const sampleVars = (vars = []) => Object.fromEntries([...new Set([...Object.keys(SAMPLE), ...vars])].map((k) => [k, SAMPLE[k] !== undefined ? SAMPLE[k] : /Html$/.test(k) ? `<p><i>[${k}]</i></p>` : `[${k}]`]));

async function counts() {
  const since30 = new Date(Date.now() - 30 * DAY);
  const day = new Date(Date.now() - DAY);
  const week = new Date(Date.now() - 7 * DAY);
  const rows = await M('EmailDeliveryLog').aggregate([
    { $match: { sentAt: { $gte: since30 } } },
    {
      $group: {
        _id: '$templateKey',
        d30: { $sum: { $cond: [{ $eq: ['$status', 'sent'] }, 1, 0] } },
        d7: { $sum: { $cond: [{ $and: [{ $eq: ['$status', 'sent'] }, { $gte: ['$sentAt', week] }] }, 1, 0] } },
        d1: { $sum: { $cond: [{ $and: [{ $eq: ['$status', 'sent'] }, { $gte: ['$sentAt', day] }] }, 1, 0] } },
        failed7: { $sum: { $cond: [{ $and: [{ $eq: ['$status', 'failed'] }, { $gte: ['$sentAt', week] }] }, 1, 0] } },
        last: { $max: '$sentAt' },
      },
    },
  ]);
  return new Map(rows.map((r) => [r._id || 'other', r]));
}

function statusOf(row, cat) {
  if (row && row.enabled === false) return 'Off';
  if (cat && cat.locked) return 'Locked';
  if (row && row.kind === 'custom') return 'Custom';
  return row && row.override ? 'Edited' : 'Default';
}

function guard(req, res) {
  if (isAdmin(req.admin)) return true;
  bad(res, 403, 'Only an admin can manage emails.');
  return false;
}

async function list(req, res) {
  if (!guard(req, res)) return;
  const [rows, c] = await Promise.all([M('EmailTemplate').find({ removed: false }).select('-versions -sample.html -defaultHtml -html').lean(), counts()]);
  const byK = new Map(rows.map((r) => [r.key, r]));
  const stat = (k) => {
    const x = c.get(k) || {};
    return { today: x.d1 || 0, week: x.d7 || 0, month: x.d30 || 0, failedWeek: x.failed7 || 0, lastSent: x.last || null };
  };
  const items = CATALOG.map((cat) => {
    const row = byK.get(cat.key);
    return {
      key: cat.key,
      kind: 'system',
      group: cat.group,
      name: cat.name,
      to: cat.to,
      when: cat.when,
      timing: cat.timing ? { ...cat.timing, value: row && Number.isFinite(row.timingValue) ? row.timingValue : cat.timing.default } : null,
      status: statusOf(row, cat),
      locked: !!cat.locked,
      // has the system sent it at least once (so its template is known)?
      captured: previews.keys.includes(cat.key) || !!(row && ((row.sample && row.sample.at) || row.override)),
      stats: stat(cat.key),
    };
  });
  rows
    .filter((r) => r.kind === 'custom')
    .forEach((r) =>
      items.push({ key: r.key, kind: 'custom', group: 'Custom emails', name: r.name, to: sched.describeAudience(r.audience), when: sched.describe(r), status: statusOf(r), stats: stat(r.key), lastRunAt: r.lastRunAt || null })
    );
  const all = [...c.values()];
  const totals = {
    today: all.reduce((s, x) => s + (x.d1 || 0), 0),
    week: all.reduce((s, x) => s + (x.d7 || 0), 0),
    month: all.reduce((s, x) => s + (x.d30 || 0), 0),
    failedWeek: all.reduce((s, x) => s + (x.failed7 || 0), 0),
    other: stat('other'),
  };
  return ok(res, { items, totals, mailReady: sched.mailReady(), options: { scheduleTypes: sched.SCHEDULE_TYPES, audienceTypes: sched.AUDIENCE_TYPES, customVars: sched.CUSTOM_VARS } });
}

async function item(req, res) {
  if (!guard(req, res)) return;
  const key = String(req.params.key);
  const cat = byKey(key);
  const row = await M('EmailTemplate').findOne({ key, removed: false }).lean();
  if (!cat && !row) return bad(res, 404, 'Unknown email.');
  const recent = await M('EmailDeliveryLog').find({ templateKey: key }).sort({ sentAt: -1 }).limit(25).select('recipient subject status error sentAt').lean();
  // the code's own email, built by the function that sends it, with sample
  // values — the full design, shown even before it has ever gone out
  const pv = cat ? await previews.build(key) : null;
  // the placeholders the sending code really fills in
  const vars = pv ? Object.keys(pv.vars) : cat ? cat.vars : sched.CUSTOM_VARS;
  const codeSubject = pv ? tpl.toTemplate(pv.subject, pv.vars, { html: false }) : (row && row.defaultSubject) || '';
  const codeHtml = pv ? tpl.toTemplate(pv.html, pv.vars) : (row && row.defaultHtml) || '';
  return ok(res, {
    key,
    kind: row ? row.kind : 'system',
    name: (cat && cat.name) || (row && row.name),
    group: cat ? cat.group : 'Custom emails',
    to: cat ? cat.to : sched.describeAudience(row.audience),
    when: cat ? cat.when : sched.describe(row),
    locked: !!(cat && cat.locked),
    enabled: !row || row.enabled !== false,
    override: !!(row && row.override),
    status: statusOf(row, cat),
    timing: cat && cat.timing ? { ...cat.timing, value: row && Number.isFinite(row.timingValue) ? row.timingValue : cat.timing.default } : null,
    vars,
    // body built from live data (a report table) — that part is the {{var}}
    dataBody: (cat && cat.dataBody) || null,
    // what the editor starts from: the saved edit, else the code's own email as a template
    subject: row && (row.override || row.kind === 'custom') ? row.subject : codeSubject,
    html: row && (row.override || row.kind === 'custom') ? row.html : codeHtml,
    defaultSubject: codeSubject,
    defaultHtml: codeHtml,
    // exactly how it looks in an inbox (sample values) — the real design from the code
    example: pv ? { subject: pv.subject, html: pv.html } : null,
    // inline (cid:) images, so the screen can show them — the email itself keeps cid:
    images: (pv && pv.images) || {},
    sample: (row && row.sample) || null,
    schedule: (row && row.schedule) || null,
    audience: (row && row.audience) || null,
    lastRunAt: (row && row.lastRunAt) || null,
    versions: ((row && row.versions) || []).slice(-10).reverse().map((v) => ({ at: v.at, byName: v.byName, note: v.note })),
    updatedByName: (row && row.updatedByName) || null,
    updated: (row && row.updated) || null,
    sampleVars: { ...sampleVars(vars), ...((pv && pv.vars) || {}) },
    recent,
  });
}

function cleanSchedule(s = {}) {
  if (!sched.SCHEDULE_TYPES.includes(s.type)) return { error: 'Pick when it should go out.' };
  const out = { type: s.type };
  if (s.type === 'once') {
    const at = new Date(s.at);
    if (Number.isNaN(at.getTime())) return { error: 'Pick the date and time.' };
    out.at = at;
  }
  if (s.type === 'daily' || s.type === 'weekly') {
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(String(s.time || ''))) return { error: 'Pick the time (HH:mm).' };
    out.time = s.time;
  }
  if (s.type === 'weekly') {
    const w = Number(s.weekday);
    if (!(w >= 0 && w <= 6)) return { error: 'Pick the day of the week.' };
    out.weekday = w;
  }
  if (['after-enrolment', 'before-class', 'after-class'].includes(s.type)) {
    const m = Number(s.offsetMin);
    if (!(m >= 0 && m <= 60 * 24 * 90)) return { error: 'How long before / after must be between 0 minutes and 90 days.' };
    out.offsetMin = Math.round(m);
  }
  return { value: out };
}
function cleanAudience(a = {}, scheduleType) {
  if (!sched.AUDIENCE_TYPES.includes(a.type)) return { error: 'Pick who it goes to.' };
  if (a.type !== 'all-learners' && !String(a.value || '').trim()) return { error: 'Fill in the batch / role / emails.' };
  if (['after-enrolment', 'before-class', 'after-class'].includes(scheduleType) && !['all-learners', 'batch'].includes(a.type)) return { error: 'Enrolment / class based emails go to learners — pick all learners or a batch.' };
  return { value: { type: a.type, value: String(a.value || '').trim().slice(0, 4000) } };
}

async function save(req, res) {
  if (!guard(req, res)) return;
  const key = String(req.params.key);
  const cat = byKey(key);
  const b = req.body || {};
  const T = M('EmailTemplate');
  let row = await T.findOne({ key, removed: false });
  if (!cat && !row) return bad(res, 404, 'Unknown email.');
  if (cat && cat.locked) return bad(res, 409, 'Login code emails cannot be changed here.');
  if (!row) row = new T({ key, kind: 'system', name: cat.name });
  const before = { subject: row.subject, html: row.html };
  const changedText = (b.subject !== undefined && b.subject !== row.subject) || (b.html !== undefined && b.html !== row.html);
  if (b.subject !== undefined || b.html !== undefined) {
    const subject = String(b.subject !== undefined ? b.subject : row.subject || '').trim();
    const html = String(b.html !== undefined ? b.html : row.html || '');
    if (!subject) return bad(res, 400, 'Subject is required.');
    if (!html.trim()) return bad(res, 400, 'Email body is required.');
    row.subject = subject.slice(0, 300);
    row.html = html.slice(0, 100000);
    if (row.kind === 'system') row.override = true;
  }
  if (b.enabled !== undefined) row.enabled = !!b.enabled;
  if (cat && cat.timing && b.timingValue !== undefined) {
    const v = Number(b.timingValue);
    if (!(v >= cat.timing.min && v <= cat.timing.max)) return bad(res, 400, `${cat.timing.label} must be between ${cat.timing.min} and ${cat.timing.max}.`);
    row.timingValue = v;
  }
  if (row.kind === 'custom') {
    if (b.name !== undefined) row.name = String(b.name).trim().slice(0, 120) || row.name;
    if (b.schedule) {
      const s = cleanSchedule(b.schedule);
      if (s.error) return bad(res, 400, s.error);
      const sameOnce = row.schedule && row.schedule.type === 'once' && s.value.type === 'once' && +new Date(row.schedule.at) === +s.value.at;
      row.schedule = s.value;
      if (!sameOnce) row.lastRunAt = undefined; // a new date / rule runs again
    }
    if (b.audience) {
      const a = cleanAudience(b.audience, (row.schedule || {}).type);
      if (a.error) return bad(res, 400, a.error);
      row.audience = a.value;
    }
  }
  if (changedText) row.versions = [...(row.versions || []), { at: new Date(), byName: nameOf(req.admin), subject: before.subject, html: before.html, note: 'edited' }].slice(-20);
  row.updatedByName = nameOf(req.admin);
  row.updated = new Date();
  await row.save();
  tpl.invalidate();
  await require('../../../../services/lms/auditLog')
    .record({ module: 'email-center', action: 'save', entityType: 'EmailTemplate', entityId: row._id, admin: req.admin, after: { key, enabled: row.enabled, override: row.override, timingValue: row.timingValue } })
    .catch(() => {});
  req.params.key = key;
  return item(req, res);
}

async function reset(req, res) {
  if (!guard(req, res)) return;
  const key = String(req.params.key);
  const row = await M('EmailTemplate').findOne({ key, removed: false });
  if (!row || row.kind !== 'system') return bad(res, 404, 'Nothing to reset.');
  row.versions = [...(row.versions || []), { at: new Date(), byName: nameOf(req.admin), subject: row.subject, html: row.html, note: 'reset to default' }].slice(-20);
  row.override = false;
  row.updatedByName = nameOf(req.admin);
  row.updated = new Date();
  await row.save();
  tpl.invalidate();
  return item(req, res);
}

async function test(req, res) {
  if (!guard(req, res)) return;
  if (!sched.mailReady()) return bad(res, 409, 'Email is not configured on the server.');
  const key = String(req.params.key);
  const cat = byKey(key);
  const row = await M('EmailTemplate').findOne({ key, removed: false }).lean();
  const b = req.body || {};
  const pv = cat ? await previews.build(key) : null;
  const subject = b.subject !== undefined ? b.subject : row && (row.override || row.kind === 'custom') ? row.subject : pv ? tpl.toTemplate(pv.subject, pv.vars, { html: false }) : row && row.defaultSubject;
  const html = b.html !== undefined ? b.html : row && (row.override || row.kind === 'custom') ? row.html : pv ? tpl.toTemplate(pv.html, pv.vars) : row && row.defaultHtml;
  if (!subject || !html) return bad(res, 409, 'This email has no template yet — write one and save first.');
  const vars = { ...sampleVars(cat ? cat.vars : sched.CUSTOM_VARS), ...((pv && pv.vars) || {}), email: req.admin.email };
  const { sendMailWithRetry } = require('../../../../services/mail/transport');
  await sendMailWithRetry({ from: `"${process.env.GMAIL_SENDER_NAME || 'Career Lab Consulting'}" <${process.env.GMAIL_USER}>`, to: req.admin.email, subject: `[TEST] ${tpl.render(subject, vars)}`, html: tpl.render(html, vars), templateKey: 'test' });
  return ok(res, { to: req.admin.email }, `Test sent to ${req.admin.email}.`);
}

async function createCustom(req, res) {
  if (!guard(req, res)) return;
  const b = req.body || {};
  const name = String(b.name || '').trim();
  if (!name) return bad(res, 400, 'Give the email a name.');
  if (!String(b.subject || '').trim() || !String(b.html || '').trim()) return bad(res, 400, 'Subject and body are required.');
  const s = cleanSchedule(b.schedule);
  if (s.error) return bad(res, 400, s.error);
  const a = cleanAudience(b.audience, s.value.type);
  if (a.error) return bad(res, 400, a.error);
  const key = `custom-${new mongoose.Types.ObjectId().toString().slice(-10)}`;
  await M('EmailTemplate').create({
    key,
    kind: 'custom',
    name: name.slice(0, 120),
    enabled: b.enabled !== false,
    subject: String(b.subject).trim().slice(0, 300),
    html: String(b.html).slice(0, 100000),
    schedule: s.value,
    audience: a.value,
    updatedByName: nameOf(req.admin),
  });
  tpl.invalidate();
  req.params.key = key;
  return item(req, res);
}

async function removeCustom(req, res) {
  if (!guard(req, res)) return;
  const row = await M('EmailTemplate').findOne({ key: String(req.params.key), removed: false });
  if (!row || row.kind !== 'custom') return bad(res, 409, 'Only custom emails can be deleted — switch a system email off instead.');
  row.removed = true;
  row.enabled = false;
  row.updatedByName = nameOf(req.admin);
  row.updated = new Date();
  await row.save();
  tpl.invalidate();
  return ok(res, { key: row.key }, 'Deleted.');
}

async function preview(req, res) {
  if (!guard(req, res)) return;
  const b = req.body || {};
  const cat = b.key ? byKey(String(b.key)) : null;
  const vars = sampleVars(cat ? cat.vars : sched.CUSTOM_VARS);
  return ok(res, { subject: tpl.render(b.subject || '', vars), html: tpl.render(b.html || '', vars) });
}

module.exports = { list, item, save, reset, test, createCustom, removeCustom, preview };
