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
//   • leg=agent-hangup — passive notification (placeBridgeLeg's hangup_url)
//     for the agent's own leg specifically. Flags CallRecord.missedByAgent
//     when it fires without leg=agent ever having answered first.
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

const INBOUND_WELCOME = 'Thank you for calling Career Lab Consulting. Please stay on the line, we are connecting you to our team.';
const INBOUND_SORRY_XML =
  '<Response><Speak voice="WOMAN" language="en-IN">Sorry, all our team members are busy right now. We have noted your number and will call you back shortly. Thank you for calling Career Lab Consulting.</Speak><Hangup/></Response>';
const isSmartInbound = (rec) => !!(rec && rec.direction === 'Inbound' && rec.inbound && rec.inbound.routedBy === 'smart');

const plivoAuthHeaders = (p) => ({
  Authorization: `Basic ${Buffer.from(`${p.authId}:${p.authToken}`).toString('base64')}`,
  'Content-Type': 'application/json',
  Accept: 'application/json',
  Connection: 'close',
});

const connectingXml = (label) =>
  `<Speak voice="WOMAN" language="en-IN">Connecting you to ${escapeXml(label)}, please hold.</Speak>`;

// Both legs join the SAME conference room, and each one's own <Conference>
// tag is a fresh, independent XML declaration — whichever leg's request
// reaches Plivo first is the one that actually creates the room, using ITS
// own attributes. Since the agent leg now rings in PARALLEL with the
// customer's greeting (see the "ring in parallel" comment above), the agent
// leg can easily win that race — so both declarations must always carry the
// identical record="true"/recordingCallbackUrl attributes, or a race means
// recording silently never gets enabled depending on who joins first. Only
// `startConferenceOnEnter` is meant to differ between the two.
const conferenceXml = (crmCallId, recordingCallbackUrl, startConferenceOnEnter = true, endConferenceOnExit = true) =>
  `<Conference startConferenceOnEnter="${startConferenceOnEnter}" endConferenceOnExit="${endConferenceOnExit}" record="true" recordFileFormat="mp3" recordingCallbackUrl="${escapeXml(recordingCallbackUrl)}" recordingCallbackMethod="POST">${escapeXml(roomName(crmCallId))}</Conference>`;

// Places the far end's own leg — a separate outbound Plivo call, fired the
// instant the first party is live, so it rings in parallel instead of after
// whatever they're hearing finishes.
//
// ring_timeout + hangup_url turn an agent who never picks up into a signal
// we can actually see: without ring_timeout, Plivo's own default (45s)
// still applies, but without hangup_url we'd never hear about it at all —
// see the leg=agent-hangup branch below, which is what flags
// CallRecord.missedByAgent.
async function placeBridgeLeg({ cfg, dialNumber, callerId, crmCallId, secretQs }) {
  const p = cfg.plivo;
  const answerUrl = `${p.publicBaseUrl}/api/cloud-call/plivo-answer?crmCallId=${crmCallId}&leg=agent${secretQs}`;
  const hangupUrl = `${p.publicBaseUrl}/api/cloud-call/plivo-answer?crmCallId=${crmCallId}&leg=agent-hangup${secretQs}`;
  const res = await fetch(`${p.apiBase}/v1/Account/${p.authId}/Call/`, {
    method: 'POST',
    headers: plivoAuthHeaders(p),
    body: JSON.stringify({
      from: callerId,
      to: dialNumber,
      answer_url: answerUrl,
      answer_method: 'POST',
      ring_timeout: p.ringTimeoutSec,
      hangup_url: hangupUrl,
      hangup_method: 'POST',
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Plivo bridge-leg call failed (HTTP ${res.status}): ${text}`);
  }
  const json = await res.json().catch(() => null);
  const requestId = json && (Array.isArray(json.request_uuid) ? json.request_uuid[0] : json.request_uuid);
  if (requestId && mongoose.isValidObjectId(crmCallId)) {
    await mongoose
      .model('CallRecord')
      .updateOne({ _id: crmCallId }, { $set: { agentLegRequestId: String(requestId) } })
      .catch(() => {});
  }
}

// The customer hung up while the agent's phone was still ringing (or before
// the agent joined): cancel that ringing leg so the agent doesn't pick up
// into dead air — that "call drops ~5s after I answer" was exactly this
// (customer gone during the greeting, agent answering ~10-20s later).
// Plivo: DELETE /Request/{request_uuid}/ cancels a not-yet-answered call.
async function cancelAgentLeg(rec) {
  if (!rec || !rec.agentLegRequestId || rec.agentLegAnswered) return;
  const p = callingConfig.cloud.plivo;
  if (!p.authId || !p.authToken) return;
  const res = await fetch(`${p.apiBase}/v1/Account/${p.authId}/Request/${rec.agentLegRequestId}/`, {
    method: 'DELETE',
    headers: plivoAuthHeaders(p),
  }).catch(() => null);
  // 404 = it already ended / was answered meanwhile — nothing to cancel.
  if (res && !res.ok && res.status !== 404) {
    console.error('[plivoAnswer] cancel agent leg failed:', res.status);
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

// Instant Lead Pool predictive dial (CloudCallProvider.dialLeadPoolNext):
// the customer was dialled with NO agent picked yet, so the instant they
// answer, claim whichever agent has been free the longest — atomically
// (Available -> Ringing in one findOneAndUpdate), so two customers who
// happen to answer within the same second can never grab the same agent.
// `callRecordId` is stamped onto the claimed row's currentCall so the agent's
// presence and the call agree from the moment of the claim — the dialer's
// stale-reservation reaper and every "who is this agent on with" read key
// off it.
//
// A row is only usable if it still has a real Admin behind it with a
// dialable number. A presence row whose Admin was deleted stays Available
// forever (nothing cleans it up), and claiming before checking would burn
// that row to Ringing, hand back null, and leave the customer on hold music
// with no agent — once per answered call, for as long as the orphan exists.
// So walk past unusable rows, releasing each, and claim the first real one.
async function claimLeadPoolAgent(campaignId, callRecordId) {
  const AgentCallState = mongoose.model('AgentCallState');
  const Admin = mongoose.model('Admin');
  const skip = [];

  for (let i = 0; i < 10; i++) {
    const { getConnectMode, eligibleAgentFilter } = require('../../../../services/calling/connectModes');
    const query = { campaign: campaignId, status: 'Available', ...eligibleAgentFilter(await getConnectMode()) };
    if (skip.length) query.agent = { $nin: skip };

    const state = await AgentCallState.findOneAndUpdate(
      query,
      { $set: { status: 'Ringing', since: new Date(), currentCall: callRecordId || null } },
      { sort: { since: 1 }, new: true }
    );
    if (!state) return null; // nobody claimable

    const admin = await Admin.findById(state.agent)
      .select('name surname phone mobile contactNumber removed enabled')
      .lean();
    const number = admin && last10(admin.phone || admin.mobile || admin.contactNumber);
    if (admin && !admin.removed && admin.enabled !== false && number) return admin;

    // Unusable row — put it back the way we found it and try the next agent.
    await AgentCallState.updateOne(
      { _id: state._id, status: 'Ringing' },
      { $set: { status: 'Available', currentCall: null, since: new Date() } }
    );
    skip.push(state.agent);
  }
  return null;
}

// ── inbound: a stranger calling OUR number ──────────────────────────────
async function handleInboundCall(req, res, cfg, secretQs) {
  const b = { ...req.query, ...(req.body || {}) };
  const fromNumber = b.From || b.from;
  const callUuid = b.CallUUID || b.call_uuid;

  // Record every inbound call from the moment it's answered — a caller who
  // hangs up in the IVR / hold loop never reaches a recorded conference.
  const { recordCustomerCall } = require('../../../../services/calling/connectModes');
  const recordFromStart = (rec) => setTimeout(() => recordCustomerCall(rec, callUuid).catch(() => {}), 1500);

  const IvrFlow = mongoose.model('IvrFlow');
  const flow = await IvrFlow.findOne({ removed: false, enabled: true, direction: 'Inbound' }).sort({ created: 1 });
  if (!flow) {
    // No IVR menu → smart routing: the user they last spoke to, else a free
    // user, else a Team Leader (services/calling/inboundRouting.js).
    const inbound = require('../../../../services/calling/inboundRouting');
    const rec = await inbound.start({ from: fromNumber, to: b.To || b.to, callUuid });
    recordFromStart(rec);
    const holdUrl = `${cfg.plivo.publicBaseUrl}/api/cloud-call/plivo-answer?crmCallId=${rec._id}&leg=inbound-hold&n=1${secretQs}`;
    respondXml(
      res,
      `<Response><Speak voice="WOMAN" language="en-IN">${escapeXml(INBOUND_WELCOME)}</Speak><Redirect method="POST">${escapeXml(holdUrl)}</Redirect></Response>`
    );
    inbound.ringNext(rec._id).catch((err) => console.error('[inbound] routing failed:', err.message));
    return undefined;
  }

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
  recordFromStart(rec);

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

  // Genuinely nobody to take it — rather than just dropping the caller,
  // log it as a real callback so the target team sees a missed call to
  // work, instead of it vanishing with nothing but a CallRecord no one
  // watches.
  if (!dialNumber) {
    await rec.save();
    const CallCallback = mongoose.model('CallCallback');
    await new CallCallback({
      callRecord: rec._id,
      contactName: rec.phone,
      phone: rec.phone,
      team: (opt && opt.targetTeam) || undefined,
      scheduledAt: new Date(),
      notes: `Missed inbound call — no agent was available${opt && opt.targetTeam ? ` in ${opt.targetTeam}` : ''} to take it.`,
      createdByName: 'IVR (auto)',
    }).save();
    return respondXml(
      res,
      '<Response><Speak voice="WOMAN" language="en-IN">Sorry, no one is available to take your call right now. We have noted your number and our team will call you back shortly.</Speak><Hangup/></Response>'
    );
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

  // ── smart inbound: the caller waiting while we ring someone ─────────────
  if (leg === 'inbound-hold' || leg === 'inbound-sorry' || leg === 'inbound-room') {
    const inbound = require('../../../../services/calling/inboundRouting');
    const rec = crmCallId && mongoose.isValidObjectId(crmCallId) ? await mongoose.model('CallRecord').findOne({ _id: crmCallId, removed: false }) : null;
    if (!rec || !['dialing', 'ringing', 'connected', 'onhold'].includes(rec.status)) return respondXml(res, '<Response><Hangup/></Response>');
    if (leg === 'inbound-sorry' || rec.inbound?.exhausted) return respondXml(res, INBOUND_SORRY_XML);
    if (leg === 'inbound-room') {
      const { agentRoom } = require('../../../../services/calling/connectModes');
      return respondXml(res, `<Response><Conference startConferenceOnEnter="true" endConferenceOnExit="false" waitSound="">${escapeXml(agentRoom(req.query.agentId))}</Conference></Response>`);
    }
    const recordingCallbackUrl = `${cfg.plivo.publicBaseUrl}/api/cloud-call/webhook?crmCallId=${crmCallId}${secretQs}`;
    // someone is already on it (the redirect raced this loop) — join them
    if (rec.agentLegAnswered && rec.agentLegCallUuid) {
      return respondXml(res, `<Response>${conferenceXml(crmCallId, recordingCallbackUrl)}</Response>`);
    }
    const n = parseInt(req.query.n || '1', 10) || 1;
    if (n > inbound.MAX_HOLD_LOOPS) {
      await inbound.giveUp(rec, 'nobody answered in time');
      return respondXml(res, INBOUND_SORRY_XML);
    }
    // keep the stuck-dial sweep off a caller who is genuinely holding
    await mongoose.model('CallRecord').updateOne({ _id: rec._id }, { $set: { phaseAt: new Date() } });
    // safety net: nobody being rung (a lost hangup callback) → ring the next
    if (!rec.inbound?.ringing?.kind) inbound.ringNext(rec._id).catch(() => {});
    const nextUrl = `${cfg.plivo.publicBaseUrl}/api/cloud-call/plivo-answer?crmCallId=${crmCallId}&leg=inbound-hold&n=${n + 1}${secretQs}`;
    const line = n % 3 === 0 ? 'Thank you for waiting. Our team will be with you in a moment.' : 'Please stay on the line.';
    return respondXml(
      res,
      `<Response><Wait length="6"/><Speak voice="WOMAN" language="en-IN">${line}</Speak><Redirect method="POST">${escapeXml(nextUrl)}</Redirect></Response>`
    );
  }

  // ── far-end leg: join the room and wait, then interrupt the first
  // party's greeting the instant we're here (i.e. the instant it answered) ──
  if (leg === 'agent') {
    if (!crmCallId || !mongoose.isValidObjectId(crmCallId)) return respondXml(res, '<Response><Hangup/></Response>');
    const CallRecord = mongoose.model('CallRecord');
    const rec = await CallRecord.findOne({ _id: crmCallId, removed: false });
    if (isSmartInbound(rec)) {
      const inbound = require('../../../../services/calling/inboundRouting');
      const b = { ...req.query, ...(req.body || {}) };
      const r = await inbound.answered(rec, req.query.agentId, b.CallUUID || b.call_uuid);
      if (r === 'gone') {
        return respondXml(res, '<Response><Speak voice="WOMAN" language="en-IN">The caller has already disconnected.</Speak><Hangup/></Response>');
      }
      if (r !== 'ok') return respondXml(res, '<Response><Hangup/></Response>');
      const cb = `${cfg.plivo.publicBaseUrl}/api/cloud-call/webhook?crmCallId=${crmCallId}${secretQs}`;
      return respondXml(res, `<Response>${conferenceXml(crmCallId, cb, false, false)}</Response>`);
    }
    if (rec) {
      // The answer_url for this leg only ever fires once Plivo actually
      // connects it — this IS the "agent picked up" signal the
      // leg=agent-hangup branch below checks before flagging a miss.
      rec.agentLegAnswered = true;
      await rec.save();
      // The customer already hung up (e.g. during the greeting) — tell the
      // agent instead of dropping them into a silent, empty conference.
      if (['completed', 'failed', 'cancelled'].includes(rec.status)) {
        return respondXml(
          res,
          '<Response><Speak voice="WOMAN" language="en-IN">The customer has already disconnected.</Speak><Hangup/></Response>'
        );
      }
      if (rec.agent) {
        const { notifyAgentCallEvent, setAgent } = require('../../../../services/calling/callingShared');
        await setAgent(rec.agent, { status: 'OnCall', currentCall: rec._id, since: new Date() });
        notifyAgentCallEvent(rec.agent, 'call:connected', rec).catch(() => {});
      }
      // Browser mode has no greeting — the customer is ALREADY in the room.
      // Redirecting them would make them leave it (endConferenceOnExit), which
      // ends the conference and drops the browser leg ~1s after it answers:
      // customer hears silence, agent hears nothing.
      if (rec.providerCallId && rec.connectMode !== 'browser') {
        interruptGreeting({ cfg, liveCallUuid: rec.providerCallId, crmCallId, secretQs }).catch((err) =>
          console.error('[plivoAnswer] failed to interrupt greeting:', err.message)
        );
      }
    }
    const recordingCallbackUrl = `${cfg.plivo.publicBaseUrl}/api/cloud-call/webhook?crmCallId=${crmCallId}${secretQs}`;
    return respondXml(res, `<Response>${conferenceXml(crmCallId, recordingCallbackUrl, false)}</Response>`);
  }

  // ── alwaysOn: the agent's own standing line answered — park them in
  // their room; every pool customer who answers is dropped in here. ──
  if (leg === 'agent-line') {
    const agentId = req.query.agentId;
    if (!agentId || !mongoose.isValidObjectId(agentId)) return respondXml(res, '<Response><Hangup/></Response>');
    const st = await mongoose.model('AgentCallState').findOne({ agent: agentId }).select('campaign status').lean();
    if (!st || !st.campaign || st.status === 'Offline') {
      return respondXml(res, '<Response><Speak voice="WOMAN" language="en-IN">You are not in the lead pool. Goodbye.</Speak><Hangup/></Response>');
    }
    await mongoose.model('AgentCallState').updateOne(
      { agent: agentId },
      { $set: { agentLineLive: true, agentLineCallUuid: req.body?.CallUUID || req.query.CallUUID || null, agentLineAt: new Date() } }
    );
    const { agentRoom } = require('../../../../services/calling/connectModes');
    return respondXml(
      res,
      `<Response><Speak voice="WOMAN" language="en-IN">You are connected to the lead pool. Stay on the line, customers will join you here with a beep.</Speak><Conference startConferenceOnEnter="true" endConferenceOnExit="true" enterSound="beep:1" exitSound="beep:2" waitSound="">${escapeXml(agentRoom(agentId))}</Conference></Response>`
    );
  }
  if (leg === 'agent-line-hangup') {
    const agentId = req.query.agentId;
    if (agentId && mongoose.isValidObjectId(agentId)) {
      await mongoose
        .model('AgentCallState')
        .updateOne({ agent: agentId }, { $set: { agentLineLive: false, agentLineCallUuid: null, agentLineRequestId: null } });
      const { notifyAgentCallEvent } = require('../../../../services/calling/callingShared');
      notifyAgentCallEvent(agentId, 'pool:line-dropped', { agent: agentId }).catch(() => {});
    }
    return respondXml(res, '<Response></Response>');
  }

  // ── far-end leg's hangup notification — fires whether it was ever
  // answered or not. If leg=agent's answer_url never fired for this
  // CallRecord (agentLegAnswered still false), the agent's phone rang out
  // (ring_timeout), was busy, was rejected, or the caller gave up first —
  // every one of those is "this agent didn't pick up", so flag it exactly
  // once. Passive notification only — Plivo doesn't act on the response. ──
  if (leg === 'agent-hangup') {
    if (crmCallId && mongoose.isValidObjectId(crmCallId)) {
      const CallRecord = mongoose.model('CallRecord');
      const rec = await CallRecord.findOne({ _id: crmCallId, removed: false });
      if (isSmartInbound(rec)) {
        const b = { ...req.query, ...(req.body || {}) };
        await require('../../../../services/calling/inboundRouting')
          .legEnded(rec, req.query.agentId, b.HangupCauseName || b.HangupCause)
          .catch((err) => console.error('[inbound] leg end failed:', err.message));
        return respondXml(res, '<Response></Response>');
      }
      if (rec && rec.agent && !rec.agentLegAnswered && !rec.missedByAgent) {
        rec.missedByAgent = true;
        rec.missedByAgentAt = new Date();
        await rec.save();
        // Browser phone didn't pick up (stuck SDK answers "Busy" to every
        // call): take this agent off browser routing until their tab
        // rebuilds its phone, so the pool stops sending customers into
        // silence. Meanwhile their calls ring the mobile (classic).
        if (rec.connectMode === 'browser') {
          await mongoose
            .model('AgentCallState')
            .updateOne({ agent: rec.agent }, { $set: { browserReadyAt: null, browserResetNeeded: true } });
          console.log(`[browser-phone] ${rec.agentName || rec.agent}: leg not answered (${req.body?.HangupCauseName || req.query.HangupCauseName || 'no answer'}) — reset requested`);
        }
        const { notifyAgentCallEvent } = require('../../../../services/calling/callingShared');
        notifyAgentCallEvent(rec.agent, 'call:missed', rec).catch(() => {});
      }
    }
    return respondXml(res, '<Response></Response>');
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
  let rec = null;

  if (mongoose.isValidObjectId(crmCallId)) {
    const CallRecord = mongoose.model('CallRecord');
    rec = await CallRecord.findOne({ _id: crmCallId, removed: false });
    if (rec) {
      callerId = rec.callerId || callerId;
      // The customer just picked up — record it now. Plivo only calls our
      // hangup_url at the END, so without this a live call sat on 'dialing'
      // for its whole length and the dialer's 120s "stuck dial" sweep marked
      // it failed mid-conversation, freed the agent and rang them with a
      // second customer while they were still talking.
      if (['queued', 'dialing', 'ringing'].includes(rec.status)) {
        rec.status = 'connected';
        if (!rec.answeredAt) rec.answeredAt = new Date();
        rec.phaseAt = new Date();
        await rec.save();
        // A pool customer has no agent yet and may never get one (hold,
        // then re-queue) — record from the answer so that call is kept too.
        if (!rec.agent) {
          const answeredUuid = (req.body && (req.body.CallUUID || req.body.call_uuid)) || req.query.CallUUID;
          const { recordCustomerCall } = require('../../../../services/calling/connectModes');
          setTimeout(() => recordCustomerCall(rec, answeredUuid).catch(() => {}), 1500);
        }
      }
      if (rec.agent) {
        const Admin = mongoose.model('Admin');
        const admin = await Admin.findById(rec.agent).select('phone mobile contactNumber').lean();
        agentNumber = admin && last10(admin.phone || admin.mobile || admin.contactNumber);
      } else if (rec.campaign) {
        // Instant Lead Pool: this customer was dialled with no agent
        // picked up front (see CloudCallProvider.dialLeadPoolNext) — they
        // just answered, so claim one right now.
        const CallCampaign = mongoose.model('CallCampaign');
        const camp = await CallCampaign.findOne({ _id: rec.campaign, isLeadPool: true, removed: false })
          .select('_id')
          .lean();
        if (camp) {
          const claimed = await claimLeadPoolAgent(camp._id, rec._id);
          if (claimed) {
            rec.agent = claimed._id;
            rec.agentName = `${claimed.name} ${claimed.surname || ''}`.trim();
            await rec.save();
            agentNumber = last10(claimed.phone || claimed.mobile || claimed.contactNumber);
          }
        }
      }
    }
  }

  if (!agentNumber) {
    // No agent free the instant this customer answered — every agent in
    // the pool is mid-call for at most a few seconds longer, so hold
    // briefly and retry claiming one instead of dropping them immediately.
    const holdTry = parseInt(req.query.holdTry || '0', 10);
    if (rec && rec.campaign && holdTry < 4) {
      const retryUrl = `${cfg.plivo.publicBaseUrl}/api/cloud-call/plivo-answer?crmCallId=${crmCallId}&holdTry=${holdTry + 1}${secretQs}`;
      return respondXml(
        res,
        `<Response><Speak voice="WOMAN" language="en-IN">${holdTry === 0 ? 'Please hold, connecting you to our team.' : 'Still connecting you, thank you for your patience.'}</Speak><Wait length="4"/><Redirect method="POST">${escapeXml(retryUrl)}</Redirect></Response>`
      );
    }
    if (rec && rec.callLead) {
      // Nobody free after several tries — park the lead for a normal
      // retry pass rather than losing it outright.
      await mongoose
        .model('CallLead')
        .updateOne({ _id: rec.callLead, status: 'Dialing' }, { $set: { status: 'Queued' } });
    }
    return respondXml(res, HOLD_XML);
  }

  // Every agent-bridged outbound call — pool, instant Facebook lead, Dialer,
  // callback — follows the connect mode Admin picked
  // (services/calling/connectModes.js), as long as THIS agent is ready for
  // it (line live / browser phone registered); otherwise it rings their
  // mobile exactly as before, so no call is ever lost to the mode.
  const isPoolCall = !!(rec && rec.campaign && (await mongoose
    .model('CallCampaign')
    .exists({ _id: rec.campaign, isLeadPool: true, removed: false })));
  const modes = require('../../../../services/calling/connectModes');
  const mode = rec && rec.agent ? await modes.getConnectMode() : 'classic';

  if (mode === 'alwaysOn' && rec && rec.agent) {
    const st = await mongoose.model('AgentCallState').findOne({ agent: rec.agent }).select('agentLineLive').lean();
    if (st && st.agentLineLive) {
      rec.connectMode = 'alwaysOn';
      rec.agentLegAnswered = true; // the agent is already on their line
      await rec.save();
      const { notifyAgentCallEvent, setAgent } = require('../../../../services/calling/callingShared');
      await setAgent(rec.agent, { status: 'OnCall', currentCall: rec._id, since: new Date() });
      notifyAgentCallEvent(rec.agent, 'call:connected', rec).catch(() => {});
      const answeredUuid = (req.body && (req.body.CallUUID || req.body.call_uuid)) || req.query.CallUUID;
      setTimeout(() => modes.recordCustomerCall(rec, answeredUuid).catch(() => {}), 1500);
      return respondXml(
        res,
        `<Response><Conference startConferenceOnEnter="true" endConferenceOnExit="false" waitSound="">${escapeXml(modes.agentRoom(rec.agent))}</Conference></Response>`
      );
    }
    // Line dropped since they were picked — fall back to ringing the mobile.
  }

  if (mode === 'browser' && rec && rec.agent) {
    const st = await mongoose.model('AgentCallState').findOne({ agent: rec.agent }).select('plivoEndpoint browserReadyAt').lean();
    const user = st && st.plivoEndpoint && st.plivoEndpoint.username;
    const ready = st && st.browserReadyAt && Date.now() - new Date(st.browserReadyAt).getTime() < 75 * 1000;
    if (user && ready) {
      rec.connectMode = 'browser';
      await rec.save();
      // No greeting: the browser auto-answers in about a second.
      return bridgeToNumber({ cfg, res, crmCallId, dialNumber: `sip:${user}@phone.plivo.com`, callerId, secretQs, speakXml: '' });
    }
  }

  if (rec && (isPoolCall || rec.agent) && !rec.connectMode) {
    rec.connectMode = 'classic';
    await rec.save();
  }
  const dialNumber = `${cfg.plivo.countryCode}${agentNumber}`;
  return bridgeToNumber({ cfg, res, crmCallId, dialNumber, callerId, secretQs, speakXml: GREETING_XML });
};

module.exports = { plivoAnswer, cancelAgentLeg };
