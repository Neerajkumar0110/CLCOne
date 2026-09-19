const mongoose = require('mongoose');
const { dayRange } = require('./_dayRange');

// GET /api/loginactivity/detail/:adminId?date=YYYY-MM-DD — the individual
// login/logout session timeline for one admin on one day, for the Shift
// Management "view detail" modal.
const detail = async (req, res) => {
  const Admin = mongoose.model('Admin');
  const LoginActivity = mongoose.model('LoginActivity');

  const { adminId } = req.params;
  const admin = await Admin.findOne({ _id: adminId, removed: false }).select('name surname').lean();
  if (!admin) {
    return res.status(404).json({ success: false, result: null, message: 'Admin not found' });
  }

  const { start, end } = dayRange(req.query.date);
  const sessions = await LoginActivity.find({
    removed: false,
    admin: adminId,
    loginAt: { $gte: start, $lt: end },
  })
    .sort({ loginAt: 1 })
    .lean();

  return res.status(200).json({
    success: true,
    result: {
      admin: { _id: admin._id, name: admin.surname ? `${admin.name} ${admin.surname}` : admin.name },
      sessions,
    },
    message: 'Successfully found login activity detail',
  });
};

module.exports = detail;
