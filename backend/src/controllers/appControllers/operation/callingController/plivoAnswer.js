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
const conferenceXml = (crmCallId, recordingCallbackUrl, startConferenceOnEnter = true) =>
  `<Conference startConferenceOnEnter="${startConferenceOnEnter}" endConferenceOnExit="true" record="true" recordFileFormat="mp3" recordingCallbackUrl="${escapeXml(recordingCallbackUrl)}" recordingCallbackMethod="POST">${escapeXml(roomName(crmCallId))}</Conference>`;

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
    const query = { campaign: campaignId, status: 'Available' };
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

  // ── far-end leg: join the room and wait, then interrupt the first
  // party's greeting the instant we're here (i.e. the instant it answered) ──
  if (leg === 'agent') {
    if (!crmCallId || !mongoose.isValidObjectId(crmCallId)) return respondXml(res, '<Response><Hangup/></Response>');
    const CallRecord = mongoose.model('CallRecord');
    const rec = await CallRecord.findOne({ _id: crmCallId, removed: false });
    if (rec) {
      // The answer_url for this leg only ever fires once Plivo actually
      // connects it — this IS the "agent picked up" signal the
      // leg=agent-hangup branch below checks before flagging a miss.
      rec.agentLegAnswered = true;
      await rec.save();
      if (rec.agent) {
        const { notifyAgentCallEvent } = require('../../../../services/calling/callingShared');
        notifyAgentCallEvent(rec.agent, 'call:connected', rec).catch(() => {});
      }
      if (rec.providerCallId) {
        interruptGreeting({ cfg, liveCallUuid: rec.providerCallId, crmCallId, secretQs }).catch((err) =>
          console.error('[plivoAnswer] failed to interrupt greeting:', err.message)
        );
      }
    }
    const recordingCallbackUrl = `${cfg.plivo.publicBaseUrl}/api/cloud-call/webhook?crmCallId=${crmCallId}${secretQs}`;
    return respondXml(res, `<Response>${conferenceXml(crmCallId, recordingCallbackUrl, false)}</Response>`);
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
      if (rec && rec.agent && !rec.agentLegAnswered && !rec.missedByAgent) {
        rec.missedByAgent = true;
        rec.missedByAgentAt = new Date();
        await rec.save();
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

  const dialNumber = `${cfg.plivo.countryCode}${agentNumber}`;
  return bridgeToNumber({ cfg, res, crmCallId, dialNumber, callerId, secretQs, speakXml: GREETING_XML });
};

module.exports = { plivoAnswer };
