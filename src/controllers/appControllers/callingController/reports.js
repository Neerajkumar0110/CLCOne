const mongoose = require('mongoose');
const { getProvider } = require('../../../services/calling');
const { campaignScope, callingTier } = require('./permissions');

const RANGE_DAYS = { '1W': 7, '1M': 30, '3M': 90, '6M': 182, '1Y': 365 };

// GET /api/calling/reports?range=1M&campaign=&agent=
const summary = async (req, res) => {
  await getProvider().tick();
  const CallRecord = mongoose.model('CallRecord');
  const CallCampaign = mongoose.model('CallCampaign');
  const CallCallback = mongoose.model('CallCallback');

  const days = RANGE_DAYS[req.query.range] || 30;
  const since = new Date(Date.now() - days * 86400000);

  const scope = await campaignScope(req);
  const camps = await CallCampaign.find({ removed: false, ...scope }).select('_id name').lean();
  const campIds = camps.map((c) => c._id);

  const match = { removed: false, created: { $gte: since }, campaign: { $in: campIds } };
  if (req.query.campaign) match.campaign = new mongoose.Types.ObjectId(String(req.query.campaign));
  if (req.query.agent && callingTier(req) !== 'agent')
    match.agent = new mongoose.Types.ObjectId(String(req.query.agent));
  if (callingTier(req) === 'agent') match.agent = req.admin._id;

  const CONNECTED = ['connected', 'onhold', 'completed', 'transferred'];

  const [totals, byAgent, byCampaign, byDisposition, cbTotals] = await Promise.all([
    CallRecord.aggregate([
      { $match: match },
      {
        $group: {
          _id: null,
          made: { $sum: 1 },
          connected: { $sum: { $cond: [{ $ne: ['$answeredAt', null] }, 1, 0] } },
          talk: { $sum: '$duration' },
        },
      },
    ]),
    CallRecord.aggregate([
      { $match: match },
      {
        $group: {
          _id: { agent: '$agent', name: '$agentName' },
          made: { $sum: 1 },
          connected: { $sum: { $cond: [{ $ne: ['$answeredAt', null] }, 1, 0] } },
          talk: { $sum: '$duration' },
        },
      },
      { $sort: { made: -1 } },
      { $limit: 50 },
    ]),
    CallRecord.aggregate([
      { $match: match },
      {
        $group: {
          _id: '$campaign',
          made: { $sum: 1 },
          connected: { $sum: { $cond: [{ $ne: ['$answeredAt', null] }, 1, 0] } },
          talk: { $sum: '$duration' },
        },
      },
      { $sort: { made: -1 } },
    ]),
    CallRecord.aggregate([
      { $match: { ...match, disposition: { $ne: null } } },
      { $group: { _id: '$disposition', n: { $sum: 1 } } },
      { $sort: { n: -1 } },
    ]),
    CallCallback.aggregate([
      { $match: { removed: false, created: { $gte: since }, campaign: { $in: campIds } } },
      { $group: { _id: '$status', n: { $sum: 1 } } },
    ]),
  ]);

  const t = totals[0] || { made: 0, connected: 0, talk: 0 };
  const campName = Object.fromEntries(camps.map((c) => [String(c._id), c.name]));
  const cbMap = Object.fromEntries(cbTotals.map((r) => [r._id, r.n]));
  const cbTotal = Object.values(cbMap).reduce((s, n) => s + n, 0);

  return res.status(200).json({
    success: true,
    result: {
      range: req.query.range || '1M',
      callsMade: t.made,
      connectedCalls: t.connected,
      answerRate: t.made ? Math.round((t.connected / t.made) * 100) : 0,
      avgDurationSec: t.connected ? Math.round(t.talk / t.connected) : 0,
      totalTalkSec: t.talk,
      agentPerformance: byAgent.map((r) => ({
        agent: r._id.name || 'Unknown',
        made: r.made,
        connected: r.connected,
        answerRate: r.made ? Math.round((r.connected / r.made) * 100) : 0,
        avgDurationSec: r.connected ? Math.round(r.talk / r.connected) : 0,
      })),
      campaignPerformance: byCampaign.map((r) => ({
        campaign: campName[String(r._id)] || '—',
        made: r.made,
        connected: r.connected,
        answerRate: r.made ? Math.round((r.connected / r.made) * 100) : 0,
      })),
      dispositions: byDisposition.map((r) => ({ code: r._id, count: r.n })),
      callbackPerformance: {
        total: cbTotal,
        done: cbMap.Done || 0,
        pending: cbMap.Pending || 0,
        missed: cbMap.Missed || 0,
        completionRate: cbTotal ? Math.round(((cbMap.Done || 0) / cbTotal) * 100) : 0,
      },
    },
    message: 'ok',
  });
};

module.exports = { summary };
