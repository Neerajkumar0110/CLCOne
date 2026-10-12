/* Backfill AssessmentDeliveryRecord.auto on records written before the field
 * existed.
 *
 * curriculumTracker.autoAdvance now retracts a unit back to PENDING when the
 * class behind it disappears from the calendar (cancelled, or pushed off a
 * holiday) — but only for records it set itself, so a teacher's own decision
 * is never undone. Older rows have no `auto` flag, so they read as
 * hand-resolved and would never be retracted, leaving the tracker claiming
 * topics were taught on days that no longer have a class.
 *
 * A row is treated as machine-written when it is DELIVERED and carries no
 * note. The old autoAdvance only ever set status/actualDate/updatedAt; the
 * delivery endpoint is what lets a human add a note or mark SKIPPED. Anything
 * with a note, or any non-DELIVERED status, is left alone.
 *
 * Also reports delivery records whose `batch` matches no real Batch — the
 * tracker used to run against hardcoded time-slot strings ("6:00 PM - 7:30
 * PM") rather than real batch names, and those rows now belong to nothing.
 * They are only reported, never touched, since deleting history is the
 * user's call.
 *
 * Usage (from backend/):
 *   node scripts/backfillDeliveryAutoFlag.cjs            (dry run)
 *   node scripts/backfillDeliveryAutoFlag.cjs --apply
 */
const path = require('path');
const mongoose = require('mongoose');
const { globSync } = require('glob');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
require('dotenv').config({ path: path.join(__dirname, '..', '.env.local') });

const APPLY = process.argv.includes('--apply');

const NO_NOTE = { $or: [{ notes: null }, { notes: '' }, { notes: { $exists: false } }] };

(async () => {
  if (!process.env.DATABASE) {
    console.error('DATABASE env var is not set.');
    process.exit(1);
  }
  await mongoose.connect(process.env.DATABASE);
  require('../src/config/multiDb').installMultiDbRouting();
  const files = globSync(path.join(__dirname, '..', 'src', 'models', '**', '*.js').split(String.fromCharCode(92)).join('/'));
  for (const f of files) require(path.resolve(f));

  const DR = mongoose.model('AssessmentDeliveryRecord');
  const Batch = mongoose.model('Batch');

  const q = { status: 'DELIVERED', auto: { $ne: true }, ...NO_NOTE };
  const n = await DR.countDocuments(q);
  const handResolved = await DR.countDocuments({ $or: [{ status: { $ne: 'DELIVERED' } }, { notes: { $nin: [null, ''] } }] });

  console.log(`${APPLY ? 'APPLYING' : 'DRY RUN'}`);
  console.log('  machine-written, to flag auto:true :', n);
  console.log('  hand-resolved, left alone          :', handResolved);

  if (APPLY && n) {
    const res = await DR.updateMany(q, { $set: { auto: true } });
    console.log('  flagged                            :', res.modifiedCount);
  }

  // Orphans — report only.
  const realBatches = new Set((await Batch.find({ removed: false }).select('name').lean()).map((b) => b.name));
  const byBatch = await DR.aggregate([{ $group: { _id: '$batch', n: { $sum: 1 } } }, { $sort: { n: -1 } }]);
  const orphans = byBatch.filter((b) => !realBatches.has(b._id));
  console.log('\n  delivery records by batch:');
  for (const b of byBatch) {
    console.log(`    ${String(b.n).padStart(4)}  ${b._id}${realBatches.has(b._id) ? '' : '   <- no such batch'}`);
  }
  if (orphans.length) {
    console.log(`\n  ${orphans.reduce((a, o) => a + o.n, 0)} record(s) belong to ${orphans.length} batch name(s) that do not exist.`);
    console.log('  Not touched — say the word if you want them cleared.');
  }

  if (!APPLY) console.log('\nNothing written. Re-run with --apply.');
  await mongoose.disconnect();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
