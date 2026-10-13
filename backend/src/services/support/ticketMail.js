const { sendMailWithRetry, mailReady } = require('../mail/transport');
const { lmsConfig } = require('../../config/lms');
const { ticketNo } = require('../../config/supportTickets');

// Emails for support tickets. Both are best-effort: the ticket itself is
// already saved, so a mail failure is logged, never thrown back at the
// request (same contract as notify.js).
//
//   newTicketMail      → SUPPORT_EMAIL (backend .env), when a ticket is raised
//   ticketResolvedMail → the person who raised it, when Support resolves it

const BRAND = process.env.GMAIL_SENDER_NAME || 'Career Lab Consulting';
const from = () => `"${BRAND}" <${process.env.GMAIL_USER}>`;
const baseUrl = () => lmsConfig.meeting.crmBaseUrl;

const esc = (s) =>
  String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const inr = (n) => (typeof n === 'number' ? `₹${n.toLocaleString('en-IN')}` : '—');
const fmtDate = (d) => (d ? new Date(d).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) : '—');

const row = (label, value) =>
  `<tr><td style="padding:6px 12px 6px 0;color:#667;white-space:nowrap;vertical-align:top">${esc(label)}</td><td style="padding:6px 0;color:#1f2937">${value}</td></tr>`;

function paymentRows(t) {
  const p = t.paymentSnapshot;
  if (!t.payment || !p) return '';
  const inst = p.installmentCount > 1 ? ` (installment ${p.installmentNo} of ${p.installmentCount})` : '';
  return [
    row('Payment', `${inr(p.amount)}${esc(inst)} — ${esc(p.status || '—')}`),
    p.course ? row('Internship', esc(p.course)) : '',
    row('Requested on', esc(fmtDate(p.created))),
    p.paidAt ? row('Paid on', esc(fmtDate(p.paidAt))) : '',
    p.razorpayPaymentId ? row('Razorpay payment ID', esc(p.razorpayPaymentId)) : '',
  ].join('');
}

const shell = (title, inner, cta) => `<!doctype html><html><body style="margin:0;background:#f4f6fb;font-family:Arial,Helvetica,sans-serif">
<div style="max-width:600px;margin:24px auto;background:#fff;border-radius:12px;padding:28px;border:1px solid #e5e7eb">
<h2 style="margin:0 0 16px;font-size:19px;color:#111827">${title}</h2>
${inner}
${cta ? `<p style="margin:22px 0 0"><a href="${cta.href}" style="display:inline-block;background:#2f5fd0;color:#fff;text-decoration:none;padding:11px 20px;border-radius:8px;font-weight:bold">${esc(cta.label)}</a></p>` : ''}
<p style="margin:24px 0 0;font-size:12px;color:#9ca3af">${esc(BRAND)} — automated message</p>
</div></body></html>`;

async function send(options, what) {
  if (!mailReady()) {
    console.warn(`[tickets] ${what} not sent — GMAIL_USER / GMAIL_APP_PASSWORD not set`);
    return false;
  }
  try {
    await sendMailWithRetry({ from: from(), ...options });
    return true;
  } catch (e) {
    console.error(`[tickets] ${what} failed:`, e && e.message);
    return false;
  }
}

async function newTicketMail(ticket) {
  const to = String(process.env.SUPPORT_EMAIL || '').trim();
  if (!to) {
    console.warn('[tickets] new-ticket mail not sent — SUPPORT_EMAIL not set');
    return false;
  }
  const no = ticketNo(ticket);
  const inner = `<table style="border-collapse:collapse;font-size:14px">
${row('Ticket', `<b>${esc(no)}</b>`)}
${row('Raised by', `${esc(ticket.raisedByName)}${ticket.source === 'student' ? ' (Candidate)' : ''}`)}
${row('Email', esc(ticket.raisedByEmail || '—'))}
${row('Phone', esc(ticket.raisedByPhone || '—'))}
${row('Category', esc(ticket.category))}
${row('Priority', esc(ticket.priority))}
${row('Subject', `<b>${esc(ticket.subject)}</b>`)}
${paymentRows(ticket)}
</table>
${ticket.description ? `<div style="margin-top:16px;padding:12px 14px;background:#f9fafb;border-radius:8px;font-size:14px;color:#374151;white-space:pre-wrap">${esc(ticket.description)}</div>` : ''}`;
  return send(
    {
      to,
      replyTo: ticket.raisedByEmail || undefined,
      subject: `[${no}] New ${ticket.category} ticket — ${ticket.subject}`,
      html: shell('New support ticket', inner, { href: `${baseUrl()}/support`, label: 'Open in CRM' }),
    },
    'new-ticket mail'
  );
}

async function ticketResolvedMail(ticket, toEmail) {
  if (!toEmail) return false;
  const no = ticketNo(ticket);
  const link = ticket.source === 'student' ? `${baseUrl()}/learn/support` : `${baseUrl()}/support`;
  const inner = `<p style="font-size:14px;color:#374151;margin:0 0 14px">Hi ${esc(ticket.raisedByName || '')}, your ticket has been resolved.</p>
<table style="border-collapse:collapse;font-size:14px">
${row('Ticket', `<b>${esc(no)}</b>`)}
${row('Subject', esc(ticket.subject))}
${row('Category', esc(ticket.category))}
${row('Resolved by', esc(ticket.resolvedByName || 'Support'))}
${row('Resolved on', esc(fmtDate(ticket.resolvedAt)))}
${paymentRows(ticket)}
</table>
${ticket.resolutionNote ? `<div style="margin-top:16px;padding:12px 14px;background:#ecfdf5;border-radius:8px;font-size:14px;color:#065f46;white-space:pre-wrap"><b>Resolution:</b><br>${esc(ticket.resolutionNote)}</div>` : ''}
<p style="font-size:13px;color:#6b7280;margin:16px 0 0">Still facing the issue? Just raise a new ticket from your panel.</p>`;
  return send(
    {
      to: toEmail,
      subject: `[${no}] Resolved — ${ticket.subject}`,
      html: shell('Your ticket is resolved', inner, { href: link, label: 'View ticket' }),
    },
    'resolved mail'
  );
}

module.exports = { newTicketMail, ticketResolvedMail };
