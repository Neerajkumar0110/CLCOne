const { resolveScope, requestedNarrowing } = require('../../../../services/access/salesScope');

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
  if (teamView === '1' || teamView === 'true') {
    const { teamMemberNames, teamName } = await resolveScope(admin);
    if (teamName) return { $or: [{ assignedUserName: { $in: teamMemberNames } }, { team: teamName }] };
  }
  return {};
}

module.exports = { leadScopeFilter };
