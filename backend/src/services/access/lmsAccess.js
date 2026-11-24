const mongoose = require('mongoose');
const { LMS_FULL_ACCESS_ROLES, LMS_STUDENT_ROLES } = require('../../config/roles');

// Who gets the full (admin) LMS › Certificates page: the LMS management roles,
// plus anyone whose permission record (their own, else their role's) gives
// the LMS module "view" — the same record the CRM sidebar reads
// (frontend context/permissionContext). A learner never does.
async function hasLmsPermission(admin) {
  if (!admin) return false;
  if (LMS_FULL_ACCESS_ROLES.includes(admin.role)) return true;
  if (LMS_STUDENT_ROLES.includes(admin.role)) return false;
  const Permission = mongoose.model('Permission');
  const [userRecord, roleRecord] = await Promise.all([
    Permission.findOne({ scope: 'user', key: admin.email, removed: false }).select('matrix').lean(),
    Permission.findOne({ scope: 'role', key: admin.role, removed: false }).select('matrix').lean(),
  ]);
  const found = userRecord || roleRecord;
  return !!(found && found.matrix && found.matrix.LMS && found.matrix.LMS.view);
}

// Full LMS rights (view + edit + delete on the LMS module, own record first):
// such a user works as an LMS admin everywhere in the LMS, whatever the role
// (user ask 2026-11-24: support@ gets every LMS tab with all rights).
async function hasLmsFull(admin) {
  if (!admin) return false;
  if (LMS_STUDENT_ROLES.includes(admin.role)) return false;
  const Permission = mongoose.model('Permission');
  const [userRecord, roleRecord] = await Promise.all([
    Permission.findOne({ scope: 'user', key: admin.email, removed: false }).select('matrix').lean(),
    Permission.findOne({ scope: 'role', key: admin.role, removed: false }).select('matrix').lean(),
  ]);
  const found = userRecord || roleRecord;
  const g = found && found.matrix && found.matrix.LMS;
  return !!(g && g.view && g.edit && g.delete);
}

module.exports = { hasLmsPermission, hasLmsFull };
