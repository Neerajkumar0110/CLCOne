const mongoose = require('mongoose');
const { notify } = require('../../../../notify');
const { STUDENT_TICKET_CATEGORIES, PAYMENT_TICKET_CATEGORIES, ticketNo } = require('../../../../config/supportTickets');
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
  const category = String(b.category || '').trim();
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
  };

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
  notify({
    audience: 'support',
    actorId: req.admin._id,
    actorName: doc.raisedByName,
    module: 'Support',
    type: 'ticket.created',
    title: `New ${category} ticket ${no}`,
    body: `${doc.raisedByName}: ${ticket.subject}`,
    link: '/support',
  });
  newTicketMail(ticket.toObject()).catch(() => {});

  return res.status(200).json({ success: true, result: shape(ticket), message: `Ticket ${no} raised — Support has been notified.` });
}

module.exports = { mine, payments, create };
