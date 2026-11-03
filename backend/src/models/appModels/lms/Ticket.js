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

  // Learner tickets (design L9): which session / test / project it's about
  // and what they expected to happen, alongside `description` (what happened).
  reference: String,
  expected: String,
  // Status timeline shown to the raiser — appended on create, on every
  // status change by Support, and when the learner confirms or reopens.
  history: {
    type: [
      {
        _id: false,
        at: { type: Date, default: Date.now },
        action: { type: String, enum: ['created', 'status', 'confirmed', 'reopened'] },
        status: String,
        byName: String,
        note: String,
      },
    ],
    default: undefined,
  },
  // Raiser's answer after Support resolves: "yes, solved" (confirmedAt) or
  // "still an issue" (back to Open, reopenCount + 1).
  learnerConfirmedAt: Date,
  reopenCount: { type: Number, default: 0 },

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
