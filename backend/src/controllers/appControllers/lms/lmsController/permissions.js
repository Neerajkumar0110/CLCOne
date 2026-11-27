const { SUPER_ADMIN_ROLES, LMS_FULL_ACCESS_ROLES } = require('../../../../config/roles');

// Route guards for /api/lms. The portal read endpoints are open to any
// authenticated user (they self-scope to req.admin); the /admin/* ops
// endpoints need a management role — Support included, same as the LMS
// permission module itself (see LMS_FULL_ACCESS_ROLES).

function requireManager(req, res, next) {
  const role = req.admin && req.admin.role;
  if (LMS_FULL_ACCESS_ROLES.includes(role) || (req.admin && req.admin._lmsFull)) return next();
  return res.status(403).json({ success: false, message: 'LMS admin actions require a management role.' });
}

function requireSuperAdmin(req, res, next) {
  const role = req.admin && req.admin.role;
  if (SUPER_ADMIN_ROLES.includes(role)) return next();
  return res.status(403).json({ success: false, message: 'This action requires Super Admin.' });
}

// LMS › Certificates (staff side): everyone with the LMS permission gets what an
// admin gets (user ask 2026-11-24). Marks req.admin._lmsFull for the handlers.
async function certificateAccess(req, res, next) {
  try {
    const ok = await require('../../../../services/access/lmsAccess').hasLmsPermission(req.admin);
    if (ok && req.admin) req.admin._lmsFull = true;
  } catch (e) {
    /* fall back to the role checks in the handlers */
  }
  return next();
}

function requireCertificateAccess(req, res, next) {
  if (req.admin && req.admin._lmsFull) return next();
  return res.status(403).json({ success: false, message: 'You need the LMS permission for certificates.' });
}

module.exports = { requireManager, requireSuperAdmin, certificateAccess, requireCertificateAccess };
