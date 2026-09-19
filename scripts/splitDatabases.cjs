// One-off backfill: copies every collection from the current single
// database into its target per-module database (salesDb, marketingDb,
// lmsDb, financeDb, hrmsDb, operationDb, coreDb), per config/multiDb.js's
// DB_MAP. Uses MongoDB's server-side `$merge` aggregation stage, so nothing
// is streamed through this process — the copy happens entirely on the
// Atlas cluster. This is purely additive: the SOURCE database (whatever
// `DATABASE` in .env currently points at) is only read, never modified or
// dropped, so it's safe to run before cutting the app over to the new
// per-module routing.
//
// Usage: node scripts/splitDatabases.cjs [--verify-only]
//
// Run --verify-only any time after a copy to re-check document counts
// without copying again (safe to re-run the copy itself too — $merge
// replaces matching documents by _id, so it's idempotent).

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const mongoose = require('mongoose');
const path = require('path');
const { globSync } = require('glob');

const VERIFY_ONLY = process.argv.includes('--verify-only');

async function main() {
  if (!process.env.DATABASE) {
    throw new Error('DATABASE is not set in backend/.env');
  }

  await mongoose.connect(process.env.DATABASE);
  const sourceDbName = mongoose.connection.db.databaseName;
  console.log(`Source database: ${sourceDbName}`);

  // Register every model on the DEFAULT connection (no multiDb patch here
  // — this script deliberately runs against the still-single source
  // database to read from it, and needs each model's real `.collection.name`).
  const modelFiles = globSync(path.join(__dirname, '../src/models/**/*.js'));
  for (const filePath of modelFiles) {
    require(path.resolve(filePath));
  }

  // Just reads DB_MAP — does NOT call installMultiDbRouting(), so models
  // stay registered on the plain default connection (pointed at the
  // source database) for this script's own reads.
  const { DB_MAP } = require('../src/config/multiDb');

  // Group by target database, resolving each model name to its REAL
  // collection name (not a guessed pluralization) via the now-registered model.
  const byTargetDb = {};
  for (const [modelName, targetDb] of Object.entries(DB_MAP)) {
    const Model = mongoose.model(modelName);
    const collName = Model.collection.name;
    (byTargetDb[targetDb] ||= []).push({ modelName, collName });
  }

  const db = mongoose.connection.db;

  if (!VERIFY_ONLY) {
    for (const [targetDb, entries] of Object.entries(byTargetDb)) {
      console.log(`\n== Copying into ${targetDb} (${entries.length} collections) ==`);
      for (const { modelName, collName } of entries) {
        const before = await db.collection(collName).countDocuments();
        if (before === 0) {
          console.log(`  ${collName.padEnd(28)} (0 docs, skipped)`);
          continue;
        }
        await db
          .collection(collName)
          .aggregate([
            {
              $merge: {
                into: { db: targetDb, coll: collName },
                whenMatched: 'replace',
                whenNotMatched: 'insert',
              },
            },
          ])
          .toArray();
        console.log(`  ${collName.padEnd(28)} ${before} docs copied`);
      }
    }
  }

  // ---- Verification: compare counts source vs target, per collection ----
  console.log('\n== Verification (source vs target document counts) ==');
  let allOk = true;
  for (const [targetDb, entries] of Object.entries(byTargetDb)) {
    const targetConn = mongoose.connection.useDb(targetDb, { useCache: true });
    for (const { collName } of entries) {
      const sourceCount = await db.collection(collName).countDocuments();
      const targetCount = await targetConn.db.collection(collName).countDocuments();
      const ok = sourceCount === targetCount;
      if (!ok) allOk = false;
      console.log(
        `  ${ok ? 'OK  ' : 'FAIL'} ${targetDb.padEnd(12)} ${collName.padEnd(28)} source=${sourceCount} target=${targetCount}`
      );
    }
  }

  console.log(allOk ? '\nAll collections match. ✅' : '\nSome collections DO NOT match — see FAIL rows above. ❌');
  process.exit(allOk ? 0 : 1);
}

main().catch((err) => {
  console.error('Migration script failed:', err);
  process.exit(1);
});
