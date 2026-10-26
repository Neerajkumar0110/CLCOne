const mongoose = require('mongoose');
const { STAGE_NAMES } = require('../../../../config/leadStages');
const { leadScopeFilter, userLeadMatch, responseScopeUsers, NOT_ENTERED } = require('./scope');
const { parkedPhones } = require('./usedLeads');

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

// The Lead List filter from query-style params — shared with assignOwner.js
// so a bulk "assign every lead in this view" hits exactly the rows the list
// shows (scope is applied separately, by the caller).
//
// `scopeUsers` (the Lead Stages "own leads" view, scope.responseScopeUsers)
// or `assignedUser` makes the list one person's/team's leads, matching the
// board: a lead they called but never responded on only appears under
// NOT_ENTERED, never under its current stage.
async function buildLeadListFilter(q, scopeUsers = null) {
  const filter = { removed: false };
  const and = [];

  let owned = null; // { m: userLeadMatch, ownerId? }
  if (q.assignedUser === 'none') filter.assignedUser = null; // unassigned only
  else if (q.assignedUser && mongoose.isValidObjectId(q.assignedUser)) {
    // "Assigned User" = everything that person has: leads they own, leads
    // they recorded a response on, and leads they called — most leads never
    // get an owner, so owner-only matched almost nothing.
    const u = await mongoose.model('Admin').findById(q.assignedUser).select('name surname').lean();
    if (u) owned = { m: await userLeadMatch([u]), ownerId: u._id };
    else and.push({ assignedUser: q.assignedUser });
  } else if (scopeUsers) {
    owned = { m: await userLeadMatch(scopeUsers) };
  }
  if (owned) and.push(owned.ownerId ? { $or: [{ assignedUser: owned.ownerId }, owned.m.any] } : owned.m.any);
  else {
    // Company-wide list: same as the Lead Stages board, used leads no user
    // has live in Used Leads → "Not with any user" until sent back.
    const parked = await parkedPhones();
    if (parked.length) filter.phoneNormalized = { $nin: parked };
  }

  // Leads that count under a stage for these users: ones they responded on
  // (plus, for an Assigned User, ones they own).
  const counted = owned && (owned.ownerId ? { $or: [owned.m.responded, { assignedUser: owned.ownerId }] } : owned.m.responded);
  if (q.stage === NOT_ENTERED) {
    if (counted) and.push({ $nor: [counted] });
    else filter._id = null; // no user in view — nothing is "not entered"
  } else if (q.stage && q.stage !== 'All') {
    if (q.stage === 'Other') filter.stage = { $nin: STAGE_NAMES };
    else filter.stage = q.stage;
    if (counted) and.push(counted);
  }
  if (q.subStatus) filter.subStatus = q.subStatus;
  if (q.source) filter.source = q.source;
  if (q.team) filter.team = q.team;
  if (q.position) filter.position = q.position;

  if (q.q) {
    const rx = new RegExp(String(q.q).trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    filter.$or = [{ name: rx }, { phone: rx }, { email: rx }];
  }

  const now = new Date();
  if (q.quick === 'callback-today') {
    filter.stage = 'Callback';
    filter.callBackAt = { $gte: startOfDay(now), $lte: endOfDay(now) };
  } else if (q.quick === 'callback-overdue') {
    filter.stage = 'Callback';
    filter.callBackAt = { $lt: startOfDay(now) };
  } else if (q.quick === 'callback-upcoming') {
    filter.stage = 'Callback';
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
  // `filter` may already hold the search box's own top-level $or.
  return and.length ? { $and: [filter, ...and] } : filter;
}

const byStage = async (req, res) => {
  const Lead = mongoose.model('Lead');
  const q = req.query;

  const page = parseInt(q.page) || 1;
  const limit = Math.min(parseInt(q.items) || 20, 200);
  const skip = page * limit - limit;

  // The Lead Stages "own leads" view (teamView=responses) is built into the
  // list filter itself, so stage drills match the board's counts.
  const scopeUsers = q.teamView === 'responses' ? await responseScopeUsers(req.admin) : null;
  const filter = await buildLeadListFilter(q, scopeUsers);

  const sortBy = q.sortBy || 'stageUpdatedAt';
  const sortDir = Number(q.sortValue) === 1 ? 1 : -1;

  // Row-level visibility — same rule as every other Lead read path (see
  // scope.js). This endpoint backs the main "Lead Stages" board, so without
  // this it was the one place a non-management caller could still see every
  // lead company-wide regardless of the scoping on list/filter/search/etc.
  // Combined via $and (not a flat merge) because `filter` may already carry
  // its own top-level $or for the free-text search box, which a second $or
  // key here would silently clobber.
  const scopeFilter = q.teamView === 'responses' ? {} : await leadScopeFilter(req.admin, req);
  const query = Object.keys(scopeFilter).length ? { $and: [filter, scopeFilter] } : filter;

  const [result, count] = await Promise.all([
    Lead.find(query).sort({ [sortBy]: sortDir }).skip(skip).limit(limit).lean(),
    Lead.countDocuments(query),
  ]);

  // Lead (salesDb) and Admin (coreDb) live on different connections under
  // config/multiDb.js, and .populate() can't cross that boundary — it throws
  // "Schema hasn't been registered for model Admin". Resolve assignedUser
  // with a plain second lookup instead, keeping populate's output shape.
  // Names that arrived as UTF-8 read as Windows-1252 (Meta lead forms) — show them readable.
  const { fixMojibake } = require('../../../../utils/fixMojibake');
  for (const l of result) l.name = fixMojibake(l.name);

  const userIds = [...new Set(result.filter((l) => l.assignedUser).map((l) => String(l.assignedUser)))];
  if (userIds.length) {
    const users = await mongoose
      .model('Admin')
      .find({ _id: { $in: userIds } })
      .select('name surname email')
      .lean();
    const byId = new Map(users.map((u) => [String(u._id), u]));
    for (const l of result) {
      if (l.assignedUser) l.assignedUser = byId.get(String(l.assignedUser)) || null;
    }
  }

  return res.status(200).json({
    success: true,
    result,
    pagination: { page, pages: Math.ceil(count / limit) || 0, count },
    message: 'Successfully found leads',
  });
};

module.exports = byStage;
module.exports.buildLeadListFilter = buildLeadListFilter;
