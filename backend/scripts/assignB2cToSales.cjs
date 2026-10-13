/* One-off: give every existing Sales-department user Business Segment
 * "B2C Segment" (business decision 2026-10-12). Users created before the
 * Business Name / Segment pickers existed have no segment at all.
 *
 * Only fills users whose segment is empty — anyone already set (e.g. B2B,
 * picked deliberately on Add/Edit User) is listed but left alone.
 *
 * Idempotent.
 *
 * Usage (from backend/):
 *   node scripts/assignB2cToSales.cjs            (dry run)
 *   node scripts/assignB2cToSales.cjs --apply
 */
const path = require('path');
const mongoose = require('mongoose');
const { globSync } = require('glob');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
require('dotenv').config({ path: path.join(__dirname, '..', '.env.local') });

const APPLY = process.argv.includes('--apply');
const SEGMENT = 'B2C Segment';

(async () => {
  if (!process.env.DATABASE) {
    console.error('DATABASE env var is not set.');
    process.exit(1);
  }
  await mongoose.connect(process.env.DATABASE);
  require('../src/config/multiDb').installMultiDbRouting();
  const files = globSync(path.join(__dirname, '..', 'src', 'models', '**', '*.js').split(String.fromCharCode(92)).join('/'));
  for (const f of files) require(path.resolve(f));
  const { SALES_ROLES } = require('../src/config/roles');

  const Admin = mongoose.model('Admin');
  console.log(APPLY ? 'APPLYING' : 'DRY RUN');

  const sales = await Admin.find({ removed: false, role: { $in: SALES_ROLES } })
    .select('name email role businessSegment')
    .lean();
  const empty = sales.filter((u) => !u.businessSegment);
  const alreadySet = sales.filter((u) => u.businessSegment);

  console.log(`Sales users: ${sales.length} · to set ${SEGMENT}: ${empty.length} · already set: ${alreadySet.length}`);
  for (const u of alreadySet) console.log(`  kept  ${u.businessSegment.padEnd(12)} ${u.role.padEnd(17)} ${u.name} <${u.email}>`);
  for (const u of empty) console.log(`  set   ${SEGMENT.padEnd(12)} ${u.role.padEnd(17)} ${u.name} <${u.email}>`);

  if (APPLY && empty.length) {
    const r = await Admin.updateMany(
      { _id: { $in: empty.map((u) => u._id) } },
      { $set: { businessSegment: SEGMENT } }
    );
    console.log(`Updated ${r.modifiedCount} users.`);
  }
  await mongoose.disconnect();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
