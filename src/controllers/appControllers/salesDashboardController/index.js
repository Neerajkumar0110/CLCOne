const mongoose = require('mongoose');
const { teamSystemFilter, distinctSystemsFromTeams, systemLabel } = require('../../../config/salesSystems');

// Stage buckets used by the ratios (mirrors config/leadStages.js order).
const QUALIFIED_STAGES = ['SUP Call', 'Interested', 'Sales Meeting', 'Opportunity', 'Enrolled'];
const MEETING_REACHED = ['Sales Meeting', 'Opportunity', 'Enrolled'];
const LOST_STAGES = ['Not Interested', 'No Response', 'Invalid'];

const R = (num, den) => ({
  value: den ? num / den : 0,
  numerator: Math.round(num * 100) / 100,
  denominator: Math.round(den * 100) / 100,
});

function monthsInRange(from, to) {
  const out = [];
  const d = new Date(from.getFullYear(), from.getMonth(), 1);
  while (d <= to) {
    out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
    d.setMonth(d.getMonth() + 1);
  }
  return out;
}

// ── core aggregation for ONE set of teams ────────────────────────────────
async function computeForTeams(teamNames, agentNames, from, to, costRows) {
  const Lead = mongoose.model('Lead');
  const Call = mongoose.model('Call');
  const CallRecord = mongoose.model('CallRecord');
  const LoginActivity = mongoose.model('LoginActivity');

  const created = { $gte: from, $lte: to };
  const teamIn = { $in: teamNames };

  const [leads, calls, callRecords, logins] = await Promise.all([
    Lead.find({ removed: false, team: teamIn, created })
      .select('_id stage subStatus stageHistory source created lastContactAt')
      .limit(50000)
      .lean(),
    Call.find({ removed: false, team: teamIn, created })
      .select('lead status duration created')
      .limit(100000)
      .lean(),
    CallRecord.find({ removed: false, team: teamIn, created })
      .select('callLead status answeredAt duration created')
      .limit(100000)
      .lean(),
    agentNames.length
      ? LoginActivity.find({ adminName: { $in: agentNames }, loginAt: created })
          .select('durationSeconds')
          .limit(100000)
          .lean()
      : [],
  ]);

  const totalLeads = leads.length;
  const agentCount = agentNames.length || 1;

  // per-lead classification
  const leadIdsWithCall = new Set(calls.map((c) => String(c.lead)).filter(Boolean));
  let qualified = 0;
  let firstResponse = 0;
  let noResponse = 0;
  let meetingReached = 0;
  let enrolled = 0;
  let lostAfterMeeting = 0;
  let deadLeads = 0; // current stage = Not Interested / No Response / Invalid
  let openQualified = 0;
  const bySourceMap = {};

  for (const l of leads) {
    const stage = l.stage || 'New Lead';
    const hist = Array.isArray(l.stageHistory) ? l.stageHistory : [];
    const everStages = new Set([stage, ...hist.flatMap((h) => [h.fromStage, h.toStage].filter(Boolean))]);

    const isQualified = QUALIFIED_STAGES.some((s) => everStages.has(s));
    if (isQualified) qualified += 1;

    const contacted =
      !!l.lastContactAt ||
      leadIdsWithCall.has(String(l._id)) ||
      hist.some((h) => h.fromStage && h.fromStage !== h.toStage) ||
      (stage !== 'New Lead');
    if (contacted) firstResponse += 1;
    if (stage === 'No Response') noResponse += 1;
    if (LOST_STAGES.includes(stage)) deadLeads += 1;

    const hitMeeting = MEETING_REACHED.some((s) => everStages.has(s)) || everStages.has('Sales Meeting');
    if (hitMeeting) {
      meetingReached += 1;
      if (stage === 'Enrolled') enrolled += 1;
      else if (LOST_STAGES.includes(stage)) lostAfterMeeting += 1;
    } else if (stage === 'Enrolled') {
      enrolled += 1; // enrolled without a recorded meeting stage
    }

    if (['Interested', 'Sales Meeting', 'Opportunity'].includes(stage)) openQualified += 1;

    const src = l.source || 'Unknown';
    bySourceMap[src] = bySourceMap[src] || { source: src, leads: 0, enrolled: 0 };
    bySourceMap[src].leads += 1;
    if (stage === 'Enrolled') bySourceMap[src].enrolled += 1;
  }

  const totalCallsAll = calls.length + callRecords.length;
  const connectedCalls =
    calls.filter((c) => c.status === 'Connected').length +
    callRecords.filter((c) => c.answeredAt).length;
  const talkSeconds =
    calls.reduce((s, c) => s + (c.duration || 0), 0) +
    callRecords.reduce((s, c) => s + (c.duration || 0), 0);
  const workingSeconds = logins.reduce((s, x) => s + (x.durationSeconds || 0), 0);

  // costs (summed across the months in range)
  const cost = costRows.reduce(
    (a, c) => {
      a.marketing += c.marketingSpend || 0;
      a.agent += c.agentCost || 0;
      a.other += c.otherCost || 0;
      a.revenue += c.revenue || 0;
      if (c.avgDealValue) a.dealValues.push(c.avgDealValue);
      return a;
    },
    { marketing: 0, agent: 0, other: 0, revenue: 0, dealValues: [] }
  );
  const totalCost = cost.marketing + cost.agent + cost.other;
  const avgDealValue = cost.dealValues.length
    ? cost.dealValues.reduce((a, b) => a + b, 0) / cost.dealValues.length
    : 0;
  const meetingToEnrolledRate = meetingReached ? enrolled / meetingReached : 0;
  const predictedRevenue = openQualified * meetingToEnrolledRate * avgDealValue;

  const bySource = Object.values(bySourceMap)
    .map((s) => ({ ...s, conversion: s.leads ? s.enrolled / s.leads : 0 }))
    .sort((a, b) => b.leads - a.leads);

  // Monthly trend (for the area chart) — bucket the already-loaded rows.
  const trendMap = {};
  const bucket = (d) => {
    const dt = new Date(d);
    return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}`;
  };
  for (const m of monthsInRange(from, to)) trendMap[m] = { month: m, leads: 0, enrolled: 0, calls: 0, connected: 0 };
  for (const l of leads) {
    const b = trendMap[bucket(l.created)];
    if (!b) continue;
    b.leads += 1;
    if ((l.stage || '') === 'Enrolled') b.enrolled += 1;
  }
  for (const c of calls) {
    const b = trendMap[bucket(c.created || from)];
    if (b) {
      b.calls += 1;
      if (c.status === 'Connected') b.connected += 1;
    }
  }
  for (const c of callRecords) {
    const b = trendMap[bucket(c.created || from)];
    if (b) {
      b.calls += 1;
      if (c.answeredAt) b.connected += 1;
    }
  }
  const trend = Object.values(trendMap);

  return {
    totals: {
      leads: totalLeads,
      agents: agentNames.length,
      calls: totalCallsAll,
      connectedCalls,
      talkSeconds,
      workingSeconds,
      qualified,
      meetingReached,
      enrolled,
      deadLeads,
      leadsCalled: leadIdsWithCall.size,
      cost: { ...cost, total: totalCost, avgDealValue },
    },
    ratios: {
      leadsPerAgent: R(totalLeads, agentCount),
      leadQualification: R(qualified, totalLeads),
      firstResponse: R(firstResponse, totalLeads),
      noResponse: R(noResponse, totalLeads),
      leadToCalling: R(leadIdsWithCall.size, totalLeads),
      dialVsConnectivity: R(connectedCalls, totalCallsAll),
      leadToSalesMeeting: R(meetingReached, totalLeads),
      salesMeetingToEnrolled: R(enrolled, meetingReached),
      salesMeetingToLost: R(lostAfterMeeting, meetingReached),
      allLeadsToDead: R(deadLeads, totalLeads),
      workingHoursVsTalktime: R(talkSeconds, workingSeconds),
      talktimeVsEnrollment: R(talkSeconds, enrolled),
      cac: R(totalCost, enrolled),
      leadCost: R(cost.marketing, totalLeads),
      costPerConversion: R(totalCost, enrolled),
      roi: cost.revenue ? R(cost.revenue - totalCost, totalCost) : R(0, 0),
      // ── marketing-cost framing ──────────────────────────────────────
      costPerLead: R(cost.marketing, totalLeads),
      leadQualificationCost: R(cost.marketing, qualified),
      costPerCalling: R(cost.marketing, leadIdsWithCall.size),
      marketingCac: R(cost.marketing, enrolled),
      marketingCostVsConversion: R(totalCost, enrolled),
      roms: R(cost.revenue, cost.marketing), // return on marketing spend
      perRupeeRevenuePrediction: R(predictedRevenue, cost.marketing),
      revenuePrediction: {
        value: cost.revenue ? predictedRevenue / cost.revenue : 0,
        predictedRevenue: Math.round(predictedRevenue),
        actualRevenue: cost.revenue,
        openQualifiedLeads: openQualified,
        meetingToEnrolledRate,
        avgDealValue,
      },
    },
    bySource,
    trend,
  };
}

// GET /api/sales-dashboard/summary?businessType=&region=&systemType=&from=&to=&combined=1
const summary = async (req, res) => {
  const Team = mongoose.model('Team');
  const SalesCost = mongoose.model('SalesCost');

  const to = req.query.to ? new Date(req.query.to) : new Date();
  const from = req.query.from
    ? new Date(req.query.from)
    : new Date(to.getTime() - 90 * 86400000);

  const tFilter = teamSystemFilter(req.query);
  const teams = await Team.find({ removed: false, ...tFilter }).lean();
  const teamNames = teams.map((t) => t.name);
  const agentNames = [...new Set(teams.flatMap((t) => t.members || []))];

  const months = monthsInRange(from, to);
  const costMatch = { removed: false, month: { $in: months } };
  ['businessType', 'region', 'systemType'].forEach((k) => {
    if (req.query[k]) costMatch[k] = req.query[k];
  });
  const allCost = await SalesCost.find(costMatch).lean();

  if (teamNames.length === 0) {
    return res.status(200).json({
      success: true,
      result: {
        range: { from, to },
        system: systemLabel(req.query),
        teams: [],
        note: 'No teams are classified for this System yet — set Business/Region/AI on teams first.',
        ...(await computeForTeams([], [], from, to, [])),
      },
      message: 'ok',
    });
  }

  const main = await computeForTeams(teamNames, agentNames, from, to, allCost);

  let systems;
  if (req.query.combined === '1' || req.query.combined === 'true') {
    const groups = distinctSystemsFromTeams(teams);
    systems = [];
    for (const g of groups) {
      const gAgents = [
        ...new Set(teams.filter((t) => g.teams.includes(t.name)).flatMap((t) => t.members || [])),
      ];
      const gCost = allCost.filter(
        (c) =>
          (!c.businessType || c.businessType === g.businessType) &&
          (!c.region || c.region === g.region) &&
          (!c.systemType || c.systemType === g.systemType)
      );
      const r = await computeForTeams(g.teams, gAgents, from, to, gCost);
      systems.push({ label: g.label, teams: g.teams, totals: r.totals, ratios: r.ratios });
    }
  }

  return res.status(200).json({
    success: true,
    result: {
      range: { from, to },
      system: systemLabel(req.query),
      teams: teams.map((t) => ({
        name: t.name,
        businessType: t.businessType,
        region: t.region,
        systemType: t.systemType,
        members: (t.members || []).length,
      })),
      ...main,
      systems,
    },
    message: 'ok',
  });
};

// GET /api/sales-dashboard/marketing — same shell as summary, framed as
// marketing cost / ROI ratios, plus per-source ROI. Reuses computeForTeams.
const R2 = (num, den) => ({ value: den ? num / den : 0, numerator: Math.round(num * 100) / 100, denominator: Math.round(den * 100) / 100 });
const marketingSummary = async (req, res) => {
  const Team = mongoose.model('Team');
  const SalesCost = mongoose.model('SalesCost');

  const to = req.query.to ? new Date(req.query.to) : new Date();
  const from = req.query.from ? new Date(req.query.from) : new Date(to.getTime() - 90 * 86400000);

  const tFilter = teamSystemFilter(req.query);
  const teams = await Team.find({ removed: false, ...tFilter }).lean();
  const teamNames = teams.map((t) => t.name);
  const agentNames = [...new Set(teams.flatMap((t) => t.members || []))];

  const months = monthsInRange(from, to);
  const costMatch = { removed: false, month: { $in: months } };
  ['businessType', 'region', 'systemType'].forEach((k) => {
    if (req.query[k]) costMatch[k] = req.query[k];
  });
  const allCost = await SalesCost.find(costMatch).lean();

  const base = await computeForTeams(teamNames, agentNames, from, to, allCost);

  // per-source ROI — source-tagged cost rows if present, else marketing
  // spend split across sources by lead share.
  const bySrcCost = {};
  let taggedTotal = 0;
  for (const c of allCost) {
    if (c.source) {
      bySrcCost[c.source] = (bySrcCost[c.source] || 0) + (c.marketingSpend || 0);
      taggedTotal += c.marketingSpend || 0;
    }
  }
  const totalMarketing = base.totals.cost.marketing || 0;
  const totalLeadsAll = base.totals.leads || 0;
  const avgDeal = base.totals.cost.avgDealValue || 0;

  const bySourceRoi = (base.bySource || []).map((s) => {
    let spend = bySrcCost[s.source];
    if (spend == null) {
      // untagged: proportional share of whatever marketing spend isn't tagged
      const untagged = Math.max(0, totalMarketing - taggedTotal);
      spend = totalLeadsAll ? (untagged * s.leads) / totalLeadsAll : 0;
    }
    const rev = s.enrolled * avgDeal;
    return {
      source: s.source,
      leads: s.leads,
      enrolled: s.enrolled,
      spend: Math.round(spend),
      costPerLead: s.leads ? spend / s.leads : 0,
      roi: spend ? (rev - spend) / spend : 0,
      roms: spend ? rev / spend : 0,
    };
  });

  const note =
    teamNames.length === 0
      ? 'No teams are classified for this System yet — set Business/Region/AI on teams first.'
      : totalMarketing === 0
      ? 'Add monthly Marketing Spend in the Costs panel to populate the cost / ROI ratios.'
      : undefined;

  return res.status(200).json({
    success: true,
    result: {
      range: { from, to },
      system: systemLabel(req.query),
      note,
      teams: teams.map((t) => ({ name: t.name, businessType: t.businessType, region: t.region, systemType: t.systemType })),
      totals: base.totals,
      ratios: base.ratios,
      trend: base.trend,
      bySource: base.bySource,
      bySourceRoi,
    },
    message: 'ok',
  });
};

// GET /api/sales-dashboard/config  — teams (for classification UI) + cost rows
const config = async (req, res) => {
  const Team = mongoose.model('Team');
  const SalesCost = mongoose.model('SalesCost');
  const [teams, costs] = await Promise.all([
    Team.find({ removed: false }).select('name businessType region systemType members color').lean(),
    SalesCost.find({ removed: false }).sort({ month: -1 }).lean(),
  ]);
  return res.status(200).json({ success: true, result: { teams, costs }, message: 'ok' });
};

// PATCH /api/sales-dashboard/team/:id  { businessType, region, systemType }
const setTeamSystem = async (req, res) => {
  const Team = mongoose.model('Team');
  const patch = {};
  ['businessType', 'region', 'systemType'].forEach((k) => {
    if (k in req.body) patch[k] = req.body[k] || null;
  });
  const t = await Team.findOneAndUpdate(
    { _id: req.params.id, removed: false },
    { $set: patch },
    { new: true }
  );
  if (!t) return res.status(404).json({ success: false, result: null, message: 'Team not found' });
  return res.status(200).json({ success: true, result: t, message: 'Team system updated' });
};

// POST /api/sales-dashboard/cost  — upsert one monthly cost row by key
const upsertCost = async (req, res) => {
  const SalesCost = mongoose.model('SalesCost');
  const b = req.body || {};
  if (!b.month || !/^\d{4}-\d{2}$/.test(b.month)) {
    return res.status(400).json({ success: false, result: null, message: 'month must be "YYYY-MM".' });
  }
  const key = {
    month: b.month,
    businessType: b.businessType || null,
    region: b.region || null,
    systemType: b.systemType || null,
    source: b.source || null,
  };
  const doc = await SalesCost.findOneAndUpdate(
    key,
    {
      $set: {
        marketingSpend: Number(b.marketingSpend) || 0,
        agentCost: Number(b.agentCost) || 0,
        otherCost: Number(b.otherCost) || 0,
        revenue: Number(b.revenue) || 0,
        avgDealValue: Number(b.avgDealValue) || 0,
        currency: b.currency || 'INR',
        notes: b.notes || '',
        updatedBy: req.admin ? `${req.admin.name} ${req.admin.surname || ''}`.trim() : undefined,
        updated: new Date(),
        removed: false,
      },
      $setOnInsert: key,
    },
    { new: true, upsert: true }
  );
  return res.status(200).json({ success: true, result: doc, message: 'Cost saved' });
};

// DELETE /api/sales-dashboard/cost/:id
const deleteCost = async (req, res) => {
  const SalesCost = mongoose.model('SalesCost');
  await SalesCost.updateOne({ _id: req.params.id }, { $set: { removed: true } });
  return res.status(200).json({ success: true, result: null, message: 'Cost removed' });
};

module.exports = { summary, marketingSummary, config, setTeamSystem, upsertCost, deleteCost };
