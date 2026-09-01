const crypto = require('crypto');
const mongoose = require('mongoose');
const { dispatch } = require('./dispatch');

// VPS → CRM webhook receiver. Mounted at /api/telephony/* WITHOUT bearer
// auth — every request is HMAC-signed (telephonyHmacAuth). Guarantees:
// idempotency, duplicate-prevention, audit, and a dead-letter queue
// (failed events are kept and replayed, never lost).

function eventIdFor(body, req) {
  if (body.eventId) return String(body.eventId);
  const basis = `${body.type}|${body.data?.uniqueid || ''}|${body.data?.status || ''}|${body.occurredAt || ''}|${req.telephony?.nonce || ''}`;
  return crypto.createHash('sha1').update(basis).digest('hex');
}

async function process(evt) {
  const TelephonyEvent = mongoose.model('TelephonyEvent');
  const eventId = evt.eventId;

  // Idempotent claim.
  const existing = await TelephonyEvent.findOne({ eventId });
  if (existing && existing.status === 'processed') {
    return { ok: true, duplicate: true };
  }
  const doc =
    existing ||
    (await new TelephonyEvent({
      eventId,
      type: evt.type,
      correlationId: evt.data?.crmCallId || evt.data?.uniqueid || evt.data?.linkedid,
      raw: evt,
    }).save());

  doc.attempts += 1;
  try {
    await dispatch(evt);
    doc.status = 'processed';
    doc.processedAt = new Date();
    doc.lastError = undefined;
    await doc.save();
    return { ok: true };
  } catch (err) {
    doc.status = err.softMiss && doc.attempts < 5 ? 'failed' : 'failed';
    doc.lastError = err.message;
    await doc.save();
    return { ok: false, error: err.message, softMiss: !!err.softMiss };
  }
}

// POST /api/telephony/events   { eventId?, type, occurredAt?, data:{...} }
const ingest = async (req, res) => {
  const b = req.body || {};
  if (!b.type) return res.status(400).json({ success: false, message: 'type is required' });
  const evt = {
    eventId: eventIdFor(b, req),
    type: b.type,
    occurredAt: b.occurredAt,
    data: b.data || b, // allow flat payloads too
  };
  const r = await process(evt);
  // Always 200 once persisted — a failed event is queued for replay, never
  // dropped. `softMiss` (record not found yet) is expected during races.
  return res.status(200).json({ success: true, ...r });
};

// Thin aliases (spec §13) — normalise then reuse the same pipeline.
const alias = (fixedType) => async (req, res) => {
  const b = req.body || {};
  const data = b.data || b;
  // /call-status carries a status string → route to the right sub-type.
  const STATUS_MAP = {
    dialing: 'call.started',
    ringing: 'call.ringing',
    ring: 'call.ringing',
    answered: 'call.answered',
    up: 'call.answered',
    hold: 'call.hold',
    ended: 'call.ended',
    hangup: 'call.ended',
  };
  const type =
    fixedType === 'call.status'
      ? STATUS_MAP[String(data.status || '').toLowerCase()] || 'call.ringing'
      : fixedType;
  const evt = { eventId: eventIdFor({ ...b, type }, req), type, occurredAt: b.occurredAt, data };
  const r = await process(evt);
  return res.status(200).json({ success: true, ...r });
};

const callStatus = alias('call.status');
const callEnded = alias('call.ended');
const recording = alias('recording.ready');
const transfer = alias('transfer.completed');

// GET /api/telephony/health — VPS liveness probe (still HMAC-gated).
const health = async (req, res) =>
  res.status(200).json({ success: true, ok: true, service: 'crm', time: new Date().toISOString() });

// Replay failed / soft-missed events. Called opportunistically by the
// calling dashboard/history controllers and exposed for manual/cron use.
async function replayFailed(limit = 25) {
  const TelephonyEvent = mongoose.model('TelephonyEvent');
  const stuck = await TelephonyEvent.find({ status: 'failed', attempts: { $lt: 6 } })
    .sort({ receivedAt: 1 })
    .limit(limit);
  let fixed = 0;
  for (const doc of stuck) {
    const r = await process({ ...doc.raw, eventId: doc.eventId });
    if (r.ok && !r.softMiss) fixed += 1;
  }
  return { scanned: stuck.length, fixed };
}

// GET /api/telephony/replay-failed  (HMAC-gated) — VPS or cron can poke it.
const replayEndpoint = async (req, res) => {
  const r = await replayFailed(Number(req.query.limit) || 50);
  return res.status(200).json({ success: true, ...r });
};

module.exports = { ingest, callStatus, callEnded, recording, transfer, health, replayEndpoint, replayFailed };
