/* One-off cleanup for the Permission collection, run once before adding the
 * new unique (scope, key) index (see models/appModels/Permission.js):
 *
 *   1. Deletes 'role'-scope records whose key is a role name that no longer
 *      exists (legacy strings like "Agent"/"Sales Admin"/"Senior Agent"/
 *      "TestRole" from before roles got renamed — see frontend/src/config/
 *      roles.js's ROLE_ALIASES for the display-side equivalent). Only
 *      touches a key confirmed to have zero live Admin accounts on it.
 *   2. Renames the 'role'/"Team Coordinator" record (if any) to "Support"
 *      and resets its matrix to full view/edit/delete on every current
 *      module — Team Coordinator is being replaced by Support, which is
 *      meant to start at full access (still editable afterward via
 *      Roles & Permissions).
 *   3. De-duplicates 'role'-scope records: concurrent page loads of Roles &
 *      Permissions could each independently seed-if-missing without an
 *      atomic check, leaving 2+ conflicting records for the same role —
 *      keeps the most complete/most recently updated one, deletes the rest.
 *
 * Idempotent — safe to run more than once.
 * Usage (from backend/):  node scripts/dedupePermissionRecords.cjs
 */
const path = require('path');
const mongoose = require('mongoose');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
require('dotenv').config({ path: path.join(__dirname, '..', '.env.local') });

// Mirrors frontend/src/config/permissionModules.js — kept in sync by hand,
// same constraint every other role/permission config in this app already
// lives with (see roles.js's own top-of-file comment).
const PERMISSION_MODULES = [
  'Dashboard', 'Sales', 'Marketing', 'Operations', 'Project Management', 'LMS', 'HRMS',
  'Messenger', 'Communication', 'Calling', 'Reports', 'Performance', 'Finance', 'Invoices',
  'Payments', 'User Management', 'Support', 'Git Management', 'Vercel Management', 'Settings', 'About',
];

const CURRENT_ROLES = [
  'owner', 'Super Admin', 'Admin', 'Sales Manager', 'Team Manager', 'Senior Executive',
  'Executive', 'Support', 'Team Leader', 'Sales Intern', 'Finance', 'Teacher', 'Student',
];

function fullAccessMatrix() {
  const m = {};
  PERMISSION_MODULES.forEach((mod) => {
    m[mod] = { view: true, edit: true, delete: true };
  });
  return m;
}

(async () => {
  if (!process.env.DATABASE) {
    console.error('DATABASE env var is not set — nothing to migrate.');
    process.exit(1);
  }

  await mongoose.connect(process.env.DATABASE);
  const Permission = require('../src/models/appModels/Permission');
  const Admin = require('../src/models/coreModels/Admin');

  // 1. Team Coordinator -> Support (rename + full-access reset)
  const tcDoc = await Permission.findOne({ scope: 'role', key: 'Team Coordinator' });
  if (tcDoc) {
    const existingSupport = await Permission.findOne({ scope: 'role', key: 'Support' });
    if (existingSupport && String(existingSupport._id) !== String(tcDoc._id)) {
      // A Support record already exists (e.g. someone visited Roles &
      // Permissions after the code change but before this script ran) —
      // keep that one, drop the old Team Coordinator doc instead of
      // colliding with the new unique index.
      await Permission.deleteOne({ _id: tcDoc._id });
      console.log('  dropped stale role:"Team Coordinator" (role:"Support" already exists)');
    } else {
      tcDoc.key = 'Support';
      tcDoc.matrix = fullAccessMatrix();
      tcDoc.updated = new Date();
      await tcDoc.save();
      console.log('  renamed role:"Team Coordinator" -> role:"Support" (matrix reset to full access)');
    }
  }

  // 2. delete orphaned role-scope records for role names that no longer
  // exist and have zero live Admin accounts on them.
  const roleRecords = await Permission.find({ scope: 'role' }).lean();
  const orphanKeys = [...new Set(roleRecords.map((r) => r.key))].filter((k) => !CURRENT_ROLES.includes(k));
  for (const key of orphanKeys) {
    const liveCount = await Admin.countDocuments({ role: key });
    if (liveCount > 0) {
      console.log(`  SKIPPED role:"${key}" — ${liveCount} live account(s) still hold this role; not deleting.`);
      continue;
    }
    const res = await Permission.deleteMany({ scope: 'role', key });
    console.log(`  deleted ${res.deletedCount} orphaned role:"${key}" record(s)`);
  }

  // 3. de-duplicate any (scope, key) pair with more than one saved record —
  // keep the one with the most modules covered (falls back to most recently
  // updated). Per-user records (scope:'user') are just as exposed to the
  // same seed-on-first-load race as role records, so this covers both.
  const remaining = await Permission.find({}).lean();
  const byKey = {};
  remaining.forEach((r) => {
    const k = `${r.scope}::${r.key}`;
    (byKey[k] = byKey[k] || []).push(r);
  });
  for (const [compositeKey, docs] of Object.entries(byKey)) {
    if (docs.length <= 1) continue;
    docs.sort((a, b) => {
      const modDiff = Object.keys(b.matrix || {}).length - Object.keys(a.matrix || {}).length;
      if (modDiff !== 0) return modDiff;
      return new Date(b.updated || 0) - new Date(a.updated || 0);
    });
    const [keep, ...drop] = docs;
    await Permission.deleteMany({ _id: { $in: drop.map((d) => d._id) } });
    console.log(`  ${compositeKey} had ${docs.length} records — kept ${keep._id}, deleted ${drop.length}`);
  }

  console.log('\nDone.');
  await mongoose.disconnect();
  process.exit(0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
