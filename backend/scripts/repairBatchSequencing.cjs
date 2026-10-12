/* One-off repair after the holiday-aware schedule regeneration.
 *
 * Two things drifted and this puts both right:
 *
 *  1. Class numbers. regenerateForBatch gap-fills — already-taught classes
 *     keep their original sessionIndex while newly generated ones are
 *     numbered from the fresh schedule. Once holidays shifted the dates the
 *     two numberings stopped agreeing, leaving each batch with a duplicate
 *     index and a missing one (e.g. two "Class 4", no "Class 5").
 *     liveClassService.renumberBatchSessions puts them back to 1..n in date
 *     order. Only the auto-generated "<batch> — Class N" title is rewritten;
 *     a hand-set name is left alone.
 *
 *  2. Recording names. LiveRecording.className is stored, not computed, so
 *     existing rows still hold the name from before the curriculum mapping
 *     learned about multi-class chapters ("Part 1 of 2") and non-syllabus
 *     sessions. resyncBatchRecordingNames recomputes them from the current
 *     mapping.
 *
 * Both are idempotent — re-running changes nothing once things are correct.
 *
 * Usage (from backend/):
 *   node scripts/repairBatchSequencing.cjs            (dry run — reports only)
 *   node scripts/repairBatchSequencing.cjs --apply    (writes)
 */
const path = require('path');
const mongoose = require('mongoose');
const { globSync } = require('glob');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
require('dotenv').config({ path: path.join(__dirname, '..', '.env.local') });

const APPLY = process.argv.includes('--apply');

async function sequencingReport(S, batch) {
  const rows = await S.find({ batch: batch._id, removed: false, status: { $ne: 'cancelled' } })
    .sort({ scheduledStart: 1 })
    .select('sessionIndex')
    .lean();
  const counts = {};
  for (const r of rows) counts[r.sessionIndex] = (counts[r.sessionIndex] || 0) + 1;
  const duplicates = Object.entries(counts).filter(([, n]) => n > 1).map(([i]) => Number(i));
  const outOfOrder = rows.filter((r, i) => r.sessionIndex !== i + 1).length;
  return { total: rows.length, duplicates, outOfOrder };
}

(async () => {
  if (!process.env.DATABASE) {
    console.error('DATABASE env var is not set.');
    process.exit(1);
  }
  await mongoose.connect(process.env.DATABASE);
  require('../src/config/multiDb').installMultiDbRouting();
  const files = globSync(path.join(__dirname, '..', 'src', 'models', '**', '*.js').split(String.fromCharCode(92)).join('/'));
  for (const f of files) require(path.resolve(f));

  const svc = require('../src/services/lms/liveClassService');
  const S = mongoose.model('LmsLiveSession');
  const batches = await mongoose.model('Batch').find({ removed: false }).select('_id name').lean();

  console.log(`${APPLY ? 'APPLYING' : 'DRY RUN'} — ${batches.length} batch(es)\n`);

  for (const b of batches) {
    const before = await sequencingReport(S, b);
    let renumbered = 0;
    let renamed = 0;

    if (APPLY) {
      renumbered = await svc.renumberBatchSessions(b._id, b.name);
      const r = await svc.resyncBatchRecordingNames(b._id);
      renamed = r.updated;
    }

    const after = APPLY ? await sequencingReport(S, b) : before;
    console.log(`  ${b.name}`);
    console.log(`    sessions            : ${before.total}`);
    console.log(`    duplicate class nos : ${before.duplicates.length ? before.duplicates.join(', ') : 'none'}` + (APPLY ? ` -> ${after.duplicates.length ? after.duplicates.join(', ') : 'none'}` : ''));
    console.log(`    out of date order   : ${before.outOfOrder}` + (APPLY ? ` -> ${after.outOfOrder}` : ''));
    if (APPLY) {
      console.log(`    renumbered          : ${renumbered}`);
      console.log(`    recordings renamed  : ${renamed}`);
    }
  }

  if (!APPLY) console.log('\nNothing written. Re-run with --apply.');

  await mongoose.disconnect();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
