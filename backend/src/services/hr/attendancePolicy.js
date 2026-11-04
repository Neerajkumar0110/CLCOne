const { attendancePolicy: P } = require('../../config/shiftSchedule');

// CLC-POL-001 attendance rules as pure functions (no database), used by the
// Sales 360° report (controllers/appControllers/hrms/sales360.js).

const LEVELS = { absent: 0, half: 1, full: 2 };
const NAMES = ['absent', 'half', 'full'];

const levelOf = (value, rule) => (value >= rule.full ? 'full' : value >= rule.half ? 'half' : 'absent');

// metrics: { verifiedProspects, attendedDemos, attempts, talkSec, dialerMin }
// The best qualifying route decides the day, capped by the dialer hours — the
// dialer rule can't be waived by doing well on another route (section 6.1).
function evaluateDay(metrics) {
  const routes = [
    { key: 'verifiedProspects', value: metrics.verifiedProspects || 0, level: levelOf(metrics.verifiedProspects || 0, P.routes.verifiedProspects) },
    { key: 'attendedDemos', value: metrics.attendedDemos || 0, level: levelOf(metrics.attendedDemos || 0, P.routes.attendedDemos) },
    { key: 'attempts', value: metrics.attempts || 0, level: levelOf(metrics.attempts || 0, P.routes.attempts) },
    { key: 'talkMin', value: Math.floor((metrics.talkSec || 0) / 60), level: levelOf((metrics.talkSec || 0) / 60, P.routes.talkMin) },
  ];
  const routeRank = Math.max(...routes.map((r) => LEVELS[r.level]));
  const dialerMin = metrics.dialerMin || 0;
  const cap = dialerMin >= P.dialer.fullMin ? 'full' : dialerMin >= P.dialer.halfMin ? 'half' : 'absent';
  const level = NAMES[Math.min(routeRank, LEVELS[cap])];
  return { level, routeLevel: NAMES[routeRank], cap, routes };
}

// Minutes of `spans` left after cutting out `holes` — both [{ start, end }] in
// milliseconds. Used for dialer time minus scheduled breaks and approved leave.
function spanMinutes(spans, holes = []) {
  let ms = 0;
  for (const s of spans) {
    const cuts = holes
      .map((h) => ({ start: Math.max(h.start, s.start), end: Math.min(h.end, s.end) }))
      .filter((h) => h.end > h.start)
      .sort((a, b) => a.start - b.start);
    let at = s.start;
    for (const c of cuts) {
      if (c.start > at) ms += c.start - at;
      at = Math.max(at, c.end);
    }
    if (s.end > at) ms += s.end - at;
  }
  return Math.floor(ms / 60000);
}

// Monday of a dayKey's calendar week ('YYYY-MM-DD').
function weekStart(dayKey) {
  const d = new Date(`${dayKey}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}

// overrunsByDay: { dayKey: count }. Section 9: the first overrun of a calendar
// week is a grace; two or more on one day is one event; any further overrun
// after the grace is one event. → { dayKey: { grace: boolean, events: 0 | 1 } }
function breakOverrunEvents(overrunsByDay) {
  const graceUsed = new Set();
  const out = {};
  for (const dayKey of Object.keys(overrunsByDay).sort()) {
    const n = overrunsByDay[dayKey];
    if (!n) continue;
    const week = weekStart(dayKey);
    if (n >= 2) {
      graceUsed.add(week);
      out[dayKey] = { grace: false, events: 1 };
    } else if (!graceUsed.has(week)) {
      graceUsed.add(week);
      out[dayKey] = { grace: true, events: 0 };
    } else out[dayKey] = { grace: false, events: 1 };
  }
  return out;
}

// Section 7: a miss carries forward, extra verified prospects clear it, a
// documented waiver takes it down. months: [{ period, target, achieved, waived }]
// oldest first → the backlog left after the last month.
function prospectBacklog(months) {
  return months.reduce((left, m) => Math.max(0, left + (m.target || 0) - (m.achieved || 0) - (m.waived || 0)), 0);
}

module.exports = { evaluateDay, spanMinutes, weekStart, breakOverrunEvents, prospectBacklog };
