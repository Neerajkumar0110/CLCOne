const mongoose = require('mongoose');
const { callingConfig } = require('../../../../config/calling');
const { last10 } = require('../../../../services/calling/callingShared');

// GET/POST /api/cloud-call/plivo-answer — Plivo hits this per leg of a
// bridged call:
//   • customer leg (no ?leg=, has crmCallId) — the instant a customer WE
//     called picks up (see PLIVO_ADAPTER.buildCall's answer_url). Plays the
//     greeting, then joins a Conference room named after the CallRecord.
//   • inbound leg (no ?leg=, no crmCallId) — a stranger calling OUR number.
//     Creates a CallRecord, plays the Inbound IvrFlow's menu via
//     <GetDigits>, and routes to leg=ivr-digits once they pick a digit (or
//     time out).
//   • leg=ivr-digits — resolves the pressed digit against the IvrFlow,
//     finds an Available agent in the matching Team (or a fixed number),
//     and bridges to them the same way the outbound flow does.
//   • leg=agent — a SEPARATE outbound call placed the instant the OTHER
//     side of the bridge answers (placeBridgeLeg), so the phone being
//     dialed starts ringing in parallel with whatever the first party is
//     hearing, not after it. The instant THIS leg answers, it redirects the
//     first party's still-live call (Plivo's "modify a live call" API)
//     straight to leg=join — cutting off the greeting/hold message
//     immediately, no audible gap.
//   • leg=join — the redirect target above: joins the conference
//     immediately, no greeting. Also what the first party reaches on its
//     own if the far end never answers early enough to interrupt it.
// Recording is attached to whichever request actually starts the
// conference for the first party (leg=join, or the natural end of the
// greeting/hold message) — never the far end's wait-only join.

const escapeXml = (s) =>
  String(s || '').replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c]));

const respondXml = (res, xml) => {
  res.set('Content-Type', 'text/xml');
  res.status(200).send(`<?xml version="1.0" encoding="UTF-8"?>\n${xml}`);
};

const HOLD_XML =
  '<Response><Speak voice="WOMAN" language="en-IN">Please hold while we connect your call.</Speak><Wait length="3"/><Speak voice="WOMAN" language="en-IN">No agent is available right now. Please try again shortly.</Speak><Hangup/></Response>';

// Plays once, right when the customer picks up, while the agent's phone is
// separately ringing in parallel — cut short the instant the agent answers.
// Edit this string to change the wording.
const GREETING_XML =
  '<Speak voice="WOMAN" language="en-IN">Welcome to Career Lab Consulting. We are India\'s growing platform for career growth in Artificial Intelligence, Data Science, and modern technology careers. Our team is dedicated to helping you learn in-demand skills and build a successful career. Please stay on the line, we are connecting you to our team right now.</Speak>';

const roomName = (crmCallId) => `call-${crmCallId}`;

const plivoAuthHeaders = (p) => ({
  Authorization: `Basic ${Buffer.from(`${p.authId}:${p.authToken}`).toString('base64')}`,
  'Content-Type': 'application/json',
  Accept: 'application/json',
  Connection: 'close',
});

const connectingXml = (label) =>
  `<Speak voice="WOMAN" language="en-IN">Connecting you to ${escapeXml(label)}, please hold.</Speak>`;

const conferenceXml = (crmCallId, recordingCallbackUrl) =>
  `<Conference startConferenceOnEnter="true" endConferenceOnExit="true" record="true" recordFileFormat="mp3" recordingCallbackUrl="${escapeXml(recordingCallbackUrl)}" recordingCallbackMethod="POST">${escapeXml(roomName(crmCallId))}</Conference>`;

// Places the far end's own leg — a separate outbound Plivo call, fired the
// instant the first party is live, so it rings in parallel instead of after
// whatever they're hearing finishes.
async function placeBridgeLeg({ cfg, dialNumber, callerId, crmCallId, secretQs }) {
  const p = cfg.plivo;
  const answerUrl = `${p.publicBaseUrl}/api/cloud-call/plivo-answer?crmCallId=${crmCallId}&leg=agent${secretQs}`;
  const res = await fetch(`${p.apiBase}/v1/Account/${p.authId}/Call/`, {
    method: 'POST',
    headers: plivoAuthHeaders(p),
    body: JSON.stringify({ from: callerId, to: dialNumber, answer_url: answerUrl, answer_method: 'POST' }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Plivo bridge-leg call failed (HTTP ${res.status}): ${text}`);
  }
}

// The instant the far end's leg answers, redirect the first party's
// still-live call straight to ?leg=join — Plivo's "modify a live call"
// API — so whatever they're hearing is cut off immediately and they drop
// straight into the conference.
async function interruptGreeting({ cfg, liveCallUuid, crmCallId, secretQs }) {
  if (!liveCallUuid) return;
  const p = cfg.plivo;
  const joinUrl = `${p.publicBaseUrl}/api/cloud-call/plivo-answer?crmCallId=${crmCallId}&leg=join${secretQs}`;
  const res = await fetch(`${p.apiBase}/v1/Account/${p.authId}/Call/${liveCallUuid}/`, {
    method: 'POST',
    headers: plivoAuthHeaders(p),
    body: JSON.stringify({ legs: 'aleg', aleg_url: joinUrl, aleg_method: 'GET' }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Plivo live-call redirect failed (HTTP ${res.status}): ${text}`);
  }
}

// Shared final step for both outbound (customer leg) and inbound
// (post-menu) flows: place the far end's leg, then respond with a short
// spoken line + the conference join (recording attached here).
async function bridgeToNumber({ cfg, res, crmCallId, dialNumber, callerId, secretQs, speakXml }) {
  try {
    await placeBridgeLeg({ cfg, dialNumber, callerId, crmCallId, secretQs });
  } catch (err) {
    console.error('[plivoAnswer] failed to place bridge leg:', err.message);
    return respondXml(res, HOLD_XML);
  }
  const recordingCallbackUrl = `${cfg.plivo.publicBaseUrl}/api/cloud-call/webhook?crmCallId=${crmCallId}${secretQs}`;
  return respondXml(res, `<Response>${speakXml}${conferenceXml(crmCallId, recordingCallbackUrl)}</Response>`);
}

// Finds one Available agent belonging to a named Team. Team membership is
// stored as name strings (see models/appModels/core/Team.js), not Admin
// refs, so matching is by string comparison against name / "name surname".
async function findAvailableAgentInTeam(targetTeam) {
  if (!targetTeam) return null;
  const Team = mongoose.model('Team');
  const team = await Team.findOne({ removed: false, name: targetTeam }).lean();
  if (!team || !team.members || !team.members.length) return null;

  const Admin = mongoose.model('Admin');
  const admins = await Admin.find({ removed: false }).select('name surname phone mobile contactNumber').lean();
  const memberSet = new Set(team.members.map((m) => String(m).trim().toLowerCase()));
  const matched = admins.filter((a) => {
    const first = String(a.name || '').trim().toLowerCase();
    const full = `${a.name || ''} ${a.surname || ''}`.trim().toLowerCase();
    return memberSet.has(first) || memberSet.has(full);
  });
  if (!matched.length) return null;

  const AgentCallState = mongoose.model('AgentCallState');
  const states = await AgentCallState.find({ agent: { $in: matched.map((m) => m._id) }, status: 'Available' })
    .sort({ since: 1 })
    .lean();
  if (!states.length) return null;
  return matched.find((m) => String(m._id) === String(states[0].agent)) || null;
}

async function findAvailableAgentById(agentId) {
  if (!agentId) return null;
  const AgentCallState = mongoose.model('AgentCallState');
  const state = await AgentCallState.findOne({ agent: agentId, status: 'Available' }).lean();
  if (!state) return null;
  const Admin = mongoose.model('Admin');
  return Admin.findById(agentId).select('name surname phone mobile contactNumber').lean();
}

// ── inbound: a stranger calling OUR number ──────────────────────────────
async function handleInboundCall(req, res, cfg, secretQs) {
  const b = { ...req.query, ...(req.body || {}) };
  const fromNumber = b.From || b.from;
  const callUuid = b.CallUUID || b.call_uuid;

  const IvrFlow = mongoose.model('IvrFlow');
  const flow = await IvrFlow.findOne({ removed: false, enabled: true, direction: 'Inbound' }).sort({ created: 1 });
  if (!flow) return respondXml(res, HOLD_XML);

  const CallRecord = mongoose.model('CallRecord');
  const rec = await new CallRecord({
    direction: 'Inbound',
    status: 'dialing',
    phone: String(fromNumber || '').trim(),
    provider: 'cloud',
    providerCallId: callUuid || undefined,
    isMock: false,
    ivrFlow: flow._id,
    notes: 'Inbound IVR call',
  }).save();

  const actionUrl = `${cfg.plivo.publicBaseUrl}/api/cloud-call/plivo-answer?crmCallId=${rec._id}&leg=ivr-digits${secretQs}`;
  return respondXml(
    res,
    `<Response><GetDigits action="${escapeXml(actionUrl)}" method="POST" numDigits="1" timeout="10"><Speak voice="WOMAN" language="en-IN">${escapeXml(flow.greeting)}</Speak></GetDigits><Redirect method="POST">${escapeXml(actionUrl)}</Redirect></Response>`
  );
}

// ── inbound: the caller pressed (or failed to press) a digit ───────────
async function handleIvrDigits(req, res, cfg, crmCallId, secretQs) {
  if (!crmCallId || !mongoose.isValidObjectId(crmCallId)) return respondXml(res, HOLD_XML);
  const b = { ...req.query, ...(req.body || {}) };
  const digits = b.Digits || b.digits;

  const CallRecord = mongoose.model('CallRecord');
  const rec = await CallRecord.findOne({ _id: crmCallId, removed: false });
  if (!rec) return respondXml(res, HOLD_XML);

  const IvrFlow = mongoose.model('IvrFlow');
  const flow = rec.ivrFlow ? await IvrFlow.findById(rec.ivrFlow) : null;
  const opt = flow && digits ? flow.optionForDigit(digits) : null;

  rec.ivrResponses = rec.ivrResponses || [];
  if (digits) {
    rec.ivrResponses.push({ promptKey: flow ? flow.promptKey : 'main', digit: String(digits), label: (opt && opt.label) || `Pressed ${digits}`, at: new Date() });
  }

  let dialNumber = null;
  let label = 'our team';

  if (opt && opt.action === 'route_team' && opt.targetTeam) {
    const admin = await findAvailableAgentInTeam(opt.targetTeam);
    if (admin) {
      dialNumber = last10(admin.phone || admin.mobile || admin.contactNumber);
      label = opt.targetTeam;
      rec.agent = admin._id;
      rec.agentName = `${admin.name} ${admin.surname || ''}`.trim();
    }
  } else if (opt && opt.action === 'route_agent' && opt.targetAgent) {
    const admin = await findAvailableAgentById(opt.targetAgent);
    if (admin) {
      dialNumber = last10(admin.phone || admin.mobile || admin.contactNumber);
      label = admin.name || 'our team';
      rec.agent = admin._id;
      rec.agentName = `${admin.name} ${admin.surname || ''}`.trim();
    }
  } else if (opt && opt.action === 'route_number' && opt.targetNumber) {
    dialNumber = last10(opt.targetNumber);
    label = opt.label || 'our team';
  }

  // No match, or the matched team/agent has nobody Available right now —
  // fall back to the flow's single fallback number.
  if (!dialNumber && flow && flow.fallbackNumber) {
    dialNumber = last10(flow.fallbackNumber);
    label = 'our team';
  }

  if (!dialNumber) {
    await rec.save();
    return respondXml(res, HOLD_XML);
  }

  await rec.save();
  const fullDialNumber = `${cfg.plivo.countryCode}${dialNumber}`;
  return bridgeToNumber({
    cfg,
    res,
    crmCallId,
    dialNumber: fullDialNumber,
    callerId: cfg.callerId,
    secretQs,
    speakXml: connectingXml(label),
  });
}

const plivoAnswer = async (req, res) => {
  const cfg = callingConfig.cloud;
  const secretExpected = cfg.webhookSecret;
  const secretGot = req.query.secret;
  if (secretExpected && secretGot !== secretExpected) {
    return respondXml(res, '<Response><Speak>Unauthorized.</Speak><Hangup/></Response>');
  }

  const crmCallId = req.query.crmCallId;
  const secretQs = secretExpected ? `&secret=${encodeURIComponent(secretExpected)}` : '';
  const leg = req.query.leg;

  // ── redirect target: join the conference right now, no greeting ───────
  if (leg === 'join') {
    if (!crmCallId) return respondXml(res, '<Response><Hangup/></Response>');
    const recordingCallbackUrl = `${cfg.plivo.publicBaseUrl}/api/cloud-call/webhook?crmCallId=${crmCallId}${secretQs}`;
    return respondXml(res, `<Response>${conferenceXml(crmCallId, recordingCallbackUrl)}</Response>`);
  }

  // ── far-end leg: join the room and wait, then interrupt the first
  // party's greeting the instant we're here (i.e. the instant it answered) ──
  if (leg === 'agent') {
    if (!crmCallId || !mongoose.isValidObjectId(crmCallId)) return respondXml(res, '<Response><Hangup/></Response>');
    const CallRecord = mongoose.model('CallRecord');
    const rec = await CallRecord.findOne({ _id: crmCallId, removed: false }).select('providerCallId').lean();
    if (rec && rec.providerCallId) {
      interruptGreeting({ cfg, liveCallUuid: rec.providerCallId, crmCallId, secretQs }).catch((err) =>
        console.error('[plivoAnswer] failed to interrupt greeting:', err.message)
      );
    }
    return respondXml(
      res,
      `<Response><Conference startConferenceOnEnter="false" endConferenceOnExit="true">${escapeXml(roomName(crmCallId))}</Conference></Response>`
    );
  }

  // ── inbound IVR digit resolution ───────────────────────────────────────
  if (leg === 'ivr-digits') {
    return handleIvrDigits(req, res, cfg, crmCallId, secretQs);
  }

  // ── a stranger calling our number (no crmCallId — the CRM never
  // originated this call) ─────────────────────────────────────────────────
  if (!crmCallId) {
    return handleInboundCall(req, res, cfg, secretQs);
  }

  // ── customer leg of an outbound (CRM-initiated) call ───────────────────
  let agentNumber = null;
  let callerId = cfg.callerId;

  if (mongoose.isValidObjectId(crmCallId)) {
    const CallRecord = mongoose.model('CallRecord');
    const rec = await CallRecord.findOne({ _id: crmCallId, removed: false });
    if (rec) {
      callerId = rec.callerId || callerId;
      if (rec.agent) {
        const Admin = mongoose.model('Admin');
        const admin = await Admin.findById(rec.agent).select('phone mobile contactNumber').lean();
        agentNumber = admin && last10(admin.phone || admin.mobile || admin.contactNumber);
      }
    }
  }

  if (!agentNumber) return respondXml(res, HOLD_XML);

  const dialNumber = `${cfg.plivo.countryCode}${agentNumber}`;
  return bridgeToNumber({ cfg, res, crmCallId, dialNumber, callerId, secretQs, speakXml: GREETING_XML });
};

module.exports = { plivoAnswer };
