const mongoose = require('mongoose');
const { resolveScope, requestedNarrowing } = require('../../../../services/access/salesScope');

// Bucket for a lead a user called but never recorded a response on — its
// current stage was set by someone/something else, so it isn't theirs to
// count under that stage (stageStats.js / byStage.js).
const NOT_ENTERED = 'Response Not Entered';

// A user's "own" leads, for one or more users (ids + every name form their
// stageHistory entries may carry — the dialer path only stamps the name):
//   responded — they recorded a response (stageHistory entry)
//   called    — a call of theirs reached the number (CallRecord agent, or
//               ownerAgent for calls nobody took), response or not
// Returns { responded, called, any } Mongo filters on Lead.
async function userLeadMatch(users) {
  const ids = users.map((u) => u._id);
  const names = [...new Set(users.flatMap((u) => [u.name, `${u.name || ''} ${u.surname || ''}`.trim()]).filter(Boolean))];
  const responded = { $or: [{ 'stageHistory.changedBy': { $in: ids } }, { 'stageHistory.changedByName': { $in: names } }] };
  const phones = await mongoose
    .model('CallRecord')
    .distinct('phone', { removed: false, answeredAt: { $ne: null }, $or: [{ agent: { $in: ids } }, { agent: null, ownerAgent: { $in: ids } }] });
  const tails = [...new Set(phones.map((p) => String(p || '').replace(/\D/g, '').slice(-10)).filter((p) => p.length === 10))];
  const called = { phoneNormalized: { $in: tails } };
  return { ids, names, responded, called, any: { $or: [responded, called] } };
}

// The caller's scope for the Lead Stages board: their own leads (Team
// Leader with a team: + the team's). null = full access, no filter.
// `viewUserId` (Lead Stages "User" filter): just that one user's board —
// anyone for full-access callers, a Team Leader only for themself or a team
// member; any other id is ignored and the caller's normal scope applies.
async function responseScopeUsers(admin, viewUserId) {
  const { isFullAccess, teamMemberNames } = await resolveScope(admin);
  if (viewUserId && mongoose.isValidObjectId(viewUserId)) {
    const target = await mongoose.model('Admin').findOne({ _id: viewUserId, removed: false }).select('_id name surname').lean();
    if (target) {
      if (isFullAccess) return [target];
      const mine = await responseScopeUsers(admin);
      if (mine && mine.some((u) => String(u._id) === String(target._id))) return [target];
    }
  }
  if (isFullAccess) return null;
  const users = [admin];
  const memberKeys = admin.role === 'Team Leader' ? teamMemberNames || [] : [];
  if (memberKeys.length) {
    // Team docs store display names ("name" or "name surname"); resolve them
    // to Admin rows so both the id and the full name form match.
    const admins = await mongoose
      .model('Admin')
      .find({ removed: false, name: { $in: memberKeys.map((k) => k.split(' ')[0]) } })
      .select('_id name surname')
      .lean();
    for (const a of admins) {
      const full = `${a.name || ''} ${a.surname || ''}`.trim();
      if (String(a._id) !== String(admin._id) && (memberKeys.includes(a.name) || memberKeys.includes(full))) users.push(a);
    }
  }
  return users;
}

async function responseScopeFilter(admin) {
  const users = await responseScopeUsers(admin);
  return users ? (await userLeadMatch(users)).any : {};
}

// Lead's owner is `assignedUserName` (denormalized display copy of
// `assignedUser`) plus `team` (String, matches Team.name) — see the model
// comment.
//
// Every user sees every lead (business decision 2026-10-12: a freshly
// created user used to land on empty Lead Stages / dialer views, because
// non-management roles were scoped to only the leads assigned to them and
// nothing auto-assigns leads). Lead export/import stay management-only —
// they gate on FULL_ACCESS_ROLES themselves, not on this filter.
//
// `req` is optional. Anyone may narrow the company-wide view down to one
// team (`?team=`) or one person (`?agent=`), same idea as
// performanceController/summary.js's team/agent filters. The "Showing"
// picker on the Lead Stages / Callbacks pages sends `?teamView=1` to
// narrow to the caller's own team, or `?teamView=mine` for just their own
// leads.
async function leadScopeFilter(admin, req) {
  const { team, agent } = requestedNarrowing(req);
  if (agent) return { assignedUserName: agent };
  if (team) return { team };

  const teamView = req && req.query ? req.query.teamView : undefined;
  if (teamView === 'mine') return { assignedUserName: admin.name };
  if (teamView === 'responses') return responseScopeFilter(admin);
  if (teamView === '1' || teamView === 'true') {
    const { teamMemberNames, teamName } = await resolveScope(admin);
    if (teamName) return { $or: [{ assignedUserName: { $in: teamMemberNames } }, { team: teamName }] };
  }
  return {};
}

module.exports = { leadScopeFilter, userLeadMatch, responseScopeUsers, NOT_ENTERED };
