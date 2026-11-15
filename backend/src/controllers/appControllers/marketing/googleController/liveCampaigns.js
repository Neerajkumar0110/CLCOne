const graph = require('../../../../utils/googleAdsClient');
const { findAllConnections, getFreshAccessToken } = require('./_helpers');

// GET /api/google/live-campaigns?range=today|yesterday|7d|30d|this_month|last_month
//                               (or &from=YYYY-MM-DD&to=YYYY-MM-DD) [&account=<customerId>]
//
// READ-ONLY view of the campaigns already running in Google Ads (user request
// 2026-11-12: "show what our existing campaigns bring in, don't create or send
// anything"; 2026-11-16: "whichever Google account is connected, show every
// campaign in it"). Covers EVERY connected Google login and EVERY ad account
// each one reaches — direct ones and client accounts under a manager (MCC) —
// not just the active connection's one selected account. Per account: every
// non-removed campaign with its settings + its metrics for the date range,
// merged so a campaign with no traffic still shows (0s). One account failing
// (no access, token not approved…) never hides the others; it is listed in
// `accounts` with its Google error. Nothing is written to Google Ads.

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

// The account list per login changes rarely and costs 1 + (managers) calls —
// cached for 10 minutes so switching the date range stays quick.
const accountCache = new Map(); // connId -> { at, accounts }
async function accountsFor(conn, accessToken) {
  const key = String(conn._id);
  const hit = accountCache.get(key);
  if (hit && Date.now() - hit.at < 10 * 60 * 1000) return hit.accounts;
  const accounts = await graph.listAdAccounts(accessToken);
  accountCache.set(key, { at: Date.now(), accounts });
  return accounts;
}

// runs fn over items, at most `limit` at a time (Google rate-limits bursts)
async function pool(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const k = i++;
      out[k] = await fn(items[k]);
    }
  });
  await Promise.all(workers);
  return out;
}

async function accountReport({ acc, accessToken, from, to }) {
  const opts = { customerId: acc.customerId, accessToken, loginCustomerId: acc.loginCustomerId || acc.customerId };
  const [settings, metrics, daily] = await Promise.all([
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
      id: `${acc.customerId}:${c.id}`,
      campaignId: String(c.id),
      accountId: acc.customerId,
      accountName: acc.name,
      currency: acc.currency || 'INR',
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

  const days = daily.map((r) => ({
    date: r.segments && r.segments.date,
    impressions: num(r.metrics && r.metrics.impressions),
    clicks: num(r.metrics && r.metrics.clicks),
    cost: micros(r.metrics && r.metrics.costMicros),
    conversions: num(r.metrics && r.metrics.conversions),
  }));
  return { campaigns, days };
}

const liveCampaigns = async (req, res) => {
  const q = req.query || {};
  const { from, to, range } = rangeDates(q);
  const only = q.account && q.account !== 'all' ? String(q.account).replace(/\D/g, '') : null;
  if (q.fresh === '1') accountCache.clear();

  const conns = (await findAllConnections()).filter((c) => c.status === 'connected');
  if (!conns.length) return res.status(400).json({ success: false, result: null, message: 'Google Ads is not connected yet.' });

  // 1) every ad account every connected login reaches (first login wins a duplicate)
  const accounts = [];
  const seen = new Set();
  const loginErrors = [];
  for (const conn of conns) {
    let accessToken;
    try {
      accessToken = await getFreshAccessToken(conn);
      const list = await accountsFor(conn, accessToken);
      for (const a of list) {
        if (seen.has(a.customerId)) continue;
        seen.add(a.customerId);
        accounts.push({ ...a, login: conn.googleUserEmail, accessToken });
      }
    } catch (err) {
      loginErrors.push({ login: conn.googleUserEmail, error: `Google Ads: ${err.message}` });
    }
  }

  // managers hold no campaigns of their own; cancelled/closed accounts are skipped
  const runnable = accounts.filter((a) => !a.manager && !a.error && !['CANCELED', 'CLOSED'].includes(a.status));
  const targets = only ? runnable.filter((a) => a.customerId === only) : runnable;

  // 2) campaigns + metrics for each, a few at a time
  const reports = await pool(targets, 3, async (acc) => {
    try {
      return { acc, ...(await accountReport({ acc, accessToken: acc.accessToken, from, to })) };
    } catch (err) {
      return { acc, error: `Google Ads: ${err.message}` };
    }
  });

  const campaigns = [];
  const dayMap = new Map();
  const reportById = new Map(reports.map((r) => [r.acc.customerId, r]));
  for (const r of reports) {
    if (r.error) continue;
    campaigns.push(...r.campaigns);
    for (const d of r.days) {
      const t = dayMap.get(d.date) || { date: d.date, impressions: 0, clicks: 0, cost: 0, conversions: 0 };
      t.impressions += d.impressions;
      t.clicks += d.clicks;
      t.cost += d.cost;
      t.conversions += d.conversions;
      dayMap.set(d.date, t);
    }
  }
  campaigns.sort((a, b) => (a.status === b.status ? b.cost - a.cost || String(a.name).localeCompare(String(b.name)) : a.status === 'ENABLED' ? -1 : 1));

  const currencies = [...new Set(campaigns.map((c) => c.currency))];
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

  const accountRows = accounts.map((a) => {
    const r = reportById.get(a.customerId);
    const mine = r && !r.error ? r.campaigns : [];
    return {
      id: a.customerId,
      name: a.name,
      currency: a.currency,
      status: a.status,
      manager: a.manager,
      managerName: a.managerName,
      login: a.login,
      error: a.error || (r && r.error) || undefined,
      campaigns: mine.length,
      enabled: mine.filter((c) => c.status === 'ENABLED').length,
      cost: mine.reduce((t, c) => t + c.cost, 0),
      skipped: !a.manager && !a.error && ['CANCELED', 'CLOSED'].includes(a.status),
    };
  });

  const reached = reports.filter((r) => !r.error).length;
  if (!reached && (loginErrors.length || reports.length)) {
    // nothing at all came back — surface Google's own reason
    const first = loginErrors[0] || reports.find((r) => r.error);
    return res.status(502).json({
      success: false,
      result: { accounts: accountRows, loginErrors },
      message: (first && first.error) || 'Google Ads: no account could be read.',
    });
  }

  const single = targets.length === 1 ? targets[0] : null;
  return res.status(200).json({
    success: true,
    result: {
      account: single
        ? { id: single.customerId, name: single.name, currency: single.currency || 'INR' }
        : { id: null, name: `${reached} account${reached === 1 ? '' : 's'}`, currency: currencies.length === 1 ? currencies[0] : currencies[0] || 'INR' },
      mixedCurrency: currencies.length > 1,
      accounts: accountRows,
      loginErrors,
      logins: conns.map((c) => c.googleUserEmail),
      selected: only || 'all',
      range,
      from,
      to,
      totals,
      campaigns,
      days: [...dayMap.values()].sort((a, b) => String(a.date).localeCompare(String(b.date))),
      fetchedAt: new Date(),
    },
    message: 'ok',
  });
};

module.exports = { liveCampaigns, rangeDates };
