// GET /api/marketing-hub/rows/:key — paginated drill-through records for a leaf.
//   leads leaf     → Lead docs (channel + region + System + window + drill params)
//   campaigns leaf → Campaign docs
//   manual leaf    → the MarketingMetric monthly rows
const mongoose = require('mongoose');
const { LEAF_BY_KEY, CHANNEL_SOURCES } = require('../../../config/marketingDashboards');
const { teamSystemFilter } = require('../../../config/salesSystems');
const { windowFromQuery } = require('../analyticsController/shared');
const { drillToMongo, paginate } = require('../analyticsController/modules/_util');

function regionRe(region) {
  return region === 'India' ? /india/i : /usa|united states|u\.s\.|america/i;
}

async function leadFilter(leaf, q, from, to) {
  const Team = mongoose.model('Team');
  const region = q.region || leaf.region || null;
  const tFilter = teamSystemFilter({ ...q, region });
  const teams = await Team.find({ removed: false, ...tFilter }).select('name').lean();
  const teamNames = teams.map((t) => t.name);

  const cond = { removed: false, created: { $gte: from, $lte: to } };
  if (region) {
    const or = [{ country: regionRe(region) }];
    if (teamNames.length) or.push({ team: { $in: teamNames } });
    cond.$or = or;
  } else if (teamNames.length && (q.businessType || q.systemType)) {
    cond.team = { $in: teamNames };
  }
  const ch = leaf.channel;
  if (ch && ch !== 'other') {
    cond.source = { $in: CHANNEL_SOURCES[ch].map((s) => new RegExp(`^${s}$`, 'i')) };
  } else if (ch === 'other') {
    const mapped = Object.values(CHANNEL_SOURCES).flat().map((s) => new RegExp(`^${s}$`, 'i'));
    cond.source = { $nin: mapped };
  }
  Object.assign(cond, drillToMongo(q));
  if (q.q) {
    cond.$and = [
      ...(cond.$and || []),
      { $or: [{ name: { $regex: q.q, $options: 'i' } }, { phone: { $regex: q.q, $options: 'i' } }, { email: { $regex: q.q, $options: 'i' } }] },
    ];
  }
  return cond;
}

module.exports = () => {
  const rows = async (req, res) => {
    const leaf = LEAF_BY_KEY[req.params.key] || (req.params.key === 'master' ? { key: 'master', source: 'leads', channel: null, region: null } : null);
    if (!leaf) return res.status(404).json({ success: false, result: null, message: 'Unknown dashboard' });

    const { from, to } = windowFromQuery(req.query);
    const { items, skip, sort } = paginate(req.query);

    if (leaf.source === 'leads') {
      const Lead = mongoose.model('Lead');
      const filter = await leadFilter(leaf, req.query, from, to);
      const [docs, count] = await Promise.all([
        Lead.find(filter)
          .select('name phone email source stage subStatus assignedUserName team country created nextFollowUpAt')
          .sort(sort)
          .skip(skip)
          .limit(items)
          .lean(),
        Lead.countDocuments(filter),
      ]);
      return res.status(200).json({
        success: true,
        result: docs.map((d) => ({ ...d, id: String(d._id) })),
        pagination: { page: Math.floor(skip / items) + 1, pages: Math.max(1, Math.ceil(count / items)), count },
        message: 'ok',
      });
    }

    if (leaf.source === 'campaigns') {
      const Campaign = mongoose.model('Campaign');
      const filter = {
        removed: false,
        $or: [
          { startDate: { $gte: from, $lte: to } },
          { endDate: { $gte: from, $lte: to } },
          { created: { $gte: from, $lte: to } },
        ],
        ...drillToMongo(req.query),
      };
      if (req.query.q) filter.name = { $regex: req.query.q, $options: 'i' };
      const [docs, count] = await Promise.all([
        Campaign.find(filter)
          .select('name type objective status budget actualSpend leads conversions revenue startDate endDate owner')
          .sort(sort)
          .skip(skip)
          .limit(items)
          .lean(),
        Campaign.countDocuments(filter),
      ]);
      return res.status(200).json({
        success: true,
        result: docs.map((d) => ({ ...d, id: String(d._id) })),
        pagination: { page: Math.floor(skip / items) + 1, pages: Math.max(1, Math.ceil(count / items)), count },
        message: 'ok',
      });
    }

    // manual
    const MarketingMetric = mongoose.model('MarketingMetric');
    const docs = await MarketingMetric.find({ removed: false, dashboardKey: leaf.key })
      .sort({ month: -1 })
      .limit(400)
      .lean();
    return res.status(200).json({
      success: true,
      result: docs.map((r) => ({ id: String(r._id), month: r.month, region: r.region, businessType: r.businessType, systemType: r.systemType, ...(r.values || {}) })),
      pagination: { page: 1, pages: 1, count: docs.length },
      message: 'ok',
    });
  };

  return { rows };
};
