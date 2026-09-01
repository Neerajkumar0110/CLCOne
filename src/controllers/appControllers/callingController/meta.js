const mongoose = require('mongoose');
const { getProvider } = require('../../../services/calling');
const { publicCallingConfig } = require('../../../config/calling');
const { CALL_DISPOSITIONS } = require('../../../services/calling/dispositions');
const { callingTier } = require('./permissions');

// GET /api/calling/status — provider name + TEST MODE flag (no secrets).
const status = async (req, res) => {
  const provider = getProvider();
  const s = await provider.status();
  return res.status(200).json({
    success: true,
    result: { ...publicCallingConfig(), ...s, tier: callingTier(req) },
    message: 'ok',
  });
};

// GET /api/calling/meta — dispositions, teams, agents (for dropdowns).
const meta = async (req, res) => {
  const Admin = mongoose.model('Admin');
  const Team = mongoose.model('Team');
  const [agents, teams] = await Promise.all([
    Admin.find({ removed: false, enabled: true }).select('name surname role email').sort({ name: 1 }).lean(),
    Team.find({ removed: false }).select('name color members').lean(),
  ]);
  return res.status(200).json({
    success: true,
    result: {
      dispositions: CALL_DISPOSITIONS,
      transferTargets: ['Sales', 'Finance', 'Support', ...teams.map((t) => t.name)].filter(
        (v, i, a) => a.indexOf(v) === i
      ),
      agents: agents.map((a) => ({
        _id: a._id,
        name: `${a.name} ${a.surname || ''}`.trim(),
        role: a.role,
        email: a.email,
      })),
      teams,
      tier: callingTier(req),
    },
    message: 'ok',
  });
};

module.exports = { status, meta };
