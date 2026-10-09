const mongoose = require('mongoose');
const { FULL_ACCESS_ROLES } = require('../../../../services/access/salesHierarchy');
const { SALES_ROLES } = require('../../../../config/roles');

// GET /api/performance/org-tree — the whole sales org chart as a nested
// tree (built from Admin.reportsTo — see services/access/salesHierarchy.js),
// for the Performance page's Person filter: a TreeSelect instead of a flat
// dropdown, so picking "Team Manager" expands to show the Team Leaders
// under them, each expanding to their Senior Executives, and so on.
// Full-access only (same tier as performance/summary's team/agent/role
// narrowing) — everyone else is already hard-scoped to their own chain, so
// there's nothing for them to browse outside it.
const orgTree = async (req, res) => {
  if (!FULL_ACCESS_ROLES.includes(req.admin.role)) {
    return res.status(403).json({ success: false, result: null, message: 'Full access required.' });
  }

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

  return res.status(200).json({ success: true, result: roots, message: 'ok' });
};

module.exports = orgTree;
