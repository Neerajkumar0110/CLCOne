const mongoose = require('mongoose');

const schema = new mongoose.Schema({
  removed: {
    type: Boolean,
    default: false,
  },

  subject: {
    type: String,
    required: true,
  },
  description: String,
  // One of PERMISSION_MODULES (frontend/src/config/permissionModules.js) —
  // the module the ticket is about.
  category: {
    type: String,
    required: true,
  },
  priority: {
    type: String,
    enum: ['Low', 'Medium', 'High', 'Urgent'],
    default: 'Medium',
  },
  status: {
    type: String,
    enum: ['Open', 'In Progress', 'Resolved'],
    default: 'Open',
  },

  // Who raised it — set server-side from the authenticated admin, never
  // trusted from the request body (see ticketController/create.js).
  createdBy: { type: mongoose.Schema.ObjectId, ref: 'Admin', required: true },
  raisedByName: String,
  raisedByEmail: String,
  raisedByPhone: String,

  // 'crm' = raised from the CRM Support page; 'student' = raised from the
  // LMS student panel (lmsController/supportTickets.js), where `category`
  // is one of config/supportTickets.js's STUDENT_TICKET_CATEGORIES.
  source: { type: String, enum: ['crm', 'student'], default: 'crm' },

  // Payment / Invoice tickets: the student's own PaymentRequest it's about,
  // plus a snapshot taken when the ticket was raised (what the student saw).
  payment: { type: mongoose.Schema.ObjectId, ref: 'PaymentRequest' },
  paymentSnapshot: {
    amount: Number,
    status: String,
    course: String,
    installmentNo: Number,
    installmentCount: Number,
    razorpayPaymentId: String,
    paidAt: Date,
    created: Date,
  },

  // Written by Support when resolving — goes to the raiser in the
  // "resolved" email and shows on their ticket.
  resolutionNote: String,
  resolvedAt: Date,
  resolvedByName: String,

  created: {
    type: Date,
    default: Date.now,
  },
  updated: {
    type: Date,
    default: Date.now,
  },
});

module.exports = mongoose.model('Ticket', schema);
