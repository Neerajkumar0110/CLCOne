const mongoose = require('mongoose');
const { resolveHierarchyScope, FULL_ACCESS_ROLES } = require('../../../../services/access/salesHierarchy');
const { hydrateClientAndAdmin } = require('../../../../services/finance/hydrateClientAndAdmin');

const RANGE_DAYS = { '1M': 30, '3M': 90, '6M': 182, '1Y': 365 };

function secondsToLabel(totalSeconds) {
  const s = Math.max(0, Math.round(totalSeconds || 0));
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${String(sec).padStart(2, '0')}`;
}

function dayBucketKey(d) {
  return new Date(d).toISOString().slice(0, 10);
}

function weekBucketKey(d) {
  const date = new Date(d);
  const onejan = new Date(date.getFullYear(), 0, 1);
  const week = Math.ceil(((date - onejan) / 86400000 + onejan.getDay() + 1) / 7);
  return `${date.getFullYear()}-W${String(week).padStart(2, '0')}`;
}

// GET /api/performance/summary?range=1M|3M|6M|1Y&team=<name>&agent=<name>
//
// Scoping follows the sales org chart (Sales Manager -> Team Manager -> Team
// Leader -> Senior Executive -> Executive -> Sales Intern — see
// services/access/salesHierarchy.js): MANAGEMENT_ROLES see company-wide data
// and may filter by team or agent; everyone else is force-scoped
// server-side to themselves + everyone reporting up to them through
// Admin.reportsTo, however many levels deep. Anyone whose reportsTo chain
// hasn't been configured yet falls back to the old flat
// team-membership/self-only scope so this never breaks for an un-migrated
// account.
const summary = async (req, res) => {
  const Team = mongoose.model('Team');
  const Call = mongoose.model('Call');
  const Payment = mongoose.model('Payment');
  const Admin = mongoose.model('Admin');

  const range = RANGE_DAYS[req.query.range] ? req.query.range : '1M';
  const since = new Date(Date.now() - RANGE_DAYS[range] * 24 * 60 * 60 * 1000);

  const hierarchy = await resolveHierarchyScope(req.admin);
  const isManagement = hierarchy.isFullAccess;

  const allTeams = await Team.find({ removed: false }).select('name members color').lean();

  let myTeam = null;
  if (!isManagement && hierarchy.legacy) {
    myTeam = allTeams.find((t) => t.members.includes(req.admin.name)) || null;
  }

  // Resolve the actual scope for this request — this is the only place
  // authorization for team/agent filtering happens.
  let scopeTeam = null;
  let scopeAgent = null;
  // Hierarchy scope (non-legacy, non-management) — self + every descendant's
  // name, however deep the chain goes. null when management (no filter
  // needed) or legacy (handled via scopeTeam/scopeAgent exactly as before).
  let scopeNames = null;

  // Full-access callers (owner/Super Admin/Admin/Sales Manager) may also
  // narrow by role — "show me only what Team Leaders look like right now" —
  // on top of (or instead of) team/agent. Never consulted for a non-full-access
  // caller, same as team/agent above.
  const scopeRole = isManagement && req.query.role ? req.query.role : null;

  if (isManagement) {
    scopeTeam = req.query.team || null;
    scopeAgent = req.query.agent || null;
  } else if (hierarchy.legacy) {
    if (myTeam) {
      scopeTeam = myTeam.name; // team-wide — naturally includes their own rows
    } else {
      scopeAgent = req.admin.name; // no team — just their own data
    }
  } else {
    scopeNames = hierarchy.names; // hierarchy-aware — self + full reporting chain beneath them
  }

  // ---- Calls — real per-agent data, filtered straight in the query. ----
  const callMatch = { removed: false, created: { $gte: since } };
  if (scopeTeam) callMatch.team = scopeTeam;
  if (scopeAgent) callMatch.calledBy = scopeAgent;
  if (scopeNames) callMatch.calledBy = { $in: scopeNames };
  const calls = await Call.find(callMatch).select('status duration calledBy created').lean();

  // ---- Payments — real per-agent revenue. Payment has no team field of its
  // own, so team/hierarchy scoping is applied here in JS rather than in the
  // query. createdBy (Admin, coreDb) is a plain ref now — Payment is
  // financeDb, autopopulate can't cross databases — so it's hydrated
  // manually right after the fetch, same {_id, name} shape as before. ----
  const memberSet = scopeTeam
    ? new Set((allTeams.find((t) => t.name === scopeTeam) || {}).members || [])
    : null;
  const nameSet = scopeNames ? new Set(scopeNames) : null;

  const rawPaymentsUnhydrated = await Payment.find({ removed: false, created: { $gte: since } })
    .select('amount createdBy created')
    .lean();
  const rawPayments = await hydrateClientAndAdmin(rawPaymentsUnhydrated, { adminSelect: 'name' });

  const payments = rawPayments.filter((p) => {
    const name = p.createdBy?.name;
    if (!name) return false;
    if (scopeAgent) return name === scopeAgent;
    if (scopeTeam) return memberSet.has(name);
    if (nameSet) return nameSet.has(name);
    return true; // management, no team/agent filter — every payment is in scope
  });

  // Which agents to report on — identical enforcement to what scoped the
  // queries above, so a non-management caller only ever sees their own
  // hierarchy scope (or legacy team, if that's all that's configured for them).
  // Queried straight from Admin (by role) rather than flattened Team
  // membership when a role filter is active — Team Manager/Sales Manager
  // have no Team concept at all (NO_TEAM_FIELD_ROLES), so they'd otherwise
  // never show up under a role filter even though they're real agents.
  let agentNames = scopeAgent
    ? [scopeAgent]
    : scopeTeam
    ? (allTeams.find((t) => t.name === scopeTeam)?.members || [])
    : scopeNames
    ? scopeNames
    : isManagement
    ? [...new Set(allTeams.flatMap((t) => t.members))]
    : [req.admin.name];

  if (scopeRole) {
    const roleAdmins = await Admin.find({ role: scopeRole, removed: false }).select('name').lean();
    const roleNameSet = new Set(roleAdmins.map((r) => r.name));
    agentNames =
      scopeTeam || scopeAgent
        ? agentNames.filter((n) => roleNameSet.has(n)) // intersect with an already-chosen team/agent
        : [...roleNameSet]; // role filter alone — every person holding that role
  }

  const teamForAgent = (name) => allTeams.find((t) => t.members.includes(name)) || null;

  // role + hierarchy depth per agent, for the Leaderboard's Role column and
  // indent — depth comes straight from resolveHierarchyScope's precomputed
  // value when available (non-legacy hierarchy scope); otherwise looked up
  // fresh so management/legacy callers still get a Role column, just no depth.
  const depthByName = new Map((hierarchy.people || []).map((p) => [p.name, p.depth]));
  const roleRows = await Admin.find({ name: { $in: agentNames }, removed: false }).select('name role').lean();
  const roleByName = new Map(roleRows.map((r) => [r.name, r.role]));

  const agents = agentNames
    .map((name) => {
      const myCalls = calls.filter((c) => c.calledBy === name);
      const conn = myCalls.filter((c) => c.status === 'Connected').length;
      const dur = myCalls.reduce((s, c) => s + (c.duration || 0), 0);
      const myPayments = payments.filter((p) => p.createdBy?.name === name);
      const sales = myPayments.reduce((s, p) => s + (p.amount || 0), 0);
      const team = teamForAgent(name);

      return {
        name,
        role: roleByName.get(name) || null,
        depth: depthByName.has(name) ? depthByName.get(name) : 0,
        team: team?.name || null,
        color: team?.color || '#2563EB',
        calls: myCalls.length,
        connected: conn,
        missed: myCalls.length - conn,
        connectRatePct: myCalls.length ? Math.round((conn / myCalls.length) * 100) : 0,
        avgDurationLabel: secondsToLabel(myCalls.length ? dur / myCalls.length : 0),
        deals: myPayments.length,
        sales,
      };
    })
    .sort((a, b) => a.depth - b.depth || b.calls - a.calls);

  const totals = agents.reduce(
    (acc, a) => {
      acc.calls += a.calls;
      acc.connected += a.connected;
      acc.deals += a.deals;
      acc.sales += a.sales;
      return acc;
    },
    { calls: 0, connected: 0, deals: 0, sales: 0 }
  );

  const bucketByDay = range === '1M';
  const callBucket = {};
  calls.forEach((c) => {
    const key = bucketByDay ? dayBucketKey(c.created) : weekBucketKey(c.created);
    callBucket[key] = (callBucket[key] || 0) + 1;
  });
  const salesBucket = {};
  payments.forEach((p) => {
    const key = bucketByDay ? dayBucketKey(p.created) : weekBucketKey(p.created);
    salesBucket[key] = (salesBucket[key] || 0) + (p.amount || 0);
  });
  const weeklyTrend = [...new Set([...Object.keys(callBucket), ...Object.keys(salesBucket)])]
    .sort()
    .map((key) => ({ label: key, calls: callBucket[key] || 0, sales: salesBucket[key] || 0 }));

  return res.status(200).json({
    success: true,
    result: {
      range,
      scope: {
        isManagement,
        role: req.admin.role,
        team: scopeTeam,
        agent: scopeAgent,
        roleFilter: scopeRole,
        isHierarchy: !!scopeNames,
        legacy: !!hierarchy.legacy,
        teamSize: scopeNames ? scopeNames.length : null,
      },
      filters: {
        teams: isManagement ? allTeams.map((t) => t.name) : myTeam ? [myTeam.name] : [],
        agents: agentNames,
        roles: isManagement ? require('../../../../config/roles').SALES_ROLE_ORDER : [],
      },
      totals: {
        ...totals,
        connectRatePct: totals.calls ? Math.round((totals.connected / totals.calls) * 100) : 0,
        avgDealSize: totals.deals ? Math.round(totals.sales / totals.deals) : 0,
      },
      agents,
      weeklyTrend,
    },
    message: 'Successfully computed performance summary',
  });
};

module.exports = summary;
