// Payment-link email — reuses the same Gmail transport every other LMS
// email already goes through (services/lms/mailer.js), just with its own
// template. Best-effort: a send failure never blocks creating the payment.
const mailer = require('../lms/mailer');

function esc(s) {
  return String(s || '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}
function fmtInr(n) {
  try {
    return Number(n).toLocaleString('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });
  } catch (e) {
    return `₹${n}`;
  }
}

const GST_RATE = 0.18;
// The entered "Amount" is what's actually charged (GST-inclusive) — this
// just splits it back out for the email's benefit, it never changes what
// Razorpay collects. base + gst reconstruct to the original amount (gst is
// the remainder, not an independent round, so the two always add up exactly
// even after rounding).
function gstBreakdown(amount) {
  const total = Number(amount) || 0;
  const base = Math.round((total / (1 + GST_RATE)) * 100) / 100;
  const gst = Math.round((total - base) * 100) / 100;
  return { base, gst, total };
}

function paymentLinkEmailHtml({ name, course, amount, shortUrl }) {
  const { base, gst, total } = gstBreakdown(amount);
  return `<div style="font:15px/1.6 -apple-system,Segoe UI,Roboto,sans-serif;color:#17202c;max-width:520px;margin:0 auto">
  <h2 style="margin:0 0 4px">Fee payment request</h2>
  <p style="color:#556;margin:0 0 18px">Hi ${esc(name)}, please complete your fee payment below.</p>
  <div style="border:1px solid #e3e8ef;border-radius:12px;padding:18px 20px;margin:0 0 18px">
    <p style="margin:0 0 6px;color:#889;font-size:12.5px;text-transform:uppercase;letter-spacing:.4px">Amount due</p>
    <p style="margin:0 0 10px;font-size:26px;font-weight:800;color:#17202c">${esc(fmtInr(total))}</p>
    <table style="width:100%;border-collapse:collapse;font-size:13px;color:#556;margin:0 0 12px">
      <tr><td style="padding:2px 0">Amount (excl. GST)</td><td style="padding:2px 0;text-align:right">${esc(fmtInr(base))}</td></tr>
      <tr><td style="padding:2px 0">GST (18%)</td><td style="padding:2px 0;text-align:right">${esc(fmtInr(gst))}</td></tr>
      <tr style="font-weight:700;color:#17202c"><td style="padding:4px 0 0;border-top:1px solid #e3e8ef">Total payable</td><td style="padding:4px 0 0;border-top:1px solid #e3e8ef;text-align:right">${esc(fmtInr(total))}</td></tr>
    </table>
    ${course ? `<p style="margin:0;color:#334"><b>Course:</b> ${esc(course)}</p>` : ''}
  </div>
  <p style="margin:0 0 18px">
    <a href="${esc(shortUrl)}" style="display:inline-block;background:#2f5fd0;color:#fff;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:700">Pay Now</a>
  </p>
  <p style="color:#889;font-size:13px;margin:0">Or scan the attached QR code with any UPI app / your phone camera to open the same payment page. Once your payment is confirmed you'll be taken straight to a short KYC form to complete your enrollment.</p>
</div>`;
}

async function sendPaymentLinkEmail({ email, name, course, amount, shortUrl, qrDataUrl }) {
  const attachments = [];
  if (qrDataUrl) {
    const base64 = String(qrDataUrl).split(',')[1];
    if (base64) attachments.push({ filename: 'payment-qr.png', content: Buffer.from(base64, 'base64'), contentType: 'image/png' });
  }
  return mailer.sendMail([email], {
    subject: `Fee payment request — ${fmtInr(amount)}${course ? ` (${course})` : ''}`,
    html: paymentLinkEmailHtml({ name, course, amount, shortUrl }),
    attachments,
  });
}

function fmtDate(d) {
  try {
    return new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
  } catch (e) {
    return '';
  }
}

// daysUntilDue: positive = still ahead of the due date, 0 = due today.
function emiReminderEmailHtml({ name, course, amount, dueAt, daysUntilDue, shortUrl }) {
  const urgent = daysUntilDue <= 1;
  const whenLine =
    daysUntilDue === 0
      ? 'due <b>today</b>'
      : daysUntilDue === 1
      ? 'due <b>tomorrow</b>'
      : `due in <b>${daysUntilDue} days</b>`;
  return `<div style="font:15px/1.6 -apple-system,Segoe UI,Roboto,sans-serif;color:#17202c;max-width:520px;margin:0 auto">
  <h2 style="margin:0 0 4px">EMI installment reminder</h2>
  <p style="color:#556;margin:0 0 18px">Hi ${esc(name)}, your next EMI installment is ${whenLine} — ${esc(fmtDate(dueAt))}.</p>
  <div style="border:1px solid #e3e8ef;border-radius:12px;padding:18px 20px;margin:0 0 18px${urgent ? ';border-color:#f0b4b4;background:#fff8f8' : ''}">
    <p style="margin:0 0 6px;color:#889;font-size:12.5px;text-transform:uppercase;letter-spacing:.4px">Amount due</p>
    <p style="margin:0 0 6px;font-size:26px;font-weight:800;color:#17202c">${esc(fmtInr(amount))}</p>
    <p style="margin:0;color:#334">Due date: <b>${esc(fmtDate(dueAt))}</b></p>
    ${course ? `<p style="margin:6px 0 0;color:#334"><b>Course:</b> ${esc(course)}</p>` : ''}
  </div>
  <p style="margin:0 0 18px">
    <a href="${esc(shortUrl)}" style="display:inline-block;background:#2f5fd0;color:#fff;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:700">Pay Now</a>
  </p>
  <p style="color:#889;font-size:13px;margin:0">If your payment is already made, please ignore this reminder — it can take a few minutes to reflect. Missing the due date by more than a day pauses your course access until payment is received.</p>
</div>`;
}

async function sendEmiReminderEmail({ email, name, course, amount, dueAt, daysUntilDue, shortUrl }) {
  return mailer.sendMail([email], {
    subject:
      daysUntilDue <= 0
        ? `EMI due today — ${fmtInr(amount)}${course ? ` (${course})` : ''}`
        : `EMI due in ${daysUntilDue} day${daysUntilDue === 1 ? '' : 's'} — ${fmtInr(amount)}${course ? ` (${course})` : ''}`,
    html: emiReminderEmailHtml({ name, course, amount, dueAt, daysUntilDue, shortUrl }),
  });
}

module.exports = { sendPaymentLinkEmail, sendEmiReminderEmail };
