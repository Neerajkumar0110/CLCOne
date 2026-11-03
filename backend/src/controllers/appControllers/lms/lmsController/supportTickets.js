const mongoose = require('mongoose');
const { notify } = require('../../../../notify');
const { STUDENT_TICKET_CATEGORIES, LEGACY_TICKET_CATEGORIES, RESTRICTED_TICKET_CATEGORY, PAYMENT_TICKET_CATEGORIES, ticketNo } = require('../../../../config/supportTickets');
const { newTicketMail } = require('../../../../services/support/ticketMail');

// Student-side support tickets (LMS panel → Help & Support). Same Ticket
// collection the CRM Support page works from (ticketController/*), tagged
// source: 'student'. Support resolves them there; ticketController/update.js
// sends the raiser the "resolved" mail + notification.

const PRIORITIES = ['Low', 'Medium', 'High', 'Urgent'];
const rx = (s) => new RegExp(`^${String(s || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i');

const shape = (t) => ({
  _id: t._id,
  ticketNo: ticketNo(t),
  subject: t.subject,
  description: t.description,
  category: t.category,
  priority: t.priority,
  status: t.status,
  payment: t.payment || null,
  paymentSnapshot: t.payment ? t.paymentSnapshot : null,
  resolutionNote: t.resolutionNote || null,
  resolvedAt: t.resolvedAt || null,
  reference: t.reference || null,
  expected: t.expected || null,
  attachments: t.attachments || [],
  history: t.history || [],
  learnerConfirmedAt: t.learnerConfirmedAt || null,
  reopenCount: t.reopenCount || 0,
  created: t.created,
  updated: t.updated,
});

// GET /api/lms/my/tickets — the caller's own tickets, newest first.
async function mine(req, res) {
  const Ticket = mongoose.model('Ticket');
  const rows = await Ticket.find({ removed: false, createdBy: req.admin._id }).sort({ created: -1 }).limit(200).lean();
  return res.status(200).json({
    success: true,
    result: { tickets: rows.map(shape), categories: STUDENT_TICKET_CATEGORIES, paymentCategories: PAYMENT_TICKET_CATEGORIES },
  });
}

// GET /api/lms/my/tickets/payments — the caller's own payment requests, so a
// Payment / Invoice ticket can point at the exact one it's about.
async function payments(req, res) {
  const PaymentRequest = mongoose.model('PaymentRequest');
  const email = req.admin.email || '';
  if (!email) return res.status(200).json({ success: true, result: [] });
  const rows = await PaymentRequest.find({ removed: false, studentEmail: rx(email) })
    .sort({ created: -1 })
    .limit(50)
    .select('amount status course installmentNo installmentCount razorpayPaymentId paidAt created')
    .lean();
  return res.status(200).json({ success: true, result: rows });
}

// POST /api/lms/my/tickets { subject, category, priority?, description?, payment? }
async function create(req, res) {
  const Ticket = mongoose.model('Ticket');
  const b = req.body || {};
  const subject = String(b.subject || '').trim();
  const rawCategory = String(b.category || '').trim();
  const category = LEGACY_TICKET_CATEGORIES[rawCategory] || rawCategory;
  const restricted = category === RESTRICTED_TICKET_CATEGORY;
  const description = String(b.description || '').trim();
  const priority = PRIORITIES.includes(b.priority) ? b.priority : 'Medium';

  if (!subject) return res.status(400).json({ success: false, result: null, message: 'Subject is required.' });
  if (!STUDENT_TICKET_CATEGORIES.includes(category)) {
    return res.status(400).json({ success: false, result: null, message: 'Pick a category.' });
  }

  const doc = {
    subject: subject.slice(0, 200),
    description: description.slice(0, 5000),
    category,
    priority,
    status: 'Open',
    source: 'student',
    createdBy: req.admin._id,
    raisedByName: [req.admin.name, req.admin.surname].filter(Boolean).join(' '),
    raisedByEmail: req.admin.email,
    raisedByPhone: req.admin.phone || undefined,
    reference: String(b.reference || '').trim().slice(0, 200) || undefined,
    expected: String(b.expected || '').trim().slice(0, 1000) || undefined,
    // screenshots this learner uploaded via POST /my/tickets/attachment
    attachments: (Array.isArray(b.attachments) ? b.attachments : [])
      .filter((x) => x && typeof x.url === 'string' && x.url.startsWith(`public/uploads/tickets/${req.admin._id}-`))
      .slice(0, 5)
      .map((x) => ({ name: String(x.name || 'screenshot').slice(0, 200), url: x.url })),
  };
  doc.history = [{ at: new Date(), action: 'created', status: 'Open', byName: doc.raisedByName }];

  // Only one of the caller's OWN payments may be attached, and only on a
  // payment/invoice ticket.
  if (b.payment && PAYMENT_TICKET_CATEGORIES.includes(category)) {
    if (!mongoose.isValidObjectId(b.payment)) {
      return res.status(400).json({ success: false, result: null, message: 'Invalid payment.' });
    }
    const p = await mongoose
      .model('PaymentRequest')
      .findOne({ _id: b.payment, removed: false, studentEmail: rx(req.admin.email || '') })
      .lean();
    if (!p) return res.status(400).json({ success: false, result: null, message: 'That payment was not found on your account.' });
    doc.payment = p._id;
    doc.paymentSnapshot = {
      amount: p.amount,
      status: p.status,
      course: p.course,
      installmentNo: p.installmentNo,
      installmentCount: p.installmentCount,
      razorpayPaymentId: p.razorpayPaymentId || undefined,
      paidAt: p.paidAt,
      created: p.created,
    };
  }

  const ticket = await new Ticket(doc).save();
  const no = ticketNo(ticket);

  // Support + owner/Super Admin/Admin, live over the socket (notify.js →
  // socket.js emitNotification) — never other students.
  // A restricted Policy / privacy ticket goes to management only, and its
  // subject never travels in the notification or the shared support mail.
  notify({
    audience: restricted ? 'admins' : 'support',
    actorId: req.admin._id,
    actorName: doc.raisedByName,
    module: 'Support',
    type: 'ticket.created',
    title: `New ${category} ticket ${no}`,
    body: restricted ? `${doc.raisedByName} raised a restricted ticket` : `${doc.raisedByName}: ${ticket.subject}`,
    link: '/support',
  });
  if (!restricted) newTicketMail(ticket.toObject()).catch(() => {});

  return res.status(200).json({ success: true, result: shape(ticket), message: `Ticket ${no} raised — Support has been notified.` });
}

// POST /api/lms/my/tickets/:id/confirm { resolved: true|false } — the raiser's
// answer once Support marks their ticket Resolved: confirm it, or reopen it
// (back to Open, Support notified).
async function confirm(req, res) {
  const Ticket = mongoose.model('Ticket');
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ success: false, result: null, message: 'Ticket not found.' });
  const t = await Ticket.findOne({ _id: req.params.id, createdBy: req.admin._id, removed: false });
  if (!t) return res.status(404).json({ success: false, result: null, message: 'Ticket not found.' });
  if (t.status !== 'Resolved') return res.status(409).json({ success: false, result: null, message: 'Only a resolved ticket can be confirmed or reopened.' });
  const byName = [req.admin.name, req.admin.surname].filter(Boolean).join(' ');
  const now = new Date();
  const note = String((req.body && req.body.note) || '').trim().slice(0, 1000) || undefined;
  if (!t.history) t.history = [];

  if (req.body && req.body.resolved === true) {
    t.learnerConfirmedAt = now;
    t.history.push({ at: now, action: 'confirmed', status: 'Resolved', byName });
  } else {
    t.status = 'Open';
    t.learnerConfirmedAt = undefined;
    t.reopenCount = (t.reopenCount || 0) + 1;
    t.history.push({ at: now, action: 'reopened', status: 'Open', byName, note });
    const no = ticketNo(t);
    notify({
      audience: 'support',
      actorId: req.admin._id,
      actorName: byName,
      module: 'Support',
      type: 'ticket.reopened',
      title: `Ticket ${no} reopened by the learner`,
      body: note || t.subject,
      link: '/support',
    });
  }
  t.updated = now;
  await t.save();
  return res.status(200).json({ success: true, result: shape(t), message: t.status === 'Open' ? 'Ticket reopened — Support has been notified.' : 'Thanks for confirming.' });
}

// POST /api/lms/my/tickets/attachment (multipart "file") — a screenshot for
// the next ticket; the route's multer stored it as
// public/uploads/tickets/<adminId>-<random>.<ext>, create() only accepts
// the caller's own.
async function attachment(req, res) {
  if (!req.file) return res.status(400).json({ success: false, result: null, message: 'Choose an image (png / jpg / webp, max 5 MB).' });
  return res.status(200).json({ success: true, result: { name: req.file.originalname, url: `public/uploads/tickets/${require('path').basename(req.file.path)}` } });
}

module.exports = { mine, payments, create, confirm, attachment };
