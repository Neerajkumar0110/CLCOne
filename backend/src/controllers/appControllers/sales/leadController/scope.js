const { resolveScope, requestedNarrowing } = require('../../../../services/access/salesScope');

// Lead's owner is `assignedUserName` (denormalized display copy of
// `assignedUser`) plus `team` (String, matches Team.name) — see the model
// comment.
//
// `req` is optional. For a full-access caller it lets Owner/Super Admin/
// Admin/Sales Manager/Team Manager narrow their otherwise-unrestricted view
// down to one team (`?team=`) or one person (`?agent=`), same idea as
// performanceController/summary.js's team/agent filters.
//
// For a non-full-access caller, the default is SELF ONLY — even if they're
// on a team, being on one doesn't automatically widen what they see. Their
// team's pooled data only shows up when they explicitly opt into it via
// `?teamView=1` (the "My Team" toggle on the Lead Stages / Callbacks pages).
// There's no partial view in between: it's either just their own rows, or
// the whole team's — never one named teammate's rows on their own, since a
// non-full-access caller's query string is otherwise never read here.
async function leadScopeFilter(admin, req) {
  const { isFullAccess, teamMemberNames, teamName } = await resolveScope(admin);
  if (isFullAccess) {
    const { team, agent } = requestedNarrowing(req);
    if (agent) return { assignedUserName: agent };
    if (team) return { team };
    return {};
  }

  const wantsTeamView = !!(req && req.query && (req.query.teamView === '1' || req.query.teamView === 'true'));
  if (wantsTeamView && teamName) {
    const or = [{ assignedUserName: { $in: teamMemberNames } }];
    or.push({ team: teamName });
    return { $or: or };
  }
  return { assignedUserName: admin.name };
}

module.exports = { leadScopeFilter };
