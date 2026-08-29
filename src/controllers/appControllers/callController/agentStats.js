const mongoose = require('mongoose');

// Roles allowed to see everyone's call performance across every team.
const MANAGEMENT_ROLES = ['owner', 'Super Admin', 'Admin', 'Sales Manager'];

// GET /api/call/agent-stats — per-team, per-salesperson call breakdown:
// how many distinct numbers they've called, and how many connected vs not.
// Restricted to management roles since it spans every team, not just the
// requesting admin's own.
const agentStats = async (req, res) => {
  if (!MANAGEMENT_ROLES.includes(req.admin.role)) {
    return res.status(403).json({
      success: false,
      result: null,
      message: 'Not authorized to view call stats across teams',
    });
  }

  const Team = mongoose.model('Team');
  const Call = mongoose.model('Call');

  const teams = await Team.find({ removed: false }).exec();

  const perAgent = await Call.aggregate([
    { $match: { removed: false } },
    {
      $group: {
        _id: { team: '$team', calledBy: '$calledBy' },
        numbers: { $addToSet: '$phone' },
        connected: { $sum: { $cond: [{ $eq: ['$status', 'Connected'] }, 1, 0] } },
        disconnected: { $sum: { $cond: [{ $ne: ['$status', 'Connected'] }, 1, 0] } },
      },
    },
  ]);

  const statsByTeamMember = {};
  perAgent.forEach((row) => {
    statsByTeamMember[`${row._id.team}||${row._id.calledBy}`] = {
      numbers: (row.numbers || []).filter(Boolean).length,
      connected: row.connected,
      disconnected: row.disconnected,
    };
  });

  const result = teams.map((t) => ({
    team: t.name,
    color: t.color,
    members: t.members.map((memberName) => {
      const stats = statsByTeamMember[`${t.name}||${memberName}`] || {
        numbers: 0,
        connected: 0,
        disconnected: 0,
      };
      return { name: memberName, ...stats };
    }),
  }));

  return res.status(200).json({
    success: true,
    result,
    message: 'Successfully computed agent call stats',
  });
};

module.exports = agentStats;
