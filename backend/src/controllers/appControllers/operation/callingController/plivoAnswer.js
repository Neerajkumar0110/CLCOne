const mongoose = require('mongoose');
const { callingConfig } = require('../../../../config/calling');
const { last10 } = require('../../../../services/calling/callingShared');

// GET/POST /api/cloud-call/plivo-answer — Plivo hits this the instant the
// customer picks up (see PLIVO_ADAPTER.buildCall's answer_url). Plivo has
// no fixed destination configured on its own portal: THIS decides what the
// customer hears next, by returning Plivo XML (not JSON). Bridges
// to the agent who owns the CallRecord (crmCallId query param); falls back
// to a hold message + hangup if no agent is attached.

const escapeXml = (s) =>
  String(s || '').replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c]));

const respondXml = (res, xml) => {
  res.set('Content-Type', 'text/xml');
  res.status(200).send(`<?xml version="1.0" encoding="UTF-8"?>\n${xml}`);
};

const HOLD_XML =
  '<Response><Speak voice="WOMAN" language="en-IN">Please hold while we connect your call.</Speak><Wait length="3"/><Speak voice="WOMAN" language="en-IN">No agent is available right now. Please try again shortly.</Speak><Hangup/></Response>';

const plivoAnswer = async (req, res) => {
  const cfg = callingConfig.cloud;
  const secretExpected = cfg.webhookSecret;
  const secretGot = req.query.secret;
  if (secretExpected && secretGot !== secretExpected) {
    return respondXml(res, '<Response><Speak>Unauthorized.</Speak><Hangup/></Response>');
  }

  const crmCallId = req.query.crmCallId;
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
  const secretQs = secretExpected ? `&secret=${encodeURIComponent(secretExpected)}` : '';
  const recordingCallbackUrl = `${cfg.plivo.publicBaseUrl}/api/cloud-call/webhook?crmCallId=${crmCallId}${secretQs}`;
  return respondXml(
    res,
    `<Response><Dial callerId="${escapeXml(callerId)}" timeout="30" record="true" recordFileFormat="mp3" recordingCallbackUrl="${escapeXml(recordingCallbackUrl)}" recordingCallbackMethod="POST"><Number>${escapeXml(dialNumber)}</Number></Dial></Response>`
  );
};

module.exports = { plivoAnswer };
