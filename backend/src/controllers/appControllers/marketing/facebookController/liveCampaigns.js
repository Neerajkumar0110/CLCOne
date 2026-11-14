const mongoose = require('mongoose');
const graph = require('../../../../utils/metaGraphClient');
const { requireConnection, decryptedUserToken } = require('./_helpers');

// GET /api/facebook/live-campaigns?range=today|yesterday|7d|30d|this_month|last_month|maximum
//
// Capture Form › Facebook Ads dashboard (user request 2026-11-12): which campaigns
// run, how many leads each brings, and Facebook vs Instagram — READ-ONLY.
//   Meta  — the ad account's campaigns + insights by publisher_platform (spend,
//           impressions, clicks, leads, messaging chats) for the range.
//   CRM   — the Facebook leads that actually reached the CRM in the range, per
//           campaign and platform, with where they stand in the pipeline.
// A "health" block flags when Meta reports leads that never reached the CRM.

const RANGES = ['today', 'yesterday', '7d', '30d', 'this_month', 'last_month', 'maximum'];
const DAY = 864e5;
const istKey = (ms) => new Date(ms + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
const istStart = (key) => new Date(`${key}T00:00:00+05:30`);

function rangeOf(q) {
  const range = RANGES.includes(q.range) ? q.range : '30d';
  const now = Date.now();
  const today = istKey(now);
  let since = today;
  let until = today;
  if (range === 'yesterday') since = until = istKey(now - DAY);
  else if (range === '7d') since = istKey(now - 6 * DAY);
  else if (range === '30d') since = istKey(now - 29 * DAY);
  else if (range === 'this_month') since = `${today.slice(0, 7)}-01`;
  else if (range === 'last_month') {
    const [y, m] = today.split('-').map(Number);
    since = new Date(Date.UTC(m === 1 ? y - 1 : y, m === 1 ? 11 : m - 2, 1)).toISOString().slice(0, 10);
    until = new Date(Date.UTC(y, m - 1, 0)).toISOString().slice(0, 10);
  } else if (range === 'maximum') since = null;
  const crmFrom = since ? istStart(since) : null;
  const crmTo = new Date(istStart(until).getTime() + DAY);
  return { range, since, until, crmFrom, crmTo };
}

const PLATFORM_KEY = { facebook: 'facebook', instagram: 'instagram', messenger: 'messenger', whatsapp: 'whatsapp', audience_network: 'other', unknown: 'other' };
const LEAD_PLATFORM = { fb: 'facebook', ig: 'instagram', msg: 'messenger', an: 'other', wa: 'whatsapp' };
const actionVal = (actions, types) =>
  (actions || []).filter((a) => types.includes(a.action_type)).reduce((t, a) => t + Number(a.value || 0), 0);
const LEAD_ACTIONS = ['lead'];
const CHAT_ACTIONS = ['onsite_conversion.messaging_conversation_started_7d'];
const blankSplit = () => ({ facebook: 0, instagram: 0, messenger: 0, whatsapp: 0, other: 0 });

const liveCampaigns = async (req, res) => {
  const conn = await requireConnection(res, { needAdAccount: true });
  if (!conn) return;
  const { range, since, until, crmFrom, crmTo } = rangeOf(req.query || {});
  const token = decryptedUserToken(conn);
  const act = conn.adAccountId;

  // ── Meta side ──
  let campaigns = [];
  let insights = [];
  let metaError = null;
  try {
    const timeParams = since ? { time_range: JSON.stringify({ since, until }) } : { date_preset: 'maximum' };
    [campaigns, insights] = await Promise.all([
      graph.graphPaged(`/${act}/campaigns`, {
        fields: 'id,name,effective_status,objective,daily_budget,lifetime_budget,start_time,stop_time',
        limit: 100,
        access_token: token,
      }),
      graph.graphPaged(`/${act}/insights`, {
        level: 'campaign',
        breakdowns: 'publisher_platform',
        fields: 'campaign_id,campaign_name,spend,impressions,reach,clicks,actions',
        limit: 500,
        ...timeParams,
        access_token: token,
      }),
    ]);
  } catch (err) {
    metaError = err.message;
  }

  // ── CRM side: Facebook leads that reached the CRM in the range ──
  const Lead = mongoose.model('Lead');
  const when = { ...(crmFrom ? { $gte: crmFrom } : {}), $lt: crmTo };
  const crmRows = await Lead.aggregate([
    {
      $match: {
        removed: false,
        facebookLeadId: { $exists: true, $ne: null },
        $or: [{ facebookCreatedAt: when }, { facebookCreatedAt: { $exists: false }, created: when }],
      },
    },
    {
      $group: {
        _id: {
          c: { $ifNull: ['$metaCampaignId', '$rawMetaData.campaign_id'] },
          p: '$metaPlatform',
          s: '$stage',
        },
        n: { $sum: 1 },
      },
    },
  ]);

  const rows = new Map();
  const row = (id, name) => {
    const k = String(id || 'unknown');
    if (!rows.has(k)) {
      rows.set(k, {
        id: k,
        name: name || null,
        status: null,
        objective: null,
        dailyBudget: null,
        spend: 0,
        impressions: 0,
        reach: 0,
        clicks: 0,
        metaLeads: 0,
        chats: 0,
        metaSplit: blankSplit(), // leads by platform (Meta)
        spendSplit: blankSplit(),
        crmLeads: 0,
        crmSplit: { ...blankSplit(), unknown: 0 }, // leads in CRM by platform
        stages: {},
      });
    }
    const r = rows.get(k);
    if (name && !r.name) r.name = name;
    return r;
  };

  for (const c of campaigns) {
    const r = row(c.id, c.name);
    r.status = c.effective_status;
    r.objective = c.objective;
    r.dailyBudget = c.daily_budget ? Number(c.daily_budget) / 100 : c.lifetime_budget ? null : null;
    r.lifetimeBudget = c.lifetime_budget ? Number(c.lifetime_budget) / 100 : null;
    r.startTime = c.start_time || null;
  }
  for (const x of insights) {
    const r = row(x.campaign_id, x.campaign_name);
    const p = PLATFORM_KEY[x.publisher_platform] || 'other';
    const leads = actionVal(x.actions, LEAD_ACTIONS);
    const spend = Number(x.spend || 0);
    r.spend += spend;
    r.impressions += Number(x.impressions || 0);
    r.reach += Number(x.reach || 0);
    r.clicks += Number(x.clicks || 0);
    r.metaLeads += leads;
    r.chats += actionVal(x.actions, CHAT_ACTIONS);
    r.metaSplit[p] += leads;
    r.spendSplit[p] += spend;
  }
  for (const g of crmRows) {
    const r = row(g._id.c);
    r.crmLeads += g.n;
    const p = LEAD_PLATFORM[g._id.p] || 'unknown';
    r.crmSplit[p] = (r.crmSplit[p] || 0) + g.n;
    const st = g._id.s || 'New Lead';
    r.stages[st] = (r.stages[st] || 0) + g.n;
  }

  const list = [...rows.values()].map((r) => ({
    ...r,
    name: r.name || (r.id === 'unknown' ? 'Unknown campaign' : `Campaign ${r.id}`),
    ctr: r.impressions ? (r.clicks / r.impressions) * 100 : 0,
    cpl: r.metaLeads ? r.spend / r.metaLeads : 0,
    active: r.status === 'ACTIVE',
    hasActivity: r.spend > 0 || r.metaLeads > 0 || r.crmLeads > 0 || r.chats > 0,
  }));
  list.sort((a, b) => (b.active - a.active) || (b.metaLeads + b.crmLeads - (a.metaLeads + a.crmLeads)) || b.spend - a.spend);

  const sum = (k) => list.reduce((t, r) => t + (r[k] || 0), 0);
  const split = (k) => list.reduce((acc, r) => {
    Object.entries(r[k]).forEach(([p, n]) => { acc[p] = (acc[p] || 0) + n; });
    return acc;
  }, {});
  const totals = {
    campaigns: list.length,
    active: list.filter((r) => r.active).length,
    spend: sum('spend'),
    impressions: sum('impressions'),
    clicks: sum('clicks'),
    metaLeads: sum('metaLeads'),
    chats: sum('chats'),
    crmLeads: sum('crmLeads'),
    metaSplit: split('metaSplit'),
    crmSplit: split('crmSplit'),
  };
  totals.cpl = totals.metaLeads ? totals.spend / totals.metaLeads : 0;

  // ── health: is Meta handing out leads the CRM never got? ──
  const last = await Lead.findOne({ removed: false, facebookLeadId: { $exists: true, $ne: null } })
    .sort({ facebookCreatedAt: -1, created: -1 })
    .select('facebookCreatedAt created')
    .lean();
  const lastCrmLeadAt = last ? last.facebookCreatedAt || last.created : null;
  let recentMetaLeads = null;
  if (!metaError) {
    try {
      const r = await graph.graphPaged(`/${act}/insights`, {
        level: 'account',
        fields: 'actions',
        time_range: JSON.stringify({ since: istKey(Date.now() - 2 * DAY), until: istKey(Date.now()) }),
        access_token: token,
      });
      recentMetaLeads = r.reduce((t, x) => t + actionVal(x.actions, LEAD_ACTIONS), 0);
    } catch {
      recentMetaLeads = null;
    }
  }
  const recentCrmLeads = await Lead.countDocuments({
    removed: false,
    facebookLeadId: { $exists: true, $ne: null },
    facebookCreatedAt: { $gte: istStart(istKey(Date.now() - 2 * DAY)) },
  });
  // Meta also counts leads from chat (Messages) campaigns — those reach the
  // CRM as chat leads, so they count as "reached" too.
  const recentChatLeads = await Lead.countDocuments({
    removed: false,
    chatConversationId: { $exists: true, $ne: null },
    chatLastAt: { $gte: istStart(istKey(Date.now() - 2 * DAY)) },
  });
  const lastChat = await Lead.findOne({ removed: false, chatConversationId: { $exists: true, $ne: null } }).sort({ chatLastAt: -1 }).select('chatLastAt').lean();
  const health = {
    lastCrmLeadAt,
    lastChatLeadAt: lastChat ? lastChat.chatLastAt : null,
    recentMetaLeads, // last 3 days, Meta
    recentCrmLeads, // last 3 days, form leads that reached the CRM
    recentChatLeads, // last 3 days, chats that reached the CRM
    missing: recentMetaLeads != null && recentMetaLeads > 0 && recentCrmLeads + recentChatLeads < recentMetaLeads,
    // Lead-form campaigns running — Messages campaigns never give form leads.
    leadFormActive: list.filter((r) => r.active && /LEAD/.test(String(r.objective || ''))).length,
    chatActive: list.filter((r) => r.active && /MESSAGES|ENGAGEMENT/.test(String(r.objective || ''))).length,
  };

  // ── ad chats that reached the CRM as leads (jobs/facebookChatPoller.js +
  // the WhatsApp webhook → services/marketing/chatLeads.js) ──
  const chatAgg = await Lead.aggregate([
    { $match: { removed: false, chatConversationId: { $exists: true, $ne: null }, chatStartedAt: when } },
    {
      $group: {
        _id: '$chatChannel',
        n: { $sum: 1 },
        withPhone: { $sum: { $cond: [{ $gt: [{ $strLenCP: { $ifNull: ['$phone', ''] } }, 7] }, 1, 0] } },
      },
    },
  ]);
  const chatLeads = { messenger: 0, instagram: 0, whatsapp: 0, total: 0, withPhone: 0 };
  chatAgg.forEach((g) => {
    if (g._id in chatLeads) chatLeads[g._id] = g.n;
    chatLeads.total += g.n;
    chatLeads.withPhone += g.withPhone;
  });
  const chatSync = {
    messengerError: conn.chatsPollError || null,
    instagramError: conn.chatsIgPollError || null,
    messengerAt: conn.chatsPolledAt || null,
    instagramAt: conn.chatsIgPolledAt || null,
    whatsappReady: !!process.env.DEROPO_ACCESS_TOKEN,
  };

  return res.status(200).json({
    success: true,
    result: {
      account: { id: act, name: conn.adAccountName || act, page: conn.pageName || null },
      range,
      since,
      until,
      totals,
      campaigns: list,
      health,
      chatLeads,
      chatSync,
      metaError,
      fetchedAt: new Date(),
    },
    message: 'ok',
  });
};


// GET /api/facebook/live-campaigns/:campaignId?range= — one campaign in full: its ads
// (Meta: spend / clicks / leads, Facebook vs Instagram) and every lead of it in the CRM.
const campaignDetail = async (req, res) => {
  const conn = await requireConnection(res, { needAdAccount: true });
  if (!conn) return;
  const id = String(req.params.campaignId || '');
  if (!/^(\d+|unknown)$/.test(id)) return res.status(400).json({ success: false, result: null, message: 'Bad campaign id.' });
  const { range, since, until, crmFrom, crmTo } = rangeOf(req.query || {});
  const token = decryptedUserToken(conn);

  let ads = [];
  let metaError = null;
  if (id !== 'unknown') {
    try {
      const rows = await graph.graphPaged(`/${id}/insights`, {
        level: 'ad',
        breakdowns: 'publisher_platform',
        fields: 'adset_id,adset_name,ad_id,ad_name,spend,impressions,clicks,actions',
        limit: 500,
        ...(since ? { time_range: JSON.stringify({ since, until }) } : { date_preset: 'maximum' }),
        access_token: token,
      });
      const byAd = new Map();
      for (const x of rows) {
        const k = String(x.ad_id);
        if (!byAd.has(k)) byAd.set(k, { adId: k, adName: x.ad_name, adsetName: x.adset_name, spend: 0, impressions: 0, clicks: 0, leads: 0, chats: 0, split: blankSplit() });
        const a = byAd.get(k);
        const leads = actionVal(x.actions, LEAD_ACTIONS);
        a.spend += Number(x.spend || 0);
        a.impressions += Number(x.impressions || 0);
        a.clicks += Number(x.clicks || 0);
        a.leads += leads;
        a.chats += actionVal(x.actions, CHAT_ACTIONS);
        a.split[PLATFORM_KEY[x.publisher_platform] || 'other'] += leads;
      }
      ads = [...byAd.values()]
        .map((a) => ({ ...a, cpl: a.leads ? a.spend / a.leads : 0, ctr: a.impressions ? (a.clicks / a.impressions) * 100 : 0 }))
        .sort((p, q) => q.leads - p.leads || q.spend - p.spend);
    } catch (err) {
      metaError = err.message;
    }
  }

  const Lead = mongoose.model('Lead');
  const when = { ...(crmFrom ? { $gte: crmFrom } : {}), $lt: crmTo };
  const ofCampaign =
    id === 'unknown'
      ? { metaCampaignId: { $in: [null, ''] }, 'rawMetaData.campaign_id': { $in: [null, ''] } }
      : { $or: [{ metaCampaignId: id }, { 'rawMetaData.campaign_id': id }] };
  const leads = await Lead.find({
    removed: false,
    facebookLeadId: { $exists: true, $ne: null },
    $and: [ofCampaign, { $or: [{ facebookCreatedAt: when }, { facebookCreatedAt: { $exists: false }, created: when }] }],
  })
    .select('name phone email stage subStatus assignedUserName metaPlatform metaAdsetName metaAdName metaFormName facebookCreatedAt created source')
    .sort({ facebookCreatedAt: -1, created: -1 })
    .limit(2000)
    .lean();

  return res.status(200).json({
    success: true,
    result: {
      campaignId: id,
      range,
      since,
      until,
      ads,
      metaError,
      leads: leads.map((l) => ({
        _id: l._id,
        name: l.name,
        phone: l.phone,
        email: l.email,
        stage: l.stage || 'New Lead',
        subStatus: l.subStatus || '',
        owner: l.assignedUserName || '',
        platform: LEAD_PLATFORM[l.metaPlatform] || 'unknown',
        adset: l.metaAdsetName || '',
        ad: l.metaAdName || '',
        form: l.metaFormName || '',
        at: l.facebookCreatedAt || l.created,
      })),
    },
    message: 'ok',
  });
};

module.exports = { liveCampaigns, campaignDetail, rangeOf };
