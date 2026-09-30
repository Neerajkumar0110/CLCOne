/* One-off fix: give the "Support" role full (admin-level) access to the LMS
 * module, while leaving its existing full access to the Support (ticketing)
 * tab untouched.
 *
 * defaultMatrixForRole() already computes full LMS access for Support (see
 * frontend/src/config/defaultPermissionMatrix.js), but that's only the
 * fallback used when no Permission record has been saved yet. Real accounts
 * usually already have a saved record — either the shared role-level one
 * (scope:'role', key:'Support') or a per-user override seeded the first time
 * an admin opened Roles & Permissions / User Management (scope:'user',
 * key:<email>) — and a saved record wins over the computed default. This
 * script finds and corrects every one of those saved records so the real,
 * persisted access matches the intended default.
 *
 * Idempotent — safe to run more than once.
 * Usage (from backend/):  node scripts/grantSupportFullLmsAccess.cjs
 */
const path = require('path');
const mongoose = require('mongoose');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
require('dotenv').config({ path: path.join(__dirname, '..', '.env.local') });

const FULL = { view: true, edit: true, delete: true };

(async () => {
  if (!process.env.DATABASE) {
    console.error('DATABASE env var is not set — nothing to migrate.');
    process.exit(1);
  }

  await mongoose.connect(process.env.DATABASE);
  // Admin + Permission live in the 'coreDb' logical database, not the
  // default connection — must install multi-db routing first, exactly like
  // server.js does, or every query below silently hits the wrong (empty) db.
  require('../src/config/multiDb').installMultiDbRouting();
  const Permission = require('../src/models/appModels/core/Permission');
  const Admin = require('../src/models/coreModels/Admin');

  let touched = 0;

  // 1. Shared role-level default for "Support".
  const roleDoc = await Permission.findOne({ scope: 'role', key: 'Support' });
  if (roleDoc) {
    const m = roleDoc.matrix || {};
    m.LMS = { ...FULL };
    m.Support = { ...FULL };
    roleDoc.matrix = m;
    roleDoc.markModified('matrix');
    roleDoc.updated = new Date();
    await roleDoc.save();
    touched++;
    console.log('  updated role:"Support" — LMS + Support set to full access');
  } else {
    console.log('  no role:"Support" record found (fine — computed default already grants full access)');
  }

  // 2. Every individual Support user's per-user override, if one exists.
  const supportUsers = await Admin.find({ role: 'Support' }).lean();
  console.log(`  found ${supportUsers.length} Admin account(s) with role "Support"`);

  for (const user of supportUsers) {
    const userDoc = await Permission.findOne({ scope: 'user', key: user.email });
    if (!userDoc) continue; // no per-user override saved — role default (now fixed above) applies
    const m = userDoc.matrix || {};
    m.LMS = { ...FULL };
    m.Support = { ...FULL };
    userDoc.matrix = m;
    userDoc.markModified('matrix');
    userDoc.updated = new Date();
    await userDoc.save();
    touched++;
    console.log(`  updated user:"${user.email}" — LMS + Support set to full access`);
  }

  console.log(`\nDone. Updated ${touched} Permission record(s).`);
  await mongoose.disconnect();
  process.exit(0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
