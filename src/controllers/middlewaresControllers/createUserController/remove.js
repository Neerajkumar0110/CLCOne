const mongoose = require('mongoose');

// Soft-deletes a user (removed: true) — same convention as the rest of the
// app. They stop showing in the normal list but can be viewed and restored
// via GET /admin/list?removed=true + PATCH /admin/update/:id { removed: false }.
const remove = async (userModel, req, res) => {
  const User = mongoose.model(userModel);

  const result = await User.findOneAndUpdate(
    { _id: req.params.id, removed: false },
    { removed: true },
    { new: true }
  ).exec();

  if (!result) {
    return res.status(404).json({
      success: false,
      result: null,
      message: 'No user found.',
    });
  }

  return res.status(200).json({
    success: true,
    result: { _id: result._id },
    message: 'User deleted successfully.',
  });
};

module.exports = remove;
