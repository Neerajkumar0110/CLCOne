const { notify } = require('../../notify');

// Spec §5 "LMS admin access becoming unavailable" — monitoring/alerting on
// login failures didn't exist at all (confirmed: zero AuditLog references in
// createAuthMiddleware/). This is an in-memory sliding-window counter, not a
// persisted log — intentionally lightweight, matching every other tick job's
// best-effort style in this codebase, and correctly scoped to this app's real
// deployment (a persistent PM2 process on the VPS — see deploy/vps/README.md
// — not the Vercel serverless path, where in-memory state wouldn't survive
// between invocations anyway).
const WINDOW_MS = 15 * 60 * 1000;
const ACCOUNT_THRESHOLD = 5; // same privileged account, tight
const GLOBAL_THRESHOLD = 20; // any accounts, org-wide burst
const ALERT_COOLDOWN_MS = 30 * 60 * 1000;
const PRIVILEGED_ROLES = ['owner', 'Super Admin', 'Admin'];

const _byAccount = new Map(); // email -> [timestamps]
let _global = [];
let _lastAlertAt = 0;

function prune(arr, now) {
  return arr.filter((t) => now - t <= WINDOW_MS);
}

// Called from login.js/verifyOtp.js/loginWithPassword.js on every failed
// attempt (wrong OTP, wrong password, expired code). Never throws into the
// caller — this is monitoring, not a gate.
async function recordFailure({ email, role } = {}) {
  try {
    const now = Date.now();
    const key = String(email || '').toLowerCase();
    let accountCount = 0;
    if (key) {
      const hits = prune(_byAccount.get(key) || [], now);
      hits.push(now);
      _byAccount.set(key, hits);
      accountCount = hits.length;
    }
    _global = prune(_global, now);
    _global.push(now);

    const isPrivileged = role && PRIVILEGED_ROLES.includes(role);
    const accountBreach = isPrivileged && accountCount >= ACCOUNT_THRESHOLD;
    const globalBreach = _global.length >= GLOBAL_THRESHOLD;
    if (!accountBreach && !globalBreach) return;
    if (now - _lastAlertAt < ALERT_COOLDOWN_MS) return;
    _lastAlertAt = now;

    await notify({
      audience: 'management',
      module: 'Security',
      type: 'security.loginFailures',
      title: accountBreach ? `Repeated failed logins for ${email}` : 'Unusual burst of failed logins',
      body: accountBreach
        ? `${accountCount} failed login attempts for ${email}${role ? ` (${role})` : ''} in the last 15 minutes.`
        : `${_global.length} failed login attempts across all accounts in the last 15 minutes — possible incident.`,
      link: '/user-management',
    });
  } catch (e) {
    /* best-effort — never block the login flow */
  }
}

module.exports = { recordFailure };
