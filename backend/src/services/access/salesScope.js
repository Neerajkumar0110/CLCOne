const mongoose = require('mongoose');
const { MANAGEMENT_ROLES } = require('../../config/roles');

// Row-level data-visibility scoping for the Sales module (Lead/SalesDeal/
// Client) — previously these models' list/filter/search/summary/read
// endpoints were 100% generic CRUD with zero identity awareness: any
// authenticated user (e.g. a freshly-created Sales Executive) could list
// every row in the whole collection, company-wide.
//
// Rule (as specified): owner/Super Admin/Admin/Sales Manager (the existing
// MANAGEMENT_ROLES) PLUS Team Manager see every row, unfiltered. Everyone
// else sees their own team's rows if they're on a team (matched by
// Admin.name against Team.members/lead, same convention already used by
// dashboardController/summary.js, performanceController/summary.js,
// analyticsController/modules/overview.js), or just their own rows if
// they're not on any team.
const FULL_ACCESS_ROLES = [...MANAGEMENT_ROLES, 'Team Manager'];

// Team Leader rule (2026-10-23): until a team with members is set up for
// them, a Team Leader sees EVERYONE's data; once their team has members,
// only that team's. Returns { open: true } (see all) or the team.
const LEADER_ROLES = ['Team Leader'];
async function leaderTeam(admin) {
  const Team = mongoose.model('Team');
  const keys = [admin.name, `${admin.name || ''} ${admin.surname || ''}`.trim()].filter(Boolean);
  const team =
    (await Team.findOne({ removed: false, lead: { $in: keys } }).select('name lead members').lean()) ||
    (await Team.findOne({ removed: false, members: { $in: keys } }).select('name lead members').lean());
  const names = team ? [...new Set([team.lead, ...(team.members || [])].filter(Boolean))] : [];
  const others = names.filter((n) => !keys.includes(n));
  if (!team || !others.length) return { open: true };
  return { open: false, teamName: team.name, names };
}

// { isFullAccess: bool, teamMemberNames: string[] | null }
// teamMemberNames === null means "full access, no filter needed".
// teamMemberNames === [admin.name] means "no team — self only".
async function resolveScope(admin) {
  if (FULL_ACCESS_ROLES.includes(admin.role)) {
    return { isFullAccess: true, teamMemberNames: null, teamName: null };
  }
  if (LEADER_ROLES.includes(admin.role)) {
    const t = await leaderTeam(admin);
    if (t.open) return { isFullAccess: true, teamMemberNames: null, teamName: null, leaderOpen: true };
    return { isFullAccess: false, teamMemberNames: t.names, teamName: t.teamName };
  }

  const Team = mongoose.model('Team');
  const myTeam = await Team.findOne({
    removed: false,
    $or: [{ lead: admin.name }, { members: admin.name }],
  })
    .select('name lead members')
    .lean();

  if (myTeam) {
    const names = [...new Set([myTeam.lead, ...(myTeam.members || [])].filter(Boolean))];
    return { isFullAccess: false, teamMemberNames: names, teamName: myTeam.name };
  }
  return { isFullAccess: false, teamMemberNames: [admin.name], teamName: null };
}

// Member names (lead + members, deduped) of one named team — used to turn a
// full-access caller's `?team=<name>` narrowing filter into the same
// name-list shape resolveScope() already produces for a caller's own team.
// Returns [] for an unknown/removed team (narrows to "nothing", not "everyone").
async function namesForTeam(teamName) {
  if (!teamName) return [];
  const Team = mongoose.model('Team');
  const team = await Team.findOne({ name: teamName, removed: false }).select('lead members').lean();
  if (!team) return [];
  return [...new Set([team.lead, ...(team.members || [])].filter(Boolean))];
}

// Optional `?team=` / `?agent=` narrowing a FULL-ACCESS caller may apply on
// top of their already-unrestricted view (management wants to zoom into one
// team or one person instead of the whole company). Only ever consulted when
// isFullAccess is already true — a non-management caller's query string is
// never read for this, so they can't widen their own hard scope by guessing
// params.
// Returns { team: string|null, agent: string|null }.
function requestedNarrowing(req) {
  const team = (req && req.query && req.query.team) || null;
  const agent = (req && req.query && req.query.agent) || null;
  return { team, agent };
}

module.exports = { resolveScope, FULL_ACCESS_ROLES, namesForTeam, requestedNarrowing, leaderTeam, LEADER_ROLES };
