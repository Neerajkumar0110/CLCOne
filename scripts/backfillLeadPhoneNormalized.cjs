/* eslint-disable no-console */
// One-off backfill: populate Lead.phoneNormalized (last 10 digits of phone)
// for every existing lead so the bulk-import dedupe query can use the index
// instead of scanning the whole collection.
//
//   node scripts/backfillLeadPhoneNormalized.cjs            # apply
//   node scripts/backfillLeadPhoneNormalized.cjs --dry-run  # count only
//
// Idempotent and safe to re-run. Additive — only sets a new field.
// Reads/writes only the `leads` collection.

require('module-alias/register');
const path = require('path');
const mongoose = require('mongoose');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
require('dotenv').config({ path: path.join(__dirname, '..', '.env.local') });

const DRY = process.argv.includes('--dry-run') || process.argv.includes('-n');

const norm = (p) => {
  const d = String(p == null ? '' : p).replace(/\D/g, '');
  return d.length > 10 ? d.slice(-10) : d;
};

(async () => {
  if (!process.env.DATABASE) {
    console.error('DATABASE env var is not set (backend/.env). Aborting.');
    process.exit(1);
  }
  require('../src/models/appModels/Lead');
  await mongoose.connect(process.env.DATABASE, { serverSelectionTimeoutMS: 10000 });
  const Lead = mongoose.model('Lead');
  console.log(`connected: ${mongoose.connection.name}${DRY ? '   (DRY RUN)' : ''}`);

  // only rows that don't have the field yet (or have it stale/empty but a phone exists)
  const filter = {
    $or: [
      { phoneNormalized: { $exists: false } },
      { phoneNormalized: null },
      { phoneNormalized: '' },
    ],
  };
  const total = await Lead.countDocuments(filter);
  console.log(`${total} lead(s) need phoneNormalized`);
  if (DRY || total === 0) {
    await mongoose.disconnect();
    process.exit(0);
  }

  const cursor = Lead.find(filter).select('phone').lean().cursor();
  let ops = [];
  let done = 0;
  let set = 0;

  const flush = async () => {
    if (!ops.length) return;
    await Lead.bulkWrite(ops, { ordered: false });
    ops = [];
  };

  for (let doc = await cursor.next(); doc; doc = await cursor.next()) {
    const n = norm(doc.phone);
    ops.push({
      updateOne: {
        filter: { _id: doc._id },
        update: { $set: { phoneNormalized: n || '' } },
      },
    });
    if (n) set += 1;
    done += 1;
    if (ops.length >= 2000) {
      await flush();
      process.stdout.write(`\r  ${done}/${total}`);
    }
  }
  await flush();
  console.log(`\ndone — ${done} processed, ${set} got a non-empty phoneNormalized`);

  await mongoose.disconnect();
  process.exit(0);
})().catch((e) => {
  console.error('\nBACKFILL FAILED:', e);
  process.exit(2);
});
