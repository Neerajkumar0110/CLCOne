const mongoose = require('mongoose');
const { SALES_ROLES } = require('../../../config/roles');

// Never returns password/salt — same safe-field shape as read.js, just for every user.
// ?removed=true lists soft-deleted users instead of active ones.
//
// Sales Manager / Team Manager only ever manage the Sales department from
// User Management — scoped here (not just hidden in the sidebar) so they
// never see/fetch Finance/LMS/HR/Marketing accounts, same spirit as every
// other Sales-only scoping in this app (see services/access/salesHierarchy.js).
// A true CRM admin (owner/Super Admin/Admin) is unaffected — full list, as
// before. Everyone else's result is unchanged too; this only narrows these
// two roles.
const list = async (userModel, req, res) => {
  const User = mongoose.model(userModel);

  const removed = req.query.removed === 'true';
  const filter = { removed };
  if (userModel === 'Admin' && req.admin && ['Sales Manager', 'Team Manager'].includes(req.admin.role)) {
    filter.role = { $in: SALES_ROLES };
  }
  const results = await User.find(filter).sort({ created: 'desc' }).exec();

  const result = results.map((u) => ({
    _id: u._id,
    enabled: u.enabled,
    removed: u.removed,
    email: u.email,
    name: u.name,
    surname: u.surname,
    photo: u.photo,
    role: u.role,
    reportsTo: u.reportsTo,
    created: u.created,
  }));

  return res.status(200).json({
    success: true,
    result,
    message: 'Successfully found all users',
  });
};

module.exports = list;
