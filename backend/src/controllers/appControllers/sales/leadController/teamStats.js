const mongoose = require('mongoose');

// GET /api/lead/team-stats — how many leads each team currently has, including
// teams with zero leads (so the UI can show a full roster, not just active ones).
const teamStats = async (req, res) => {
  const Lead = mongoose.model('Lead');
  const Team = mongoose.model('Team');

  const [teams, counts] = await Promise.all([
    Team.find({ removed: false }).exec(),
    Lead.aggregate([
      { $match: { removed: false, team: { $nin: [null, ''] } } },
      { $group: { _id: '$team', count: { $sum: 1 } } },
    ]),
  ]);

  const countByTeam = Object.fromEntries(counts.map((c) => [c._id, c.count]));

  // Only teams that currently exist (removed: false) — a lead can still carry
  // the name of a team that's since been deleted, but that's stale data on
  // the lead, not a reason to make the deleted team reappear here.
  const result = teams.map((t) => ({
    team: t.name,
    color: t.color,
    memberCount: t.members.length,
    leadCount: countByTeam[t.name] || 0,
  }));

  return res.status(200).json({
    success: true,
    result,
    message: 'Successfully computed team lead stats',
  });
};

module.exports = teamStats;
