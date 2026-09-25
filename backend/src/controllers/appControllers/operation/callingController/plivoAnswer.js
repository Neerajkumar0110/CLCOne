const mongoose = require('mongoose');
const { callingConfig } = require('../../../../config/calling');
const { last10 } = require('../../../../services/calling/callingShared');

// GET/POST /api/cloud-call/plivo-answer — Plivo hits this twice per bridged
// call, once per leg:
//   • customer leg (no ?leg= param) — the instant the customer picks up
//     (see PLIVO_ADAPTER.buildCall's answer_url). Plays the ~20s greeting,
//     then joins a Conference room named after the CallRecord.
//   • agent leg (?leg=agent) — a SEPARATE outbound call THIS handler places
//     the moment the customer answers (see placeAgentLeg below), so the
//     agent's phone starts ringing in parallel with the customer hearing
//     the greeting, not after it. Joins the SAME Conference room and waits
//     (Plivo's default hold treatment) until the customer's leg joins too.
// Recording is attached to the customer leg's Conference join (the leg that
// actually starts the conference), so it only captures the real
// conversation, not the agent's wait time.

const escapeXml = (s) =>
  String(s || '').replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c]));

const respondXml = (res, xml) => {
  res.set('Content-Type', 'text/xml');
  res.status(200).send(`<?xml version="1.0" encoding="UTF-8"?>\n${xml}`);
};

const HOLD_XML =
  '<Response><Speak voice="WOMAN" language="en-IN">Please hold while we connect your call.</Speak><Wait length="3"/><Speak voice="WOMAN" language="en-IN">No agent is available right now. Please try again shortly.</Speak><Hangup/></Response>';

// Plays once, right when the customer picks up, while the agent's phone is
// separately ringing in parallel — ~20s at Plivo TTS's normal pace. Edit
// this string to change the wording.
const GREETING_XML =
  '<Speak voice="WOMAN" language="en-IN">Welcome to Career Lab Consulting. We are India\'s growing platform for career growth in Artificial Intelligence, Data Science, and modern technology careers. Our team is dedicated to helping you learn in-demand skills and build a successful career. Please stay on the line, we are connecting you to our team right now.</Speak>';

const roomName = (crmCallId) => `call-${crmCallId}`;

// Places the agent's own leg — a separate outbound Plivo call, fired the
// instant the customer answers, so it rings in parallel with the greeting
// instead of after it. Fire-and-forget from the caller's point of view;
// errors are logged, never thrown (the customer's own XML must still return).
async function placeAgentLeg({ cfg, dialNumber, callerId, crmCallId, secretQs }) {
  const p = cfg.plivo;
  const agentAnswerUrl = `${p.publicBaseUrl}/api/cloud-call/plivo-answer?crmCallId=${crmCallId}&leg=agent${secretQs}`;
  const res = await fetch(`${p.apiBase}/v1/Account/${p.authId}/Call/`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${p.authId}:${p.authToken}`).toString('base64')}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Connection: 'close',
    },
    body: JSON.stringify({
      from: callerId,
      to: dialNumber,
      answer_url: agentAnswerUrl,
      answer_method: 'POST',
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Plivo agent-leg call failed (HTTP ${res.status}): ${text}`);
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

  // ── agent leg: just join the room and wait ────────────────────────────
  if (req.query.leg === 'agent') {
    if (!crmCallId) return respondXml(res, '<Response><Hangup/></Response>');
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
  return respondXml(
    res,
    `<Response>${GREETING_XML}<Conference startConferenceOnEnter="true" endConferenceOnExit="true" record="true" recordFileFormat="mp3" recordingCallbackUrl="${escapeXml(recordingCallbackUrl)}" recordingCallbackMethod="POST">${escapeXml(roomName(crmCallId))}</Conference></Response>`
  );
};

module.exports = { plivoAnswer };
