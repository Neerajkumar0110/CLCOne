const { verify } = require('../services/lms/httpSign');
const { lmsConfig } = require('../config/lms');

// Guards the Moodle → CRM webhook routes (/api/lms/webhook/*). Not bearer-
// authed (Moodle has no CRM session) — every request is HMAC-signed by
// local_crmbridge with MOODLE_WEBHOOK_HMAC_SECRET, and optionally IP-checked.
// Needs req.rawBody (app.js captures it via express.json({ verify })).

function ipAllowed(reqIp, list) {
  if (!list.length) return true;
  const ip = String(reqIp || '').replace(/^::ffff:/, '');
  return list.some((entry) => {
    if (entry.includes('/')) {
      // very small CIDR check (IPv4 /8../32); good enough for an allow-list
      const [net, bitsRaw] = entry.split('/');
      const bits = Number(bitsRaw);
      const toInt = (a) => a.split('.').reduce((acc, o) => (acc << 8) + Number(o), 0) >>> 0;
      if (ip.split('.').length !== 4 || net.split('.').length !== 4) return false;
      const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
      return (toInt(ip) & mask) === (toInt(net) & mask);
    }
    return ip === entry;
  });
}

module.exports = function moodleWebhookAuth(req, res, next) {
  const { apiKey, hmacSecret, toleranceSec, allowIps } = lmsConfig.webhook;

  if (!hmacSecret) {
    return res.status(503).json({
      success: false,
      message: 'Moodle webhook not configured (MOODLE_WEBHOOK_HMAC_SECRET).',
    });
  }

  if (!ipAllowed(req.ip, allowIps)) {
    return res.status(403).json({ success: false, message: 'Source IP not allowed.' });
  }

  const result = verify({
    apiKey,
    secret: hmacSecret,
    toleranceSec,
    headers: req.headers,
    rawBody: req.rawBody || '',
  });

  if (!result.ok) {
    return res.status(401).json({ success: false, message: `Signature rejected: ${result.reason}` });
  }

  req.moodleWebhook = { nonce: result.nonce, timestamp: result.timestamp };
  next();
};
