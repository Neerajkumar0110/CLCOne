const mongoose = require('mongoose');

// Maps a normalised telephony event onto the CRM data model. Pure-ish:
// throws on unrecoverable errors (caller records a failed TelephonyEvent
// for later replay). Idempotency is enforced upstream by TelephonyEvent.

const HANGUP_TO_STATUS = {
  ANSWER: 'completed',
  NORMAL_CLEARING: 'completed',
  BUSY: 'busy',
  NO_ANSWER: 'no-answer',
  NOANSWER: 'no-answer',
  CANCEL: 'cancelled',
  CONGESTION: 'failed',
  CHANUNAVAIL: 'failed',
  FAILED: 'failed',
  VOICEMAIL: 'voicemail',
};

async function findRecord(data = {}) {
  const CallRecord = mongoose.model('CallRecord');
  if (data.crmCallId && mongoose.isValidObjectId(data.crmCallId)) {
    const r = await CallRecord.findById(data.crmCallId);
    if (r) return r;
  }
  if (data.uniqueid) {
    const r = await CallRecord.findOne({ asteriskUniqueId: data.uniqueid });
    if (r) return r;
  }
  if (data.linkedid) {
    const r = await CallRecord.findOne({ asteriskLinkedId: data.linkedid, removed: false }).sort({ created: -1 });
    if (r) return r;
  }
  if (data.providerCallId) {
    const r = await CallRecord.findOne({ providerCallId: data.providerCallId });
    if (r) return r;
  }
  return null;
}

async function setAgent(agentId, patch) {
  if (!agentId) return;
  await mongoose.model('AgentCallState').updateOne(
    { agent: agentId },
    { $set: { ...patch, lastSeenAt: new Date() } },
    { upsert: true }
  );
}

async function resolveLead(rec, status, disposition) {
  if (!rec.callLead) return;
  await mongoose
    .model('CallLead')
    .updateOne(
      { _id: rec.callLead },
      { $set: { status, lastDisposition: disposition || undefined, lastAttemptAt: new Date() } }
    );
}

async function dispatch(evt) {
  const CallRecord = mongoose.model('CallRecord');
  const type = evt.type;
  const data = evt.data || {};
  const now = evt.occurredAt ? new Date(evt.occurredAt) : new Date();

  // ── inbound call with no record yet → create one ──────────────────────
  if (type === 'call.started' || type === 'call.dialing') {
    let rec = await findRecord(data);
    if (!rec) {
      rec = new CallRecord({
        campaign: mongoose.isValidObjectId(data.campaignId) ? data.campaignId : undefined,
        callLead: mongoose.isValidObjectId(data.crmLeadId) ? data.crmLeadId : undefined,
        agent: mongoose.isValidObjectId(data.agentId) ? data.agentId : undefined,
        agentName: data.agentName,
        contactName: data.contactName || data.callerName,
        phone: data.phone || data.callerNumber,
        direction: data.direction === 'Inbound' ? 'Inbound' : 'Outbound',
        provider: 'telephony',
        isMock: false,
        queuedAt: now,
      });
    }
    rec.status = 'dialing';
    rec.phaseAt = now;
    rec.asteriskUniqueId = data.uniqueid || rec.asteriskUniqueId;
    rec.asteriskLinkedId = data.linkedid || rec.asteriskLinkedId;
    rec.providerCallId = data.providerCallId || data.uniqueid || rec.providerCallId;
    rec.vicidialLeadId = data.vicidialLeadId || rec.vicidialLeadId;
    rec.vicidialCallId = data.vicidialCallId || rec.vicidialCallId;
    rec.callerId = data.callerId || rec.callerId;
    await rec.save();
    return;
  }

  const rec = await findRecord(data);
  if (!rec) {
    // Unknown correlation — keep the event, but nothing to update yet.
    const e = new Error(`No CallRecord for event ${type} (uniqueid=${data.uniqueid || '-'})`);
    e.softMiss = true;
    throw e;
  }

  switch (type) {
    case 'call.ringing':
      rec.status = 'ringing';
      rec.ringingAt = now;
      rec.phaseAt = now;
      break;

    case 'call.answered':
      rec.status = 'connected';
      rec.answeredAt = now;
      rec.phaseAt = now;
      await setAgent(rec.agent, { status: 'OnCall', currentCall: rec._id });
      await resolveLead(rec, 'Connected');
      break;

    case 'call.hold':
      rec.onHold = !!data.on;
      rec.status = data.on ? 'onhold' : 'connected';
      rec.phaseAt = now;
      break;

    case 'call.ended': {
      const cause = String(data.hangupCause || data.status || 'NORMAL_CLEARING').toUpperCase();
      const answered = !!rec.answeredAt || !!data.answeredAt;
      rec.status = answered ? 'completed' : HANGUP_TO_STATUS[cause] || 'completed';
      rec.endedAt = now;
      rec.phaseAt = now;
      rec.duration = Number.isFinite(data.durationSec)
        ? Math.round(data.durationSec)
        : rec.answeredAt
        ? Math.max(0, Math.round((now - new Date(rec.answeredAt)) / 1000))
        : 0;
      if (data.disposition) rec.disposition = data.disposition;
      if (data.notes != null) rec.notes = data.notes;
      if (data.recordingExpected) {
        rec.recording = { status: 'processing', url: null, durationSec: rec.duration, reference: data.recordingReference || null };
      }
      await setAgent(rec.agent, { status: 'Wrapup', currentCall: null, since: now });
      await resolveLead(rec, answered ? 'Completed' : rec.status === 'no-answer' ? 'No Answer' : rec.status === 'busy' ? 'Busy' : 'Failed', rec.disposition);
      break;
    }

    case 'recording.ready':
      rec.recording = {
        status: 'available',
        url: null,
        reference: data.reference || data.path || rec.recording?.reference || null,
        durationSec: Number(data.durationSec) || rec.recording?.durationSec || rec.duration || 0,
        sizeBytes: Number(data.sizeBytes) || 0,
        readyAt: now,
      };
      break;

    case 'recording.failed':
      rec.recording = { ...(rec.recording || {}), status: 'unavailable' };
      break;

    case 'transfer.requested':
      rec.transferStatus = 'requested';
      rec.transferredTo = data.target || rec.transferredTo;
      break;

    case 'transfer.completed': {
      rec.transferStatus = 'completed';
      rec.status = 'transferred';
      rec.transferredTo = data.target || rec.transferredTo;
      if (mongoose.isValidObjectId(data.toAgentId)) rec.transferredToAgent = data.toAgentId;
      rec.endedAt = rec.endedAt || now;
      if (data.newUniqueId) {
        const leg = new CallRecord({
          campaign: rec.campaign,
          callLead: rec.callLead,
          agent: mongoose.isValidObjectId(data.toAgentId) ? data.toAgentId : undefined,
          agentName: data.toAgentName || data.target,
          contactName: rec.contactName,
          phone: rec.phone,
          direction: 'Outbound',
          status: 'connected',
          answeredAt: now,
          phaseAt: now,
          queuedAt: now,
          notes: `Transferred from ${rec.agentName || 'agent'}`,
          provider: 'telephony',
          isMock: false,
          asteriskUniqueId: data.newUniqueId,
          asteriskLinkedId: rec.asteriskLinkedId,
          team: rec.team,
        });
        await leg.save();
        if (mongoose.isValidObjectId(data.toAgentId)) {
          await setAgent(data.toAgentId, { status: 'OnCall', currentCall: leg._id, agentName: leg.agentName });
        }
      }
      break;
    }

    case 'transfer.failed':
      rec.transferStatus = 'failed';
      break;

    case 'agent.status':
      await setAgent(mongoose.isValidObjectId(data.agentId) ? data.agentId : rec.agent, {
        status: data.status || 'Available',
        agentName: data.agentName,
      });
      return; // no rec change

    default: {
      const e = new Error(`Unhandled telephony event type: ${type}`);
      e.softMiss = true;
      throw e;
    }
  }

  rec.updated = new Date();
  await rec.save();
}

module.exports = { dispatch };
