// LMS Additional Requirements automations (Figma 2G + 3C/3E):
//   every minute  — project reminders, deadline lock / auto-disqualify, auto-allocation
//   every 15 min  — engagement alerts (inactive / low / drop) + daily goal reminders
// Each step claims its rows atomically, so running on the laptop and the VPS
// at once never doubles a notice. LMS_GROWTH_JOBS=0 turns it off.
module.exports = function startLmsGrowthTick() {
  if (process.env.LMS_GROWTH_JOBS === '0') return;
  const projects = require('../services/lms/growth/projects');
  setTimeout(() => projects.tick().catch(() => {}), 45 * 1000);
  setInterval(() => projects.tick().catch(() => {}), 60 * 1000);
  let alerts = null;
  try {
    alerts = require('../services/lms/growth/alerts');
  } catch (_) {
    alerts = null;
  }
  if (alerts) {
    setTimeout(() => alerts.tick().catch(() => {}), 90 * 1000);
    setInterval(() => alerts.tick().catch(() => {}), 15 * 60 * 1000);
  }
};
