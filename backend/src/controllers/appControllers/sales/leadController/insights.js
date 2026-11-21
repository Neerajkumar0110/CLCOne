const mongoose = require('mongoose');
const { leadScopeFilter } = require('./scope');

// Lead Management dashboard (Marketing › Lead Management) — READ ONLY.
//
//   GET /api/lead/insights?from&to&channel&stage&assignedUser&team&q
//     → every number on the dashboard (KPIs, previous-period compare, trend,
//       sources, quality, funnel, rejection reasons, sales users)
//   GET /api/lead/insights/list?…same filters…&page&items&sort
//     → the "All leads" table, paged on the server
//
// Both build their filter with buildMatch() below, so a KPI, a chart and the
// table can never disagree: same leads, same date range, same filters. A lead
// "came in" at facebookCreatedAt (the ad platform's own time) or else created,
// the same rule as the Leads page's "Came in" column. Row visibility follows
// leadScopeFilter (scope.js) like every other lead read path.

const TZ = 'Asia/Kolkata';
const IST_MS = 330 * 60000;

// Where a lead came from, grouped into the channels a person thinks in. The raw
// lead.source stays untouched; this is only the grouping. LinkedIn, YouTube and
// Capture Form are always listed (0 when none), so it is visible that a channel
// is set up but has not brought a lead yet.
const CHANNELS = [
  ['LinkedIn', 'linkedin'],
  ['YouTube', 'youtube|yt\\b'],
  ['Capture Form', '^website$|capture|landing|web ?form|enquiry'],
  ['Meta (Facebook / Instagram)', 'facebook|^fb|instagram|messenger|meta'],
  ['Google', 'google'],
  ['WhatsApp', 'whatsapp'],
  ['Referral', 'referral'],
  ['Import', 'import'],
  ['Calls / Manual', 'calling|^call|manual|walk'],
];
const ALWAYS = ['Capture Form', 'LinkedIn', 'YouTube'];
const channelExpr = {
  $let: {
    vars: { s: { $ifNull: ['$source', ''] } },
    in: {
      $switch: {
        branches: CHANNELS.map(([name, rx]) => ({ case: { $regexMatch: { input: '$$s', regex: rx, options: 'i' } }, then: name })),
        default: { $cond: [{ $eq: ['$$s', ''] }, 'Unknown', 'Other'] },
      },
    },
  },
};

// Stage groups. Qualified = the lead showed real interest (1st discussion
// qualified, or reached Interested / Demo / Prospect / Future / Enrolled).
// Rejected = Not Interested or Invalid. Converted = Enrolled.
const QUALIFIED_STAGES = ['Interested Leads', 'Demo Booking', 'Prospects', 'Future Prospect', 'Enrolled'];
const REJECTED_STAGES = ['Not Interested Leads', 'Invalid Leads'];
const qualifiedExpr = {
  $or: [
    { $in: ['$stage', QUALIFIED_STAGES] },
    { $and: [{ $eq: ['$stage', 'Connected Leads'] }, { $regexMatch: { input: { $ifNull: ['$subStatus', ''] }, regex: 'qualified', options: 'i' } }] },
  ],
};
const convertedExpr = { $eq: ['$stage', 'Enrolled'] };
const rejectedExpr = { $in: ['$stage', REJECTED_STAGES] };
const sumIf = (cond) => ({ $sum: { $cond: [cond, 1, 0] } });

// Funnel = how far a lead has got now (its current stage or any later one).
const FUNNEL = [
  ['All leads', null],
  ['Connected', ['Connected Leads', 'Interested Leads', 'Callback', 'Demo Booking', 'Prospects', 'Future Prospect', 'Enrolled']],
  ['Interested', ['Interested Leads', 'Demo Booking', 'Prospects', 'Future Prospect', 'Enrolled']],
  ['Demo booked', ['Demo Booking', 'Prospects', 'Enrolled']],
  ['Prospect', ['Prospects', 'Enrolled']],
  ['Enrolled', ['Enrolled']],
];

const escapeRx = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const istDay = (d) => new Date(new Date(d).getTime() + IST_MS).toISOString().slice(0, 10);
function istStartOfDay(d) {
  const k = istDay(d);
  return new Date(new Date(`${k}T00:00:00.000Z`).getTime() - IST_MS);
}

function parseRange(q) {
  const now = new Date();
  let to = q.to ? new Date(q.to) : now;
  let from = q.from ? new Date(q.from) : new Date(istStartOfDay(now).getTime() - 29 * 864e5);
  if (Number.isNaN(+to)) to = now;
  if (Number.isNaN(+from)) from = new Date(istStartOfDay(now).getTime() - 29 * 864e5);
  if (from > to) [from, to] = [to, from];
  const span = to - from;
  const prevTo = new Date(from.getTime() - 1);
  const prevFrom = new Date(from.getTime() - span - 1);
  const days = span / 864e5;
  const auto = days <= 62 ? 'day' : days <= 200 ? 'week' : 'month';
  // the Day / Week / Month switch; a day per point is capped at ~2 years
  const bucket = ['day', 'week', 'month'].includes(q.bucket) && !(q.bucket === 'day' && days > 750) ? q.bucket : auto;
  return { from, to, prevFrom, prevTo, bucket };
}

// Filters other than the date range, as pipeline stages run after `cameIn` and
// `channel` are added. Kept separate so the previous period reuses them.
async function filterStages(req) {
  const q = req.query || {};
  const and = [];
  if (q.channel) and.push({ channel: String(q.channel) });
  if (q.stage) and.push({ stage: String(q.stage) });
  if (q.team) and.push({ team: String(q.team) });
  if (q.assignedUser === 'none') and.push({ assignedUser: null });
  else if (q.assignedUser && mongoose.isValidObjectId(q.assignedUser)) and.push({ assignedUser: new mongoose.Types.ObjectId(q.assignedUser) });
  // quality: qualified | converted | rejected | working (none of those yet)
  if (q.quality === 'qualified') and.push({ $expr: qualifiedExpr });
  else if (q.quality === 'converted') and.push({ $expr: convertedExpr });
  else if (q.quality === 'rejected') and.push({ $expr: rejectedExpr });
  else if (q.quality === 'working') and.push({ $expr: { $not: [{ $or: [qualifiedExpr, rejectedExpr] }] } });
  if (q.ids) {
    const ids = String(q.ids).split(',').filter((x) => mongoose.isValidObjectId(x)).slice(0, 5000);
    and.push({ _id: { $in: ids.map((x) => new mongoose.Types.ObjectId(x)) } });
  }
  if (q.q) {
    const rx = new RegExp(escapeRx(String(q.q).trim()), 'i');
    and.push({ $or: [{ name: rx }, { phone: rx }, { email: rx }, { 'attribution.utmCampaign': rx }] });
  }
  const scope = await leadScopeFilter(req.admin, req);
  if (Object.keys(scope).length) and.push(scope);
  return and;
}

const base = [
  { $match: { removed: { $ne: true } } },
  { $addFields: { cameIn: { $ifNull: ['$facebookCreatedAt', '$created'] }, channel: channelExpr } },
];
const inRange = (from, to) => ({ $match: { cameIn: { $gte: from, $lte: to } } });

function bucketKeys(from, to, bucket) {
  const keys = [];
  const seen = new Set();
  for (let t = istStartOfDay(from).getTime(); t <= to.getTime(); t += 864e5) {
    const k = keyOf(new Date(t), bucket);
    if (!seen.has(k)) {
      seen.add(k);
      keys.push(k);
    }
  }
  return keys;
}
function keyOf(d, bucket) {
  const day = istDay(d);
  if (bucket === 'month') return day.slice(0, 7);
  if (bucket === 'week') {
    const dt = new Date(`${day}T00:00:00.000Z`);
    const dow = (dt.getUTCDay() + 6) % 7; // Monday = 0
    return new Date(dt.getTime() - dow * 864e5).toISOString().slice(0, 10);
  }
  return day;
}
const bucketFmt = { day: '%Y-%m-%d', month: '%Y-%m' };

async function insights(req, res) {
  const Lead = mongoose.model('Lead');
  const { from, to, prevFrom, prevTo, bucket } = parseRange(req.query || {});
  const and = await filterStages(req);
  const filtered = and.length ? [{ $match: { $and: and } }] : [];
  const today0 = istStartOfDay(new Date());
  const yest0 = new Date(today0.getTime() - 864e5);

  const totals = { $group: { _id: null, total: { $sum: 1 }, qualified: sumIf(qualifiedExpr), converted: sumIf(convertedExpr), rejected: sumIf(rejectedExpr) } };
  const dateKey =
    bucket === 'week'
      ? { $dateToString: { format: '%Y-%m-%d', timezone: TZ, date: { $dateFromParts: { isoWeekYear: { $isoWeekYear: { date: '$cameIn', timezone: TZ } }, isoWeek: { $isoWeek: { date: '$cameIn', timezone: TZ } }, isoDayOfWeek: 1, timezone: TZ } } } }
      : { $dateToString: { format: bucketFmt[bucket], date: '$cameIn', timezone: TZ } };

  const [cur] = await Lead.aggregate([
    ...base,
    ...filtered,
    {
      $facet: {
        totals: [inRange(from, to), totals],
        prev: [inRange(prevFrom, prevTo), totals],
        today: [{ $match: { cameIn: { $gte: today0 } } }, { $count: 'n' }],
        yesterday: [{ $match: { cameIn: { $gte: yest0, $lt: today0 } } }, { $count: 'n' }],
        trend: [inRange(from, to), { $group: { _id: dateKey, n: { $sum: 1 }, qualified: sumIf(qualifiedExpr), converted: sumIf(convertedExpr), rejected: sumIf(rejectedExpr) } }],
        bySource: [inRange(from, to), { $group: { _id: '$channel', total: { $sum: 1 }, qualified: sumIf(qualifiedExpr), converted: sumIf(convertedExpr), rejected: sumIf(rejectedExpr), raw: { $addToSet: '$source' } } }],
        byStage: [inRange(from, to), { $group: { _id: '$stage', n: { $sum: 1 } } }],
        reasons: [inRange(from, to), { $match: { stage: { $in: REJECTED_STAGES } } }, { $group: { _id: { stage: '$stage', reason: { $ifNull: ['$subStatus', 'No reason given'] } }, n: { $sum: 1 } } }, { $sort: { n: -1 } }, { $limit: 15 }],
        // grouped by the owner id only: a blank and a missing name are the same "Unassigned"
        byUser: [inRange(from, to), { $group: { _id: '$assignedUser', name: { $max: '$assignedUserName' }, total: { $sum: 1 }, qualified: sumIf(qualifiedExpr), converted: sumIf(convertedExpr), rejected: sumIf(rejectedExpr) } }, { $sort: { total: -1 } }, { $limit: 25 }],
        campaigns: [inRange(from, to), { $match: { 'attribution.utmCampaign': { $nin: [null, ''] } } }, { $group: { _id: '$attribution.utmCampaign', total: { $sum: 1 }, converted: sumIf(convertedExpr) } }, { $sort: { total: -1 } }, { $limit: 10 }],
      },
    },
  ]);

  const t = cur.totals[0] || { total: 0, qualified: 0, converted: 0, rejected: 0 };
  const p = cur.prev[0] || { total: 0, qualified: 0, converted: 0, rejected: 0 };
  const pct = (a, b) => (b ? Math.round((a / b) * 1000) / 10 : 0);
  const block = (x) => ({ total: x.total, qualified: x.qualified, converted: x.converted, rejected: x.rejected, qualityPct: pct(x.qualified, x.total), conversionPct: pct(x.converted, x.total), rejectionPct: pct(x.rejected, x.total) });

  const tBy = new Map(cur.trend.map((x) => [x._id, x]));
  const trend = bucketKeys(from, to, bucket).map((k) => ({ key: k, n: tBy.get(k)?.n || 0, qualified: tBy.get(k)?.qualified || 0, converted: tBy.get(k)?.converted || 0, rejected: tBy.get(k)?.rejected || 0 }));

  const src = new Map(cur.bySource.map((x) => [x._id, x]));
  for (const name of ALWAYS) if (!src.has(name)) src.set(name, { _id: name, total: 0, qualified: 0, converted: 0, rejected: 0, raw: [] });
  const bySource = [...src.values()]
    .map((x) => ({ channel: x._id, raw: (x.raw || []).filter(Boolean).sort(), ...block(x) }))
    .sort((a, b) => b.total - a.total || a.channel.localeCompare(b.channel));

  const stageN = new Map(cur.byStage.map((x) => [x._id, x.n]));
  const funnel = FUNNEL.map(([label, stages]) => ({ label, n: stages ? stages.reduce((s, st) => s + (stageN.get(st) || 0), 0) : t.total }));

  return res.status(200).json({
    success: true,
    result: {
      range: { from, to, prevFrom, prevTo, bucket },
      definitions: {
        qualified: `Connected Leads marked qualified, or now in ${QUALIFIED_STAGES.join(' / ')}`,
        rejected: REJECTED_STAGES.join(' / '),
        converted: 'Enrolled',
        cameIn: 'Ad-platform time for ad leads, otherwise when the lead was created',
      },
      totals: block(t),
      prev: block(p),
      today: cur.today[0]?.n || 0,
      yesterday: cur.yesterday[0]?.n || 0,
      trend,
      bySource,
      byStage: cur.byStage.map((x) => ({ stage: x._id || 'No stage', n: x.n })).sort((a, b) => b.n - a.n),
      funnel,
      reasons: cur.reasons.map((x) => ({ stage: x._id.stage, reason: x._id.reason, n: x.n })),
      byUser: cur.byUser.map((x) => ({ adminId: x._id || null, name: x._id ? x.name || 'Unknown user' : 'Unassigned', ...block(x) })),
      campaigns: cur.campaigns.map((x) => ({ campaign: x._id, total: x.total, converted: x.converted })),
      channels: [...CHANNELS.map(([n]) => n), 'Other', 'Unknown'],
    },
  });
}

const SORTS = { newest: { cameIn: -1 }, oldest: { cameIn: 1 }, name: { name: 1 }, stage: { stage: 1, cameIn: -1 }, source: { channel: 1, cameIn: -1 }, owner: { assignedUserName: 1, cameIn: -1 } };

async function list(req, res) {
  const Lead = mongoose.model('Lead');
  const q = req.query || {};
  const { from, to } = parseRange(q);
  const and = await filterStages(req);
  const page = Math.max(1, parseInt(q.page, 10) || 1);
  const items = Math.min(100, Math.max(1, parseInt(q.items, 10) || 20));
  const sort = SORTS[q.sort] || SORTS.newest;
  const [r] = await Lead.aggregate([
    ...base,
    inRange(from, to),
    ...(and.length ? [{ $match: { $and: and } }] : []),
    {
      $facet: {
        rows: [
          { $sort: sort },
          { $skip: (page - 1) * items },
          { $limit: items },
          {
            $project: {
              name: 1, phone: 1, email: 1, source: 1, channel: 1, stage: 1, subStatus: 1, team: 1, city: 1,
              assignedUser: 1, assignedUserName: 1, cameIn: 1, created: 1, facebookCreatedAt: 1, lastContactAt: 1, stageUpdatedAt: 1,
              programInterest: 1, position: 1, campaign: '$attribution.utmCampaign', landingPage: '$attribution.landingPage',
              lastActivity: { $max: ['$lastContactAt', '$stageUpdatedAt'] },
              qualified: qualifiedExpr, converted: convertedExpr, rejected: rejectedExpr,
            },
          },
        ],
        count: [{ $count: 'n' }],
      },
    },
  ]);
  const count = r.count[0]?.n || 0;
  return res.status(200).json({ success: true, result: r.rows, pagination: { page, items, count, pages: Math.ceil(count / items) || 1 } });
}

// GET /api/lead/insights/export?…same filters…[&ids=a,b,c] — CSV of exactly
// the leads the All Leads table shows (or the ticked rows). Management only,
// the same rule as /lead/export.
async function exportCsv(req, res) {
  const { FULL_ACCESS_ROLES } = require('../../../../services/access/salesScope');
  if (!FULL_ACCESS_ROLES.includes(req.admin.role)) {
    return res.status(403).json({ success: false, result: null, message: 'Only management can export leads.' });
  }
  const Lead = mongoose.model('Lead');
  const q = req.query || {};
  const { from, to } = parseRange(q);
  const and = await filterStages(req);
  const rows = await Lead.aggregate([
    ...base,
    ...(q.ids ? [] : [inRange(from, to)]),
    ...(and.length ? [{ $match: { $and: and } }] : []),
    { $sort: SORTS[q.sort] || SORTS.newest },
    { $limit: 20000 },
    { $project: { name: 1, phone: 1, email: 1, city: 1, source: 1, channel: 1, stage: 1, subStatus: 1, assignedUserName: 1, cameIn: 1, position: 1, campaign: '$attribution.utmCampaign', qualified: qualifiedExpr, converted: convertedExpr, rejected: rejectedExpr } },
  ]);
  const cell = (v) => {
    const t = v == null ? '' : v instanceof Date ? new Date(v.getTime() + IST_MS).toISOString().replace('T', ' ').slice(0, 16) : String(v);
    return /[",\n\r]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
  };
  const head = ['Name', 'Phone', 'Email', 'City', 'Source', 'Channel', 'Campaign', 'Interest', 'Stage', 'Sub-status', 'Quality', 'Sales user', 'Came in (IST)'];
  const lines = rows.map((r) =>
    [r.name, r.phone, r.email, r.city, r.source, r.channel, r.campaign, r.position, r.stage, r.subStatus, r.converted ? 'Converted' : r.qualified ? 'Qualified' : r.rejected ? 'Rejected' : 'Still being worked', r.assignedUserName || 'Unassigned', r.cameIn].map(cell).join(',')
  );
  res.set('Content-Type', 'text/csv; charset=utf-8');
  res.set('Content-Disposition', `attachment; filename="leads-${istDay(new Date())}.csv"`);
  return res.status(200).send('\ufeff' + [head.join(','), ...lines].join('\r\n'));
}

// POST /api/lead/insights/note { id, text } — a note typed in the lead details
// drawer. Anyone who can see the lead (leadScopeFilter) can add one.
async function addNote(req, res) {
  const Lead = mongoose.model('Lead');
  const { id } = req.body || {};
  const text = String((req.body && req.body.text) || '').trim().slice(0, 2000);
  if (!mongoose.isValidObjectId(id) || !text) return res.status(400).json({ success: false, result: null, message: 'Write a note first.' });
  const scope = await leadScopeFilter(req.admin, req);
  const match = { _id: id, removed: false, ...(Object.keys(scope).length ? { $and: [scope] } : {}) };
  const note = { text, by: req.admin._id, byName: [req.admin.name, req.admin.surname].filter(Boolean).join(' '), at: new Date() };
  const lead = await Lead.findOneAndUpdate(match, { $push: { notesLog: note } }, { new: true, projection: { notesLog: 1 } }).lean();
  if (!lead) return res.status(404).json({ success: false, result: null, message: 'Lead not found.' });
  return res.status(200).json({ success: true, result: lead.notesLog, message: 'Note added.' });
}

module.exports = { insights, list, exportCsv, addNote };
