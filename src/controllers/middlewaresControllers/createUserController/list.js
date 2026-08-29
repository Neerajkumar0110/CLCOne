const mongoose = require('mongoose');

// Never returns password/salt — same safe-field shape as read.js, just for every user.
// ?removed=true lists soft-deleted users instead of active ones.
const list = async (userModel, req, res) => {
  const User = mongoose.model(userModel);

  const removed = req.query.removed === 'true';
  const results = await User.find({ removed }).sort({ created: 'desc' }).exec();

  const result = results.map((u) => ({
    _id: u._id,
    enabled: u.enabled,
    removed: u.removed,
    email: u.email,
    name: u.name,
    surname: u.surname,
    photo: u.photo,
    role: u.role,
    created: u.created,
  }));

  return res.status(200).json({
    success: true,
    result,
    message: 'Successfully found all users',
  });
};

module.exports = list;
