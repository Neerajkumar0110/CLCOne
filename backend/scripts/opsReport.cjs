#!/usr/bin/env node
/*
 * Spec §18 / §20 ops evidence: records the outcome of a backup, restore
 * drill or load test where LMS → Admin & Ops → Evidence shows it
 * (LmsAdminConfig keys ops:backup / ops:restoreDrill / ops:loadTest, read
 * by GET /api/lms/admin/sm/ops-status). Writes nothing else.
 *
 *   node scripts/opsReport.cjs backup ok "7 DBs + uploads · 412 MB"
 *   node scripts/opsReport.cjs restoreDrill fail "count mismatch in lmsDb.tickets"
 *
 * Also used as a module by restoreDrill.cjs / loadTest.cjs: report(kind, ok, summary, extra).
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const mongoose = require('mongoose');
const { DB_MAP } = require('../src/config/multiDb');

const KINDS = { backup: 'ops:backup', restoreDrill: 'ops:restoreDrill', loadTest: 'ops:loadTest' };

async function report(kind, ok, summary, extra = {}) {
  const key = KINDS[kind];
  if (!key) throw new Error(`kind must be one of ${Object.keys(KINDS).join(', ')}`);
  const own = mongoose.connection.readyState !== 1;
  if (own) await mongoose.connect(process.env.DATABASE);
  try {
    const value = { ok: !!ok, summary: String(summary || '').slice(0, 300), at: new Date(), host: require('os').hostname(), ...extra };
    await mongoose.connection
      .useDb(DB_MAP.LmsAdminConfig, { useCache: true })
      .collection('lmsadminconfigs')
      .updateOne(
        { key },
        { $set: { key, value, updatedByName: `ops script (${kind})`, updated: new Date() }, $push: { history: { $each: [{ at: new Date(), byName: 'ops script', note: value.summary, value }], $slice: -50 } } },
        { upsert: true }
      );
    return value;
  } finally {
    if (own) await mongoose.disconnect();
  }
}

if (require.main === module) {
  const [kind, status, ...rest] = process.argv.slice(2);
  report(kind, status === 'ok', rest.join(' '))
    .then((v) => console.log(`[ops] ${kind}: ${v.ok ? 'OK' : 'FAILED'} · ${v.summary}`))
    .catch((e) => {
      console.error('[ops] report failed:', e.message);
      process.exit(1);
    });
}

module.exports = { report };
