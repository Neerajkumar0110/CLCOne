#!/usr/bin/env node
/*
 * Spec §18 restore drill, verify step. deploy/vps/restore-drill.sh first
 * restores the latest backup archive of each database into a scratch
 * database named "<db>__restore_drill"; this script then compares every
 * collection's document count against the live database, drops the scratch
 * databases and reports the result to Admin & Ops → Evidence.
 *
 *   node scripts/restoreDrill.cjs lmsDb coreDb
 *   node scripts/restoreDrill.cjs --keep lmsDb        (leave the scratch DB for inspection)
 *
 * Safety: it only ever drops a database whose name ends in "__restore_drill";
 * live databases are only read (countDocuments). A live collection may grow
 * between backup and drill, so restored >= 98% of live (or within 50 docs)
 * counts as a match; a restored collection that is missing or empty while
 * live has data is a failure.
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const mongoose = require('mongoose');
const { report } = require('./opsReport.cjs');

const SUFFIX = '__restore_drill';

function matches(live, restored) {
  if (live === 0) return true;
  if (restored === 0) return false;
  return restored >= live * 0.98 || live - restored <= 50;
}

async function verifyOne(db, keep) {
  const liveDb = mongoose.connection.useDb(db, { useCache: true }).db;
  const drillName = `${db}${SUFFIX}`;
  const drillDb = mongoose.connection.useDb(drillName, { useCache: true }).db;
  const liveCols = (await liveDb.listCollections({}, { nameOnly: true }).toArray()).map((c) => c.name).filter((n) => !n.startsWith('system.'));
  const drillCols = new Set((await drillDb.listCollections({}, { nameOnly: true }).toArray()).map((c) => c.name));
  const bad = [];
  let docs = 0;
  for (const name of liveCols) {
    // eslint-disable-next-line no-await-in-loop
    const live = await liveDb.collection(name).estimatedDocumentCount();
    // eslint-disable-next-line no-await-in-loop
    const restored = drillCols.has(name) ? await drillDb.collection(name).countDocuments() : 0;
    docs += restored;
    if (!matches(live, restored)) bad.push(`${name} live ${live} vs restored ${restored}`);
  }
  if (!keep) {
    if (!drillName.endsWith(SUFFIX)) throw new Error(`refusing to drop ${drillName}`);
    await drillDb.dropDatabase();
  }
  return { db, collections: liveCols.length, docs, bad };
}

async function main() {
  const args = process.argv.slice(2);
  const keep = args.includes('--keep');
  const dbs = args.filter((a) => !a.startsWith('--'));
  if (!dbs.length) throw new Error('name at least one database, e.g. lmsDb');
  if (dbs.some((d) => d.endsWith(SUFFIX) || !/^[A-Za-z0-9_-]+$/.test(d))) throw new Error('pass the live database names (lmsDb, coreDb, ...)');
  await mongoose.connect(process.env.DATABASE);
  const started = Date.now();
  const results = [];
  try {
    for (const db of dbs) results.push(await verifyOne(db, keep)); // eslint-disable-line no-await-in-loop
    const bad = results.flatMap((r) => r.bad.map((b) => `${r.db}.${b}`));
    const ok = bad.length === 0;
    const summary = ok
      ? `${results.map((r) => `${r.db} ${r.collections} cols / ${r.docs} docs`).join(' · ')} restored and matched · ${Math.round((Date.now() - started) / 1000)}s`
      : `${bad.length} mismatch: ${bad.slice(0, 3).join('; ')}`;
    await report('restoreDrill', ok, summary, { dbs, mismatches: bad.slice(0, 20) });
    console.log(`[restore-drill] ${ok ? 'OK' : 'FAILED'} · ${summary}`);
    if (!ok) process.exitCode = 2;
  } finally {
    await mongoose.disconnect();
  }
}

if (require.main === module) {
  main().catch(async (e) => {
    console.error('[restore-drill] failed:', e.message);
    try {
      await report('restoreDrill', false, e.message);
    } catch (_) {
      /* report best-effort */
    }
    process.exit(1);
  });
}

module.exports = { matches, SUFFIX };
