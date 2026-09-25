const mongoose = require('mongoose');
const mailer = require('../../../../services/lms/mailer');

// Real backend for the Communication Centre (spec §13) — replaces what was
// entirely frontend-mock state (frontend/src/pages/Communication/index.jsx).
// WhatsApp is out of scope for this deployment (no approved WhatsApp
// Business/API provider configured) — connectionStatus always reports it as
// not connected, honestly, rather than faking a toggle.

const ok = (res, result, message) => res.status(200).json({ success: true, result, message });
const bad = (res, code, message) => res.status(code).json({ success: false, message });

// GET /api/lms/admin/communication/status
async function connectionStatus(req, res) {
  return ok(res, {
    email: { connected: mailer.ready(), provider: 'Gmail SMTP' },
    whatsapp: { connected: false, provider: null, note: 'No WhatsApp Business/API provider is configured for this deployment.' },
  });
}

// GET /api/lms/admin/communication/templates
async function listTemplates(req, res) {
  const NotificationTemplate = mongoose.model('NotificationTemplate');
  const rows = await NotificationTemplate.find({ removed: false }).sort({ created: -1 }).lean();
  return ok(res, rows);
}

function extractVariables(html, subject) {
  const found = new Set();
  const rx = /\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g;
  let m;
  const text = `${subject || ''} ${html || ''}`;
  // eslint-disable-next-line no-cond-assign
  while ((m = rx.exec(text))) found.add(m[1]);
  return [...found];
}

// POST /api/lms/admin/communication/templates — manager only. Spec §8
// "variable validation" — auto-detects {{placeholders}} rather than trusting
// a hand-typed list, so a template's actual variables are always accurate.
async function createTemplate(req, res) {
  const b = req.body || {};
  if (!String(b.name || '').trim()) return bad(res, 400, 'Template name is required.');
  const NotificationTemplate = mongoose.model('NotificationTemplate');
  const row = await NotificationTemplate.create({
    name: b.name.trim(),
    eventKey: b.eventKey || '',
    channel: 'email',
    subject: b.subject || '',
    html: b.html || '',
    variables: extractVariables(b.html, b.subject),
    createdBy: req.admin._id,
    createdByName: req.admin.name,
  });
  return ok(res, row, 'Template created.');
}

// PATCH /api/lms/admin/communication/templates/:id — manager only.
async function updateTemplate(req, res) {
  const b = req.body || {};
  const NotificationTemplate = mongoose.model('NotificationTemplate');
  const $set = {};
  if (b.name !== undefined) $set.name = b.name;
  if (b.eventKey !== undefined) $set.eventKey = b.eventKey;
  if (b.subject !== undefined) $set.subject = b.subject;
  if (b.html !== undefined) $set.html = b.html;
  if (b.enabled !== undefined) $set.enabled = !!b.enabled;
  if (b.subject !== undefined || b.html !== undefined) {
    $set.variables = extractVariables(b.html, b.subject);
  }
  $set.updated = new Date();
  const row = await NotificationTemplate.findOneAndUpdate({ _id: req.params.id, removed: false }, { $set }, { new: true });
  if (!row) return bad(res, 404, 'Template not found.');
  return ok(res, row, 'Template updated.');
}

// POST /api/lms/admin/communication/templates/:id/delete — manager only.
async function removeTemplate(req, res) {
  const NotificationTemplate = mongoose.model('NotificationTemplate');
  const row = await NotificationTemplate.findOneAndUpdate({ _id: req.params.id }, { $set: { removed: true } }, { new: true });
  if (!row) return bad(res, 404, 'Template not found.');
  return ok(res, { id: String(row._id) }, 'Template deleted.');
}

// GET /api/lms/admin/communication/delivery-summary?days=7 — manager only.
// Spec §16 "Communication delivery/failure report" — the raw log list
// (health.js#emailDeliveryLogs) already existed; this adds the actual
// sent-vs-failed aggregate the spec asks for instead of leaving the admin to
// count rows by hand.
async function deliverySummary(req, res) {
  const EmailDeliveryLog = mongoose.model('EmailDeliveryLog');
  const days = Math.min(90, Math.max(1, Number(req.query.days) || 7));
  const since = new Date(Date.now() - days * 24 * 3600 * 1000);
  const rows = await EmailDeliveryLog.aggregate([
    { $match: { sentAt: { $gte: since } } },
    { $group: { _id: { day: { $dateToString: { format: '%Y-%m-%d', date: '$sentAt' } }, status: '$status' }, count: { $sum: 1 } } },
    { $sort: { '_id.day': 1 } },
  ]);
  const byDay = {};
  rows.forEach((r) => {
    const day = r._id.day;
    byDay[day] = byDay[day] || { day, sent: 0, failed: 0 };
    byDay[day][r._id.status] = r.count;
  });
  const totalSent = rows.filter((r) => r._id.status === 'sent').reduce((s, r) => s + r.count, 0);
  const totalFailed = rows.filter((r) => r._id.status === 'failed').reduce((s, r) => s + r.count, 0);
  return ok(res, {
    days,
    totalSent,
    totalFailed,
    failureRate: totalSent + totalFailed ? Math.round((totalFailed / (totalSent + totalFailed)) * 1000) / 10 : 0,
    byDay: Object.values(byDay),
  });
}

module.exports = { connectionStatus, listTemplates, createTemplate, updateTemplate, removeTemplate, deliverySummary };
