/* Follow-up to backfillHistoricalBatches.cjs: that script's own poll loop
 * returned as soon as a batch had ANY sessions, then (once all 3 batches
 * were handled) called process.exit(0) — which killed the still-in-flight
 * background session-generation chains for all 3 batches mid-way, leaving
 * each with only a partial run of dates instead of the full 6-month span.
 *
 * This fixes it the safe way: liveClassService.regenerateForBatch() is
 * gap-fill only (recurrence.js's generateForBatch with force:true) — it
 * cancels only the leftover un-started 'scheduled' rows (no actualStart) and
 * recreates the full date range from scratch, while any row that already
 * has actualStart set (the ones already marked 'ended' by the first script)
 * is left completely alone. Awaited directly here (no detached promise, no
 * early process.exit) so it can't get cut off again.
 *
 * Usage (from backend/):  node scripts/fixPartialBackfill.cjs
 */
const path = require('path');
const mongoose = require('mongoose');
const { globSync } = require('glob');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const NAMES = ['July 2026 6 to 7:30 PM', 'July 2026 8 to 9:30 PM', 'Aug 2026 4 to 5:30 PM'];

(async () => {
  await mongoose.connect(process.env.DATABASE);
  require('../src/config/multiDb').installMultiDbRouting();
  for (const f of globSync(path.join(__dirname, '..', 'src', 'models', '**', '*.js'))) require(path.resolve(f));

  const Batch = mongoose.model('Batch');
  const LmsLiveSession = mongoose.model('LmsLiveSession');
  const { liveClassService } = require('../src/services/lms');

  for (const name of NAMES) {
    const batch = await Batch.findOne({ name, removed: false });
    if (!batch) {
      console.log(name, '| NOT FOUND, skipping');
      continue;
    }
    const before = await LmsLiveSession.countDocuments({ batch: batch._id, removed: false });
    const result = await liveClassService.regenerateForBatch(batch._id);
    const after = await LmsLiveSession.countDocuments({ batch: batch._id, removed: false });
    console.log(name, '| before:', before, '| newly created:', result && result.result && result.result.created, '| after:', after);

    // re-run the "mark already-past sessions ended" pass — the gap-fill may
    // have created fresh rows for dates that are themselves already past
    // (recreated in place of the cancelled leftovers from the old run).
    const now = new Date();
    const endedRes = await LmsLiveSession.updateMany(
      { batch: batch._id, removed: false, status: { $in: ['scheduled', 'upcoming'] }, scheduledEnd: { $lt: now } },
      [{ $set: { status: 'ended', actualStart: '$scheduledStart', actualEnd: '$scheduledEnd' } }]
    );
    console.log('  marked ended (this pass):', endedRes.modifiedCount);
  }

  console.log('Done.');
  process.exit(0);
})().catch((e) => {
  console.error('ERR', e);
  process.exit(1);
});
