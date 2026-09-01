const mongoose = require('mongoose');
const { STAGE_NAMES } = require('../../../config/leadStages');

// GET /api/lead/by-stage — the filtered lead list behind every dashboard
// drill-down and the Lead List filters. All params optional:
//   stage, subStatus, assignedUser, source, team, q (name/phone/email)
//   quick   = one of: callback-today | callback-overdue | callback-upcoming
//   callbackFrom, callbackTo, followUpFrom, followUpTo, createdFrom, createdTo  (ISO)
//   page, items, sortBy, sortValue
const startOfDay = (d) => {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
};
const endOfDay = (d) => {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
};

const byStage = async (req, res) => {
  const Lead = mongoose.model('Lead');
  const q = req.query;

  const page = parseInt(q.page) || 1;
  const limit = Math.min(parseInt(q.items) || 20, 200);
  const skip = page * limit - limit;

  const filter = { removed: false };

  if (q.stage && q.stage !== 'All') {
    if (q.stage === 'Other') filter.stage = { $nin: STAGE_NAMES };
    else filter.stage = q.stage;
  }
  if (q.subStatus) filter.subStatus = q.subStatus;
  if (q.assignedUser) filter.assignedUser = q.assignedUser;
  if (q.source) filter.source = q.source;
  if (q.team) filter.team = q.team;
  if (q.position) filter.position = q.position;

  if (q.q) {
    const rx = new RegExp(String(q.q).trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    filter.$or = [{ name: rx }, { phone: rx }, { email: rx }];
  }

  const now = new Date();
  if (q.quick === 'callback-today') {
    filter.stage = 'Call Back';
    filter.callBackAt = { $gte: startOfDay(now), $lte: endOfDay(now) };
  } else if (q.quick === 'callback-overdue') {
    filter.stage = 'Call Back';
    filter.callBackAt = { $lt: startOfDay(now) };
  } else if (q.quick === 'callback-upcoming') {
    filter.stage = 'Call Back';
    filter.callBackAt = { $gt: endOfDay(now) };
  }

  const range = (field, from, to) => {
    if (!from && !to) return;
    filter[field] = {};
    if (from) filter[field].$gte = new Date(from);
    if (to) filter[field].$lte = new Date(to);
  };
  if (!filter.callBackAt) range('callBackAt', q.callbackFrom, q.callbackTo);
  range('nextFollowUpAt', q.followUpFrom, q.followUpTo);
  range('created', q.createdFrom, q.createdTo);

  const sortBy = q.sortBy || 'stageUpdatedAt';
  const sortDir = Number(q.sortValue) === 1 ? 1 : -1;

  const [result, count] = await Promise.all([
    Lead.find(filter)
      .sort({ [sortBy]: sortDir })
      .skip(skip)
      .limit(limit)
      .populate('assignedUser', 'name surname email')
      .lean(),
    Lead.countDocuments(filter),
  ]);

  return res.status(200).json({
    success: true,
    result,
    pagination: { page, pages: Math.ceil(count / limit) || 0, count },
    message: 'Successfully found leads',
  });
};

module.exports = byStage;
