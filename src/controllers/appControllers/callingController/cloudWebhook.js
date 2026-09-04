const crypto = require('crypto');
const mongoose = require('mongoose');
const { callingConfig } = require('../../../config/calling');

// POST /api/cloud-call/webhook  — call-status callbacks from the cloud
// calling provider (Tata Smartflo / Exotel / …). Unauthenticated (the
// provider has no CRM session); protected by a shared secret passed as
// ?secret= or the x-webhook-secret header, matched against
// CLOUD_CALL_WEBHOOK_SECRET. Configure the same URL + secret in the
// provider dashboard's call-notify / status-callback settings.
//
// Providers vary a lot in payload shape, so every field is read from a
// list of likely key names and the raw body is always stored.

const pick = (obj, ...keys) => {
  for (const k of keys) {
    if (obj[k] !== undefined && obj[k] !== null && obj[k] !== '') return obj[k];
  }
  return undefined;
};

const toDate = (v) => {
  if (!v) return undefined;
  const n = Number(v);
  if (Number.isFinite(n) && n > 1e9) return new Date(n < 1e12 ? n * 1000 : n); // epoch s / ms
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? undefined : d;
};

const timingSafeEq = (a, b) => {
  const ba = Buffer.from(String(a || ''));
  const bb = Buffer.from(String(b || ''));
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
};

// Map a provider call state → our CallRecord.status.
function mapStatus(raw) {
  const s = String(raw || '').toLowerCase();
  if (/answer|bridge|connect|inprogress|in-progress|ongoing/.test(s)) return 'connected';
  if (/complete|hangup|end|completed|disconnect/.test(s)) return 'completed';
  if (/miss|no.?answer|noanswer|cancel|abandon|fail|busy|reject|not.?connect/.test(s)) return 'failed';
  if (/ring|dial|originate|initiat/.test(s)) return 'dialing';
  return undefined;
}

const cloudWebhook = async (req, res) => {
  const CallRecord = mongoose.model('CallRecord');
  const secretExpected = callingConfig.cloud.webhookSecret;
  const secretGot = req.query.secret || req.get('x-webhook-secret') || req.get('x-smartflo-signature');

  if (secretExpected) {
    if (!timingSafeEq(secretGot, secretExpected)) {
      return res.status(401).json({ success: false, message: 'bad secret' });
    }
  }

  const b = { ...(req.body || {}), ...(req.query || {}) };

  // Correlate: our id first (custom_identifier we sent), then the
  // provider's own call id.
  const crmId = pick(b, 'custom_identifier', 'customField', 'CustomField', 'custom_field', 'crmCallId');
  const providerCallId = pick(b, 'call_id', 'callId', 'CallSid', 'uuid', 'Sid', 'call_uuid');

  let rec = null;
  if (crmId && mongoose.isValidObjectId(crmId)) {
    rec = await CallRecord.findOne({ _id: crmId, removed: false });
  }
  if (!rec && providerCallId) {
    rec = await CallRecord.findOne({ providerCallId, removed: false });
  }
  if (!rec) {
    // 200 anyway so the provider doesn't retry-storm an event we can't place.
    return res.status(200).json({ success: true, message: 'no matching call' });
  }

  const status = mapStatus(pick(b, 'status', 'call_status', 'CallStatus', 'callstate', 'state', 'dial_status'));
  const answeredAt = toDate(pick(b, 'answer_stamp', 'answered_at', 'answer_time', 'AnswerTime', 'start_stamp'));
  const endedAt = toDate(pick(b, 'end_stamp', 'ended_at', 'end_time', 'EndTime', 'hangup_time'));
  const durationSec = Number(pick(b, 'billsec', 'duration', 'call_duration', 'CallDuration', 'conversation_duration')) || 0;
  const recordingUrl = pick(b, 'recording_url', 'recordingUrl', 'RecordingUrl', 'recording', 'record_url');
  const hangupCause = pick(b, 'hangup_cause', 'HangupCause', 'reason', 'disconnected_by');

  // Only ever move forward: dialing → connected → completed/failed.
  const rank = { queued: 0, dialing: 1, connected: 2, onhold: 2, completed: 3, failed: 3, cancelled: 3, transferred: 3 };
  if (status && (rank[status] ?? -1) >= (rank[rec.status] ?? -1)) {
    rec.status = status;
  }
  if (answeredAt && !rec.answeredAt) rec.answeredAt = answeredAt;
  if (endedAt) rec.endedAt = endedAt;
  if (durationSec && durationSec > (rec.duration || 0)) rec.duration = Math.round(durationSec);
  if (hangupCause && !rec.disposition) rec.notes = rec.notes || String(hangupCause);
  rec.phaseAt = new Date();

  if (recordingUrl) {
    rec.recording = {
      ...(rec.recording || {}),
      status: 'available',
      url: recordingUrl,
      durationSec: Math.round(durationSec) || rec.recording?.durationSec || 0,
      readyAt: new Date(),
    };
  }

  rec.providerRaw = b;
  await rec.save();

  // Roll the linked CallLead forward on a terminal event.
  if (rec.callLead && ['completed', 'failed'].includes(rec.status)) {
    const leadStatus = rec.status === 'completed' && rec.duration > 0 ? 'Completed' : 'Failed';
    await mongoose
      .model('CallLead')
      .updateOne({ _id: rec.callLead }, { $set: { status: leadStatus, lastDisposition: rec.disposition || undefined } });
  }

  return res.status(200).json({ success: true, message: 'ok' });
};

module.exports = { cloudWebhook };
