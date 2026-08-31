/* One-off migration for the sidebar/permission-module restructure:
 *   • "HR"  permission module  ->  "HRMS"  (renamed)
 *   • "Leads" / "Customer" / "Calls" modules folded into "Sales"
 *     (their view/edit/delete flags are OR'd into Sales so nobody loses
 *      access), then removed.
 *
 * Rewrites the `matrix` of every stored Permission document (scope role +
 * user). Idempotent — safe to run more than once.
 *
 * Usage (from backend/):  node scripts/migrateSidebarPermissionModules.cjs
 */
const path = require('path');
const mongoose = require('mongoose');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
require('dotenv').config({ path: path.join(__dirname, '..', '.env.local') });

const RENAME = { HR: 'HRMS' };
const FOLD_INTO_SALES = ['Leads', 'Customer', 'Calls'];
const FLAGS = ['view', 'edit', 'delete'];

(async () => {
  if (!process.env.DATABASE) {
    console.error('DATABASE env var is not set — nothing to migrate.');
    process.exit(1);
  }

  await mongoose.connect(process.env.DATABASE);
  const Permission = require('../src/models/appModels/Permission');

  const docs = await Permission.find({}).exec();
  let changed = 0;

  for (const doc of docs) {
    const m = doc.matrix;
    if (!m || typeof m !== 'object') continue;
    let touched = false;

    // 1. straight renames
    for (const [oldKey, newKey] of Object.entries(RENAME)) {
      if (Object.prototype.hasOwnProperty.call(m, oldKey)) {
        if (!Object.prototype.hasOwnProperty.call(m, newKey)) m[newKey] = m[oldKey];
        delete m[oldKey];
        touched = true;
      }
    }

    // 2. fold Leads/Customer/Calls into Sales (OR the flags), then drop them
    for (const key of FOLD_INTO_SALES) {
      const src = m[key];
      if (src && typeof src === 'object') {
        m.Sales = m.Sales || { view: false, edit: false, delete: false };
        for (const f of FLAGS) m.Sales[f] = Boolean(m.Sales[f] || src[f]);
        delete m[key];
        touched = true;
      }
    }

    if (touched) {
      doc.matrix = m;
      doc.markModified('matrix');
      doc.updated = new Date();
      await doc.save();
      changed++;
      console.log(`  updated ${doc.scope}:${doc.key}`);
    }
  }

  console.log(`\nDone. Updated ${changed} of ${docs.length} permission record(s).`);
  await mongoose.disconnect();
  process.exit(0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
