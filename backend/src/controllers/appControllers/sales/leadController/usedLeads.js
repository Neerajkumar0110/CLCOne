const mongoose = require('mongoose');
const { leadScopeFilter } = require('./scope');

// GET /api/lead/used?team=&agent=&teamView=1
// Every lead that's genuinely been DIALLED through this CRM's own calling
// system — the Instant Lead Pool or the manual Dialer screen — in one flat
// list instead of having to add up several rows of the stage funnel by
// hand. Deliberately NOT "any lead whose stage isn't New Lead": a lead can
// land on a later stage without ever being called here (bulk-imported
// already-Interested, a stage set by hand in the edit modal, an ad-platform
// webhook, ...), and those don't belong in a "who did we actually call"
// list. `callHistory` is the one field only a real CRM-placed call ever
// pushes to (see services/calling/callingShared.js's advanceCrmLead and
// manualDial.js's end handler), so it's the source of truth here — paired
// with stage != "New Lead" so a lead that's been called always also drops
// out of the New Lead count the moment it lands in this list.
const usedLeads = async (req, res) => {
  const Lead = mongoose.model('Lead');
  const filter = { removed: false, stage: { $ne: 'New Lead' }, 'callHistory.0': { $exists: true } };

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
