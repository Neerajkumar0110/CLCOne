const mongoose = require('mongoose');

// Turns the organisation-wide HolidayRule rows into actual dates for a given
// year, for recurrence.js (skip these days when generating a batch's
// classes) and for the admin holiday screen.
//
// See models/appModels/lms/HolidayRule.js for why there are three rule kinds
// — the short version is that only some Indian public holidays can be
// derived arithmetically, and the rest have to be stored per year.

// Gregorian Computus. Returns Easter Sunday for `year` as a UTC date.
//
// This is Meeus/Jones/Butcher — the standard closed form, exact for every
// Gregorian year, no table and no astronomy needed. Good Friday is simply
// two days earlier.
function easterSunday(year) {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(year, month - 1, day));
}

const iso = (d) => d.toISOString().slice(0, 10);

function goodFriday(year) {
  const d = easterSunday(year);
  d.setUTCDate(d.getUTCDate() - 2);
  return iso(d);
}

const pad = (n) => String(n).padStart(2, '0');

// Resolve one rule for one year, or null when it cannot be known.
function dateForRule(rule, year) {
  if (rule.kind === 'fixed') {
    if (!rule.month || !rule.day) return null;
    return { date: `${year}-${pad(rule.month)}-${pad(rule.day)}`, confirmed: true, derived: true };
  }
  if (rule.kind === 'goodFriday') {
    return { date: goodFriday(year), confirmed: true, derived: true };
  }
  // lunar — only what was entered for this specific year.
  const hit = (rule.dates || []).find((x) => x.year === year);
  if (!hit) return null;
  return { date: hit.date, confirmed: !!hit.confirmed, derived: false };
}

// Every holiday for one year, oldest first.
//
// `missing` lists the lunar rules that have no date stored for this year —
// those days WILL get classes scheduled on them, so the admin screen shows
// this prominently rather than letting the year quietly go uncovered.
async function holidaysForYear(year) {
  const HolidayRule = mongoose.model('HolidayRule');
  const rules = await HolidayRule.find({ removed: false, enabled: true }).sort({ order: 1 }).lean();

  const holidays = [];
  const missing = [];
  for (const rule of rules) {
    const resolved = dateForRule(rule, year);
    if (!resolved) {
      missing.push({ key: rule.key, name: rule.name });
      continue;
    }
    holidays.push({ key: rule.key, name: rule.name, kind: rule.kind, ...resolved });
  }
  holidays.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return { year, holidays, missing, unconfirmed: holidays.filter((h) => !h.confirmed) };
}

// Flat Set of "YYYY-MM-DD" across a span of years — what recurrence.js needs.
//
// A batch's schedule routinely runs 6+ months and can cross a year boundary,
// so callers pass the whole span they are generating rather than one year.
async function holidayDateSet(fromYear, toYear) {
  const set = new Set();
  for (let y = fromYear; y <= toYear; y += 1) {
    // eslint-disable-next-line no-await-in-loop
    const { holidays } = await holidaysForYear(y);
    for (const h of holidays) set.add(h.date);
  }
  return set;
}

module.exports = { easterSunday, goodFriday, dateForRule, holidaysForYear, holidayDateSet };
