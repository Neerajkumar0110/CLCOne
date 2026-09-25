// Mounted on /api/lms right after adminAuth.isValidAuthToken (see app.js),
// alongside financeHoldGuard. A Student whose Admin.rosterHold is true
// (models/appModels/lms/Student.js — roster status moved away from "Active")
// gets every /api/lms call rejected except the one the panel already polls
// to notice the change, matching financeHoldGuard's shape exactly. Teachers/
// managers are never affected (role check first).
const ALLOWED_PATHS = new Set(['/my/updates']);

module.exports = function rosterHoldGuard(req, res, next) {
  const user = req.admin;
  if (user && user.role === 'Student' && user.rosterHold && !ALLOWED_PATHS.has(req.path)) {
    return res.status(403).json({
      success: false,
      rosterHold: true,
      message: user.rosterHoldReason || 'Your course access has been suspended. Contact your program coordinator.',
    });
  }
  return next();
};
