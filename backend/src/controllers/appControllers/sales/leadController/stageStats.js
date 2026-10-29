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
  let scopeIds = null; // the board's users (Lead Quality counts only their calls)
  if (responsesView) {
    // Own leads = ones they responded on + ones they called. A called lead
    // with no response of theirs goes to NOT_ENTERED, not its current stage.
    const users = await responseScopeUsers(req.admin, q.user);
    if (users) {
      const m = await userLeadMatch(users);
      scopeIds = m.ids;
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
    // ?part=quality → only the Lead Quality card (slower: scans calls), asked for separately
    result: q.part === 'quality' ? { quality: await leadQuality(finalMatch, scopeIds, countByStage, total) } : { stages, total },
    message: 'Successfully computed lead stage stats',
  });
};

// ── Lead Quality (the card under the donut) ──────────────────────────────
// How much the leads on this board are actually helping: how many a user
// spoke to (answered call an agent took), total talk time, and how many of
// those ended Interested / Callback / Demo Booking / Enrolled.
const POSITIVE = ['Interested Leads', 'Callback', 'Demo Booking', 'Enrolled'];
const tail = (p) => String(p || '').replace(/\D/g, '').slice(-10);

const _qualityCache = new Map();
async function leadQuality(finalMatch, agentIds, countByStage, total) {
  const key = JSON.stringify([finalMatch, agentIds]);
  const hit = _qualityCache.get(key);
  if (hit && Date.now() - hit.at < 60 * 1000) return { ...hit.value, ...positives(countByStage, hit.value.contacted, total) };

  const Lead = mongoose.model('Lead');
  const tails = new Set((await Lead.distinct('phoneNormalized', finalMatch)).filter(Boolean));
  const callQ = { removed: { $ne: true }, answeredAt: { $ne: null }, agent: agentIds && agentIds.length ? { $in: agentIds } : { $ne: null } };
  const calls = await mongoose.model('CallRecord').find(callQ).select('phone duration').lean();
  const spoken = new Set();
  let talkSec = 0;
  let talkCalls = 0;
  for (const c of calls) {
    const t = tail(c.phone);
    if (!tails.has(t)) continue;
    spoken.add(t);
    talkSec += c.duration || 0;
    talkCalls += 1;
  }
  const value = { contacted: spoken.size, talkMinutes: Math.round(talkSec / 60), talkCalls };
  _qualityCache.set(key, { at: Date.now(), value });
  if (_qualityCache.size > 200) _qualityCache.delete(_qualityCache.keys().next().value);
  return { ...value, ...positives(countByStage, value.contacted, total) };
}

function positives(countByStage, contacted, total) {
  const byStage = Object.fromEntries(POSITIVE.map((s) => [s, countByStage[s] || 0]));
  const positive = POSITIVE.reduce((n, s) => n + byStage[s], 0);
  return {
    total,
    positive,
    byStage,
    // the headline: of the leads someone spoke to, how many turned positive
    qualityPct: contacted ? Math.round((positive / contacted) * 1000) / 10 : 0,
    contactedPct: total ? Math.round((contacted / total) * 1000) / 10 : 0,
  };
}

module.exports = stageStats;
