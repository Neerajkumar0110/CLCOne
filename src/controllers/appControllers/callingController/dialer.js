const mongoose = require('mongoose');
const { getProvider } = require('../../../services/calling');

// GET /api/calling/dialer/:campaignId — live auto-dialer state.
const state = async (req, res) => {
  await getProvider().tick();

  const CallCampaign = mongoose.model('CallCampaign');
  const CallLead = mongoose.model('CallLead');
  const CallRecord = mongoose.model('CallRecord');
  const AgentCallState = mongoose.model('AgentCallState');

  const camp = await CallCampaign.findOne({ _id: req.params.campaignId, removed: false })
    .populate('agents', 'name surname')
    .lean();
  if (!camp) return res.status(404).json({ success: false, result: null, message: 'Campaign not found' });

  const [waiting, inProgress, connected, nextLead, agentStates, liveCalls] = await Promise.all([
    CallLead.countDocuments({ campaign: camp._id, removed: false, status: { $in: ['New', 'Queued'] } }),
    CallRecord.countDocuments({ campaign: camp._id, removed: false, status: { $in: ['dialing', 'ringing'] } }),
    CallRecord.countDocuments({ campaign: camp._id, removed: false, status: { $in: ['connected', 'onhold'] } }),
    CallLead.findOne({ campaign: camp._id, removed: false, status: { $in: ['New', 'Queued'] } })
      .sort({ created: 1 })
      .select('name phone company')
      .lean(),
    AgentCallState.find({ agent: { $in: camp.agents.map((a) => a._id) } })
      .populate('agent', 'name surname')
      .lean(),
    CallRecord.find({ campaign: camp._id, removed: false, status: { $in: ['dialing', 'ringing', 'connected', 'onhold'] } })
      .sort({ phaseAt: -1 })
      .limit(50)
      .lean(),
  ]);

  const agentsAvailable = agentStates.filter((s) => s.status === 'Available').length;
  const agentsBusy = agentStates.filter((s) => ['OnCall', 'Ringing', 'Wrapup'].includes(s.status)).length;

  return res.status(200).json({
    success: true,
    result: {
      campaign: { _id: camp._id, name: camp.name, status: camp.status, callerId: camp.callerId, dialRatio: camp.dialRatio },
      leadsWaiting: waiting,
      callsInProgress: inProgress,
      connectedCalls: connected,
      agentsAvailable,
      agentsBusy,
      nextLead: nextLead || null,
      agents: agentStates.map((s) => ({
        _id: s.agent?._id,
        name: s.agentName || (s.agent ? `${s.agent.name} ${s.agent.surname || ''}`.trim() : 'Agent'),
        status: s.status,
        callsToday: s.callsToday || 0,
      })),
      liveCalls: liveCalls.map((c) => ({
        _id: c._id,
        contactName: c.contactName,
        phone: c.phone,
        status: c.status,
        agentName: c.agentName,
        startedAt: c.queuedAt,
        answeredAt: c.answeredAt,
      })),
    },
    message: 'ok',
  });
};

// POST /api/calling/dialer/:campaignId/presence  { status: 'Available' | 'Paused' | 'Offline' }
const presence = async (req, res) => {
  const CallCampaign = mongoose.model('CallCampaign');
  const AgentCallState = mongoose.model('AgentCallState');
  const camp = await CallCampaign.findOne({ _id: req.params.campaignId, removed: false }).lean();
  if (!camp) return res.status(404).json({ success: false, result: null, message: 'Campaign not found' });

  const next = ['Available', 'Paused', 'Offline'].includes(req.body.status) ? req.body.status : 'Available';
  await AgentCallState.updateOne(
    { agent: req.admin._id },
    {
      $setOnInsert: { agent: req.admin._id },
      $set: {
        agentName: `${req.admin.name} ${req.admin.surname || ''}`.trim(),
        status: next,
        campaign: next === 'Offline' ? null : camp._id,
        since: new Date(),
        lastSeenAt: new Date(),
      },
    },
    { upsert: true }
  );
  return res.status(200).json({ success: true, result: { status: next }, message: 'ok' });
};

// POST /api/calling/dialer/:campaignId/dial-next — manual "dial next lead".
const dialNext = async (req, res) => {
  const CallCampaign = mongoose.model('CallCampaign');
  const camp = await CallCampaign.findOne({ _id: req.params.campaignId, removed: false });
  if (!camp) return res.status(404).json({ success: false, result: null, message: 'Campaign not found' });
  if (!['Active', 'Draft', 'Scheduled', 'Paused'].includes(camp.status)) {
    return res.status(400).json({ success: false, result: null, message: `Campaign is ${camp.status}.` });
  }
  const r = await getProvider().dialNext({ campaign: camp, agent: req.admin });
  if (!r.ok) return res.status(400).json({ success: false, result: null, message: r.error });
  return res.status(200).json({ success: true, result: r.callRecord, message: 'Dialing next lead (test mode)' });
};

module.exports = { state, presence, dialNext };
