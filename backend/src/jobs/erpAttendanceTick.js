const mongoose = require('mongoose');
const E = require('../services/hr/erpAttendance');

// Attendance ERP, every 30 s (services/hr/erpAttendance.js tick):
//   • moves open sessions on (ACTIVE → INACTIVE after 5 min without input,
//     → OFFLINE after 2 min without a heartbeat) so Live Activity and the
//     Inactivity Log are right even when the employee's tab is gone
//   • starts lunch on its own at the lunch window (Settings › autoLunch)
//   • after autoCloseAt / at the day change, closes sessions nobody logged
//     out of as "Needs review"
// Reads also advance the state, so a process without this job stays correct.
const TICK_MS = 30 * 1000;

module.exports = function startErpAttendanceTick() {
  let running = false;
  let quietUntil = 0;
  setInterval(async () => {
    if (running || mongoose.connection.readyState !== 1) return;
    running = true;
    try {
      await E.tick();
    } catch (err) {
      if (Date.now() > quietUntil) {
        console.error('[erp-attendance] tick error:', err.message);
        quietUntil = Date.now() + 10 * 60 * 1000;
      }
    } finally {
      running = false;
    }
  }, TICK_MS);
};
