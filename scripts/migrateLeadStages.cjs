/* One-off migration to the stage + sub-status pipeline
 * (see src/config/leadStages.js).
 *
 *   • Legacy 5-value status  ->  { stage, subStatus }
 *       New       -> New Lead / Newly Generated
 *       Contacted -> Contacted / First Contact Done
 *       Qualified -> Interested / Workshop Prospect
 *       Won       -> Enrolled / Registration Done
 *       Lost      -> Not Interested / Price Too High
 *   • Any lead missing `stage` gets stage/subStatus derived from its
 *     current `status` string (handles combined values written by an
 *     earlier build too).
 *   • `status` is rewritten to the canonical "<stage> - <subStatus>" form.
 *   • `stageUpdatedAt` is backfilled from `updated` / `created` when absent.
 *
 * Idempotent — safe to run repeatedly.
 *
 * Usage (from backend/):  node scripts/migrateLeadStages.cjs
 */
const path = require('path');
const mongoose = require('mongoose');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
require('dotenv').config({ path: path.join(__dirname, '..', '.env.local') });

const { resolveStageSub, statusLabel } = require('../src/config/leadStages');

(async () => {
  if (!process.env.DATABASE) {
    console.error('DATABASE env var is not set — nothing to migrate.');
    process.exit(1);
  }

  await mongoose.connect(process.env.DATABASE);
  require('../src/models/appModels/Lead');
  const Lead = mongoose.model('Lead');

  const cursor = Lead.find({}).cursor();
  let scanned = 0;
  let changed = 0;

  for (let doc = await cursor.next(); doc != null; doc = await cursor.next()) {
    scanned += 1;
    const r = resolveStageSub({
      stage: doc.stage,
      subStatus: doc.subStatus,
      status: doc.stage ? undefined : doc.status,
    });
    const canonical = statusLabel(r.stage, r.subStatus);

    const set = {};
    if (doc.stage !== r.stage) set.stage = r.stage;
    if (doc.subStatus !== r.subStatus) set.subStatus = r.subStatus;
    if (doc.status !== canonical) set.status = canonical;
    if (!doc.stageUpdatedAt) set.stageUpdatedAt = doc.updated || doc.created || new Date();

    if (Object.keys(set).length > 0) {
      await Lead.updateOne({ _id: doc._id }, { $set: set });
      changed += 1;
    }
  }

  console.log(`Scanned ${scanned} lead(s), migrated ${changed}.`);
  await mongoose.disconnect();
  process.exit(0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
