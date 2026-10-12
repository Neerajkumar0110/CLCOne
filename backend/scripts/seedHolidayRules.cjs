/* Seed / refresh the organisation-wide LMS holiday calendar
 * (models/appModels/lms/HolidayRule.js + services/lms/holidayCalendar.js).
 *
 * Idempotent and keyed on `key`, so re-running it updates the rules in place
 * and never duplicates them. It also never overwrites a year a human has
 * already confirmed — re-running after someone corrects a Diwali date leaves
 * their correction alone.
 *
 * Usage (from backend/):
 *   node scripts/seedHolidayRules.cjs             (dry run — reports only)
 *   node scripts/seedHolidayRules.cjs --apply     (writes)
 *   node scripts/seedHolidayRules.cjs --apply --regenerate
 *       ...and rebuilds every batch's future schedule so the new holidays
 *       actually take effect on classes that are already on the calendar.
 *       Only future, never-started sessions are touched (see
 *       liveClassService.regenerateForBatch).
 */
const path = require('path');
const mongoose = require('mongoose');
const { globSync } = require('glob');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
require('dotenv').config({ path: path.join(__dirname, '..', '.env.local') });

const APPLY = process.argv.includes('--apply');
const REGENERATE = process.argv.includes('--regenerate');

// 2026 comes from the company's own published "Holiday List 2026" sheet, so
// every 2026 date is confirmed from the start.
//
// 2027-2035 for the lunar holidays are the widely-published almanac dates.
// They are seeded UNCONFIRMED on purpose: Holi/Dussehra/Diwali depend on
// panchang tithi and Id-ul-Fitr on local moon sighting, so they must be
// checked against the official holiday list for that year before anyone
// relies on them. They are a TABLE on purpose: the astronomy (new/full
// moon) is computable to the minute, but the festival date depends on
// which tithi is running at local sunrise, and on adhik maas. A naive
// "full moon + 1" rule was tested against five known years and landed a
// day out on most of them and a month out on Dussehra 2028 — wrong
// enough to cancel classes on the wrong day, so it is not used.
// relies on them. The admin holiday screen lists every unconfirmed year.
const RULES = [
  { key: 'republic-day', name: 'Republic Day', kind: 'fixed', month: 1, day: 26, order: 1 },
  {
    key: 'holi',
    name: 'Holi',
    kind: 'lunar',
    order: 2,
    dates: [
      { year: 2026, date: '2026-03-04', confirmed: true },
      { year: 2027, date: '2027-03-22' },
      { year: 2028, date: '2028-03-11' },
      { year: 2029, date: '2029-03-01' },
      { year: 2030, date: '2030-03-20' },
      { year: 2031, date: '2031-03-09' },
      { year: 2032, date: '2032-02-27' },
      { year: 2033, date: '2033-03-16' },
      { year: 2034, date: '2034-03-05' },
      { year: 2035, date: '2035-03-24' },
    ],
  },
  {
    key: 'id-ul-fitr',
    name: 'Id-ul-Fitr',
    kind: 'lunar',
    order: 3,
    dates: [
      { year: 2026, date: '2026-03-21', confirmed: true },
      { year: 2027, date: '2027-03-10' },
      { year: 2028, date: '2028-02-27' },
      { year: 2029, date: '2029-02-15' },
      { year: 2030, date: '2030-02-05' },
      { year: 2031, date: '2031-01-25' },
      { year: 2032, date: '2032-01-15' },
      { year: 2033, date: '2033-01-03' },
      { year: 2034, date: '2034-12-12' },
      { year: 2035, date: '2035-12-02' },
    ],
  },
  { key: 'good-friday', name: 'Good Friday', kind: 'goodFriday', order: 4 },
  { key: 'independence-day', name: 'Independence Day', kind: 'fixed', month: 8, day: 15, order: 5 },
  { key: 'gandhi-jayanti', name: 'Gandhi Jayanti', kind: 'fixed', month: 10, day: 2, order: 6 },
  {
    key: 'dussehra',
    name: 'Dussehra (Vijay Dashmi)',
    kind: 'lunar',
    order: 7,
    dates: [
      { year: 2026, date: '2026-10-20', confirmed: true },
      { year: 2027, date: '2027-10-09' },
      { year: 2028, date: '2028-09-27' },
      { year: 2029, date: '2029-10-16' },
      { year: 2030, date: '2030-10-06' },
      { year: 2031, date: '2031-09-26' },
      { year: 2032, date: '2032-10-14' },
      { year: 2033, date: '2033-10-02' },
      { year: 2034, date: '2034-10-21' },
      { year: 2035, date: '2035-10-11' },
    ],
  },
  {
    key: 'diwali',
    name: 'Diwali (Deepavali)',
    kind: 'lunar',
    order: 8,
    dates: [
      { year: 2026, date: '2026-11-08', confirmed: true },
      { year: 2027, date: '2027-10-29' },
      { year: 2028, date: '2028-10-17' },
      { year: 2029, date: '2029-11-05' },
      { year: 2030, date: '2030-10-26' },
      { year: 2031, date: '2031-10-15' },
      { year: 2032, date: '2032-11-02' },
      { year: 2033, date: '2033-10-22' },
      { year: 2034, date: '2034-11-10' },
      { year: 2035, date: '2035-10-30' },
    ],
  },
  { key: 'christmas', name: 'Christmas Day', kind: 'fixed', month: 12, day: 25, order: 9 },
];

(async () => {
  if (!process.env.DATABASE) {
    console.error('DATABASE env var is not set — nothing to seed.');
    process.exit(1);
  }
  await mongoose.connect(process.env.DATABASE);
  require('../src/config/multiDb').installMultiDbRouting();
  const files = globSync(path.join(__dirname, '..', 'src', 'models', '**', '*.js').split(String.fromCharCode(92)).join('/'));
  for (const f of files) require(path.resolve(f));

  const HolidayRule = mongoose.model('HolidayRule');
  let created = 0;
  let updated = 0;
  let keptConfirmed = 0;

  for (const spec of RULES) {
    const existing = await HolidayRule.findOne({ key: spec.key });

    if (spec.kind === 'lunar') {
      // Merge year by year so a date someone already confirmed survives.
      const byYear = new Map((existing ? existing.dates : []).map((d) => [d.year, d]));
      for (const incoming of spec.dates) {
        const prior = byYear.get(incoming.year);
        if (prior && prior.confirmed) {
          keptConfirmed += 1;
          continue;
        }
        byYear.set(incoming.year, { ...incoming, confirmed: !!incoming.confirmed });
      }
      spec.dates = [...byYear.values()].sort((a, b) => a.year - b.year);
    }

    if (!existing) {
      created += 1;
      if (APPLY) await HolidayRule.create({ ...spec, updated: new Date() });
    } else {
      updated += 1;
      if (APPLY) await HolidayRule.updateOne({ _id: existing._id }, { $set: { ...spec, updated: new Date() } });
    }
  }

  console.log(`${APPLY ? 'Applied' : 'Dry run'}: ${created} rule(s) to create, ${updated} to update, ${keptConfirmed} already-confirmed year(s) left untouched.`);

  if (APPLY) {
    const { holidaysForYear } = require('../src/services/lms/holidayCalendar');
    for (const year of [2026, 2027, 2028]) {
      const { holidays, missing, unconfirmed } = await holidaysForYear(year);
      console.log(`\n${year} — ${holidays.length} holidays` + (missing.length ? `, ${missing.length} MISSING` : '') + (unconfirmed.length ? `, ${unconfirmed.length} unconfirmed` : ''));
      for (const h of holidays) console.log(`  ${h.date}  ${h.confirmed ? ' ' : '?'} ${h.name}`);
      for (const m of missing) console.log(`  (no date)   ! ${m.name}`);
    }
  }

  if (APPLY && REGENERATE) {
    const Batch = mongoose.model('Batch');
    const liveClassService = require('../src/services/lms/liveClassService');
    const batches = await Batch.find({ removed: false }).select('_id name').lean();
    console.log(`\nRegenerating future schedules for ${batches.length} batch(es)…`);
    for (const b of batches) {
      const r = await liveClassService.regenerateForBatch(b._id).catch((e) => ({ error: e.message }));
      console.log(`  ${b.name}: ${r && r.result ? `${r.result.created} session(s) regenerated` : `failed — ${r && (r.message || r.error)}`}`);
    }
  } else if (APPLY) {
    console.log('\nRules saved. Existing batch schedules are NOT changed — re-run with --regenerate to rebuild them.');
  }

  await mongoose.disconnect();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
