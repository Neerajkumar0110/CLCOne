// IST time-of-day helpers for the Instant Lead Pool's fixed shift schedule
// (config/shiftSchedule.js) — kept separate from services/lms/recurrence.js
// (where the underlying IST math is borrowed from) since that module is
// LMS-coupled and this one is calling-coupled; both compute IST the same
// flat +5:30 way, independent of the process's own TZ.
const { istParts, IST_OFFSET_MS } = require('../lms/recurrence');
const shiftSchedule = require('../../config/shiftSchedule');

function istDateKey(d) {
  const p = istParts(d);
  return `${p.year}-${String(p.month + 1).padStart(2, '0')}-${String(p.date).padStart(2, '0')}`;
}

function istMinutesOfDay(d) {
  const ist = new Date(d.getTime() + IST_OFFSET_MS);
  return ist.getUTCHours() * 60 + ist.getUTCMinutes();
}

function parseHM(hm) {
  const [h, m] = String(hm).split(':').map(Number);
  return h * 60 + m;
}

// [start, end) in IST minutes-of-day.
function inWindow(d, start, end) {
  const mins = istMinutesOfDay(d);
  return mins >= parseHM(start) && mins < parseHM(end);
}

function isWithinJoinWindow(d) {
  return inWindow(d, shiftSchedule.joinWindow.start, shiftSchedule.joinWindow.end);
}

// The break (if any) whose offer-window `now` currently falls inside —
// regardless of whether this agent has already taken it; the caller
// decides what to do with that (leadPool.js's status endpoint marks it
// `taken` instead of omitting it, so the frontend can still show "Tea
// Break — already taken today" rather than nothing).
function activeBreakWindow(now) {
  return shiftSchedule.breaks.find((b) => inWindow(now, b.start, b.end)) || null;
}

module.exports = { istDateKey, istMinutesOfDay, parseHM, inWindow, isWithinJoinWindow, activeBreakWindow };
