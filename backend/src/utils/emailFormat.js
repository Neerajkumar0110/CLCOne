// Shared HTML-escaping/currency/date formatting for every hand-built email
// template in this app. Spec §8 "Email template/notification mismatch" —
// these three helpers were previously copy-pasted independently into
// SendEmailTemplate.js, services/lms/studentAccountService.js,
// services/lms/mailer.js and services/payments/mailer.js, each its own
// near-identical (but not always byte-identical) implementation — a fix to
// one copy (e.g. an escaping edge case) silently never reached the others.
// This is a small, honest consolidation, not a full template-management
// system: templates themselves are still separate HTML-literal functions per
// email, just no longer each carrying their own copy of these primitives.

function escHtml(s) {
  return String(s || '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

function fmtInr(n) {
  try {
    return Number(n).toLocaleString('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });
  } catch (e) {
    return `₹${n}`;
  }
}

// "12 Mar 2026" — for a due date / receipt date, no time component.
function fmtDateShort(d) {
  try {
    return new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
  } catch (e) {
    return '';
  }
}

// "Thu, 12 Mar, 3:30 pm" — for a scheduled class/event moment.
function fmtDateTime(d) {
  try {
    return new Date(d).toLocaleString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  } catch (e) {
    return String(d);
  }
}

module.exports = { escHtml, fmtInr, fmtDateShort, fmtDateTime };
