const mongoose = require('mongoose');
const { callingConfig } = require('../../../../config/calling');
const { last10 } = require('../../../../services/calling/callingShared');

// GET/POST /api/cloud-call/plivo-answer — Plivo hits this per leg of a
// bridged call:
//   • customer leg (no ?leg=) — the instant the customer picks up (see
//     PLIVO_ADAPTER.buildCall's answer_url). Plays the greeting, then joins
//     a Conference room named after the CallRecord.
//   • agent leg (?leg=agent) — a SEPARATE outbound call THIS handler places
//     the moment the customer answers (see placeAgentLeg), so the agent's
//     phone starts ringing in parallel with the greeting, not after it.
//     The instant Plivo tells us THIS leg answered, we also redirect the
//     customer's still-live call (Plivo's "modify a live call" API) straight
//     to ?leg=join — cutting the greeting off wherever it is and dropping
//     the customer straight into the conference, so there's no audible gap
//     between "agent picks up" and "call is live" from the customer's side.
//   • join (?leg=join) — the redirect target above: joins the conference
//     immediately, no greeting. Also what the customer leg reaches on its
//     own if the agent never answers early enough to interrupt it.
// Recording is attached to whichever request actually starts the
// conference for the customer (?leg=join, or the natural end of the
// greeting) — never the agent's wait-only join.

const escapeXml = (s) =>
  String(s || '').replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c]));

const respondXml = (res, xml) => {
  res.set('Content-Type', 'text/xml');
  res.status(200).send(`<?xml version="1.0" encoding="UTF-8"?>\n${xml}`);
};

const HOLD_XML =
  '<Response><Speak voice="WOMAN" language="en-IN">Please hold while we connect your call.</Speak><Wait length="3"/><Speak voice="WOMAN" language="en-IN">No agent is available right now. Please try again shortly.</Speak><Hangup/></Response>';

// Plays once, right when the customer picks up, while the agent's phone is
// separately ringing in parallel — cut short the instant the agent answers
// (see interruptGreeting below). Edit this string to change the wording.
const GREETING_XML =
  '<Speak voice="WOMAN" language="en-IN">Welcome to Career Lab Consulting. We are India\'s growing platform for career growth in Artificial Intelligence, Data Science, and modern technology careers. Our team is dedicated to helping you learn in-demand skills and build a successful career. Please stay on the line, we are connecting you to our team right now.</Speak>';

const roomName = (crmCallId) => `call-${crmCallId}`;

const plivoAuthHeaders = (p) => ({
  Authorization: `Basic ${Buffer.from(`${p.authId}:${p.authToken}`).toString('base64')}`,
  'Content-Type': 'application/json',
  Accept: 'application/json',
  Connection: 'close',
});

const conferenceXml = (crmCallId, recordingCallbackUrl) =>
  `<Conference startConferenceOnEnter="true" endConferenceOnExit="true" record="true" recordFileFormat="mp3" recordingCallbackUrl="${escapeXml(recordingCallbackUrl)}" recordingCallbackMethod="POST">${escapeXml(roomName(crmCallId))}</Conference>`;

// Places the agent's own leg — a separate outbound Plivo call, fired the
// instant the customer answers, so it rings in parallel with the greeting
// instead of after it.
async function placeAgentLeg({ cfg, dialNumber, callerId, crmCallId, secretQs }) {
  const p = cfg.plivo;
  const agentAnswerUrl = `${p.publicBaseUrl}/api/cloud-call/plivo-answer?crmCallId=${crmCallId}&leg=agent${secretQs}`;
  const res = await fetch(`${p.apiBase}/v1/Account/${p.authId}/Call/`, {
    method: 'POST',
    headers: plivoAuthHeaders(p),
    body: JSON.stringify({ from: callerId, to: dialNumber, answer_url: agentAnswerUrl, answer_method: 'POST' }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Plivo agent-leg call failed (HTTP ${res.status}): ${text}`);
  }
}

// The instant the agent's leg answers, redirect the customer's still-live
// call straight to ?leg=join — Plivo's "modify a live call" API — so
// whatever the customer is hearing (the greeting) is cut off immediately
// and they drop straight into the conference with the agent.
async function interruptGreeting({ cfg, customerCallUuid, crmCallId, secretQs }) {
  if (!customerCallUuid) return;
  const p = cfg.plivo;
  const joinUrl = `${p.publicBaseUrl}/api/cloud-call/plivo-answer?crmCallId=${crmCallId}&leg=join${secretQs}`;
  const res = await fetch(`${p.apiBase}/v1/Account/${p.authId}/Call/${customerCallUuid}/`, {
    method: 'POST',
    headers: plivoAuthHeaders(p),
    body: JSON.stringify({ legs: 'aleg', aleg_url: joinUrl, aleg_method: 'GET' }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Plivo live-call redirect failed (HTTP ${res.status}): ${text}`);
  }
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

  // ── agent leg: join the room and wait, then interrupt the customer's
  // greeting the instant we're here (i.e. the instant the agent answered) ──
  if (leg === 'agent') {
    if (!crmCallId || !mongoose.isValidObjectId(crmCallId)) return respondXml(res, '<Response><Hangup/></Response>');
    const CallRecord = mongoose.model('CallRecord');
    const rec = await CallRecord.findOne({ _id: crmCallId, removed: false }).select('providerCallId').lean();
    if (rec && rec.providerCallId) {
      interruptGreeting({ cfg, customerCallUuid: rec.providerCallId, crmCallId, secretQs }).catch((err) =>
        console.error('[plivoAnswer] failed to interrupt customer greeting:', err.message)
      );
    }
    return respondXml(
      res,
      `<Response><Conference startConferenceOnEnter="false" endConferenceOnExit="true">${escapeXml(roomName(crmCallId))}</Conference></Response>`
    );
  }

  // ── customer leg ───────────────────────────────────────────────────────
  let agentNumber = null;
  let callerId = cfg.callerId;

  if (crmCallId && mongoose.isValidObjectId(crmCallId)) {
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

  try {
    await placeAgentLeg({ cfg, dialNumber, callerId, crmCallId, secretQs });
  } catch (err) {
    console.error('[plivoAnswer] failed to place agent leg:', err.message);
    return respondXml(res, HOLD_XML);
  }

  const recordingCallbackUrl = `${cfg.plivo.publicBaseUrl}/api/cloud-call/webhook?crmCallId=${crmCallId}${secretQs}`;
  return respondXml(res, `<Response>${GREETING_XML}${conferenceXml(crmCallId, recordingCallbackUrl)}</Response>`);
};

module.exports = { plivoAnswer };
