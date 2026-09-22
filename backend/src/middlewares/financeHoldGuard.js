// Mounted on /api/lms right after adminAuth.isValidAuthToken (see app.js).
// A Student whose Admin.financeHold is true (jobs/financeEmiTick.js — an EMI
// installment is >24h overdue) gets every /api/lms call rejected except the
// one the panel already polls to know to show its "pay now" screen in the
// first place, and to notice the instant it clears — see
// LmsPanelApp.jsx / lmsController/panel.js myUpdates. Teachers/managers are
// never affected (role check first).
const ALLOWED_PATHS = new Set(['/my/updates']);

module.exports = function financeHoldGuard(req, res, next) {
  const user = req.admin;
  if (user && user.role === 'Student' && user.financeHold && !ALLOWED_PATHS.has(req.path)) {
    return res.status(402).json({
      success: false,
      financeHold: true,
      message: 'Your account access is on hold due to an overdue payment.',
    });
  }
  return next();
};
