const mongoose = require('mongoose');
const { getProvider } = require('../../../services/calling');
const { campaignScope } = require('./permissions');

const startOfToday = () => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
};

// GET /api/calling/dashboard — the Calling Dashboard KPIs.
const dashboard = async (req, res) => {
  await getProvider().tick();

  const CallRecord = mongoose.model('CallRecord');
  const CallCampaign = mongoose.model('CallCampaign');
  const AgentCallState = mongoose.model('AgentCallState');

  const scope = await campaignScope(req);
  const campaigns = await CallCampaign.find({ removed: false, ...scope }).select('_id status').lean();
  const campIds = campaigns.map((c) => c._id);
  const base = { removed: false, campaign: { $in: campIds } };
  const today = { ...base, created: { $gte: startOfToday() } };

  const CONNECTED = { $in: ['connected', 'onhold', 'completed', 'transferred'] };
  const FAILED = { $in: ['no-answer', 'busy', 'failed', 'voicemail'] };

  const [
    total,
    todays,
    connected,
    missed,
    failed,
    durationAgg,
    agentsAvailable,
    agentsOnCall,
    activeCampaigns,
    live,
  ] = await Promise.all([
    CallRecord.countDocuments(base),
    CallRecord.countDocuments(today),
    CallRecord.countDocuments({ ...base, status: CONNECTED, answeredAt: { $ne: null } }),
    CallRecord.countDocuments({ ...base, status: 'no-answer' }),
    CallRecord.countDocuments({ ...base, status: { $in: ['failed', 'busy'] } }),
    CallRecord.aggregate([
      { $match: { ...base, duration: { $gt: 0 } } },
      { $group: { _id: null, total: { $sum: '$duration' }, avg: { $avg: '$duration' } } },
    ]),
    AgentCallState.countDocuments({ status: 'Available' }),
    AgentCallState.countDocuments({ status: { $in: ['OnCall', 'Ringing'] } }),
    CallCampaign.countDocuments({ removed: false, status: 'Active', ...scope }),
    CallRecord.countDocuments({ ...base, status: { $in: ['dialing', 'ringing', 'connected', 'onhold'] } }),
  ]);

  const dur = durationAgg[0] || { total: 0, avg: 0 };

  return res.status(200).json({
    success: true,
    result: {
      totalCalls: total,
      todaysCalls: todays,
      connectedCalls: connected,
      missedCalls: missed,
      failedCalls: failed,
      totalDurationSec: Math.round(dur.total || 0),
      avgDurationSec: Math.round(dur.avg || 0),
      liveCalls: live,
      agentsAvailable,
      agentsOnCall,
      activeCampaigns,
      answerRate: total ? Math.round((connected / total) * 100) : 0,
    },
    message: 'ok',
  });
};

module.exports = dashboard;
