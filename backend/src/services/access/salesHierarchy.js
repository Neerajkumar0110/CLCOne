const mongoose = require('mongoose');
const { MANAGEMENT_ROLES, SALES_ROLE_ORDER } = require('../../config/roles');

// Multi-level sales org-chart scoping, built on Admin.reportsTo — Sales
// Manager -> Team Manager -> Team Leader -> Senior Executive -> Executive ->
// Sales Intern (see roles.js's SALES_ROLE_ORDER/SALES_ROLE_PARENT). Used by
// performanceController/summary.js and the new targetController so each tier
// sees itself + everyone under it, while MANAGEMENT_ROLES (owner/Super
// Admin/Admin/Sales Manager — Sales Manager is already the top of the chart,
// so this is also correct for them) see everyone unfiltered, same as every
// other full-access check in this app.
//
// This is deliberately a SEPARATE resolver from services/access/salesScope.js
// (which Lead/SalesDeal/Client visibility still uses) rather than a shared
// rewrite of it — salesScope.js's flat "Team Manager = full access" rule is
// still the one actually governing Lead/Deal/Client visibility, and changing
// that was never asked for here. Keeping them independent means rolling the
// hierarchy out to Performance/Targets can't silently change who sees what
// leads.
const FULL_ACCESS_ROLES = [...MANAGEMENT_ROLES];

// Every Admin whose reportsTo chain eventually reaches rootId, plus rootId
// itself — one $graphLookup instead of walking levels by hand. Cycle-safe:
// MongoDB's $graphLookup tracks visited documents and will not loop forever
// even if the data has one (e.g. two people accidentally pointing at each
// other), see the note on update.js's self-report guard.
async function getDescendantIds(rootId) {
  const Admin = mongoose.model('Admin');
  const rows = await Admin.aggregate([
    { $match: { _id: new mongoose.Types.ObjectId(String(rootId)) } },
    {
      $graphLookup: {
        from: 'admins',
        startWith: '$_id',
        connectFromField: '_id',
        connectToField: 'reportsTo',
        as: 'tree',
      },
    },
    { $project: { ids: { $concatArrays: [['$_id'], '$tree._id'] } } },
  ]);
  return (rows[0]?.ids || [rootId]).map((id) => String(id));
}

// depth: 0 = the viewer themselves, 1 = direct report, 2 = report-of-report,
// etc. — purely a display aid (indent in the Performance leaderboard), so a
// simple role-tier difference is enough; it doesn't need to walk the graph a
// second time. Roles outside SALES_ROLE_ORDER (shouldn't normally appear in
// a sales hierarchy scope) fall back to depth 0.
function roleDepth(viewerRole, otherRole) {
  const vi = SALES_ROLE_ORDER.indexOf(viewerRole);
  const oi = SALES_ROLE_ORDER.indexOf(otherRole);
  if (vi === -1 || oi === -1) return 0;
  return Math.max(0, oi - vi);
}

// { isFullAccess, ids: string[]|null, names: string[]|null, people, legacy }
// - isFullAccess true  -> no filter needed, caller sees everything.
// - ids/names null     -> same as isFullAccess (kept for callers that branch
//                          on isFullAccess alone).
// - legacy true         -> this admin has no reportsTo chain configured yet
//                          (no manager set on them, and nobody reports to
//                          them either) — fell back to the old flat
//                          Team-membership scope so Performance/Targets keep
//                          working exactly as before until the hierarchy is
//                          filled in for them.
async function resolveHierarchyScope(admin) {
  if (FULL_ACCESS_ROLES.includes(admin.role)) {
    return { isFullAccess: true, ids: null, names: null, people: null, legacy: false };
  }

  const Admin = mongoose.model('Admin');
  const hasManager = !!admin.reportsTo;
  const hasReports = !!(await Admin.exists({ reportsTo: admin._id, removed: false }));

  if (!hasManager && !hasReports) {
    const Team = mongoose.model('Team');
    const myTeam = await Team.findOne({
      removed: false,
      $or: [{ lead: admin.name }, { members: admin.name }],
    })
      .select('name lead members')
      .lean();

    if (myTeam) {
      const names = [...new Set([myTeam.lead, ...(myTeam.members || [])].filter(Boolean))];
      return { isFullAccess: false, ids: null, names, people: null, teamName: myTeam.name, legacy: true };
    }
    return { isFullAccess: false, ids: [String(admin._id)], names: [admin.name], people: null, legacy: true };
  }

  const ids = await getDescendantIds(admin._id);
  const people = await Admin.find({ _id: { $in: ids }, removed: false }).select('name role').lean();
  return {
    isFullAccess: false,
    ids,
    names: people.map((p) => p.name),
    people: people.map((p) => ({ ...p, depth: roleDepth(admin.role, p.role) })),
    legacy: false,
  };
}

// The whole sales org chart as a nested tree ({id, name, role, children}[]),
// built from Admin.reportsTo — shared by performanceController/orgTree.js's
// endpoint and analyticsController/shared.js's scopeFacets(), so every
// dashboard's Person/Owner/Agent filter gets the same expandable tree
// instead of each reimplementing this walk.
async function buildOrgTree() {
  const { SALES_ROLES } = require('../../config/roles');
  const Admin = mongoose.model('Admin');
  const people = await Admin.find({ role: { $in: SALES_ROLES }, removed: false })
    .select('name role reportsTo')
    .sort({ name: 1 })
    .lean();

  const byId = new Map(
    people.map((p) => [String(p._id), { id: String(p._id), name: p.name, role: p.role, children: [] }])
  );
  const roots = [];
  for (const p of people) {
    const node = byId.get(String(p._id));
    const parent = p.reportsTo && byId.get(String(p.reportsTo));
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  return roots;
}

module.exports = { resolveHierarchyScope, getDescendantIds, roleDepth, buildOrgTree, FULL_ACCESS_ROLES };
