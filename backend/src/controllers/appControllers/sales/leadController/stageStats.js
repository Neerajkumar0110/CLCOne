const mongoose = require('mongoose');
const { LEAD_STAGES, STAGE_NAMES, stageForStatus } = require('../../../../config/leadStages');
const { leadScopeFilter, userLeadMatch, responseScopeUsers, NOT_ENTERED } = require('./scope');
const { parkedPhones } = require('./usedLeads');

// GET /api/lead/stage-stats?team=<optional>
// Powers the Lead Stages dashboard card. Returns every stage in pipeline
// order (0-count included), each with its sub-status breakdown, plus the
// grand total. total ALWAYS equals the sum of the stage counts (+ an
// "Other" bucket for any legacy value that can't be mapped).
const stageStats = async (req, res) => {
  const Lead = mongoose.model('Lead');

  const match = { removed: false };
  if (req.query.team) match.team = req.query.team;

  // Row-level visibility — same rule as every other Lead read path (see
  // scope.js), so a non-management caller's dashboard totals only ever
  // reflect their own (or their team's) pipeline, not the whole company's.
  // The board defaults to the caller's own responses (Team Leader: + their
  // team's) unless a narrower view was picked explicitly.
  const q = req.query || {};
  const responsesView = !(q.teamView || q.team || q.agent) || q.teamView === 'responses';
  let finalMatch = match;
  let notEnteredExpr = null; // true for a lead the scoped users called but never responded on
  if (responsesView) {
    // Own leads = ones they responded on + ones they called. A called lead
    // with no response of theirs goes to NOT_ENTERED, not its current stage.
    const users = await responseScopeUsers(req.admin, q.user);
    if (users) {
      const m = await userLeadMatch(users);
      finalMatch = { $and: [match, m.any] };
      notEnteredExpr = {
        $not: [
          {
            $anyElementTrue: [
              {
                $map: {
                  input: { $ifNull: ['$stageHistory', []] },
                  as: 'h',
                  in: { $or: [{ $in: ['$$h.changedBy', m.ids] }, { $in: ['$$h.changedByName', m.names] }] },
                },
              },
            ],
          },
        ],
      };
    }
  }
  if (!notEnteredExpr) {
    if (!responsesView) {
      const scopeFilter = await leadScopeFilter(req.admin, req);
      if (Object.keys(scopeFilter).length) finalMatch = { $and: [match, scopeFilter] };
    }
    // Used leads no user has are counted in Used Leads → "Not with any user",
    // not here, until they're sent back to a stage (usedLeads.parkedPhones).
    const parked = await parkedPhones();
    if (parked.length) match.phoneNormalized = { $nin: parked };
  }

  const rows = await Lead.aggregate([
    { $match: finalMatch },
    {
      $group: {
        _id: { stage: '$stage', subStatus: '$subStatus', status: '$status', notEntered: notEnteredExpr || { $literal: false } },
        count: { $sum: 1 },
      },
    },
  ]);

  const countByStage = {};
  const subByStage = {};
  STAGE_NAMES.forEach((s) => {
    countByStage[s] = 0;
    subByStage[s] = {};
  });
  let other = 0;
  let notEntered = 0;

  for (const r of rows) {
    if (r._id.notEntered) {
      notEntered += r.count;
      continue;
    }
    // A lead always has `stage` now, but fall back through `status` for any
    // doc written before the migration.
    let stage = r._id.stage;
    if (!stage || !STAGE_NAMES.includes(stage)) stage = stageForStatus(r._id.status);
    if (!STAGE_NAMES.includes(stage)) {
      other += r.count;
      continue;
    }
    countByStage[stage] += r.count;
    const sub = r._id.subStatus || '—';
    subByStage[stage][sub] = (subByStage[stage][sub] || 0) + r.count;
  }

  const total = STAGE_NAMES.reduce((sum, s) => sum + countByStage[s], 0) + other + notEntered;

  const stages = LEAD_STAGES.map((cfg) => ({
    stage: cfg.stage,
    color: cfg.color,
    description: cfg.description,
    count: countByStage[cfg.stage],
    percentage: total ? Math.round((countByStage[cfg.stage] / total) * 100) : 0,
    subStatuses: cfg.subStatuses.map((name) => ({
      subStatus: name,
      count: subByStage[cfg.stage][name] || 0,
      percentage: total ? Math.round(((subByStage[cfg.stage][name] || 0) / total) * 100) : 0,
    })),
  }));

  if (other > 0) {
    stages.push({
      stage: 'Other',
      color: '#CBD5E1',
      description: 'Legacy values not yet migrated.',
      count: other,
      percentage: total ? Math.round((other / total) * 100) : 0,
      subStatuses: [],
    });
  }

  if (notEntered > 0) {
    stages.push({
      stage: NOT_ENTERED,
      color: '#94A3B8',
      description: 'Called, but no response was recorded by this user.',
      count: notEntered,
      percentage: total ? Math.round((notEntered / total) * 100) : 0,
      subStatuses: [],
    });
  }

  return res.status(200).json({
    success: true,
    result: { stages, total },
    message: 'Successfully computed lead stage stats',
  });
};

module.exports = stageStats;
