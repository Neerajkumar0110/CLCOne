const mongoose = require('mongoose');
const { getProvider } = require('../../../../services/calling');
const { callingTier, campaignScope } = require('./permissions');
const { FULL_ACCESS_ROLES } = require('../../../../services/access/salesScope');

// GET /api/calling/history
//   q, campaign, agent, status, disposition, direction,
//   from, to (ISO), page, items
const list = async (req, res) => {
  await getProvider().tick();
  const CallRecord = mongoose.model('CallRecord');
  const CallCampaign = mongoose.model('CallCampaign');
  const q = req.query;

  const page = parseInt(q.page) || 1;
  const items = Math.min(parseInt(q.items) || 20, 200);

  const filter = { removed: false };

  // scope
  const tier = callingTier(req);
  // A user's calls = ones they took + ones nobody took that are filed under
  // them (CallRecord.ownerAgent — missed inbound, unclaimed pool calls).
  const callsOf = (id) => ({ $or: [{ agent: id }, { agent: null, ownerAgent: id }] });
  const and = [];
  if (tier === 'agent') {
    and.push(callsOf(req.admin._id));
  } else if (tier === 'manager') {
    const scope = await campaignScope(req);
    const camps = await CallCampaign.find({ removed: false, ...scope }).select('_id').lean();
    filter.campaign = { $in: camps.map((c) => c._id) };
  }

  if (q.campaign) filter.campaign = q.campaign;
  if (q.agent && mongoose.isValidObjectId(q.agent)) and.push(callsOf(new mongoose.Types.ObjectId(q.agent)));
  if (q.status && q.status !== 'All') filter.status = q.status;
  if (q.disposition) filter.disposition = q.disposition;
  if (q.direction) filter.direction = q.direction;
  if (q.q) {
    const rx = new RegExp(String(q.q).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    filter.$or = [{ contactName: rx }, { phone: rx }, { agentName: rx }, { ownerAgentName: rx }];
  }
  if (and.length) filter.$and = and;
  if (q.from || q.to) {
    filter.created = {};
    if (q.from) filter.created.$gte = new Date(q.from);
    if (q.to) filter.created.$lte = new Date(q.to);
  }

  const [result, count] = await Promise.all([
    CallRecord.find(filter)
      .sort({ created: -1 })
      .skip((page - 1) * items)
      .limit(items)
      .populate('campaign', 'name')
      .lean(),
    CallRecord.countDocuments(filter),
  ]);

  // History rows can include teammates' calls (campaign scope), but the
  // recording itself follows recordings.js's stricter rule: only see-all
  // roles get another agent's recording URL. Status stays, so the column
  // still shows "available".
  if (!FULL_ACCESS_ROLES.includes(req.admin.role)) {
    const me = String(req.admin._id);
    for (const r of result) {
      const mine = String(r.agent) === me || (!r.agent && String(r.ownerAgent) === me);
      if (r.recording && !mine) r.recording = { ...r.recording, url: null };
    }
  }
  // A call nobody took shows the user it's filed under.
  for (const r of result) {
    if (!r.agentName && r.ownerAgentName) {
      r.agentName = r.ownerAgentName;
      r.ownerOnly = true;
    }
  }

  return res.status(200).json({
    success: true,
    result,
    pagination: { page, pages: Math.ceil(count / items) || 0, count },
    message: 'ok',
  });
};

module.exports = { list };
