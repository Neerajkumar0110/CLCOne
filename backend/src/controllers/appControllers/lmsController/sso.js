const { lmsConfig, sso, roleMap } = require('../../../services/lms');

// GET /api/lms/sso/login-url?wantsurl=/course/view.php?id=42
// Returns the one-time Moodle login URL for the *current* CRM user. The
// frontend opens it in a new tab / iframe when a screen needs a real Moodle
// session (deep authoring, attempting a quiz, joining a bbb room).
async function loginUrl(req, res) {
  if (!lmsConfig.isConfigured || !lmsConfig.sso.secret) {
    return res.status(503).json({ success: false, message: 'LMS SSO is not configured.' });
  }
  const admin = req.admin;
  const token = sso.mintLoginToken({
    crmUserId: admin._id,
    email: admin.email,
    name: `${admin.name || ''} ${admin.surname || ''}`.trim(),
    lmsRole: roleMap.lmsRoleForCrm(admin.role),
    wantsurl: typeof req.query.wantsurl === 'string' ? req.query.wantsurl : '/my/',
  });
  return res.status(200).json({
    success: true,
    result: { url: sso.buildLoginUrl(token), expiresInSec: lmsConfig.sso.tokenTtlSec },
  });
}

// GET /api/lms/sso/logout-url — kills the Moodle session alongside CRM logout.
async function logoutUrl(req, res) {
  if (!lmsConfig.isConfigured) {
    return res.status(200).json({ success: true, result: { url: null } });
  }
  return res.status(200).json({ success: true, result: { url: sso.buildLogoutUrl() } });
}

module.exports = { loginUrl, logoutUrl };
