const { FULL_ACCESS_ROLES, buildOrgTree } = require('../../../../services/access/salesHierarchy');

// GET /api/performance/org-tree — the whole sales org chart as a nested
// tree (see services/access/salesHierarchy.js's buildOrgTree), for the
// Performance page's Person filter: a TreeSelect instead of a flat
// dropdown, so picking "Team Manager" expands to show the Team Leaders
// under them, each expanding to their Senior Executives, and so on.
// Full-access only (same tier as performance/summary's team/agent/role
// narrowing) — everyone else is already hard-scoped to their own chain, so
// there's nothing for them to browse outside it.
const orgTree = async (req, res) => {
  if (!FULL_ACCESS_ROLES.includes(req.admin.role)) {
    return res.status(403).json({ success: false, result: null, message: 'Full access required.' });
  }
  const roots = await buildOrgTree();
  return res.status(200).json({ success: true, result: roots, message: 'ok' });
};

module.exports = orgTree;
