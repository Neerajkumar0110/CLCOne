const { SUPER_ADMIN_ROLES, MANAGEMENT_ROLES } = require('../../../config/roles');

// Route guards for /api/lms. The portal read endpoints are open to any
// authenticated user (they self-scope to req.admin); the /admin/* ops
// endpoints need a management role.

function requireManager(req, res, next) {
  const role = req.admin && req.admin.role;
  if (MANAGEMENT_ROLES.includes(role)) return next();
  return res.status(403).json({ success: false, message: 'LMS admin actions require a management role.' });
}

function requireSuperAdmin(req, res, next) {
  const role = req.admin && req.admin.role;
  if (SUPER_ADMIN_ROLES.includes(role)) return next();
  return res.status(403).json({ success: false, message: 'This action requires Super Admin.' });
}

module.exports = { requireManager, requireSuperAdmin };
