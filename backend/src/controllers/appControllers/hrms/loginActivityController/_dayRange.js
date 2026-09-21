// Local-day [start, end) boundaries for a given date string (or today if
// omitted) — shared by summary.js and detail.js.
function dayRange(dateStr) {
  const base = dateStr ? new Date(dateStr) : new Date();
  const start = new Date(base.getFullYear(), base.getMonth(), base.getDate(), 0, 0, 0, 0);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { start, end };
}

function isSameDayAsToday(dateStr) {
  if (!dateStr) return true;
  return dayRange(dateStr).start.toDateString() === new Date().toDateString();
}

module.exports = { dayRange, isSameDayAsToday };
