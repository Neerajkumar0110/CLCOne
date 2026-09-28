const mongoose = require('mongoose');
const { getOrCreateLeadPoolCampaign } = require('../../../../services/calling/callingShared');
const { NON_SALES_ROLES } = require('../../../../config/roles');

// POST /api/calling/lead-pool/toggle { on: boolean }
// Joins/leaves the one system-managed Instant Lead Pool campaign — Sales
// agents only (mirrors campaigns.js's write-time guard). Joining adds the
// agent to the campaign's roster (so the existing auto-dialer tick, which
// only ever dials Available agents within camp.agents, naturally picks
// them up) and marks them Available on it; leaving marks them Offline.
const toggle = async (req, res) => {
  if (NON_SALES_ROLES.includes(req.admin.role)) {
    return res.status(403).json({ success: false, result: null, message: 'The Instant Lead Pool is Sales-only.' });
  }
  const camp = await getOrCreateLeadPoolCampaign();
  const CallCampaign = mongoose.model('CallCampaign');
  const AgentCallState = mongoose.model('AgentCallState');

  const on = !!req.body.on;
  if (on) {
    await CallCampaign.updateOne({ _id: camp._id }, { $addToSet: { agents: req.admin._id } });
  }

  await AgentCallState.updateOne(
    { agent: req.admin._id },
    {
      $setOnInsert: { agent: req.admin._id },
      $set: {
        agentName: `${req.admin.name} ${req.admin.surname || ''}`.trim(),
        status: on ? 'Available' : 'Offline',
        campaign: on ? camp._id : null,
        since: new Date(),
        lastSeenAt: new Date(),
      },
    },
    { upsert: true }
  );

  return res.status(200).json({
    success: true,
    result: { on },
    message: on ? 'Joined the Instant Lead Pool' : 'Left the Instant Lead Pool',
  });
};

// GET /api/calling/lead-pool/status — my own join state + the shared pool's
// live numbers + my own recent calls (contact, duration, outcome) from it.
const status = async (req, res) => {
  const CallCampaign = mongoose.model('CallCampaign');
  const CallLead = mongoose.model('CallLead');
  const CallRecord = mongoose.model('CallRecord');
  const AgentCallState = mongoose.model('AgentCallState');

  const camp = await CallCampaign.findOne({ isLeadPool: true, removed: false }).lean();
  if (!camp) {
    return res.status(200).json({
      success: true,
      result: { on: false, myStatus: 'Offline', leadsWaiting: 0, participants: 0, poolExhausted: false, recentCalls: [] },
      message: 'ok',
    });
  }

  const myState = await AgentCallState.findOne({ agent: req.admin._id }).lean();
  const on = !!(myState && myState.status !== 'Offline' && String(myState.campaign) === String(camp._id));

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const [leadsWaiting, participants, recentCalls] = await Promise.all([
    CallLead.countDocuments({ campaign: camp._id, removed: false, status: { $in: ['New', 'Queued'] } }),
    AgentCallState.countDocuments({ campaign: camp._id, status: 'Available' }),
    CallRecord.find({ campaign: camp._id, agent: req.admin._id, removed: false, created: { $gte: todayStart } })
      .sort({ created: -1 })
      .limit(50)
      .select('contactName phone status disposition duration answeredAt endedAt')
      .lean(),
  ]);

  return res.status(200).json({
    success: true,
    result: {
      on,
      myStatus: myState ? myState.status : 'Offline',
      leadsWaiting,
      participants,
      poolExhausted: leadsWaiting === 0,
      recentCalls: recentCalls.map((c) => ({
        _id: c._id,
        contactName: c.contactName,
        phone: c.phone,
        status: c.status,
        disposition: c.disposition,
        durationSec: c.duration || 0,
        answeredAt: c.answeredAt,
        endedAt: c.endedAt,
      })),
    },
    message: 'ok',
  });
};

module.exports = { toggle, status };
