const mongoose = require('mongoose');

// GET /api/calling/missed-calls?range=1M — admin-only (requireTier('admin')
// on the route). Deliberately NOT campaign-scoped the way dashboard.js /
// reports.js are: an inbound call routed straight to an agent via the IVR
// (plivoAnswer.js's handleIvrDigits) never has a `campaign` set at all, so
// filtering by `{ campaign: { $in: campIds } }` the way those two do would
// silently exclude every inbound miss — exactly the case this feature
// exists for. missedByAgent is set by plivoAnswer.js's leg=agent-hangup
// branch, independent of `status` — see CallRecord.js's comment on why.
const RANGE_DAYS = { '1W': 7, '1M': 30, '3M': 90, '6M': 182, '1Y': 365 };

const summary = async (req, res) => {
  const CallRecord = mongoose.model('CallRecord');
  const days = RANGE_DAYS[req.query.range] || 30;
  const since = new Date(Date.now() - days * 86400000);
  const match = { removed: false, missedByAgent: true, created: { $gte: since } };

  const [byAgent, recent, total] = await Promise.all([
    CallRecord.aggregate([
      { $match: match },
      { $group: { _id: { agent: '$agent', name: '$agentName' }, missed: { $sum: 1 } } },
      { $sort: { missed: -1 } },
      { $limit: 100 },
    ]),
    CallRecord.find(match)
      .sort({ missedByAgentAt: -1 })
      .limit(100)
      .select('contactName phone agent agentName direction created missedByAgentAt')
      .lean(),
    CallRecord.countDocuments(match),
  ]);

  return res.status(200).json({
    success: true,
    result: {
      range: req.query.range || '1M',
      total,
      byAgent: byAgent.map((r) => ({ agent: r._id.agent ? String(r._id.agent) : null, name: r._id.name || 'Unknown', missed: r.missed })),
      recent,
    },
    message: 'ok',
  });
};

module.exports = { summary };
