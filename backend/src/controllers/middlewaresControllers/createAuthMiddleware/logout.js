const mongoose = require('mongoose');

const logout = async (req, res, { userModel }) => {
  const UserPassword = mongoose.model(userModel + 'Password');

  // const token = req.cookies[`token_${cloud._id}`];

  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // Extract the token

  if (token)
    await UserPassword.findOneAndUpdate(
      { user: req.admin._id },
      { $pull: { loggedSessions: token, deviceSessions: { token } } },
      {
        new: true,
      }
    ).exec();
  else
    await UserPassword.findOneAndUpdate(
      { user: req.admin._id },
      { loggedSessions: [], deviceSessions: [] },
      {
        new: true,
      }
    ).exec();

  // Attendance ERP: signing out of the CRM everywhere is the end of the
  // working day (an owner still signed in on another device is not).
  try {
    const left = await UserPassword.findOne({ user: req.admin._id }).select('loggedSessions').lean();
    if (!left || !(left.loggedSessions || []).length) {
      const E = require('../../../services/hr/erpAttendance');
      if (E.isTrackedRole(req.admin.role)) await E.logout(req.admin, { type: 'auth' });
    }
  } catch (e) {
    console.error('[erp] logout hook failed:', e.message);
  }

  return res.json({
    success: true,
    result: {},
    message: 'Successfully logout',
  });
};

module.exports = logout;
