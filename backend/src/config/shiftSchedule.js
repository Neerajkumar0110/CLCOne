// Fixed daily shift schedule for Sales agents working the Instant Lead
// Pool (see leadPool.js) — all times IST, 24h "HH:mm". One schedule for
// everyone for now; not per-agent configurable.
module.exports = {
  // The pool auto-joins an agent sometime in this window (see
  // leadPool.js's status endpoint + the frontend's auto-join check) —
  // start is when it first becomes eligible, end is just informational
  // (how late "on time" still counts), not a hard cutoff.
  joinWindow: { start: '10:30', end: '11:00' },

  targetWorkMinutes: 8 * 60,

  // `key` must be stable (used to dedupe "already took this break today").
  // `start`/`end` is the window the break option is OFFERED in; `durationMin`
  // is how long the dialer actually pauses once the agent taps it — not
  // necessarily "until `end`", since tapping partway through the window
  // still gets the full duration from that moment.
  breaks: [
    { key: 'tea-morning', label: 'Tea Break', start: '12:15', end: '12:30', durationMin: 15 },
    { key: 'lunch', label: 'Lunch Break', start: '14:00', end: '15:00', durationMin: 60 },
    { key: 'tea-evening', label: 'Tea Break', start: '17:15', end: '17:30', durationMin: 15 },
  ],
};
