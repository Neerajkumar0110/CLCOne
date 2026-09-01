const { MANAGEMENT_ROLES } = require('../../../config/roles');

// Map the CRM's existing roles onto the calling module's three tiers.
// No new auth system — this reads req.admin.role set by adminAuth.
const MANAGER_ROLES = ['Team Manager', 'Team Coordinator', 'Team Leader', 'Senior Executive'];

function callingTier(req) {
  const role = req.admin && req.admin.role;
  if (MANAGEMENT_ROLES.includes(role)) return 'admin';
  if (MANAGER_ROLES.includes(role)) return 'manager';
  return 'agent';
}

const RANK = { agent: 1, manager: 2, admin: 3 };

// Express guard: requireTier('manager') → manager or admin only.
function requireTier(min) {
  return (req, res, next) => {
    const tier = callingTier(req);
    if (RANK[tier] >= RANK[min]) {
      req.callingTier = tier;
      return next();
    }
    return res.status(403).json({
      success: false,
      result: null,
      message: `This action requires ${min}-level calling access.`,
    });
  };
}

// The campaign-visibility filter for a request:
//   admin   → everything
//   manager → campaigns for teams they belong to, plus ones they're on
//   agent   → campaigns they're assigned to
async function campaignScope(req) {
  const tier = callingTier(req);
  if (tier === 'admin') return {};

  const mongoose = require('mongoose');
  const Team = mongoose.model('Team');
  const myTeams = await Team.find({ removed: false, members: req.admin._id }).select('name').lean();
  const teamNames = myTeams.map((t) => t.name);

  if (tier === 'manager') {
    const or = [{ agents: req.admin._id }];
    if (teamNames.length) or.push({ team: { $in: teamNames } });
    return { $or: or };
  }
  return { agents: req.admin._id };
}

module.exports = { callingTier, requireTier, campaignScope, MANAGER_ROLES };
