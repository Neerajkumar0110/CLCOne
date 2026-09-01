const { verify } = require('../services/calling/httpSign');
const { callingConfig } = require('../config/calling');

// Guards the VPS → CRM webhook routes (/api/telephony/*). These are NOT
// bearer-authed (the VPS has no CRM login) — instead every request is
// signed with the shared webhook HMAC secret. Needs req.rawBody, which
// app.js captures via express.json({ verify }).
module.exports = function telephonyHmacAuth(req, res, next) {
  const { apiKey, hmacSecret, toleranceSec } = callingConfig.webhook;

  if (!hmacSecret) {
    return res.status(503).json({
      success: false,
      message: 'Telephony webhook not configured (TELEPHONY_WEBHOOK_HMAC_SECRET).',
    });
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

  req.telephony = { nonce: result.nonce, timestamp: result.timestamp };
  next();
};
