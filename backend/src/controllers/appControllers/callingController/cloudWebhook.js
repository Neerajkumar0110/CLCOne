const crypto = require('crypto');
const mongoose = require('mongoose');
const { callingConfig } = require('../../../config/calling');
const { setAgent, wrapupAgent, resolveLead, recountCampaign } = require('../../../services/calling/callingShared');

// POST /api/cloud-call/webhook — call-status + IVR callbacks from the cloud
// calling provider. Handles two Edesy products on one endpoint:
//   • number masking   — outbound bridge status + recording
//   • voice-agent       — inbound IVR: call.started / dtmf / transfer / ended
//
// Unauthenticated (the provider has no CRM session); protected by a shared
// secret in ?secret= / x-webhook-secret, OR an HMAC-SHA256 signature header
// (Edesy-style), matched against CLOUD_CALL_WEBHOOK_SECRET.
//
// Provider payloads vary, so every field is read from a list of likely key
// names and the raw body is always stored on the CallRecord.

const pick = (obj, ...keys) => {
  for (const k of keys) {
    if (obj[k] !== undefined && obj[k] !== null && obj[k] !== '') return obj[k];
  }
  return undefined;
};

const digitsOnly = (s) => String(s || '').replace(/[^\d]/g, '');
const last10 = (s) => {
  const d = digitsOnly(s);
  return d.length > 10 ? d.slice(-10) : d;
};

const toDate = (v) => {
  if (!v) return undefined;
  const n = Number(v);
  if (Number.isFinite(n) && n > 1e9) return new Date(n < 1e12 ? n * 1000 : n);
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
  if (/transfer/.test(s)) return 'transferred';
  if (/answer|bridge|connect|inprogress|in-progress|ongoing/.test(s)) return 'connected';
  if (/complete|hangup|end|completed|disconnect/.test(s)) return 'completed';
  if (/miss|no.?answer|noanswer|cancel|abandon|fail|busy|reject|not.?connect/.test(s)) return 'failed';
  if (/ring|dial|originate|initiat|start|incoming|inbound/.test(s)) return 'dialing';
  return undefined;
}

// Is this event carrying DTMF the caller pressed?
function extractDtmf(b) {
  const type = String(pick(b, 'event', 'event_type', 'type', 'Event') || '').toLowerCase();
  const raw = pick(b, 'digits', 'digit', 'dtmf', 'Digits', 'dtmf_digits', 'pressed', 'input', 'gather_result');
  if (raw === undefined && !/dtmf|digit|gather|keypress|menu/.test(type)) return undefined;
  const val = String(raw ?? '').trim();
  return val === '' ? undefined : val;
}

async function findFlow(b, campaign) {
  const IvrFlow = mongoose.model('IvrFlow');
  if (campaign && campaign.ivrFlow) {
    const f = await IvrFlow.findOne({ _id: campaign.ivrFlow, removed: false });
    if (f) return f;
  }
  const providerFlowId = pick(b, 'agent_id', 'agentId', 'flow_id', 'flowId', 'ivr_id', 'ivrId');
  if (providerFlowId) {
    const f = await IvrFlow.findOne({ providerFlowId: String(providerFlowId), removed: false });
    if (f) return f;
  }
  return IvrFlow.findOne({ removed: false, enabled: true, direction: 'Inbound' }).sort({ created: 1 });
}

// Apply a matched IVR option to the record: label the digit + set routing.
async function applyIvrOption(rec, flow, digit, promptKey) {
  const label =
    (flow && flow.optionForDigit && flow.optionForDigit(digit) && flow.optionForDigit(digit).label) || `Pressed ${digit}`;
  const entry = { promptKey: promptKey || (flow && flow.promptKey) || 'main', digit, label, at: new Date() };

  rec.ivrResponses = rec.ivrResponses || [];
  rec.ivrResponses.push(entry);
  if (flow && !rec.ivrFlow) rec.ivrFlow = flow._id;

  const opt = flow && flow.optionForDigit ? flow.optionForDigit(digit) : null;
  if (opt) {
    if (opt.action === 'route_team') {
      rec.transferredTo = opt.targetTeam || 'Queue';
      rec.transferStatus = 'requested';
    } else if (opt.action === 'route_agent' && opt.targetAgent) {
      rec.transferredToAgent = opt.targetAgent;
      rec.transferredTo = 'Agent';
      rec.transferStatus = 'requested';
    } else if (opt.action === 'route_number') {
      rec.transferredToNumber = digitsOnly(opt.targetNumber || '');
      rec.transferredTo = opt.targetNumber || 'Number';
      rec.transferStatus = 'requested';
    } else if (opt.action === 'voicemail') {
      rec.notes = (rec.notes ? rec.notes + ' · ' : '') + 'Sent to voicemail';
    }
  }

  if (rec.callLead) {
    await mongoose.model('CallLead').updateOne(
      { _id: rec.callLead },
      { $push: { ivrResponses: entry } }
    );
  }
}

const cloudWebhook = async (req, res) => {
  const CallRecord = mongoose.model('CallRecord');
  const CallLead = mongoose.model('CallLead');
  const secretExpected = callingConfig.cloud.webhookSecret;
  const secretGot = req.query.secret || req.get('x-webhook-secret');

  if (secretExpected) {
    const rawBody = req.rawBody || JSON.stringify(req.body || {});
    const sigHeader =
      req.get('x-edesy-signature') ||
      req.get('x-webhook-signature') ||
      req.get('x-signature') ||
      req.get('x-smartflo-signature');
    let ok = secretGot && timingSafeEq(secretGot, secretExpected);
    if (!ok && sigHeader) {
      const digest = crypto.createHmac('sha256', secretExpected).update(rawBody).digest('hex');
      ok = timingSafeEq(sigHeader, digest) || timingSafeEq(sigHeader, `sha256=${digest}`);
    }
    if (!ok) return res.status(401).json({ success: false, message: 'bad secret' });
  }

  // Edesy nests call fields under `data` with `event` + `call_sid` on top.
  const body = req.body || {};
  const nested = body.data && typeof body.data === 'object' ? body.data : {};
  const b = { ...body, ...nested, ...(req.query || {}) };

  const crmId = pick(b, 'custom_identifier', 'customField', 'CustomField', 'custom_field', 'crmCallId');
  const providerCallId = pick(b, 'call_sid', 'call_id', 'callId', 'CallSid', 'uuid', 'Sid', 'call_uuid');
  const eventType = String(pick(b, 'event', 'event_type', 'type', 'Event') || '').toLowerCase();
  const fromNumber = pick(b, 'from', 'caller', 'caller_id', 'From', 'party_b', 'customer_number', 'ani');
  const toNumber = pick(b, 'to', 'called', 'To', 'did', 'destination', 'dnis');
  const isInbound = /inbound|incoming/.test(String(pick(b, 'direction', 'call_direction', 'Direction') || '')) ||
    /call\.(started|incoming)/.test(eventType) && !crmId;

  // ── locate (or, for a fresh inbound call, create) the CallRecord ──────
  let rec = null;
  if (crmId && mongoose.isValidObjectId(crmId)) {
    rec = await CallRecord.findOne({ _id: crmId, removed: false });
  }
  if (!rec && providerCallId) {
    rec = await CallRecord.findOne({ providerCallId, removed: false });
  }

  if (!rec && isInbound && providerCallId) {
    // New inbound call landing in the IVR — open a record for it.
    const flow = await findFlow(b, null);
    const callerLead = fromNumber
      ? await CallLead.findOne({ phoneNormalized: last10(fromNumber), removed: false }).sort({ created: -1 })
      : null;
    const now = new Date();
    rec = await new CallRecord({
      contactName: (callerLead && callerLead.name) || 'Inbound Caller',
      phone: String(fromNumber || '').trim(),
      direction: 'Inbound',
      status: 'dialing',
      phaseAt: now,
      queuedAt: now,
      provider: 'cloud',
      providerCallId,
      isMock: false,
      callLead: callerLead ? callerLead._id : undefined,
      campaign: callerLead ? callerLead.campaign : undefined,
      ivrFlow: flow ? flow._id : undefined,
      callerId: toNumber ? String(toNumber) : undefined,
      notes: 'Inbound IVR call',
    }).save();
  }

  if (!rec) {
    return res.status(200).json({ success: true, message: 'no matching call' });
  }

  // ── DTMF / IVR menu selection ────────────────────────────────────────
  const dtmf = extractDtmf(b);
  if (dtmf !== undefined) {
    const camp = rec.campaign ? await mongoose.model('CallCampaign').findById(rec.campaign).lean() : null;
    const flow = rec.ivrFlow
      ? await mongoose.model('IvrFlow').findById(rec.ivrFlow)
      : await findFlow(b, camp);
    await applyIvrOption(rec, flow, dtmf, pick(b, 'prompt', 'prompt_key', 'node', 'gather_id'));
  }

  // ── status / timing / recording ─────────────────────────────────────
  const status = mapStatus(pick(b, 'status', 'call_status', 'CallStatus', 'callstate', 'state', 'dial_status', 'event'));
  const answeredAt = toDate(pick(b, 'answer_stamp', 'answered_at', 'answer_time', 'AnswerTime', 'start_stamp'));
  const endedAt = toDate(pick(b, 'end_stamp', 'ended_at', 'end_time', 'EndTime', 'hangup_time'));
  const durationSec =
    Number(
      pick(b, 'billsec', 'duration_sec', 'bill_duration_sec', 'duration', 'call_duration', 'CallDuration', 'conversation_duration')
    ) || 0;
  let recordingUrl = pick(b, 'recording_url', 'recordingUrl', 'RecordingUrl', 'recording', 'record_url');
  if (recordingUrl && !/^https?:\/\//i.test(recordingUrl)) {
    const origin = String(callingConfig.cloud.apiBase || '').replace(/\/v\d+$/, '');
    if (origin) recordingUrl = `${origin}/${String(recordingUrl).replace(/^\/+/, '')}`;
  }
  const hangupCause = pick(b, 'hangup_cause', 'HangupCause', 'reason', 'disconnected_by');

  // ── transfer event ─────────────────────────────────────────────────
  if (/transfer/.test(eventType) || status === 'transferred') {
    const dest = pick(b, 'transfer_to', 'transferred_to', 'destination', 'to', 'agent_number');
    if (dest) rec.transferredToNumber = digitsOnly(dest);
    rec.transferStatus = /fail/.test(eventType) ? 'failed' : /complete|answer|bridge/.test(eventType) ? 'completed' : 'ringing';
    if (!rec.transferredTo) rec.transferredTo = dest ? String(dest) : 'Number';
  }

  // Only ever move forward: dialing → connected → completed/failed.
  const rank = { queued: 0, dialing: 1, connected: 2, onhold: 2, completed: 3, failed: 3, cancelled: 3, transferred: 3 };
  const prevStatus = rec.status;
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

  // ── agent presence + lead/campaign roll-forward ─────────────────────
  const nowConnected = rec.status === 'connected' && prevStatus !== 'connected';
  const nowDone = ['completed', 'failed', 'transferred', 'cancelled'].includes(rec.status) &&
    !['completed', 'failed', 'transferred', 'cancelled'].includes(prevStatus);

  if (rec.agent && nowConnected) {
    await setAgent(rec.agent, { status: 'OnCall', currentCall: rec._id });
  }
  if (nowDone) {
    if (rec.agent) await wrapupAgent(rec);
    await resolveLead(
      rec,
      rec.disposition,
      rec.status === 'transferred' ? 'connected' : rec.status === 'completed' ? (rec.duration > 0 ? 'connected' : null) : 'failed'
    );
    if (rec.campaign) await recountCampaign(rec.campaign);
  } else if (rec.callLead && rec.status === 'connected') {
    await CallLead.updateOne({ _id: rec.callLead }, { $set: { status: 'Connected' } });
  }

  return res.status(200).json({ success: true, message: 'ok' });
};

module.exports = { cloudWebhook };
