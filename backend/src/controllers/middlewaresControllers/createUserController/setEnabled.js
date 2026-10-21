const mongoose = require('mongoose');
const { SUPER_ADMIN_ROLES, CRM_ADMIN_ROLES, SALES_ROLES } = require('../../../config/roles');

// PATCH /admin/set-enabled/:id { enabled } — User Management's
// Deactivate / Activate. A deactivated account can't get a login OTP,
// can't log in with a password, and every session it already has stops
// working at its next request (isValidAuthToken checks `enabled`). The
// account and its data stay — Activate brings it straight back.
//
// Same permission rule as editing a user (update.js): owner / Super Admin /
// Admin can toggle anyone below them; Sales Manager / Team Manager only a
// Sales-role user. Nobody can deactivate themselves, and only a Super Admin
// can touch an owner / Super Admin account.
const setEnabled = async (userModel, req, res) => {
  const User = mongoose.model(userModel);
  const enabled = req.body && req.body.enabled;
  if (typeof enabled !== 'boolean') {
    return res.status(400).json({ success: false, result: null, message: 'Send enabled: true or false.' });
  }

  const target = await User.findOne({ _id: req.params.id, removed: false }).select('role enabled email name').lean();
  if (!target) return res.status(404).json({ success: false, result: null, message: 'No user found.' });

  const requesterRole = req.admin && req.admin.role;
  if (String(target._id) === String(req.admin && req.admin._id)) {
    return res.status(400).json({ success: false, result: null, message: "You can't deactivate your own account." });
  }
  const isCrmAdmin = CRM_ADMIN_ROLES.includes(requesterRole);
  const isSalesLead = ['Sales Manager', 'Team Manager'].includes(requesterRole);
  const allowed =
    (SUPER_ADMIN_ROLES.includes(target.role) ? SUPER_ADMIN_ROLES.includes(requesterRole) : isCrmAdmin) ||
    (isSalesLead && SALES_ROLES.includes(target.role));
  if (!allowed) {
    return res.status(403).json({ success: false, result: null, message: 'You do not have permission to change this user.' });
  }

  await User.updateOne({ _id: target._id }, { $set: { enabled } });
  if (!enabled) {
    // End every open session and any login code already sent.
    await mongoose
      .model(`${userModel}Password`)
      .updateOne({ user: target._id }, { $set: { loggedSessions: [], deviceSessions: [] }, $unset: { otpCode: 1, otpExpires: 1 } })
      .catch(() => {});
  }

  return res.status(200).json({
    success: true,
    result: { _id: target._id, enabled },
    message: enabled ? `${target.name || 'User'} activated — can log in again.` : `${target.name || 'User'} deactivated — logged out and can't log in.`,
  });
};

module.exports = setEnabled;
