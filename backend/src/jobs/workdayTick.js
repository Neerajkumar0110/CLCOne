const mongoose = require('mongoose');
const wd = require('../services/hr/workday');

// Every minute (services/hr/workday.js):
//   • from 11:00 IST, anyone in Sales who hasn't pressed Login today is put
//     on the auto-dialer — skipped on holidays, weekly off and approved
//     leave; each person at most once a day (WorkSession.autoStartedAt)
//   • approved leave running right now pauses (hours / half day) or stops
//     (whole day) that person's dialer
//   • at each scheduled break time the break starts on its own and the
//     dialer pauses for it (autoBreakTick); when it's over the dialer is
//     back on, even if it was switched off meanwhile (resumeAfterBreakTick)
// Only runs where RUN_BACKGROUND_JOBS is on — it changes who gets real calls.
const TICK_MS = 60 * 1000;

function startWorkdayTick() {
  let running = false;
  let quietUntil = 0;
  setInterval(async () => {
    if (running || mongoose.connection.readyState !== 1) return;
    running = true;
    try {
      await wd.leaveEnforcementTick();
      const started = await wd.autoStartTick();
      if (started) console.log(`[workday] auto-started the dialer for ${started} user(s) not logged in`);
      // scheduled break time → break starts on its own, dialer paused
      const onBreak = await wd.autoBreakTick();
      if (onBreak) console.log(`[workday] started the scheduled break for ${onBreak} user(s)`);
      // break over → dialer back on (even if it was switched off meanwhile)
      const back = await wd.resumeAfterBreakTick();
      if (back) console.log(`[workday] dialer back on after a break for ${back} user(s)`);
      // after the shift: logged in, never logged out → one email each
      const mailed = await wd.logoutReminderTick();
      if (mailed) console.log(`[workday] emailed ${mailed} user(s) who didn't log out`);
    } catch (err) {
      if (Date.now() > quietUntil) {
        console.error('[workday] tick error:', err.message);
        quietUntil = Date.now() + 10 * 60 * 1000;
      }
    } finally {
      running = false;
    }
  }, TICK_MS);
}

module.exports = startWorkdayTick;
