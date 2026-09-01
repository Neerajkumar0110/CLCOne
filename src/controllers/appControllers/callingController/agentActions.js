const mongoose = require('mongoose');
const { getProvider } = require('../../../services/calling');

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
    status: { $in: ['dialing', 'ringing', 'connected', 'onhold'] },
  })
    .sort({ phaseAt: -1 })
    .lean();
  if (!rec) return res.status(200).json({ success: true, result: null, message: 'idle' });

  const lead = rec.callLead
    ? await mongoose.model('CallLead').findById(rec.callLead).lean()
    : null;
  return res.status(200).json({ success: true, result: { call: rec, lead }, message: 'ok' });
};

const answer = async (req, res) => {
  const rec = await loadCall(req, res);
  if (!rec) return;
  const r = await provider().answer(rec);
  return res.status(r.ok ? 200 : 400).json({ success: r.ok, result: r.callRecord, message: r.ok ? 'Connected' : r.error });
};

const hold = async (req, res) => {
  const rec = await loadCall(req, res);
  if (!rec) return;
  const r = await provider().hold({ callRecord: rec, on: !!req.body.on });
  return res.status(r.ok ? 200 : 400).json({ success: r.ok, result: r.callRecord, message: r.ok ? 'ok' : r.error });
};

const mute = async (req, res) => {
  const rec = await loadCall(req, res);
  if (!rec) return;
  const r = await provider().mute({ callRecord: rec, on: !!req.body.on });
  return res.status(r.ok ? 200 : 400).json({ success: r.ok, result: r.callRecord, message: r.ok ? 'ok' : r.error });
};

const note = async (req, res) => {
  const rec = await loadCall(req, res);
  if (!rec) return;
  rec.notes = String(req.body.notes || '');
  await rec.save();
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
  return res.status(r.ok ? 200 : 400).json({ success: r.ok, result: r.callRecord, message: r.ok ? 'Call ended' : r.error });
};

// POST /api/calling/agent/call/:id/transfer { target, toAgent }
const transfer = async (req, res) => {
  const rec = await loadCall(req, res);
  if (!rec) return;
  let toAgent = null;
  if (req.body.toAgent) {
    toAgent = await mongoose.model('Admin').findById(req.body.toAgent).select('name surname').lean();
  }
  const r = await provider().transfer({
    callRecord: rec,
    target: req.body.target || (toAgent ? `${toAgent.name} ${toAgent.surname || ''}`.trim() : 'Queue'),
    toAgent,
    actorName: actorName(req),
  });
  return res.status(r.ok ? 200 : 400).json({
    success: r.ok,
    result: r.callRecord,
    message: r.ok ? `Transferred to ${req.body.target || 'agent'} (test mode)` : r.error,
  });
};

// POST /api/calling/agent/call/:id/disposition { disposition, notes }
const disposition = async (req, res) => {
  const rec = await loadCall(req, res);
  if (!rec) return;
  if (!req.body.disposition)
    return res.status(400).json({ success: false, result: null, message: 'Pick a disposition.' });
  // If still live, ending + dispositioning in one go.
  if (['connected', 'onhold', 'ringing', 'dialing'].includes(rec.status)) {
    const r = await provider().hangup({
      callRecord: rec,
      disposition: req.body.disposition,
      notes: req.body.notes,
      actorName: actorName(req),
    });
    return res.status(r.ok ? 200 : 400).json({ success: r.ok, result: r.callRecord, message: r.ok ? 'Disposition saved' : r.error });
  }
  rec.disposition = req.body.disposition;
  if (req.body.notes != null) rec.notes = req.body.notes;
  await rec.save();
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

module.exports = { active, answer, hold, mute, note, hangup, transfer, disposition, scheduleCallback };
