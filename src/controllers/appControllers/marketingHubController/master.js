// GET /api/marketing-hub/master — the Marketing Intelligence rollup.
// Aggregates live Lead-by-channel + live Campaign + all manual metric spend/
// revenue for the current filter window, with previous-period deltas, the
// marketing funnel, trend charts and a Lead-Source ROI ranking.
const mongoose = require('mongoose');
const { LEAF_BY_KEY, CHANNEL_SOURCES } = require('../../../config/marketingDashboards');
const { windowFromQuery, kpi, ratio, chart, R } = require('../analyticsController/shared');

const MASTER_LEAF = { key: 'master', source: 'leads', channel: null, region: null };
const CHANNEL_LABEL = {
  ppc: 'PPC / Google Ads', meta: 'Meta', linkedin: 'LinkedIn', youtube: 'YouTube', gmb: 'GMB', other: 'Other',
};

function monthsInWindow(from, to) {
  const out = [];
  const d = new Date(from.getFullYear(), from.getMonth(), 1);
  while (d <= to) {
    out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
    d.setMonth(d.getMonth() + 1);
  }
  return out;
}

module.exports = ({ computeLeads, computeCampaigns }) => {
  // one window's worth of rolled-up numbers
  async function rollup(q, from, to) {
    const months = monthsInWindow(from, to);
    const MarketingMetric = mongoose.model('MarketingMetric');
    const SalesCost = mongoose.model('SalesCost');

    const sliceMatch = { removed: false, month: { $in: months } };
    ['region', 'businessType', 'systemType'].forEach((k) => {
      if (q[k]) sliceMatch[k] = q[k];
    });

    const [leadsAll, camps, manualRows, costRows] = await Promise.all([
      computeLeads(MASTER_LEAF, q, from, to),
      computeCampaigns({ region: q.region || null }, q, from, to),
      MarketingMetric.find(sliceMatch).select('values dashboardKey').lean(),
      SalesCost.find(sliceMatch).select('marketingSpend revenue avgDealValue source').lean(),
    ]);

    const manualSpend = manualRows.reduce((s, r) => s + (Number(r.values?.spend) || 0), 0);
    const manualRevenue = manualRows.reduce((s, r) => s + (Number(r.values?.revenue) || 0), 0);
    const costSpend = costRows.reduce((s, r) => s + (Number(r.marketingSpend) || 0), 0);
    const costRevenue = costRows.reduce((s, r) => s + (Number(r.revenue) || 0), 0);
    const avgDeal =
      costRows.filter((r) => r.avgDealValue).reduce((s, r) => s + r.avgDealValue, 0) /
        (costRows.filter((r) => r.avgDealValue).length || 1) || 0;

    const t = leadsAll.totals;
    const spend = Math.round(camps.totals.spend + manualSpend + costSpend);
    const revenue = Math.round(camps.totals.revenue + manualRevenue + costRevenue + t.enrolled * avgDeal);

    return {
      leadsAll,
      camps,
      costRows,
      avgDeal,
      totals: {
        spend,
        revenue,
        leads: t.leads,
        qualified: t.qualified,
        connected: t.firstResponse,
        meetings: t.meetingReached,
        enrollments: t.enrolled,
      },
    };
  }

  // pure — used by both the /master handler and /compare
  async function computeMaster(q) {
    const { from, to, prevFrom, prevTo } = windowFromQuery(q);
    const [cur, prev] = await Promise.all([rollup(q, from, to), rollup(q, prevFrom, prevTo)]);
    return buildMasterResult(q, cur, prev, from, to, prevFrom, prevTo);
  }

  function buildMasterResult(q, cur, prev, from, to, prevFrom, prevTo) {
    const c = cur.totals;
    const p = prev.totals;
    const trend = cur.leadsAll.trend || [];
    const S = (k) => trend.map((x) => Number(x[k]) || 0);

    const kpis = [
      kpi('spend', 'Total Marketing Spend', c.spend, p.spend, [], { fmt: 'money' }),
      kpi('leads', 'Total Leads', c.leads, p.leads, S('leads')),
      kpi('qualified', 'Qualified Leads', c.qualified, p.qualified, S('qualified')),
      kpi('connected', 'Connected Leads', c.connected, p.connected, []),
      kpi('meetings', 'Sales Meetings', c.meetings, p.meetings, []),
      kpi('enrollments', 'Enrollments', c.enrollments, p.enrollments, S('enrolled')),
      kpi('revenue', 'Revenue', c.revenue, p.revenue, [], { fmt: 'money' }),
      kpi('cac', 'Marketing CAC', c.enrollments ? c.spend / c.enrollments : 0, p.enrollments ? p.spend / p.enrollments : 0, [], { fmt: 'money', positiveWhenDown: true }),
      kpi('cpl', 'Cost per Lead', c.leads ? c.spend / c.leads : 0, p.leads ? p.spend / p.leads : 0, [], { fmt: 'money', positiveWhenDown: true }),
      kpi('cpql', 'Cost per Qualified Lead', c.qualified ? c.spend / c.qualified : 0, p.qualified ? p.spend / p.qualified : 0, [], { fmt: 'money', positiveWhenDown: true }),
      kpi('roas', 'ROAS', c.spend ? c.revenue / c.spend : 0, p.spend ? p.revenue / p.spend : 0, [], { fmt: 'x' }),
      kpi('roi', 'ROI %', c.spend ? ((c.revenue - c.spend) / c.spend) * 100 : 0, p.spend ? ((p.revenue - p.spend) / p.spend) * 100 : 0, [], { fmt: 'pct' }),
      kpi('revPerRupee', 'Revenue per ₹', c.spend ? c.revenue / c.spend : 0, p.spend ? p.revenue / p.spend : 0, [], { fmt: 'x' }),
      kpi('convRate', 'Lead Conversion Rate', c.leads ? (c.enrollments / c.leads) * 100 : 0, p.leads ? (p.enrollments / p.leads) * 100 : 0, [], { fmt: 'pct' }),
    ];

    const ratios = [
      ratio('cpl', 'Cost per Lead', R(c.spend, c.leads), R(p.spend, p.leads), { positiveWhenDown: true }),
      ratio('cpql', 'Lead Qualification Cost', R(c.spend, c.qualified), R(p.spend, p.qualified), { positiveWhenDown: true }),
      ratio('connectivity', 'Leads → Connectivity', R(c.connected, c.leads), R(p.connected, p.leads)),
      ratio('leadToMeeting', 'Lead → Sales Meeting', R(c.meetings, c.leads), R(p.meetings, p.leads)),
      ratio('leadToEnrolled', 'Lead → Enrolled', R(c.enrollments, c.leads), R(p.enrollments, p.leads)),
      ratio('meetingToEnrolled', 'Meeting → Enrolled', R(c.enrollments, c.meetings), R(p.enrollments, p.meetings)),
      ratio('cac', 'Marketing CAC', R(c.spend, c.enrollments), R(p.spend, p.enrollments), { positiveWhenDown: true }),
      ratio('roms', 'Return on Marketing Spend', R(c.revenue, c.spend), R(p.revenue, p.spend)),
    ].map((r) => ({ ...r, fmt: r.key === 'roms' ? 'x' : r.key.startsWith('c') && r.key !== 'connectivity' ? 'money' : 'pct' }));

    // Lead Source ROI ranking (spec §12)
    const costBySource = {};
    cur.costRows.forEach((r) => {
      if (r.source) costBySource[r.source.toLowerCase()] = (costBySource[r.source.toLowerCase()] || 0) + (Number(r.marketingSpend) || 0);
    });
    const ranking = (cur.leadsAll.bySource || [])
      .map((s) => {
        const spend = costBySource[String(s.source).toLowerCase()] || 0;
        const rev = s.enrolled * cur.avgDeal;
        return {
          source: s.source,
          leads: s.leads,
          enrolled: s.enrolled,
          conversion: s.conversion,
          spend: Math.round(spend),
          revenue: Math.round(rev),
          cpl: spend && s.leads ? Math.round(spend / s.leads) : 0,
          cac: spend && s.enrolled ? Math.round(spend / s.enrolled) : 0,
          roas: spend ? Math.round((rev / spend) * 100) / 100 : 0,
          roi: spend ? Math.round(((rev - spend) / spend) * 1000) / 10 : 0,
        };
      })
      .sort((a, b) => b.roi - a.roi || b.enrolled - a.enrolled);
    if (ranking.length) {
      ranking[0].flag = 'best';
      ranking[ranking.length - 1].flag = 'worst';
    }

    const funnel = [
      { key: 'spend', label: 'Marketing Spend', value: c.spend },
      { key: 'leads', label: 'Leads', value: c.leads },
      { key: 'connected', label: 'Connected', value: c.connected },
      { key: 'qualified', label: 'Qualified', value: c.qualified },
      { key: 'meeting', label: 'Sales Meeting', value: c.meetings },
      { key: 'enrolled', label: 'Enrollment', value: c.enrollments },
      { key: 'revenue', label: 'Revenue', value: c.revenue },
    ];

    const charts = {
      trend: chart(trend.map((x) => x.month), [
        { label: 'Leads', data: S('leads') },
        { label: 'Qualified', data: S('qualified') },
        { label: 'Enrolled', data: S('enrolled') },
      ]),
      sourceRoi: chart(ranking.map((r) => r.source), [{ label: 'ROI %', data: ranking.map((r) => r.roi) }]),
    };

    return {
      key: 'master',
      label: 'Marketing Intelligence',
      source: 'master',
      range: { from, to, prevFrom, prevTo, bucket: 'month' },
      filters: { region: q.region || null, businessType: q.businessType || null, systemType: q.systemType || null },
      totals: c,
      kpis,
      ratios,
      charts,
      funnel,
      ranking,
      table: { mode: 'server', meta: { total: c.leads } },
      facets: { sources: (cur.leadsAll.bySource || []).map((s) => s.source), channels: Object.keys(CHANNEL_LABEL) },
    };
  }

  const master = async (req, res) => {
    const result = await computeMaster(req.query);
    return res.status(200).json({ success: true, result, message: 'ok' });
  };

  return { master, computeMaster };
};
