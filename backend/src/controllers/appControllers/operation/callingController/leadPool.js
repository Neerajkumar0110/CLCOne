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
        // Leaving mid-call would otherwise leave a stale reference behind —
        // clear it so the next join starts clean.
        ...(on ? {} : { currentCall: null }),
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

// GET /api/calling/lead-pool/used-leads?page=&items= — every lead the pool
// has already attempted (pool-wide, every agent, not just me), with the
// response the system recorded for it. `status` is always populated by
// resolveLead the moment a call ends (Connected/No Answer/Busy/Voicemail/
// Completed/Callback/DNC), whether or not the agent picked an explicit
// disposition — so this list never shows a blank response.
const usedLeads = async (req, res) => {
  const CallCampaign = mongoose.model('CallCampaign');
  const CallLead = mongoose.model('CallLead');

  const camp = await CallCampaign.findOne({ isLeadPool: true, removed: false }).select('_id').lean();
  if (!camp) {
    return res.status(200).json({ success: true, result: [], pagination: { page: 1, pages: 0, count: 0 }, message: 'ok' });
  }

  const page = parseInt(req.query.page) || 1;
  const items = Math.min(parseInt(req.query.items) || 30, 100);
  const filter = { campaign: camp._id, removed: false, status: { $nin: ['New', 'Queued'] } };

  const [rows, count] = await Promise.all([
    CallLead.find(filter)
      .sort({ updated: -1 })
      .skip((page - 1) * items)
      .limit(items)
      .lean(),
    CallLead.countDocuments(filter),
  ]);

  // CallLead (operationDb) and Admin (coreDb) live on different
  // connections under this app's multi-database routing, and Mongoose's
  // own .populate() can't cross that boundary — so resolve agent names
  // with a plain second lookup instead.
  const Admin = mongoose.model('Admin');
  const agentIds = [...new Set(rows.filter((l) => l.assignedAgent).map((l) => String(l.assignedAgent)))];
  const agents = agentIds.length
    ? await Admin.find({ _id: { $in: agentIds } }).select('name surname').lean()
    : [];
  const agentNameById = new Map(agents.map((a) => [String(a._id), `${a.name} ${a.surname || ''}`.trim()]));

  return res.status(200).json({
    success: true,
    result: rows.map((l) => ({
      _id: l._id,
      name: l.name,
      phone: l.phone,
      response: l.status,
      disposition: l.lastDisposition || null,
      agentName: l.assignedAgent ? agentNameById.get(String(l.assignedAgent)) || null : null,
      attempts: l.attempts,
      lastAttemptAt: l.lastAttemptAt,
    })),
    pagination: { page, pages: Math.ceil(count / items) || 0, count },
    message: 'ok',
  });
};

module.exports = { toggle, status, usedLeads };
