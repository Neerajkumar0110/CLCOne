const nodemailer = require('nodemailer');

// The single Gmail SMTP transport every outbound email in the app shares —
// LMS/live-class mail, payment + EMI mail (services/lms/mailer.js, which
// services/payments/mailer.js delegates to) and login OTPs
// (createAuthMiddleware/sendOtpMail.js).
//
// Why pooled: nodemailer's DEFAULT transport opens a fresh connection and a
// fresh SMTP AUTH for every single sendMail. Caching the transport object
// (which both mailers already did) does NOT change that. A class-reminder
// burst is one email per student, so a 250-student batch meant ~250 Gmail
// logins in about a minute — and Gmail answered with
//
//   454-4.7.0 Too many login attempts, please try again later
//
// which is exactly how 143 reminder emails were lost on 2026-10-09. `pool`
// keeps ONE authenticated connection open and streams every message down it,
// so a burst of any size costs a single login.
//
// maxConnections is deliberately 1: Gmail counts concurrent authenticated
// sessions, and more parallelism here is what triggered the throttle in the
// first place. rateLimit caps throughput well under Gmail's send quota so a
// big batch drains steadily instead of tripping a different limit.
let _tx = null;

function mailTransport() {
  if (!_tx) {
    _tx = nodemailer.createTransport({
      service: 'gmail',
      auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD },
      pool: true,
      maxConnections: 1,
      // Recycle the connection periodically — Gmail drops a very long-lived
      // one itself, and a recycle is a clean reconnect rather than a failed
      // send partway through a batch.
      maxMessages: 100,
      rateDelta: 1000,
      rateLimit: 5,
    });
  }
  return _tx;
}

// True only when the Gmail credentials are actually configured. Every caller
// checks this first: a missing credential must skip the send quietly, never
// throw in the middle of whatever action triggered the email.
const mailReady = () => !!(process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD);

// Gmail's transient refusals. These are "try again shortly", not "this email
// is bad" — 4.x.x is the SMTP class for temporary failures, and 454/421 are
// the two it actually answers a burst with.
function isTransientSmtpError(err) {
  const msg = String((err && err.message) || '');
  return /\b4\.7\.0\b|\b454\b|\b421\b|Too many login attempts|Try again later/i.test(msg);
}

// One sendMail with a short backoff on a transient refusal. A pooled
// transport makes the throttle far less likely, but a batch that lands while
// Gmail is already annoyed at us still deserves a second chance rather than
// a silently dropped class reminder.
async function sendMailWithRetry(options, { attempts = 3, baseDelayMs = 2000 } = {}) {
  let lastErr;
  for (let i = 0; i < attempts; i += 1) {
    try {
      return await mailTransport().sendMail(options);
    } catch (err) {
      lastErr = err;
      if (i === attempts - 1 || !isTransientSmtpError(err)) throw err;
      await new Promise((r) => setTimeout(r, baseDelayMs * 2 ** i));
    }
  }
  throw lastErr;
}

module.exports = { mailTransport, mailReady, isTransientSmtpError, sendMailWithRetry };
