const crypto = require('crypto');

// Shared request-signing scheme for Moodle (local_crmbridge) ⇄ CRM webhooks.
// Identical contract to services/calling/httpSign.js, kept as its own file so
// the two integrations can rotate secrets and evolve independently.
//
//   signature = HMAC_SHA256( `${timestamp}.${nonce}.${rawBody}`, secret )  (hex)
//
// Headers on every webhook POST from Moodle:
//   x-crm-key         shared API key (coarse gate, optional)
//   x-crm-timestamp   unix seconds
//   x-crm-nonce       random, single-use (idempotency / replay guard)
//   x-crm-signature   the HMAC above
//
// The PHP side (moodle/local_crmbridge/classes/webhook.php) builds the exact
// same string, so the contract cannot drift.

function sign({ secret, timestamp, nonce, rawBody }) {
  return crypto
    .createHmac('sha256', secret)
    .update(`${timestamp}.${nonce}.${rawBody}`)
    .digest('hex');
}

function buildHeaders({ apiKey, secret, body }) {
  const timestamp = Math.floor(Date.now() / 1000);
  const nonce = crypto.randomBytes(16).toString('hex');
  const rawBody = typeof body === 'string' ? body : JSON.stringify(body || {});
  return {
    headers: {
      'content-type': 'application/json',
      'x-crm-key': apiKey || '',
      'x-crm-timestamp': String(timestamp),
      'x-crm-nonce': nonce,
      'x-crm-signature': sign({ secret, timestamp, nonce, rawBody }),
    },
    rawBody,
  };
}

// Constant-time verify. Returns { ok, reason, nonce, timestamp }.
function verify({ apiKey, secret, toleranceSec = 300, headers = {}, rawBody = '' }) {
  const key = headers['x-crm-key'];
  const ts = Number(headers['x-crm-timestamp']);
  const nonce = headers['x-crm-nonce'];
  const sig = headers['x-crm-signature'];

  if (!ts || !nonce || !sig) return { ok: false, reason: 'missing_signature_headers' };
  if (apiKey && key !== apiKey) return { ok: false, reason: 'bad_api_key' };
  const skew = Math.abs(Math.floor(Date.now() / 1000) - ts);
  if (!Number.isFinite(ts) || skew > toleranceSec) return { ok: false, reason: 'timestamp_out_of_window' };

  const expected = sign({ secret, timestamp: ts, nonce, rawBody: rawBody || '' });
  const a = Buffer.from(expected);
  const b = Buffer.from(String(sig));
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return { ok: false, reason: 'bad_signature' };

  return { ok: true, nonce, timestamp: ts };
}

module.exports = { sign, buildHeaders, verify };
