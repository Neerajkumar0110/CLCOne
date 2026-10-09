/* One-off migration: old 13-stage lead taxonomy -> the new 12-stage one
 * (see src/config/leadStages.js's header comment + LEGACY_STAGE_MAP for the
 * exact old-stage -> new-{stage,subStatus} mapping this reuses).
 *
 * Every Lead's `stage`/`subStatus`/`status` already gets normalized through
 * resolveStageSub() on save/update, which now recognizes an old stage name
 * via LEGACY_STAGE_MAP and resolves it correctly — this script just forces
 * that resolution across every EXISTING document in one pass, since the
 * pre-save hook only runs on a write, not a read (an old document sitting
 * untouched would otherwise keep showing a now-retired stage name forever).
 *
 * Idempotent — safe to run repeatedly; a lead already on the new taxonomy
 * is a no-op.
 *
 * Usage (from backend/):
 *   node scripts/migrateLeadStagesToV2.cjs            (dry run — reports only)
 *   node scripts/migrateLeadStagesToV2.cjs --apply     (writes the changes)
 */
const path = require('path');
const mongoose = require('mongoose');
const { globSync } = require('glob');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
require('dotenv').config({ path: path.join(__dirname, '..', '.env.local') });

const APPLY = process.argv.includes('--apply');

(async () => {
  if (!process.env.DATABASE) {
    console.error('DATABASE env var is not set — nothing to migrate.');
    process.exit(1);
  }

  await mongoose.connect(process.env.DATABASE);
  // Lead lives in salesDb — must install multi-db routing before any model
  // registers itself, same order as server.js.
  require('../src/config/multiDb').installMultiDbRouting();
  const modelsFiles = globSync(path.join(__dirname, '..', 'src', 'models', '**', '*.js').replace(/\\/g, '/'));
  for (const filePath of modelsFiles) require(path.resolve(filePath));

  const { resolveStageSub, statusLabel, STAGE_NAMES } = require('../src/config/leadStages');
  const Lead = mongoose.model('Lead');

  const cursor = Lead.find({}).cursor();
  let scanned = 0;
  let changed = 0;
  const stageChangeCounts = {};

  for (let doc = await cursor.next(); doc != null; doc = await cursor.next()) {
    scanned += 1;
    const r = resolveStageSub({ stage: doc.stage, subStatus: doc.subStatus, status: doc.status });
    const canonical = statusLabel(r.stage, r.subStatus);

    const set = {};
    if (doc.stage !== r.stage) set.stage = r.stage;
    if (doc.subStatus !== r.subStatus) set.subStatus = r.subStatus;
    if (doc.status !== canonical) set.status = canonical;

    if (Object.keys(set).length > 0) {
      const fromLabel = doc.stage || '(none)';
      stageChangeCounts[fromLabel] = stageChangeCounts[fromLabel] || { to: r.stage, count: 0 };
      stageChangeCounts[fromLabel].count += 1;
      changed += 1;
      if (APPLY) {
        await Lead.updateOne({ _id: doc._id }, { $set: set });
      }
    }
  }

  console.log(`Scanned ${scanned} lead(s), ${APPLY ? 'migrated' : 'would migrate'} ${changed}.`);
  console.log('\nBy old stage -> new stage:');
  Object.entries(stageChangeCounts)
    .sort((a, b) => b[1].count - a[1].count)
    .forEach(([from, { to, count }]) => console.log(`  ${from} -> ${to}  (${count})`));

  // Sanity check — confirm nothing is left pointing at a stage the new
  // taxonomy doesn't recognize (only meaningful after --apply).
  if (APPLY) {
    const strayCount = await Lead.countDocuments({ stage: { $nin: STAGE_NAMES } });
    console.log(`\nLeads still on an unrecognized stage after migration: ${strayCount}`);
  } else {
    console.log('\nDry run only — re-run with --apply to write these changes.');
  }

  await mongoose.disconnect();
  process.exit(0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
