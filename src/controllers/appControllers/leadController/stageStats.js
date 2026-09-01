const mongoose = require('mongoose');
const { LEAD_STAGES, STAGE_NAMES, stageForStatus } = require('../../../config/leadStages');

// GET /api/lead/stage-stats?team=<optional>
// Powers the Lead Stages dashboard card. Returns every stage in pipeline
// order (0-count included), each with its sub-status breakdown, plus the
// grand total. total ALWAYS equals the sum of the stage counts (+ an
// "Other" bucket for any legacy value that can't be mapped).
const stageStats = async (req, res) => {
  const Lead = mongoose.model('Lead');

  const match = { removed: false };
  if (req.query.team) match.team = req.query.team;

  const rows = await Lead.aggregate([
    { $match: match },
    { $group: { _id: { stage: '$stage', subStatus: '$subStatus', status: '$status' }, count: { $sum: 1 } } },
  ]);

  const countByStage = {};
  const subByStage = {};
  STAGE_NAMES.forEach((s) => {
    countByStage[s] = 0;
    subByStage[s] = {};
  });
  let other = 0;

  for (const r of rows) {
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

  const total = STAGE_NAMES.reduce((sum, s) => sum + countByStage[s], 0) + other;

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

  return res.status(200).json({
    success: true,
    result: { stages, total },
    message: 'Successfully computed lead stage stats',
  });
};

module.exports = stageStats;
