const mongoose = require('mongoose');

// The real security boundary for Code Editor — deliberately separate from
// (and stricter than) the normal FULL_ACCESS_ROLES bypass every other
// module gets. Code Editor opens a real VS Code session on this CRM's own
// source, so even owner/Super Admin/Admin/Sales Manager must have an
// explicit Permission record granting it — there is no role-based default.
// Mirrors the frontend carve-out in config/defaultPermissionMatrix.js and
// context/permissionContext/index.jsx; keep both in sync by hand.
async function getGrant(admin) {
  const deny = { view: false, edit: false, delete: false };
  if (!admin) return deny;

  const Permission = mongoose.model('Permission');
  const [userRecord, roleRecord] = await Promise.all([
    Permission.findOne({ scope: 'user', key: admin.email, removed: false }).lean(),
    Permission.findOne({ scope: 'role', key: admin.role, removed: false }).lean(),
  ]);

  const grant = userRecord?.matrix?.['Code Editor'] || roleRecord?.matrix?.['Code Editor'];
  return grant?.view ? grant : deny;
}

module.exports = { getGrant };
