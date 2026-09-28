const mongoose = require('mongoose');
const { leadScopeFilter } = require('./scope');

// GET /api/lead/used?team=&agent=&teamView=1
// Every lead that's already been contacted at least once — anything that's
// moved past the "New Lead" stage, whether by a rep working it by hand or
// the Instant Lead Pool auto-dialer — in one flat list instead of having to
// add up several rows of the stage funnel by hand. `response` is always
// populated: the calling side (services/calling/callingShared.js) never
// leaves a dialled lead's outcome blank.
const usedLeads = async (req, res) => {
  const Lead = mongoose.model('Lead');
  const filter = { removed: false, stage: { $ne: 'New Lead' } };

  // Same row-level visibility as every other Lead read path.
  const scopeFilter = await leadScopeFilter(req.admin, req);
  const query = Object.keys(scopeFilter).length ? { $and: [filter, scopeFilter] } : filter;

  const leads = await Lead.find(query)
    .sort({ stageUpdatedAt: -1 })
    .limit(500)
    .select('name phone stage subStatus assignedUserName team lastContactAt stageUpdatedAt callHistory')
    .lean();

  return res.status(200).json({
    success: true,
    result: leads.map((l) => {
      const lastCall = Array.isArray(l.callHistory) && l.callHistory.length ? l.callHistory[l.callHistory.length - 1] : null;
      return {
        _id: l._id,
        name: l.name,
        phone: l.phone,
        stage: l.stage,
        subStatus: l.subStatus,
        response: (lastCall && lastCall.outcome) || l.stage,
        assignedUserName: l.assignedUserName || null,
        team: l.team || null,
        lastContactAt: l.lastContactAt || l.stageUpdatedAt,
      };
    }),
    message: 'ok',
  });
};

module.exports = usedLeads;
