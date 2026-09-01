const crypto = require('crypto');

// Shared request-signing scheme for CRM ⇄ Telephony Integration Service.
//
//   signature = HMAC_SHA256( `${timestamp}.${nonce}.${rawBody}`, secret )  (hex)
//
// Headers on every request:
//   x-telephony-key         shared API key (coarse gate)
//   x-telephony-timestamp   unix seconds
//   x-telephony-nonce       random, single-use (idempotency / replay guard)
//   x-telephony-signature   the HMAC above
//
// Both sides use this file's two functions, so the contract can never drift.

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
      'x-telephony-key': apiKey,
      'x-telephony-timestamp': String(timestamp),
      'x-telephony-nonce': nonce,
      'x-telephony-signature': sign({ secret, timestamp, nonce, rawBody }),
    },
    rawBody,
  };
}

// Constant-time verify. Returns { ok, reason }.
function verify({ apiKey, secret, toleranceSec = 300, headers, rawBody }) {
  const key = headers['x-telephony-key'];
  const ts = Number(headers['x-telephony-timestamp']);
  const nonce = headers['x-telephony-nonce'];
  const sig = headers['x-telephony-signature'];

  if (!key || !ts || !nonce || !sig) return { ok: false, reason: 'missing_signature_headers' };
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
