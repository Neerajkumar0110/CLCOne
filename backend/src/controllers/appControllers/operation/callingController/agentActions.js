const mongoose = require('mongoose');
const { getProvider } = require('../../../../services/calling');
const {
  notifyAgentCallEvent,
  last10,
  LIVE_CALL_STATUSES,
} = require('../../../../services/calling/callingShared');
const { BY_CODE } = require('../../../../services/calling/dispositions');
const { resolveStageSub } = require('../../../../config/leadStages');

const provider = () => getProvider();
const actorName = (req) => `${req.admin.name} ${req.admin.surname || ''}`.trim();

async function loadCall(req, res) {
  const CallRecord = mongoose.model('CallRecord');
  const rec = await CallRecord.findOne({ _id: req.params.id, removed: false });
  if (!rec) {
    res.status(404).json({ success: false, result: null, message: 'Call not found' });
    return null;
  }
  // Agents may only act on their own call.
  if (req.callingTier === 'agent' && String(rec.agent) !== String(req.admin._id)) {
    res.status(403).json({ success: false, result: null, message: 'Not your call.' });
    return null;
  }
  return rec;
}

// GET /api/calling/agent/active — the current user's live call + lead detail.
const active = async (req, res) => {
  await provider().tick();
  const CallRecord = mongoose.model('CallRecord');
  const rec = await CallRecord.findOne({
    agent: req.admin._id,
    removed: false,
    status: { $in: LIVE_CALL_STATUSES },
  })
    .sort({ phaseAt: -1 })
    .lean();
  if (!rec) return res.status(200).json({ success: true, result: null, message: 'idle' });

  const lead = rec.callLead
    ? await mongoose.model('CallLead').findById(rec.callLead).lean()
    : null;

  let crmLead = null;
  if (lead && lead.crmLead) {
    crmLead = await mongoose.model('Lead').findById(lead.crmLead).lean();
  } else if (rec.phone) {
    const norm = String(rec.phone).replace(/[^\d]/g, '').slice(-10);
    if (norm) {
      crmLead = await mongoose.model('Lead').findOne({ phoneNormalized: norm, removed: false }).lean();
    }
  }

  return res.status(200).json({ success: true, result: { call: rec, lead, crmLead }, message: 'ok' });
};

const answer = async (req, res) => {
  const rec = await loadCall(req, res);
  if (!rec) return;
  const r = await provider().answer(rec);
  if (r.ok) {
    await notifyAgentCallEvent(rec.agent, 'call:connected', r.callRecord || rec);
  }
  return res.status(r.ok ? 200 : 400).json({ success: r.ok, result: r.callRecord, message: r.ok ? 'Connected' : r.error });
};

const hold = async (req, res) => {
  const rec = await loadCall(req, res);
  if (!rec) return;
  const r = await provider().hold({ callRecord: rec, on: !!req.body.on });
  if (r.ok) {
    await notifyAgentCallEvent(rec.agent, 'call:updated', r.callRecord || rec);
  }
  return res.status(r.ok ? 200 : 400).json({ success: r.ok, result: r.callRecord, message: r.ok ? 'ok' : r.error });
};

const mute = async (req, res) => {
  const rec = await loadCall(req, res);
  if (!rec) return;
  const r = await provider().mute({ callRecord: rec, on: !!req.body.on });
  if (r.ok) {
    await notifyAgentCallEvent(rec.agent, 'call:updated', r.callRecord || rec);
  }
  return res.status(r.ok ? 200 : 400).json({ success: r.ok, result: r.callRecord, message: r.ok ? 'ok' : r.error });
};

const note = async (req, res) => {
  const rec = await loadCall(req, res);
  if (!rec) return;
  rec.notes = String(req.body.notes || '');
  await rec.save();
  await notifyAgentCallEvent(rec.agent, 'call:updated', rec);
  return res.status(200).json({ success: true, result: rec, message: 'Note saved' });
};

// POST /api/calling/agent/call/:id/hangup { disposition, notes }
const hangup = async (req, res) => {
  const rec = await loadCall(req, res);
  if (!rec) return;
  const r = await provider().hangup({
    callRecord: rec,
    disposition: req.body.disposition || undefined,
    notes: req.body.notes,
    actorName: actorName(req),
  });
  if (r.ok) {
    await notifyAgentCallEvent(rec.agent, 'call:ended', r.callRecord || rec);
  }
  return res.status(r.ok ? 200 : 400).json({ success: r.ok, result: r.callRecord, message: r.ok ? 'Call ended' : r.error });
};

// POST /api/calling/agent/call/:id/transfer { target, toAgent }
const transfer = async (req, res) => {
  const rec = await loadCall(req, res);
  if (!rec) return;
  let toAgent = null;
  if (req.body.toAgent) {
    toAgent = await mongoose
      .model('Admin')
      .findById(req.body.toAgent)
      .select('name surname phone mobile contactNumber')
      .lean();
  }
  const r = await provider().transfer({
    callRecord: rec,
    target: req.body.target || (toAgent ? `${toAgent.name} ${toAgent.surname || ''}`.trim() : 'Queue'),
    toAgent,
    toNumber: req.body.toNumber || undefined,
    actorName: actorName(req),
  });
  if (r.ok) {
    await notifyAgentCallEvent(rec.agent, 'call:ended', r.callRecord || rec);
  }
  return res.status(r.ok ? 200 : 400).json({
    success: r.ok,
    result: r.callRecord,
    message: r.ok ? `Transferred to ${req.body.target || 'agent'}` : r.error,
  });
};

// POST /api/calling/agent/call/:id/disposition { disposition, notes }
const disposition = async (req, res) => {
  const rec = await loadCall(req, res);
  if (!rec) return;
  if (!req.body.disposition)
    return res.status(400).json({ success: false, result: null, message: 'Pick a disposition.' });
  // If still live, ending + dispositioning in one go.
  if (LIVE_CALL_STATUSES.includes(rec.status)) {
    const r = await provider().hangup({
      callRecord: rec,
      disposition: req.body.disposition,
      notes: req.body.notes,
      actorName: actorName(req),
    });
    if (r.ok) {
      await notifyAgentCallEvent(rec.agent, 'call:ended', r.callRecord || rec);
    }
    return res.status(r.ok ? 200 : 400).json({ success: r.ok, result: r.callRecord, message: r.ok ? 'Disposition saved' : r.error });
  }
  rec.disposition = req.body.disposition;
  if (req.body.notes != null) rec.notes = req.body.notes;
  await rec.save();
  await notifyAgentCallEvent(rec.agent, 'call:ended', rec);
  return res.status(200).json({ success: true, result: rec, message: 'Disposition saved' });
};

// POST /api/calling/agent/call/:id/callback { scheduledAt, notes, assignedAgent }
const scheduleCallback = async (req, res) => {
  const CallRecord = mongoose.model('CallRecord');
  const CallCallback = mongoose.model('CallCallback');
  const rec = await CallRecord.findOne({ _id: req.params.id, removed: false }).lean();
  if (!rec) return res.status(404).json({ success: false, result: null, message: 'Call not found' });
  if (!req.body.scheduledAt)
    return res.status(400).json({ success: false, result: null, message: 'Callback date & time are required.' });

  let assignedAgent = req.admin._id;
  let assignedAgentName = actorName(req);
  if (req.body.assignedAgent) {
    const a = await mongoose.model('Admin').findById(req.body.assignedAgent).select('name surname').lean();
    if (a) {
      assignedAgent = a._id;
      assignedAgentName = `${a.name} ${a.surname || ''}`.trim();
    }
  }

  const cb = await new CallCallback({
    campaign: rec.campaign,
    callLead: rec.callLead,
    callRecord: rec._id,
    contactName: rec.contactName,
    phone: rec.phone,
    scheduledAt: new Date(req.body.scheduledAt),
    notes: req.body.notes,
    assignedAgent,
    assignedAgentName,
    createdBy: req.admin._id,
    createdByName: actorName(req),
  }).save();

  if (rec.callLead) {
    await mongoose.model('CallLead').updateOne({ _id: rec.callLead }, { $set: { status: 'Callback' } });
  }
  return res.status(200).json({ success: true, result: cb, message: 'Callback scheduled' });
};

// POST /api/calling/agent/call/:id/log-details
//
// The one write behind the agent's in-call modal (frontend/src/components/
// ActiveCallModal) — it is called repeatedly while a call is live ("Save
// Details (Keep Call Live)") and once more on hangup, so every branch here
// has to be idempotent: re-saving the same form twice must not duplicate a
// callback, a stage-history entry or a CRM lead.
//
// It fans one form out across three collections: CallRecord (contact name /
// notes / disposition), CallLead (campaign-side status) and the Sales
// `Lead` (qualification detail — requirement, budget, timeline — plus the
// pipeline stage).
const logDetails = async (req, res) => {
  const rec = await loadCall(req, res);
  if (!rec) return;

  const b = req.body || {};
  const {
    contactName,
    email,
    phone,
    city,
    requirement,
    budget,
    howSoonToStart,
    disposition: dispCode,
    notes,
    scheduledCallback,
    hangupCall,
  } = b;

  if (contactName) rec.contactName = String(contactName).trim();
  if (notes != null) rec.notes = String(notes);
  if (dispCode) rec.disposition = dispCode;

  const isLive = LIVE_CALL_STATUSES.includes(rec.status);
  let hangupResult = null;
  if (hangupCall && isLive) {
    // hangup() persists `rec` itself, including the fields just assigned.
    hangupResult = await provider().hangup({
      callRecord: rec,
      disposition: dispCode || rec.disposition,
      notes: notes != null ? notes : rec.notes,
      actorName: actorName(req),
    });
  } else {
    await rec.save();
  }

  const disp = dispCode ? BY_CODE[dispCode] : null;

  // Update CallLead if linked
  let callLead = null;
  if (rec.callLead) {
    callLead = await mongoose.model('CallLead').findById(rec.callLead);
    if (callLead) {
      if (contactName) callLead.name = String(contactName).trim();
      if (email) callLead.email = String(email).trim();
      if (notes) callLead.notes = notes;
      if (dispCode) callLead.lastDisposition = dispCode;
      if (disp) {
        if (disp.category === 'callback') callLead.status = 'Callback';
        else if (disp.category === 'dnc') callLead.status = 'DNC';
        else callLead.status = 'Completed';
      }
      await callLead.save();
    }
  }

  // The (stage, subStatus) pair the agent asked for, coerced to a pair
  // config/leadStages.js actually allows — the Lead model's own pre-save
  // hook would otherwise silently reset an unknown stage to "New Lead".
  // With no stage on the form, the disposition's own mapping is the default.
  const wantsStage = b.stage || (disp && disp.crmStage.stage);
  const wantsSub = b.subStatus || (!b.stage && disp ? disp.crmStage.subStatus : undefined);
  const target = wantsStage ? resolveStageSub({ stage: wantsStage, subStatus: wantsSub }) : null;

  // Update or bridge CRM Lead
  const Lead = mongoose.model('Lead');
  let crmLead = null;
  const phoneNormalized = last10(phone || rec.phone);

  if (callLead && callLead.crmLead) {
    crmLead = await Lead.findById(callLead.crmLead);
  } else if (phoneNormalized) {
    crmLead = await Lead.findOne({ removed: false, phoneNormalized });
  }

  // Only spawn a NEW pipeline lead when the call earned one — either the
  // disposition shows real interest (same rule as callingShared's
  // CRM_BRIDGE_CATEGORIES, so an auto-dialled and a hand-dialled call
  // bridge alike) or the agent actually captured qualification detail. A
  // bare NO_ANSWER / WRONG_NUMBER call must not pollute the pipeline.
  const qualified = !!(requirement || budget || howSoonToStart || email || city);
  const worthBridging = (disp && ['sale', 'callback'].includes(disp.category)) || qualified;

  if (!crmLead && worthBridging && (contactName || rec.contactName)) {
    crmLead = new Lead({
      name: (contactName || rec.contactName || 'Lead').trim(),
      phone: phone || rec.phone,
      email: email ? String(email).trim() : undefined,
      city: city ? String(city).trim() : undefined,
      budgetRange: budget || undefined,
      howSoonToStart: howSoonToStart || undefined,
      message: requirement || undefined,
      remarks: notes || undefined,
      source: 'Calling',
      stage: target ? target.stage : 'Contacted',
      subStatus: target ? target.subStatus : 'First Contact Done',
      assignedUser: req.admin._id,
      assignedUserName: actorName(req),
      callHistory:
        notes || dispCode
          ? [
              {
                outcome: disp ? disp.label : dispCode || 'Connected',
                notes: notes || undefined,
                byName: actorName(req),
                at: new Date(),
              },
            ]
          : [],
    });
    await crmLead.save();
    if (callLead) {
      callLead.crmLead = crmLead._id;
      await callLead.save();
    }
  } else if (crmLead) {
    if (contactName) crmLead.name = String(contactName).trim();
    if (email) crmLead.email = String(email).trim();
    if (city) crmLead.city = String(city).trim();
    if (budget) crmLead.budgetRange = budget;
    if (howSoonToStart) crmLead.howSoonToStart = howSoonToStart;
    if (requirement) crmLead.message = requirement;
    if (notes) crmLead.remarks = notes;

    // Re-saving the same form must not append a no-op stage change.
    if (target && (target.stage !== crmLead.stage || target.subStatus !== crmLead.subStatus)) {
      const fromStage = crmLead.stage;
      const fromSubStatus = crmLead.subStatus;
      crmLead.stage = target.stage;
      crmLead.subStatus = target.subStatus;
      crmLead.stageHistory.push({
        fromStage,
        fromSubStatus,
        toStage: target.stage,
        toSubStatus: target.subStatus,
        changedBy: req.admin._id,
        changedByName: actorName(req),
        remarks: notes ? `Call outcome: ${notes}` : `Call disposition: ${dispCode || 'Updated'}`,
        at: new Date(),
      });
    }

    if (dispCode || notes) {
      crmLead.callHistory.push({
        outcome: disp ? disp.label : dispCode || 'Connected',
        notes: notes || undefined,
        byName: actorName(req),
        at: new Date(),
      });
    }
    await crmLead.save();
  }

  // Scheduled callback — one pending CallCallback per call record, updated
  // in place, so saving the form twice doesn't queue the same follow-up
  // twice.
  //
  // A callback-category disposition with no time is a promise with no date
  // on it: nothing would appear in the Callbacks queue and nobody would ever
  // call back. The UI makes the agent pick a time, so this only catches API
  // callers that don't — fall back to an hour out rather than drop it.
  let callbackAt = scheduledCallback;
  if (!callbackAt && disp && disp.category === 'callback') {
    callbackAt = new Date(Date.now() + 60 * 60 * 1000);
  }

  if (callbackAt) {
    const at = new Date(callbackAt);
    if (!Number.isNaN(at.getTime())) {
      const CallCallback = mongoose.model('CallCallback');
      await CallCallback.findOneAndUpdate(
        { callRecord: rec._id, removed: false, status: 'Pending' },
        {
          $set: {
            campaign: rec.campaign,
            callLead: rec.callLead,
            callRecord: rec._id,
            contactName: contactName || rec.contactName,
            phone: phone || rec.phone,
            scheduledAt: at,
            notes: notes || `Follow-up for ${requirement || 'inquiry'}`,
            assignedAgent: req.admin._id,
            assignedAgentName: actorName(req),
            updated: new Date(),
          },
          $setOnInsert: { createdBy: req.admin._id, createdByName: actorName(req) },
        },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      );

      if (crmLead) {
        crmLead.callBackAt = at;
        await crmLead.save();
      }
      if (callLead) {
        callLead.status = 'Callback';
        await callLead.save();
      }
    }
  }

  const updatedRec = hangupResult?.callRecord || rec;
  const isEnded = ['completed', 'transferred', 'cancelled'].includes(updatedRec.status);
  await notifyAgentCallEvent(rec.agent, isEnded ? 'call:ended' : 'call:updated', updatedRec);

  return res.status(200).json({
    success: true,
    result: { call: updatedRec, lead: callLead, crmLead },
    message: isEnded ? 'Call ended and details saved!' : 'Call details updated successfully!',
  });
};

module.exports = {
  active,
  answer,
  hold,
  mute,
  note,
  hangup,
  transfer,
  disposition,
  scheduleCallback,
  logDetails,
};
