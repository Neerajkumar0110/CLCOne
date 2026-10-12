const mongoose = require('mongoose');
const { holidaysForYear } = require('../../../../services/lms/holidayCalendar');

// Organisation-wide LMS holiday calendar — the dates on which no batch gets
// a class generated (services/lms/recurrence.js). Manager-only; the routes
// already gate that.
//
//  GET  /api/lms/admin/holidays?year=2027
//  POST /api/lms/admin/holidays/:key   { year, date?, confirmed? }
//
// See models/appModels/lms/HolidayRule.js for why some holidays are rules
// and others are a date per year.

const ok = (res, result, message) => res.status(200).json({ success: true, result, message });
const bad = (res, code, message) => res.status(code).json({ success: false, result: null, message });

async function list(req, res) {
  const now = new Date().getFullYear();
  const year = Number(req.query.year) || now;
  if (year < 2000 || year > 2100) return bad(res, 400, 'Year out of range.');

  // A few years either side so the screen can show which ones still need
  // confirming without a request per year.
  const span = [];
  for (let y = year; y <= year + 4; y += 1) {
    // eslint-disable-next-line no-await-in-loop
    const r = await holidaysForYear(y);
    span.push({ year: y, unconfirmed: r.unconfirmed.length, missing: r.missing.length });
  }

  const current = await holidaysForYear(year);
  return ok(res, { ...current, span }, 'ok');
}

// Set or confirm one holiday's date for one year.
//
// Only meaningful for a `lunar` rule: a fixed date and Good Friday are
// derived, always correct, and have nothing to store or confirm.
async function setYear(req, res) {
  const HolidayRule = mongoose.model('HolidayRule');
  const b = req.body || {};
  const year = Number(b.year);
  if (!year || year < 2000 || year > 2100) return bad(res, 400, 'A valid year is required.');

  const rule = await HolidayRule.findOne({ key: req.params.key, removed: false });
  if (!rule) return bad(res, 404, 'Holiday not found.');
  if (rule.kind !== 'lunar') {
    return bad(res, 400, `${rule.name} is calculated automatically for every year — there is nothing to set.`);
  }

  if (b.date !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(String(b.date))) {
    return bad(res, 400, 'Date must be in YYYY-MM-DD format.');
  }
  if (b.date !== undefined && String(b.date).slice(0, 4) !== String(year)) {
    return bad(res, 400, `That date is not in ${year}.`);
  }

  const entry = rule.dates.find((d) => d.year === year);
  if (!entry && b.date === undefined) return bad(res, 400, `No date stored for ${year} yet — send one.`);

  if (entry) {
    if (b.date !== undefined) entry.date = b.date;
    if (b.confirmed !== undefined) {
      entry.confirmed = !!b.confirmed;
      entry.confirmedBy = b.confirmed ? req.admin._id : undefined;
      entry.confirmedAt = b.confirmed ? new Date() : undefined;
    }
  } else {
    rule.dates.push({
      year,
      date: b.date,
      confirmed: !!b.confirmed,
      confirmedBy: b.confirmed ? req.admin._id : undefined,
      confirmedAt: b.confirmed ? new Date() : undefined,
    });
  }
  rule.dates.sort((a, c) => a.year - c.year);
  rule.updated = new Date();
  await rule.save();

  // Changing a holiday date does NOT rebuild anyone's schedule on its own —
  // that cancels and recreates every future class and is far too blunt to do
  // behind a checkbox. The screen offers it as an explicit, separate action.
  return ok(res, await holidaysForYear(year), 'Saved. Rebuild batch schedules to apply it to classes already on the calendar.');
}

module.exports = { list, setYear };
