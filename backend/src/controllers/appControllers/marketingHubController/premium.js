// Turns a compute*() result (current + previous window) into the premium
// dashboard payload the shared analytics shell expects:
//   kpis[]  — value / prev / deltaPct / sparkline series / fmt / positiveWhenDown
//   ratios[] — value + prev + fmt + positiveWhenDown
//   charts{} — { trend, bySource|byType }
//   funnel[] — marketing-funnel stages that this source can populate
//   table    — { mode:'server' } for leads/campaigns, { mode:'client', rows } for manual
const { kpi, ratio, chart } = require('../analyticsController/shared');

const MONEY_KEYS = new Set([
  'spend', 'budget', 'revenue', 'payout', 'estSpend', 'marketingSpend', 'cost', 'adSpend',
]);
// ratios where a smaller number is better
const DOWN_RATIOS = new Set([
  'noResponse', 'deadRate', 'cpl', 'cpa', 'cac', 'cpql', 'cpc', 'cpm', 'costPerLead',
  'bounceRate', 'unsubRate', 'negativeShare', 'negativeSentiment',
]);
const DOWN_KPIS = new Set(['noResponse', 'dead', 'bounces', 'unsub', 'negative']);

const kindToFmt = (kind) =>
  kind === 'currency' ? 'money' : kind === 'percent' ? 'pct' : kind === 'ratio' ? 'x' : 'num';

// Per manual template: which input keys become KPI cards (rest still available
// via the entry form + "Numbers" table). Falls back to the first 8 inputs.
const MANUAL_KPI_KEYS = {
  visibility: ['impressions', 'clicks', 'traffic', 'keywordsRanked', 'leads', 'enrolled', 'spend', 'revenue'],
  webAnalytics: ['sessions', 'users', 'newUsers', 'pageViews', 'avgSessionSec', 'bounceRate', 'conversions', 'enrolled'],
  orm: ['reviews', 'positive', 'negative', 'responded', 'negativeResolved', 'avgResponseHrs'],
  social: ['followers', 'followerGrowth', 'posts', 'reach', 'engagements', 'leads', 'spend', 'revenue'],
  blogDA: ['domainAuthority', 'backlinks', 'referringDomains', 'blogsPublished', 'blogTraffic', 'blogLeads', 'spend'],
  content: ['piecesPlanned', 'piecesPublished', 'onTime', 'views', 'leads', 'spend'],
  email: ['sent', 'delivered', 'opens', 'clicks', 'leads', 'enrolled', 'spend', 'revenue'],
  whatsapp: ['sent', 'delivered', 'read', 'replies', 'leads', 'enrolled', 'spend', 'revenue'],
  automation: ['workflows', 'contactsProcessed', 'touchpoints', 'leads', 'enrolled', 'hoursSaved', 'spend', 'revenue'],
  partner: ['partners', 'clicks', 'leads', 'enrolled', 'payout', 'spend', 'revenue'],
  persona: ['personas', 'leadsMatched', 'leadsTotal', 'enrolledMatched', 'enrolledTotal'],
};

function seriesFor(trend, key) {
  if (!Array.isArray(trend) || !trend.length) return [];
  if (!(key in trend[0])) return [];
  return trend.map((t) => Number(t[key]) || 0);
}

function kpiFrom(key, label, cur, prev, opts = {}) {
  const value = Number(cur.totals?.[key]) || 0;
  const prevVal = Number(prev.totals?.[key]) || 0;
  const fmt = opts.fmt || (MONEY_KEYS.has(key) ? 'money' : 'int');
  return kpi(key, label, value, prevVal, seriesFor(cur.trend, key), {
    fmt,
    positiveWhenDown: opts.positiveWhenDown || DOWN_KPIS.has(key),
  });
}

// derived-ratio KPI (e.g. Lead → Enrolled %) shown as a percentage card
function ratioKpi(rkey, label, cur, prev, opts = {}) {
  const cr = (cur.ratios || []).find((r) => r.key === rkey);
  const pr = (prev.ratios || []).find((r) => r.key === rkey);
  return kpi(rkey, label, (cr?.value || 0) * 100, (pr?.value || 0) * 100, [], {
    fmt: 'pct',
    positiveWhenDown: opts.positiveWhenDown,
  });
}

function ratiosPremium(cur, prev) {
  const pmap = {};
  (prev.ratios || []).forEach((r) => (pmap[r.key] = r));
  return (cur.ratios || []).map((r) =>
    ratio(
      r.key,
      r.label,
      { value: r.value, numerator: r.numerator, denominator: r.denominator },
      pmap[r.key] ? { value: pmap[r.key].value } : null,
      { positiveWhenDown: DOWN_RATIOS.has(r.key) }
    )
  );
}
// give the ratio chips a fmt hint from their kind
function attachRatioFmt(ratios, defs) {
  const kmap = {};
  (defs || []).forEach((d) => (kmap[d.key] = d.kind));
  return ratios.map((r) => ({ ...r, fmt: kindToFmt(kmap[r.key] || 'percent') }));
}

// ── funnels per source ──────────────────────────────────────────────────
const QUALIFIED_STAGES = ['SUP Call', 'Interested', 'Sales Meeting', 'Opportunity', 'Enrolled'];
const MEETING_STAGES = ['Sales Meeting', 'Opportunity', 'Enrolled'];
function funnelLeads(t) {
  return [
    { key: 'leads', label: 'Leads', value: t.leads || 0 },
    { key: 'contacted', label: 'Contacted', value: t.firstResponse || 0 },
    { key: 'qualified', label: 'Qualified', value: t.qualified || 0, drill: { field: 'stage', op: 'in', value: QUALIFIED_STAGES, label: 'Qualified' } },
    { key: 'meeting', label: 'Sales Meeting', value: t.meetingReached || 0, drill: { field: 'stage', op: 'in', value: MEETING_STAGES, label: 'Sales meetings' } },
    { key: 'enrolled', label: 'Enrollment', value: t.enrolled || 0, drill: { field: 'stage', op: 'eq', value: 'Enrolled', label: 'Enrolled' } },
  ];
}
function funnelCampaigns(t) {
  return [
    { key: 'spend', label: 'Spend', value: Math.round(t.spend || 0) },
    { key: 'leads', label: 'Leads', value: t.leads || 0 },
    { key: 'conversions', label: 'Conversions', value: t.conversions || 0 },
    { key: 'revenue', label: 'Revenue', value: Math.round(t.revenue || 0) },
  ];
}
function funnelManual(t) {
  const stages = [];
  if (t.impressions != null) stages.push({ key: 'impressions', label: 'Impressions', value: t.impressions || 0 });
  if (t.clicks != null) stages.push({ key: 'clicks', label: 'Clicks', value: t.clicks || 0 });
  if (t.traffic != null) stages.push({ key: 'traffic', label: 'Traffic', value: t.traffic || 0 });
  if (t.sent != null) stages.push({ key: 'sent', label: 'Sent', value: t.sent || 0 });
  if (t.delivered != null) stages.push({ key: 'delivered', label: 'Delivered', value: t.delivered || 0 });
  if (t.opens != null) stages.push({ key: 'opens', label: 'Opened', value: t.opens || 0 });
  if (t.reach != null) stages.push({ key: 'reach', label: 'Reach', value: t.reach || 0 });
  if (t.engagements != null) stages.push({ key: 'engagements', label: 'Engaged', value: t.engagements || 0 });
  if (t.views != null) stages.push({ key: 'views', label: 'Views', value: t.views || 0 });
  if (t.leads != null) stages.push({ key: 'leads', label: 'Leads', value: t.leads || 0 });
  if (t.enrolled != null) stages.push({ key: 'enrolled', label: 'Enrollment', value: t.enrolled || 0 });
  return stages.length >= 2 ? stages : [];
}

// ── charts ──────────────────────────────────────────────────────────────
function trendChart(cur, keys) {
  const labels = (cur.trend || []).map((t) => t.month);
  const datasets = keys
    .filter((k) => cur.trend && cur.trend[0] && k.key in cur.trend[0])
    .map((k) => ({ label: k.label, data: (cur.trend || []).map((t) => Number(t[k.key]) || 0) }));
  return chart(labels, datasets);
}

function buildPremium(leaf, cur, prev, from, to, extra = {}) {
  const t = cur.totals || {};
  let kpis = [];
  let charts = {};
  let funnel = [];
  let table = { mode: 'client', rows: extra.manualRows || [] };
  let facets = {};

  if (cur.source === 'leads') {
    kpis = [
      kpiFrom('leads', 'Total Leads', cur, prev),
      kpiFrom('qualified', 'Qualified Leads', cur, prev),
      kpiFrom('firstResponse', 'First Response', cur, prev),
      kpiFrom('meetingReached', 'Sales Meetings', cur, prev),
      kpiFrom('enrolled', 'Enrollments', cur, prev),
      kpiFrom('noResponse', 'No Response', cur, prev, { positiveWhenDown: true }),
      kpiFrom('dead', 'Dead Leads', cur, prev, { positiveWhenDown: true }),
      ratioKpi('leadToEnrolled', 'Lead → Enrolled', cur, prev),
    ];
    funnel = funnelLeads(t);
    charts = {
      trend: trendChart(cur, [
        { key: 'leads', label: 'Leads' },
        { key: 'qualified', label: 'Qualified' },
        { key: 'enrolled', label: 'Enrolled' },
      ]),
      bySource: chart(
        (cur.bySource || []).map((s) => s.source),
        [{ label: 'Leads', data: (cur.bySource || []).map((s) => s.leads) }]
      ),
    };
    table = { mode: 'server', meta: { total: t.leads || 0 } };
    facets = { sources: (cur.bySource || []).map((s) => s.source) };
  } else if (cur.source === 'campaigns') {
    kpis = [
      kpiFrom('campaigns', 'Campaigns', cur, prev),
      kpiFrom('active', 'Active', cur, prev),
      kpiFrom('budget', 'Budget', cur, prev),
      kpiFrom('spend', 'Spend', cur, prev),
      kpiFrom('leads', 'Leads', cur, prev),
      kpiFrom('conversions', 'Conversions', cur, prev),
      kpiFrom('revenue', 'Revenue', cur, prev),
      ratioKpi('convRate', 'Lead → Conversion', cur, prev),
    ];
    funnel = funnelCampaigns(t);
    charts = {
      trend: trendChart(cur, [
        { key: 'spend', label: 'Spend' },
        { key: 'leads', label: 'Leads' },
        { key: 'revenue', label: 'Revenue' },
      ]),
      byType: chart(
        (cur.byType || []).map((x) => x.type),
        [{ label: 'Spend', data: (cur.byType || []).map((x) => Math.round(x.spend)) }]
      ),
    };
    table = { mode: 'server', meta: { total: t.campaigns || 0 } };
    facets = { types: (cur.byType || []).map((x) => x.type) };
  } else {
    // manual
    const inputKeys = (MANUAL_KPI_KEYS[leaf.template] || (cur.inputs || []).map((i) => i.key)).slice(0, 8);
    const labelOf = {};
    (cur.inputs || []).forEach((i) => (labelOf[i.key] = i.label));
    kpis = inputKeys.map((k) => kpiFrom(k, labelOf[k] || k, cur, prev));
    funnel = funnelManual(t);
    charts = {
      trend: trendChart(cur, inputKeys.slice(0, 3).map((k) => ({ key: k, label: labelOf[k] || k }))),
    };
    table = { mode: 'client', rows: extra.manualRows || [] };
  }

  const ratios = attachRatioFmt(ratiosPremium(cur, prev), cur.ratioDefs);

  return {
    key: leaf.key,
    label: leaf.label,
    source: cur.source,
    range: { from, to, prevFrom: extra.prevFrom, prevTo: extra.prevTo, bucket: 'month' },
    filters: { region: cur.region || null, businessType: extra.businessType || null, systemType: extra.systemType || null },
    totals: t,
    kpis,
    ratios,
    charts,
    funnel,
    table,
    facets,
    // keep the fields the manual entry form still needs
    template: cur.template,
    inputs: cur.inputs,
    ratioDefs: cur.ratioDefs,
    rowCount: cur.rowCount,
    bySource: cur.bySource,
    byType: cur.byType,
    trend: cur.trend,
    estimated: cur.estimated || false,
    adCampaigns: cur.adCampaigns,
  };
}

module.exports = { buildPremium, MONEY_KEYS, DOWN_RATIOS, kindToFmt };
