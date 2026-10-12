const mongoose = require('mongoose');

// One organisation-wide holiday, defined as a RULE rather than a date, so a
// single row covers every year instead of needing the list re-entered each
// January. services/lms/holidayCalendar.js turns these into actual dates,
// and recurrence.js skips those dates when generating a batch's classes.
//
// Three kinds, because India's public holidays genuinely fall into three
// different categories and pretending otherwise is how you end up scheduling
// a class on Diwali:
//
//   fixed      Same calendar date every year — Republic Day (26 Jan),
//              Independence Day (15 Aug), Gandhi Jayanti (2 Oct),
//              Christmas (25 Dec). Exact for any year, forever.
//
//   goodFriday Two days before Easter Sunday. Easter has an exact closed-form
//              algorithm (the Gregorian Computus), so this is also exact for
//              any year — it just isn't a fixed date.
//
//   lunar      Holi, Dussehra, Diwali (Hindu lunisolar) and Id-ul-Fitr
//              (Islamic lunar). These have NO arithmetic formula: the first
//              three need panchang tithi calculations from an ephemeris, and
//              Id-ul-Fitr is fixed locally by moon sighting and announced
//              each year. So they are stored as an explicit date per year in
//              `dates`, and a year with no entry is reported as missing
//              rather than guessed.
const yearDateSchema = new mongoose.Schema(
  {
    year: { type: Number, required: true },
    date: { type: String, required: true }, // "YYYY-MM-DD", IST calendar day

    // false = seeded from a published almanac but nobody here has checked it
    // against the official holiday list yet. Still used for scheduling (a
    // probably-right Diwali beats a class on Diwali), but surfaced in the
    // admin screen so it can be confirmed or corrected before the year
    // starts. The dates taken from the company's own 2026 holiday sheet are
    // confirmed from the outset.
    confirmed: { type: Boolean, default: false },

    confirmedBy: { type: mongoose.Schema.ObjectId, ref: 'Admin' },
    confirmedAt: { type: Date },
  },
  { _id: false }
);

const schema = new mongoose.Schema({
  removed: { type: Boolean, default: false },
  enabled: { type: Boolean, default: true },

  name: { type: String, required: true }, // "Diwali (Deepavali)"
  // Stable id used by the seeder so re-running it updates rather than
  // duplicates, and so a rename never orphans a rule's year data.
  key: { type: String, required: true, unique: true, index: true }, // "diwali"

  kind: { type: String, enum: ['fixed', 'goodFriday', 'lunar'], required: true },

  // kind 'fixed' only.
  month: { type: Number, min: 1, max: 12 },
  day: { type: Number, min: 1, max: 31 },

  // kind 'lunar' only.
  dates: { type: [yearDateSchema], default: [] },

  order: { type: Number, default: 0 },
  created: { type: Date, default: Date.now },
  updated: { type: Date, default: Date.now },
});

module.exports = mongoose.model('HolidayRule', schema);
