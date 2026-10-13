// Categories a student can raise a ticket under from the LMS panel
// (lmsController/supportTickets.js). Mirrored in
// frontend/src/pages/Lms/Support/index.jsx.
const STUDENT_TICKET_CATEGORIES = [
  'Payment / Fees',
  'Invoice / Receipt',
  'Live Class',
  'Internship Content',
  'Certificate',
  'Login / Technical',
  'Other',
];

// These let the student attach one of their own payments to the ticket.
const PAYMENT_TICKET_CATEGORIES = ['Payment / Fees', 'Invoice / Receipt'];

// Short human-readable ticket number, derived from the id (no counter to
// keep in sync): "TKT-1A2B3C".
const ticketNo = (ticket) => `TKT-${String(ticket._id).slice(-6).toUpperCase()}`;

module.exports = { STUDENT_TICKET_CATEGORIES, PAYMENT_TICKET_CATEGORIES, ticketNo };
