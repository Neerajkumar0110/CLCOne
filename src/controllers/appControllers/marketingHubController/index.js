const mongoose = require('mongoose');
const {
  METRIC_TEMPLATES,
  MARKETING_TREE,
  LEAF_BY_KEY,
  CHANNEL_SOURCES,
} = require('../../../config/marketingDashboards');
const { teamSystemFilter } = require('../../../config/salesSystems');

const QUALIFIED_STAGES = ['SUP Call', 'Interested', 'Sales Meeting', 'Opportunity', 'Enrolled'];
const MEETING_REACHED = ['Sales Meeting', 'Opportunity', 'Enrolled'];
const LOST_STAGES = ['Not Interested', 'No Response', 'Invalid'];

const monthKey = (d) => {
  const dt = new Date(d);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}`;
};
function monthsInRange(from, to) {
  const out = [];
  const d = new Date(from.getFullYear(), from.getMonth(), 1);
  while (d <= to) {
    out.push(monthKey(d));
    d.setMonth(d.getMonth() + 1);
  }
  return out;
}
const rangeFromQuery = (q) => {
  const to = q.to ? new Date(q.to) : new Date();
  const from = q.from ? new Date(q.from) : new Date(to.getTime() - 180 * 86400000);
  return { from, to };
};

// ── safe formula evaluator: only {keys}, digits, + - * / ( ) . and spaces ──
function evalFormula(formula, vals) {
  const expr = formula.replace(/\{(\w+)\}/g, (_, k) => {
    const n = Number(vals[k]);
    return Number.isFinite(n) ? `(${n})` : '(0)';
  });
  if (!/^[0-9+\-*/(). ]+$/.test(expr)) return 0;
  try {
    // eslint-disable-next-line no-new-func
    const v = Function(`"use strict";return (${expr});`)();
    return Number.isFinite(v) ? v : 0;
  } catch {
    return 0;
  }
}

// ── manual dashboards: sum typed inputs across the range, derive ratios ──
async function computeManual(leaf, q) {
  const MarketingMetric = mongoose.model('MarketingMetric');
  const tpl = METRIC_TEMPLATES[leaf.template] || { inputs: [], ratios: [] };
  const { from, to } = rangeFromQuery(q);
  const months = monthsInRange(from, to);

  const match = { removed: false, dashboardKey: leaf.key, month: { $in: months } };
  ['region', 'businessType', 'systemType'].forEach((k) => {
    if (q[k]) match[k] = q[k];
  });
  const rows = await MarketingMetric.find(match).lean();

  const totals = {};
  for (const inp of tpl.inputs) totals[inp.key] = 0;
  const trendMap = {};
  for (const m of months) trendMap[m] = { month: m };
  for (const inp of tpl.inputs) for (const m of months) trendMap[m][inp.key] = 0;

  for (const r of rows) {
    const v = r.values || {};
    for (const inp of tpl.inputs) {
      const n = Number(v[inp.key]) || 0;
      totals[inp.key] += n;
      if (trendMap[r.month]) trendMap[r.month][inp.key] += n;
    }
  }

  const ratios = tpl.ratios.map((rt) => ({
    key: rt.key,
    label: rt.label,
    kind: rt.kind,
    value: evalFormula(rt.formula, totals),
  }));
  // ratio trend per month (for line charts on derived metrics)
  const trend = months.map((m) => {
    const row = { month: m, ...trendMap[m] };
    for (const rt of tpl.ratios) row[rt.key] = evalFormula(rt.formula, trendMap[m]);
    return row;
  });

  return {
    source: 'manual',
    template: leaf.template,
    inputs: tpl.inputs,
    ratioDefs: tpl.ratios,
    totals,
    ratios,
    trend,
    rowCount: rows.length,
  };
}

// ── leads dashboards: real CRM lead data, sliced by channel + region ──
async function computeLeads(leaf, q) {
  const Lead = mongoose.model('Lead');
  const Team = mongoose.model('Team');
  const { from, to } = rangeFromQuery(q);
  const months = monthsInRange(from, to);
  const region = q.region || leaf.region || null;

  // teams matching the System filter (+ region)
  const tFilter = teamSystemFilter({ ...q, region });
  const teams = await Team.find({ removed: false, ...tFilter }).select('name region').lean();
  const teamNames = teams.map((t) => t.name);

  const cond = { removed: false, created: { $gte: from, $lte: to } };

  // region: team-classified OR lead.country text
  if (region) {
    const countryRe =
      region === 'India' ? /india/i : /usa|united states|u\.s\.|america/i;
    const or = [{ country: countryRe }];
    if (teamNames.length) or.push({ team: { $in: teamNames } });
    cond.$or = or;
  } else if (teamNames.length && (q.businessType || q.systemType)) {
    cond.team = { $in: teamNames };
  }

  // channel: which lead.source values roll up here
  const ch = leaf.channel;
  if (ch && ch !== 'other') {
    cond.source = { $in: CHANNEL_SOURCES[ch].map((s) => new RegExp(`^${s}$`, 'i')) };
  } else if (ch === 'other') {
    const mapped = Object.values(CHANNEL_SOURCES)
      .flat()
      .map((s) => new RegExp(`^${s}$`, 'i'));
    cond.source = { $nin: mapped };
  }

  const leads = await Lead.find(cond)
    .select('stage subStatus stageHistory source created lastContactAt')
    .limit(50000)
    .lean();

  let qualified = 0;
  let firstResponse = 0;
  let noResponse = 0;
  let meetingReached = 0;
  let enrolled = 0;
  let dead = 0;
  const bySourceMap = {};
  const trendMap = {};
  for (const m of months) trendMap[m] = { month: m, leads: 0, enrolled: 0, qualified: 0 };

  for (const l of leads) {
    const stage = l.stage || 'New Lead';
    const hist = Array.isArray(l.stageHistory) ? l.stageHistory : [];
    const ever = new Set([stage, ...hist.flatMap((h) => [h.fromStage, h.toStage].filter(Boolean))]);
    const isQ = QUALIFIED_STAGES.some((s) => ever.has(s));
    if (isQ) qualified += 1;
    if (!!l.lastContactAt || stage !== 'New Lead') firstResponse += 1;
    if (stage === 'No Response') noResponse += 1;
    if (LOST_STAGES.includes(stage)) dead += 1;
    if (MEETING_REACHED.some((s) => ever.has(s))) meetingReached += 1;
    if (stage === 'Enrolled') enrolled += 1;

    const src = l.source || 'Unknown';
    bySourceMap[src] = bySourceMap[src] || { source: src, leads: 0, enrolled: 0 };
    bySourceMap[src].leads += 1;
    if (stage === 'Enrolled') bySourceMap[src].enrolled += 1;

    const b = trendMap[monthKey(l.created)];
    if (b) {
      b.leads += 1;
      if (stage === 'Enrolled') b.enrolled += 1;
      if (isQ) b.qualified += 1;
    }
  }

  const total = leads.length;
  const R = (n, d) => (d ? n / d : 0);
  return {
    source: 'leads',
    region,
    channel: ch || 'all',
    totals: { leads: total, qualified, firstResponse, noResponse, meetingReached, enrolled, dead },
    ratios: [
      { key: 'qualification', label: 'Lead Qualification', kind: 'percent', value: R(qualified, total) },
      { key: 'firstResponse', label: 'First Response', kind: 'percent', value: R(firstResponse, total) },
      { key: 'noResponse', label: 'No Response', kind: 'percent', value: R(noResponse, total) },
      { key: 'leadToMeeting', label: 'Lead → Sales Meeting', kind: 'percent', value: R(meetingReached, total) },
      { key: 'meetingToEnrolled', label: 'Meeting → Enrolled', kind: 'percent', value: R(enrolled, meetingReached) },
      { key: 'leadToEnrolled', label: 'Lead → Enrolled', kind: 'percent', value: R(enrolled, total) },
      { key: 'deadRate', label: 'All Leads → Dead', kind: 'percent', value: R(dead, total) },
    ],
    bySource: Object.values(bySourceMap)
      .map((s) => ({ ...s, conversion: s.leads ? s.enrolled / s.leads : 0 }))
      .sort((a, b) => b.leads - a.leads),
    trend: Object.values(trendMap),
  };
}

// ── campaigns dashboards: the `campaign` marketing model ──
async function computeCampaigns(leaf, q) {
  const Campaign = mongoose.model('Campaign');
  const { from, to } = rangeFromQuery(q);
  const months = monthsInRange(from, to);
  const region = q.region || leaf.region || null;

  const cond = {
    removed: false,
    $or: [
      { startDate: { $gte: from, $lte: to } },
      { endDate: { $gte: from, $lte: to } },
      { created: { $gte: from, $lte: to } },
    ],
  };
  if (region) {
    const re = region === 'India' ? /india|ind\b/i : /usa|us\b|united states|america/i;
    cond.$and = [{ $or: [{ targetAudience: re }, { utmCampaign: re }, { name: re }] }];
  }
  const camps = await Campaign.find(cond)
    .select('name type status budget actualSpend expectedLeads leads conversions revenue startDate endDate created currency')
    .limit(20000)
    .lean();

  const sum = (f) => camps.reduce((a, c) => a + (Number(c[f]) || 0), 0);
  const spend = sum('actualSpend');
  const leads = sum('leads');
  const conv = sum('conversions');
  const revenue = sum('revenue');

  const byType = {};
  for (const c of camps) {
    const t = c.type || 'Other';
    byType[t] = byType[t] || { type: t, spend: 0, leads: 0, conversions: 0, revenue: 0, count: 0 };
    byType[t].spend += Number(c.actualSpend) || 0;
    byType[t].leads += Number(c.leads) || 0;
    byType[t].conversions += Number(c.conversions) || 0;
    byType[t].revenue += Number(c.revenue) || 0;
    byType[t].count += 1;
  }
  const trendMap = {};
  for (const m of months) trendMap[m] = { month: m, spend: 0, leads: 0, conversions: 0, revenue: 0 };
  for (const c of camps) {
    const b = trendMap[monthKey(c.startDate || c.created)];
    if (!b) continue;
    b.spend += Number(c.actualSpend) || 0;
    b.leads += Number(c.leads) || 0;
    b.conversions += Number(c.conversions) || 0;
    b.revenue += Number(c.revenue) || 0;
  }
  const R = (n, d) => (d ? n / d : 0);
  return {
    source: 'campaigns',
    region,
    totals: {
      campaigns: camps.length,
      active: camps.filter((c) => c.status === 'Active').length,
      budget: sum('budget'),
      spend,
      leads,
      conversions: conv,
      revenue,
    },
    ratios: [
      { key: 'cpl', label: 'Cost / Lead', kind: 'currency', value: R(spend, leads) },
      { key: 'cpa', label: 'Cost / Conversion', kind: 'currency', value: R(spend, conv) },
      { key: 'convRate', label: 'Lead → Conversion', kind: 'percent', value: R(conv, leads) },
      { key: 'roas', label: 'ROAS', kind: 'ratio', value: R(revenue, spend) },
      { key: 'roi', label: 'ROI', kind: 'percent', value: spend ? (revenue - spend) / spend : 0 },
      { key: 'budgetUsed', label: 'Budget Utilised', kind: 'percent', value: R(spend, sum('budget')) },
    ],
    byType: Object.values(byType).sort((a, b) => b.spend - a.spend),
    trend: Object.values(trendMap),
  };
}

// ── routes ──────────────────────────────────────────────────────────────

// GET /api/marketing-hub/tree
const tree = async (_req, res) =>
  res.status(200).json({
    success: true,
    result: { tree: MARKETING_TREE, templates: METRIC_TEMPLATES },
    message: 'ok',
  });

// GET /api/marketing-hub/dashboard/:key?region=&businessType=&systemType=&from=&to=
const dashboard = async (req, res) => {
  const leaf = LEAF_BY_KEY[req.params.key];
  if (!leaf) {
    return res.status(404).json({ success: false, result: null, message: 'Unknown dashboard' });
  }
  let data;
  if (leaf.source === 'leads') data = await computeLeads(leaf, req.query);
  else if (leaf.source === 'campaigns') data = await computeCampaigns(leaf, req.query);
  else data = await computeManual(leaf, req.query);

  const { from, to } = rangeFromQuery(req.query);
  return res.status(200).json({
    success: true,
    result: { key: leaf.key, label: leaf.label, range: { from, to }, ...data },
    message: 'ok',
  });
};

// GET /api/marketing-hub/metrics/:key  — raw rows for the entry table
const listMetrics = async (req, res) => {
  const MarketingMetric = mongoose.model('MarketingMetric');
  const rows = await MarketingMetric.find({ removed: false, dashboardKey: req.params.key })
    .sort({ month: -1 })
    .limit(400)
    .lean();
  return res.status(200).json({ success: true, result: rows, message: 'ok' });
};

// POST /api/marketing-hub/metrics/:key  — upsert one monthly row
const saveMetric = async (req, res) => {
  const MarketingMetric = mongoose.model('MarketingMetric');
  const leaf = LEAF_BY_KEY[req.params.key];
  if (!leaf || leaf.source !== 'manual') {
    return res.status(400).json({ success: false, result: null, message: 'Not a manual dashboard' });
  }
  const b = req.body || {};
  if (!b.month || !/^\d{4}-\d{2}$/.test(b.month)) {
    return res.status(400).json({ success: false, result: null, message: 'month must be "YYYY-MM".' });
  }
  const tpl = METRIC_TEMPLATES[leaf.template] || { inputs: [] };
  const values = {};
  for (const inp of tpl.inputs) values[inp.key] = Number(b.values?.[inp.key]) || 0;

  const key = {
    dashboardKey: leaf.key,
    month: b.month,
    region: b.region || null,
    businessType: b.businessType || null,
    systemType: b.systemType || null,
  };
  const doc = await MarketingMetric.findOneAndUpdate(
    key,
    {
      $set: {
        template: leaf.template,
        values,
        notes: b.notes || '',
        updatedByName: req.admin ? `${req.admin.name || ''} ${req.admin.surname || ''}`.trim() : '',
        updatedBy: req.admin ? req.admin._id : undefined,
        updated: new Date(),
        removed: false,
      },
      $setOnInsert: key,
    },
    { new: true, upsert: true }
  );
  return res.status(200).json({ success: true, result: doc, message: 'Metrics saved' });
};

// DELETE /api/marketing-hub/metrics/:key/:id
const deleteMetric = async (req, res) => {
  const MarketingMetric = mongoose.model('MarketingMetric');
  await MarketingMetric.updateOne({ _id: req.params.id }, { $set: { removed: true } });
  return res.status(200).json({ success: true, result: null, message: 'Row removed' });
};

module.exports = { tree, dashboard, listMetrics, saveMetric, deleteMetric };
