// Fixed daily shift schedule for Sales agents working the Instant Lead
// Pool (see leadPool.js) — all times IST, 24h "HH:mm". One schedule for
// everyone for now; not per-agent configurable. Timings and attendance rules
// follow CLC-POL-001 (Sales Operations, Attendance & Employee Conduct Policy).
module.exports = {
  // The pool auto-joins an agent sometime in this window (see
  // leadPool.js's status endpoint + the frontend's auto-join check) —
  // start is when it first becomes eligible, end is just informational
  // (how late "on time" still counts), not a hard cutoff.
  joinWindow: { start: '10:30', end: '10:35' },

  targetWorkMinutes: 8 * 60,

  // Work-day frame for the header Login / leave flow (services/hr/workday.js).
  // autoStartAt: anyone in Sales who hasn't logged in by then is put on the
  // dialer anyway (jobs/workdayTick.js) — unless it's a holiday, their
  // weekly off, or they're on approved leave. Half-day leave splits the day
  // at halfSplit. weeklyOff uses JS day numbers (0 = Sunday).
  workday: { start: '10:30', end: '20:00', halfSplit: '15:00', autoStartAt: '10:35', weeklyOff: [0] },

  // `key` must be stable (used to dedupe "already took this break today").
  // `start`/`end` is the window the break option is OFFERED in; `durationMin`
  // is how long the dialer actually pauses once the agent taps it — not
  // necessarily "until `end`", since tapping partway through the window
  // still gets the full duration from that moment.
  breaks: [
    { key: 'tea-morning', label: 'Tea Break', start: '12:00', end: '12:15', durationMin: 15 },
    { key: 'lunch', label: 'Lunch Break', start: '14:00', end: '15:00', durationMin: 60 },
    { key: 'tea-evening', label: 'Tea Break', start: '16:00', end: '16:15', durationMin: 15 },
  ],

  // When the day's prospects + callbacks email goes out (jobs/salesDailyMailTick.js).
  dailyProspectMailAt: '20:30',

  // The schedule and late-login rule that applied before the policy took
  // effect — past days keep being read with these (workday.scheduleFor), so
  // history doesn't change. lateLogin: after halfDayAfter = half day, after
  // fullDayAfter = full-day leave (workday.lateLoginPenalty).
  legacyWorkday: { start: '10:00', end: '19:30', halfSplit: '14:30', autoStartAt: '11:00', weeklyOff: [0], lateLogin: { halfDayAfter: '11:00', fullDayAfter: '14:00' } },

  // CLC-POL-001 sections 6 and 9 (services/hr/attendancePolicy.js).
  attendancePolicy: {
    // First IST day the policy decides attendance. Days from dialerLogFrom up
    // to this one only show what the policy WOULD have said (a preview).
    effectiveFrom: '2026-11-05',
    dialerLogFrom: '2026-10-23', // the pool on/off log starts here
    routes: {
      verifiedProspects: { full: 3, half: 1 },
      attendedDemos: { full: 3, half: 1 },
      attempts: { full: 150, half: 100 },
      talkMin: { full: 180, half: 120 },
    },
    // Mandatory cap: below halfMin = absent, below fullMin = half day at most.
    // The policy text says 8h, but its own shift (10:30–20:00 minus 90 min of
    // breaks) is exactly 8h and it allows the dialer on until 10:35, so 7h 45m
    // keeps a compliant day from turning into a half day. Set to 480 for 8h.
    dialer: { fullMin: 465, halfMin: 240 },
    // CRM closed for longer than this while on the dialer doesn't count as
    // dialer time (only for someone who had the CRM open at all that day).
    disconnectGraceMin: 5,
    // Moving a lead to Prospects from a call needs these details first.
    requireDetailsForProspect: true,
    // Dialer first on after this = one 2-hour short-leave event.
    dialerBy: '10:35',
    // Dialer still off this long after a break's end = a break overrun.
    breakOverrunGraceMin: 2,
  },
};
