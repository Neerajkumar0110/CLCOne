const mongoose = require('mongoose');
const { lmsConfig } = require('../../config/lms');
const { mailReady, sendMailWithRetry } = require('../mail/transport');
const { ticketNo } = require('../../config/supportTickets');

// Candidates tab → Deactivate / Activate a candidate's LMS access.
//
// Deactivate: Student.accessDisabled → Admin.rosterHold (studentAccountService
// .syncRosterHold), so every /api/lms call is refused (middlewares/
// rosterHoldGuard.js) and the panel shows only a "request reactivation"
// screen. The candidate is emailed. Their button raises ONE support ticket
// (Support notified live + by email); a repeat click while it's open just
// points at the same ticket.
// Activate: lifts it again and emails them that they're back.

const BRAND = process.env.GMAIL_SENDER_NAME || 'Career Lab Consulting';
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const base = () => String(lmsConfig.meeting.crmBaseUrl || 'https://clcone.careerlabconsulting.com').replace(/\/+$/, '');
const fullName = (a) => (a ? `${a.name || ''} ${a.surname || ''}`.trim() : '');
const rxEq = (s) => new RegExp(`^${String(s || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i');

const shell = (title, inner, cta) => `<!doctype html><html><body style="margin:0;background:#f4f6fb;font-family:Arial,Helvetica,sans-serif">
<div style="max-width:560px;margin:24px auto;background:#fff;border-radius:12px;padding:28px;border:1px solid #e5e7eb">
<h2 style="margin:0 0 14px;font-size:19px;color:#111827">${title}</h2>
${inner}
${cta ? `<p style="margin:22px 0 0"><a href="${cta.href}" style="display:inline-block;background:#2f5fd0;color:#fff;text-decoration:none;padding:11px 20px;border-radius:8px;font-weight:bold">${esc(cta.label)}</a></p>` : ''}
<p style="margin:24px 0 0;font-size:12px;color:#9ca3af">${esc(BRAND)} — automated message</p>
</div></body></html>`;

async function mail(to, subject, html) {
  if (!to || !mailReady()) return false;
  try {
    await sendMailWithRetry({ from: `"${BRAND}" <${process.env.GMAIL_USER}>`, to, subject, html });
    return true;
  } catch (e) {
    console.error('[lms] candidate access mail failed:', e && e.message);
    return false;
  }
}

function deactivatedMail(s) {
  const p = (t) => `<p style="font-size:14px;color:#374151;margin:0 0 12px;line-height:1.6">${t}</p>`;
  return shell(
    'Your LMS access has been paused',
    p(`Hi ${esc(s.name)},`) +
      p(`Your access to the ${esc(BRAND)} learning portal${s.course ? ` for <b>${esc(s.course)}</b>` : ''} has been <b>deactivated</b>. Live classes, recordings, study material and tests are not available until it is turned back on.`) +
      (s.accessDisabledReason ? `<div style="margin:0 0 14px;padding:12px 14px;background:#fef2f2;border-radius:8px;font-size:14px;color:#991b1b"><b>Reason:</b> ${esc(s.accessDisabledReason)}</div>` : '') +
      p('To get it back, sign in and tap <b>Request reactivation</b> — our Support team gets your request straight away and will contact you.'),
    { href: `${base()}/learn`, label: 'Request reactivation' }
  );
}

function activatedMail(s) {
  const p = (t) => `<p style="font-size:14px;color:#374151;margin:0 0 12px;line-height:1.6">${t}</p>`;
  return shell(
    'Your LMS access is active again',
    p(`Hi ${esc(s.name)},`) + p(`Good news — your access to the learning portal${s.course ? ` for <b>${esc(s.course)}</b>` : ''} has been <b>restored</b>. You can join classes and use everything as before.`),
    { href: `${base()}/learn`, label: 'Open my portal' }
  );
}

// POST /api/lms/students/:id/access { active, reason }
async function setAccess(studentId, active, actor, reason) {
  const Student = mongoose.model('Student');
  const s = await Student.findOne({ _id: studentId, removed: false });
  if (!s) return { error: 404, message: 'Candidate not found.' };
  if (!!s.accessDisabled === !active) return { result: view(s), message: active ? 'Already active.' : 'Already deactivated.' };

  if (active) {
    s.accessDisabled = false;
    s.accessDisabledAt = undefined;
    s.accessDisabledBy = undefined;
    s.accessDisabledReason = undefined;
    s.reactivationRequestedAt = undefined;
  } else {
    s.accessDisabled = true;
    s.accessDisabledAt = new Date();
    s.accessDisabledBy = fullName(actor);
    s.accessDisabledReason = String(reason || '').trim().slice(0, 500) || undefined;
  }
  await s.save();
  // apply the lock now, not on the post-save tick
  await require('./studentAccountService').syncRosterHold(s).catch(() => {});
  // their open panel re-reads /my/updates right away (lock / unlock screen)
  try {
    const login = await mongoose.model('Admin').findOne({ email: rxEq(s.email), removed: false, role: 'Student' }).select('_id').lean();
    if (login) require('../../socket').emitLmsToUsers([String(login._id)], 'notification:new', { type: 'access' });
  } catch (e) {
    /* socket not up — the panel's poll catches it */
  }

  // close an open reactivation ticket once they're back
  if (active && s.reactivationTicket) {
    await mongoose
      .model('Ticket')
      .updateOne(
        { _id: s.reactivationTicket, status: { $in: ['Open', 'In Progress'] } },
        { $set: { status: 'Resolved', resolvedAt: new Date(), resolvedByName: fullName(actor), resolutionNote: 'LMS access reactivated.' } }
      )
      .catch(() => {});
  }

  mongoose
    .model('AuditLog')
    .create({
      module: 'student',
      action: active ? 'access.activate' : 'access.deactivate',
      entityType: 'Student',
      entityId: s._id,
      performedBy: actor && actor._id,
      performedByName: fullName(actor),
      performedByRole: actor && actor.role,
      reason: active ? undefined : s.accessDisabledReason,
      after: { student: s.email, accessDisabled: !active },
    })
    .catch(() => {});

  const emailed = await mail(
    s.email,
    active ? `Your ${BRAND} LMS access is active again` : `Your ${BRAND} LMS access has been deactivated`,
    active ? activatedMail(s) : deactivatedMail(s)
  );
  return {
    result: view(s),
    message: active
      ? `${s.name} is active again${emailed ? ' — emailed' : ''}.`
      : `${s.name} is deactivated — LMS access is off${emailed ? ' and they have been emailed' : ''}.`,
  };
}

const view = (s) => ({
  id: String(s._id),
  accessDisabled: !!s.accessDisabled,
  accessDisabledAt: s.accessDisabledAt || null,
  accessDisabledBy: s.accessDisabledBy || null,
  accessDisabledReason: s.accessDisabledReason || null,
  reactivationRequestedAt: s.reactivationRequestedAt || null,
});

// The candidate's own roster row (by login email), deactivated one first.
async function ownRow(admin) {
  return mongoose
    .model('Student')
    .findOne({ removed: false, email: rxEq(admin.email || '') })
    .sort({ accessDisabled: -1, created: -1 });
}

// For the panel's /my/updates poll.
async function accessState(admin) {
  if (!admin || admin.role !== 'Student' || !admin.rosterHold) return { hold: false };
  const s = await ownRow(admin);
  let ticket = null;
  if (s && s.reactivationTicket) {
    const t = await mongoose.model('Ticket').findById(s.reactivationTicket).select('status created').lean();
    if (t) ticket = { no: ticketNo(t), status: t.status };
  }
  return {
    hold: true,
    deactivated: !!(s && s.accessDisabled),
    reason: (s && s.accessDisabledReason) || admin.rosterHoldReason || null,
    requestedAt: (s && s.reactivationRequestedAt) || null,
    ticket,
  };
}

// POST /api/lms/my/reactivation-request — the button on the locked screen.
async function requestReactivation(admin, note) {
  if (!admin || admin.role !== 'Student') return { error: 403, message: 'Candidates only.' };
  if (!admin.rosterHold) return { error: 400, message: 'Your access is already active.' };
  const s = await ownRow(admin);
  const Ticket = mongoose.model('Ticket');

  // one open request at a time
  if (s && s.reactivationTicket) {
    const open = await Ticket.findOne({ _id: s.reactivationTicket, status: { $in: ['Open', 'In Progress'] } }).lean();
    if (open) return { result: { ticketNo: ticketNo(open), already: true }, message: `Your request ${ticketNo(open)} is already with Support — they will contact you soon.` };
  }

  const name = fullName(admin) || (s && s.name) || admin.email;
  const lines = [
    `${name} is asking for their LMS access to be reactivated.`,
    '',
    `Email: ${admin.email}`,
    admin.phone ? `Phone: ${admin.phone}` : null,
    s && s.course ? `Internship: ${s.course}` : null,
    s && s.batch ? `Batch: ${s.batch}` : null,
    s && s.accessDisabledAt ? `Deactivated: ${new Date(s.accessDisabledAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}${s.accessDisabledBy ? ` by ${s.accessDisabledBy}` : ''}` : null,
    s && s.accessDisabledReason ? `Reason given: ${s.accessDisabledReason}` : !s || !s.accessDisabled ? `Hold reason: ${admin.rosterHoldReason || '—'}` : null,
    note ? `\nCandidate's note: ${String(note).slice(0, 1000)}` : null,
    '',
    'Reactivate from LMS → Candidates (Activate button).',
  ].filter((l) => l !== null);

  const ticket = await new Ticket({
    subject: `LMS reactivation request — ${name}`,
    description: lines.join('\n'),
    category: 'Login / Technical',
    priority: 'High',
    status: 'Open',
    source: 'student',
    createdBy: admin._id,
    raisedByName: name,
    raisedByEmail: admin.email,
    raisedByPhone: admin.phone || undefined,
  }).save();
  const no = ticketNo(ticket);

  if (s) {
    s.reactivationRequestedAt = new Date();
    s.reactivationTicket = ticket._id;
    await s.save();
  }
  require('../../notify').notify({
    audience: 'support',
    actorId: admin._id,
    actorName: name,
    module: 'Support',
    type: 'ticket.created',
    title: `Reactivation request ${no}`,
    body: `${name} wants their LMS access back`,
    link: '/support',
  });
  require('../support/ticketMail').newTicketMail(ticket.toObject()).catch(() => {});
  return { result: { ticketNo: no }, message: `Request ${no} sent — Support will contact you soon.` };
}

module.exports = { setAccess, accessState, requestReactivation };
