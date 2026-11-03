// Categories a student can raise a ticket under from the LMS panel
// (lmsController/supportTickets.js) — the design board L9 list, in its
// order, plus the three the board leaves implicit. Mirrored in
// frontend/src/pages/Lms/Support/index.jsx.
const STUDENT_TICKET_CATEGORIES = [
  'Live class / join',
  'Recording / material',
  'Attendance',
  'Assessment',
  'Project',
  'Payment',
  'Policy / privacy',
  'Certificate',
  'Login / Technical',
  'Other',
];

// Names used before the L9 list (existing tickets keep theirs; a raise that
// still sends one is stored under the new name).
const LEGACY_TICKET_CATEGORIES = {
  'Payment / Fees': 'Payment',
  'Invoice / Receipt': 'Payment',
  'Live Class': 'Live class / join',
  'Internship Content': 'Recording / material',
};

// Seen only by authorised management (owner / Super Admin / Admin), not the
// Support role — see ticketController/scope.js.
const RESTRICTED_TICKET_CATEGORY = 'Policy / privacy';

// These let the student attach one of their own payments to the ticket.
const PAYMENT_TICKET_CATEGORIES = ['Payment'];

// Short human-readable ticket number, derived from the id (no counter to
// keep in sync): "TKT-1A2B3C".
const ticketNo = (ticket) => `TKT-${String(ticket._id).slice(-6).toUpperCase()}`;

module.exports = { STUDENT_TICKET_CATEGORIES, LEGACY_TICKET_CATEGORIES, RESTRICTED_TICKET_CATEGORY, PAYMENT_TICKET_CATEGORIES, ticketNo };
