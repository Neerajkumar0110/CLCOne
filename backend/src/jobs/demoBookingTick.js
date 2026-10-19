// Live demo no-shows (services/sales/demoBookings.js → handleNoShows): every
// 10 minutes, a booked customer whose demo day is over and who never joined
// is moved once to the next demo day (fresh email to customer, agent and
// Team Leader); a second miss marks the lead "Demo Not Attended".
const TICK_MS = 10 * 60 * 1000;

function startDemoBookingTick() {
  let running = false;
  setInterval(async () => {
    if (running) return;
    running = true;
    try {
      const moved = await require('../services/sales/demoBookings').handleNoShows();
      if (moved) console.log(`[demo] moved ${moved} no-show booking(s) to the next demo day`);
    } catch (err) {
      console.error('demoBookingTick error:', err.message);
    } finally {
      running = false;
    }
  }, TICK_MS);
}

module.exports = startDemoBookingTick;
