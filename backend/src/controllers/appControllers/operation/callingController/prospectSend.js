const mongoose = require('mongoose');
const { agentNotes } = require('../../../../services/calling/callingShared');
const { FULL_ACCESS_ROLES } = require('../../../../services/access/salesScope');
const { REVIEWER_ROLES } = require('../../../../config/roles');
const { prospectStatus, missingDetails } = require('../../../../services/sales/prospectDetails');
const { mailReady, sendMailWithRetry } = require('../../../../services/mail/transport');
const { notifyUser } = require('../../../../notify');

// My Calls → Send: a user hands their prospect to a reviewer, who gets a bell
// notification and an email with the whole story (every call, how long, what
// was said), then verifies it from Sales 360° › Prospect verification.
const fullName = (a) => `${a.name || ''} ${a.surname || ''}`.trim();
const last10 = (s) => String(s || '').replace(/\D/g, '').slice(-10);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const when = (d) => (d ? new Date(d).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : '—');
const dur = (s) => (s ? `${Math.floor(s / 60)}m ${s % 60}s` : '—');
const isConnected = (c) => !!(c.answeredAt && c.agentLegAnswered !== false && c.duration > 0);
const PUBLIC_BASE = () => (process.env.PUBLIC_APP_URL || 'https://clcone.careerlabconsulting.com').replace(/\/+$/, '');

// GET /api/calling/prospect-recipients
const recipients = async (req, res) => {
  const rows = await mongoose
    .model('Admin')
    .find({ removed: false, enabled: true, role: { $in: REVIEWER_ROLES }, _id: { $ne: req.admin._id } })
    .select('name surname role email')
    .sort({ name: 1 })
    .lean();
  return res.status(200).json({ success: true, result: rows.map((a) => ({ _id: a._id, name: fullName(a) || a.email, role: a.role })), message: 'ok' });
};

function emailHtml({ lead, calls, from, note, missing }) {
  const connected = calls.filter(isConnected);
  const talk = connected.reduce((t, c) => t + c.duration, 0);
  const remarks = [...(lead.stageHistory || [])].reverse().filter((h) => h.remarks).slice(0, 8);
  const row = (k, v) => (v ? `<tr><td style="padding:4px 0;color:#64748b;width:150px">${k}</td><td style="padding:4px 0;color:#0f172a;font-weight:600">${esc(v)}</td></tr>` : '');
  return `<div style="font-family:Segoe UI,Arial,sans-serif;max-width:640px;margin:auto;padding:24px;border:1px solid #e2e8f0;border-radius:14px">
    <h2 style="margin:0 0 4px;color:#0f172a">Prospect to verify: ${esc(lead.name)}</h2>
    <p style="margin:0 0 16px;color:#475569">Sent by <b>${esc(from)}</b>${note ? ` — ${esc(note)}` : ''}</p>
    <p style="margin:0 0 16px;color:#0f172a"><b>${calls.length}</b> calls · <b>${connected.length}</b> connected · <b>${dur(talk)}</b> total talk</p>
    <table style="width:100%;border-collapse:collapse;font-size:14px;margin-bottom:16px">
      ${row('Phone', lead.phone)}${row('Email', lead.email)}${row('City', lead.city)}${row('Source', lead.source)}${row('Employment', lead.persona)}${row('Education', lead.education)}${row('Designation', lead.profile)}${row('Career objective', lead.painPoint)}${row('Availability', lead.howSoonToStart)}${row('Financial readiness', lead.budgetRange)}${row('Remarks', lead.remarks)}${row('Missing details', missing.join(', '))}
    </table>
    <h3 style="margin:0 0 8px;font-size:15px;color:#0f172a">Calls</h3>
    <table style="width:100%;border-collapse:collapse;font-size:13px;margin-bottom:16px">
      ${calls.slice(0, 15).map((c) => `<tr style="border-top:1px solid #e2e8f0"><td style="padding:6px 8px 6px 0;white-space:nowrap;vertical-align:top">${when(c.created)}</td><td style="padding:6px 8px 6px 0;vertical-align:top">${esc(c.agentName || '—')}</td><td style="padding:6px 8px 6px 0;white-space:nowrap;vertical-align:top">${isConnected(c) ? dur(c.duration) : 'Not connected'}</td><td style="padding:6px 0;vertical-align:top">${esc(c.disposition || '')}${agentNotes(c.notes) ? `<div style="color:#475569">${esc(agentNotes(c.notes))}</div>` : ''}</td></tr>`).join('')}
    </table>
    ${remarks.length ? `<h3 style="margin:0 0 8px;font-size:15px;color:#0f172a">What was recorded</h3>${remarks.map((h) => `<p style="margin:0 0 8px;font-size:13px;color:#475569"><b style="color:#0f172a">${esc(h.toStage)}${h.toSubStatus && h.toSubStatus !== h.toStage ? ` · ${esc(h.toSubStatus)}` : ''}</b> · ${esc(h.changedByName || 'system')} · ${when(h.at)}<br>${esc(h.remarks)}</p>`).join('')}` : ''}
    <a href="${PUBLIC_BASE()}/sales" style="display:inline-block;padding:12px 24px;border-radius:10px;background:#4f46e5;color:#fff;font-weight:700;text-decoration:none">Open in CLC One to verify and hear recordings</a>
  </div>`;
}

// POST /api/calling/my-calls/:id/send-prospect { to: [adminId], note? }
const send = async (req, res) => {
  const fail = (message, code = 400) => res.status(code).json({ success: false, result: null, message });
  if (!mongoose.isValidObjectId(req.params.id)) return fail('Bad id');
  const call = await mongoose.model('CallRecord').findOne({ _id: req.params.id, removed: false }).select('agent phone').lean();
  if (!call || (!FULL_ACCESS_ROLES.includes(req.admin.role) && String(call.agent) !== String(req.admin._id))) return fail('Call not found', 404);
  const to = [...new Set((Array.isArray(req.body && req.body.to) ? req.body.to : []).map(String))].filter((x) => mongoose.isValidObjectId(x));
  if (!to.length) return fail('Pick who to send it to.');
  const note = String((req.body && req.body.note) || '').trim().slice(0, 1000);

  const Lead = mongoose.model('Lead');
  const p10 = last10(call.phone);
  const lead = p10.length === 10 ? await Lead.findOne({ removed: false, phoneNormalized: p10 }).select('-rawMetaData -rawGoogleData -rawLinkedInData').lean() : null;
  if (!lead) return fail('No lead in the CRM for this number.');
  if (prospectStatus(lead) !== 'pending') return fail(prospectStatus(lead) ? `This prospect is already ${prospectStatus(lead)}.` : 'This lead is not a prospect.');

  const people = await mongoose.model('Admin').find({ _id: { $in: to }, removed: false, enabled: true, role: { $in: REVIEWER_ROLES } }).select('name surname email role').lean();
  const already = new Set((lead.prospectHandoffs || []).map((h) => String(h.to)));
  const fresh = people.filter((a) => !already.has(String(a._id)) && String(a._id) !== String(req.admin._id));
  if (!fresh.length) return fail('Already sent to the people you picked.', 409);

  const from = fullName(req.admin) || req.admin.email;
  const at = new Date();
  await Lead.updateOne(
    { _id: lead._id },
    { $push: { prospectHandoffs: { $each: fresh.map((a) => ({ to: a._id, toName: fullName(a) || a.email, toRole: a.role, by: req.admin._id, byName: from, note, at })) } } }
  );

  const calls = await mongoose
    .model('CallRecord')
    .find({ removed: false, phone: new RegExp(`${p10}$`) })
    .select('created duration answeredAt agentLegAnswered agentName disposition notes')
    .sort({ created: -1 })
    .limit(50)
    .lean();
  const html = emailHtml({ lead, calls, from, note, missing: missingDetails(lead) });
  for (const a of fresh) {
    notifyUser({
      recipient: a._id,
      actorId: req.admin._id,
      actorName: from,
      module: 'Sales',
      type: 'prospect.sent',
      title: `${from} sent you a prospect to verify`,
      body: `${lead.name} · ${lead.phone}${note ? ` — ${note.slice(0, 120)}` : ''}`,
      link: '/sales',
    });
    if (mailReady() && a.email) {
      sendMailWithRetry({ from: `"CLC One" <${process.env.GMAIL_USER}>`, to: a.email, subject: `Prospect to verify: ${lead.name} (from ${from})`, html, templateKey: 'sales-prospect-verify', vars: { lead: lead.name, from } }).catch((e) => console.error('[prospect] email failed:', e.message));
    }
  }
  const names = fresh.map((a) => fullName(a) || a.email);
  return res.status(200).json({ success: true, result: { sentTo: names }, message: `Sent to ${names.join(', ')}.` });
};

module.exports = { recipients, send, _emailHtml: { emailHtml } };
