const graph = require('../../../../utils/googleAdsClient');
const { requireConnection, getFreshAccessToken } = require('./_helpers');

// GET /api/google/live-campaigns?range=today|yesterday|7d|30d|this_month|last_month
//                               (or &from=YYYY-MM-DD&to=YYYY-MM-DD)
//
// READ-ONLY view of the campaigns already running in the connected Google Ads
// account (user request 2026-11-12: "show what our existing campaigns bring in,
// don't create or send anything"). Two GAQL reports on the active account:
// every non-removed campaign with its settings, and its metrics for the date
// range — merged, so a campaign with no traffic in the range still shows (0s).
// Nothing is written to Google Ads.

const RANGES = ['today', 'yesterday', '7d', '30d', 'this_month', 'last_month'];

// IST calendar days (the account's own time zone is used by Google for
// segments.date; for an Indian account that is IST too).
function istDay(offsetDays = 0) {
  const d = new Date(Date.now() + 5.5 * 3600 * 1000 + offsetDays * 864e5);
  return d.toISOString().slice(0, 10);
}
function rangeDates(q) {
  const ok = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));
  if (ok(q.from) && ok(q.to)) return { from: q.from, to: q.to, range: 'custom' };
  const range = RANGES.includes(q.range) ? q.range : '7d';
  const today = istDay(0);
  if (range === 'today') return { from: today, to: today, range };
  if (range === 'yesterday') return { from: istDay(-1), to: istDay(-1), range };
  if (range === '30d') return { from: istDay(-29), to: today, range };
  if (range === 'this_month') return { from: `${today.slice(0, 7)}-01`, to: today, range };
  if (range === 'last_month') {
    const [y, m] = today.split('-').map(Number);
    const first = new Date(Date.UTC(m === 1 ? y - 1 : y, m === 1 ? 11 : m - 2, 1));
    const last = new Date(Date.UTC(y, m - 1, 0));
    return { from: first.toISOString().slice(0, 10), to: last.toISOString().slice(0, 10), range };
  }
  return { from: istDay(-6), to: today, range: '7d' };
}

const micros = (v) => Math.round(Number(v || 0)) / 1e6;
const num = (v) => Number(v || 0);

const liveCampaigns = async (req, res) => {
  const conn = await requireConnection(res, { needCustomer: true });
  if (!conn) return;
  const { from, to, range } = rangeDates(req.query || {});

  try {
    const accessToken = await getFreshAccessToken(conn);
    const opts = { customerId: conn.customerId, accessToken, loginCustomerId: conn.loginCustomerId || conn.customerId };

    const [settings, metrics, daily, customer] = await Promise.all([
      graph.searchAll({
        ...opts,
        query:
          'SELECT campaign.id, campaign.name, campaign.status, campaign.serving_status, campaign.advertising_channel_type, ' +
          'campaign.bidding_strategy_type, campaign.start_date, campaign.end_date, campaign_budget.amount_micros ' +
          "FROM campaign WHERE campaign.status != 'REMOVED'",
      }),
      graph.searchAll({
        ...opts,
        query:
          'SELECT campaign.id, metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions, ' +
          'metrics.conversions_value, metrics.all_conversions ' +
          `FROM campaign WHERE segments.date BETWEEN '${from}' AND '${to}' AND campaign.status != 'REMOVED'`,
      }),
      graph.searchAll({
        ...opts,
        query:
          'SELECT segments.date, metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions ' +
          `FROM customer WHERE segments.date BETWEEN '${from}' AND '${to}'`,
      }),
      graph.getCustomerInfo(opts).catch(() => ({})),
    ]);

    const byId = new Map();
    for (const r of metrics) byId.set(String(r.campaign && r.campaign.id), r.metrics || {});

    const campaigns = settings.map((r) => {
      const c = r.campaign || {};
      const m = byId.get(String(c.id)) || {};
      const impressions = num(m.impressions);
      const clicks = num(m.clicks);
      const cost = micros(m.costMicros);
      const conversions = num(m.conversions);
      return {
        id: String(c.id),
        name: c.name,
        status: c.status, // ENABLED | PAUSED
        servingStatus: c.servingStatus,
        type: c.advertisingChannelType,
        biddingStrategy: c.biddingStrategyType,
        startDate: c.startDate,
        endDate: c.endDate,
        dailyBudget: r.campaignBudget ? micros(r.campaignBudget.amountMicros) : null,
        impressions,
        clicks,
        ctr: impressions ? (clicks / impressions) * 100 : 0,
        avgCpc: clicks ? cost / clicks : 0,
        cost,
        conversions,
        costPerConversion: conversions ? cost / conversions : 0,
        conversionsValue: num(m.conversionsValue),
      };
    });
    campaigns.sort((a, b) => (a.status === b.status ? b.cost - a.cost || a.name.localeCompare(b.name) : a.status === 'ENABLED' ? -1 : 1));

    const sum = (k) => campaigns.reduce((t, c) => t + (c[k] || 0), 0);
    const totals = {
      campaigns: campaigns.length,
      enabled: campaigns.filter((c) => c.status === 'ENABLED').length,
      impressions: sum('impressions'),
      clicks: sum('clicks'),
      cost: sum('cost'),
      conversions: sum('conversions'),
    };
    totals.ctr = totals.impressions ? (totals.clicks / totals.impressions) * 100 : 0;
    totals.avgCpc = totals.clicks ? totals.cost / totals.clicks : 0;
    totals.costPerConversion = totals.conversions ? totals.cost / totals.conversions : 0;

    const days = daily
      .map((r) => ({
        date: r.segments && r.segments.date,
        impressions: num(r.metrics && r.metrics.impressions),
        clicks: num(r.metrics && r.metrics.clicks),
        cost: micros(r.metrics && r.metrics.costMicros),
        conversions: num(r.metrics && r.metrics.conversions),
      }))
      .sort((a, b) => String(a.date).localeCompare(String(b.date)));

    return res.status(200).json({
      success: true,
      result: {
        account: { id: conn.customerId, name: customer.descriptiveName || conn.customerName || conn.customerId, currency: customer.currencyCode || 'INR' },
        range,
        from,
        to,
        totals,
        campaigns,
        days,
        fetchedAt: new Date(),
      },
      message: 'ok',
    });
  } catch (err) {
    // the real Google message (e.g. developer token not approved, no access to the account)
    return res.status(502).json({ success: false, result: null, message: `Google Ads: ${err.message}` });
  }
};

module.exports = { liveCampaigns, rangeDates };
