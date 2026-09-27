const { resolveScope, requestedNarrowing, namesForTeam } = require('../../../../services/access/salesScope');

// SalesDeal.owner is a plain free-text String (no ObjectId ref exists on
// this model — see the create.js comment for the write-side caveat this
// implies), matched against Admin.name the same way Team.members/lead are.
//
// `req` is optional, only consulted for a full-access caller — lets them
// narrow down to one team (`?team=`, resolved to that team's member names
// since SalesDeal has no team field of its own) or one person (`?agent=`).
async function salesDealScopeFilter(admin, req) {
  const { isFullAccess, teamMemberNames } = await resolveScope(admin);
  if (isFullAccess) {
    const { team, agent } = requestedNarrowing(req);
    if (agent) return { owner: agent };
    if (team) return { owner: { $in: await namesForTeam(team) } };
    return {};
  }
  return { owner: { $in: teamMemberNames } };
}

module.exports = { salesDealScopeFilter };
