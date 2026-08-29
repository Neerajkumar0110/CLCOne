const mongoose = require('mongoose');

// GET /api/team/mine — resolves the logged-in admin's team. Team.members
// stores plain name strings (not Admin refs), matched against req.admin.name.
const mine = async (req, res) => {
  const Team = mongoose.model('Team');

  const team = await Team.findOne({ removed: false, members: req.admin.name }).exec();

  return res.status(200).json({
    success: true,
    result: team || null,
    message: team ? 'Successfully found your team' : 'You are not assigned to a team yet',
  });
};

module.exports = mine;
