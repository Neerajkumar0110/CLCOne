const mongoose = require('mongoose');
const wd = require('../../../services/hr/workday');
const { SALES_ROLES } = require('../../../config/roles');
const { agentNotes, NOT_PLACED_RX } = require('../../../services/calling/callingShared');
const policy = require('../../../services/hr/attendancePolicy');
const { attendancePolicy: POLICY } = require('../../../config/shiftSchedule');
const { resolveScope } = require('../../../services/access/salesScope');
const { LEAD_STAGES } = require('../../../config/leadStages');
const { ACTIVE_DISPOSITIONS } = require('../../../services/calling/dispositions');

// /api/workday/admin/360* — the Sales 360° report: everything one Sales user
// (or the whole team) did over any range, from one minute of a day to a year.
// Attendance comes from WorkSession (or, on days without one, the dialer's own
// AgentActivity log — same fallback as the monthly report), calls from
// CallRecord (`agent` = the user who took it), responses from Lead.stageHistory.
// Management-only — workdayController wraps every handler in its guard.

const TZ = 'Asia/Kolkata';
const MAX_DAYS = 400;
const minutes = (a, b) => Math.max(0, Math.round((new Date(b) - new Date(a)) / 60000));
const istDay = (d) => new Date(d).toLocaleDateString('en-CA', { timeZone: TZ });
const escapeRx = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const last10 = (s) => String(s || '').replace(/\D/g, '').slice(-10);
const GENERIC_NAMES = ['', 'Inbound caller', 'Unknown', 'Unknown Number'];

// A call "connected" = the customer answered, the user's leg answered and
// there was talk time — the same rule as the Day board and monthly report.
const CONNECTED = { $and: [{ $ne: ['$answeredAt', null] }, { $ne: ['$agentLegAnswered', false] }, { $gt: ['$duration', 0] }] };
const sumIf = (cond, v = 1) => ({ $sum: { $cond: [cond, v, 0] } });
const callTotals = {
  calls: { $sum: 1 },
  outbound: sumIf({ $eq: ['$direction', 'Outbound'] }),
  inbound: sumIf({ $eq: ['$direction', 'Inbound'] }),
  connected: sumIf(CONNECTED),
  talkSec: { $sum: { $cond: [CONNECTED, { $ifNull: ['$duration', 0] }, 0] } },
  longestSec: { $max: { $cond: [CONNECTED, { $ifNull: ['$duration', 0] }, 0] } },
  shortCalls: sumIf({ $and: [CONNECTED, { $lt: ['$duration', 30] }] }),
  missed: sumIf({ $eq: ['$missedByAgent', true] }),
  recorded: sumIf({ $eq: ['$recording.status', 'available'] }),
  recordedSec: { $sum: { $cond: [{ $eq: ['$recording.status', 'available'] }, { $ifNull: ['$recording.durationSec', 0] }, 0] } },
  // Recorded although not "connected" — the customer answered but the user's
  // leg never did (the recording is just the customer side).
  recordedMissed: sumIf({ $and: [{ $eq: ['$recording.status', 'available'] }, { $not: [CONNECTED] }] }),
  numbers: { $addToSet: '$phone' },
};

// Talk length panel: [from second, label]. Every band shows, zero or not.
const TALK_BANDS = [[0, '< 30s'], [30, '30s–1m'], [60, '1–3m'], [180, '3–5m'], [300, '5–10m'], [600, '10–12m'], [720, '12–20m'], [1200, '20–30m'], [1800, '30m+']];

// Filters change what's read from calls and leads, not attendance or the user
// comparison, so those are kept for a moment instead of rebuilt on every pick.
// Refresh sends fresh=1 and rebuilds.
const memo = new Map();
function remembered(key, ms, fresh, fn) {
  const now = Date.now();
  for (const [k, v] of memo) if (v.until < now) memo.delete(k);
  const hit = memo.get(key);
  if (hit && !fresh) return hit.value;
  const value = Promise.resolve().then(fn);
  memo.set(key, { until: now + ms, value });
  value.catch(() => memo.delete(key));
  return value;
}

// from / to (ISO) → a clamped range plus the IST day keys it covers.
function parseRange(q) {
  const now = new Date();
  let to = q.to ? new Date(q.to) : now;
  let from = q.from ? new Date(q.from) : wd.dayBounds(wd.todayKey()).start;
  if (isNaN(to)) to = now;
  if (isNaN(from)) from = wd.dayBounds(wd.todayKey()).start;
  if (to > now) to = now;
  if (from > to) from = new Date(to.getTime() - 60000);
  if (to - from > MAX_DAYS * 864e5) from = new Date(to.getTime() - MAX_DAYS * 864e5);
  const dayKeys = [];
  for (let k = istDay(from); k <= istDay(to); k = istDay(new Date(wd.istAt(k, '12:00').getTime() + 864e5))) dayKeys.push(k);
  const spanH = (to - from) / 3600e3;
  const bucket = spanH <= 48 ? 'hour' : dayKeys.length <= 120 ? 'day' : 'month';
  return { from, to, dayKeys, bucket };
}

// ── The page's filter bar ───────────────────────────────────────────────
// Every section reads the same query, and no filter = everything:
//   outcome, direction, recorded, disposition, callType, talkBand, campaign → calls
//   payStatus                      → payment links
//   stage, sub, source, prospect   → leads now in that state, the calls to their
//                                    numbers and (stage / sub) the responses
//   attendance, short, dayType     → attendance by policy
//   types, path                    → activity log
//   q                              → search in leads, calls, activity, prospects
const FILTER_KEYS = ['disposition', 'callType', 'talkBand', 'campaign', 'payStatus', 'outcome', 'direction', 'recorded', 'stage', 'sub', 'source', 'prospect', 'lifecycle', '_payTails', 'q', 'me'];
// The policy's lead lifecycle (section 12) read from the 12 CRM stages, so
// neither old leads nor reports had to move. Payment ones come from the
// payment links (prepareFilters).
const LIFECYCLE = {
  new: { stage: 'New Lead', assignedUser: null },
  assigned: { stage: 'New Lead', assignedUser: { $ne: null } },
  attempted: { stage: { $in: ['No Response', 'Fresh Leads'] } },
  contacted: { stage: 'Connected Leads', subStatus: { $ne: '1st Discussion Done - Qualified' } },
  qualified: { stage: 'Connected Leads', subStatus: '1st Discussion Done - Qualified' },
  supervisor: { stage: 'Prospects', 'prospectVerification.status': { $exists: false } },
  verified: { 'prospectVerification.status': 'verified' },
  demo: { stage: { $in: ['Demo Booking', 'Interested Leads'] } },
  followup: { stage: { $in: ['Callback', 'Future Prospect'] } },
  enrolled: { stage: 'Enrolled' },
  lost: { stage: { $in: ['Not Interested Leads', 'Invalid Leads'] } },
};
async function prepareFilters(q) {
  delete q._payTails;
  if (q.lifecycle !== 'payment-pending' && q.lifecycle !== 'payment-received') return;
  const phones = await mongoose.model('PaymentRequest').distinct('studentPhone', { removed: false, status: q.lifecycle === 'payment-received' ? 'paid' : 'created' });
  q._payTails = [...new Set(phones.map(last10).filter((p) => p.length === 10))];
}
const prospectMatch = (q) => {
  if (q.prospect === 'pending') return { stage: 'Prospects', 'prospectVerification.status': { $exists: false } };
  if (q.prospect === 'verified' || q.prospect === 'rejected') return { 'prospectVerification.status': q.prospect };
  if (q.prospect === 'sent' && q.me && mongoose.isValidObjectId(q.me)) return { stage: 'Prospects', 'prospectVerification.status': { $exists: false }, 'prospectHandoffs.to': new mongoose.Types.ObjectId(q.me) };
  return null;
};
// Leads in the state the filters ask for → a Lead match, or null when none is set.
function leadMatch(q) {
  const and = [];
  if (q.stage) and.push({ stage: q.stage });
  if (q.sub) and.push({ subStatus: q.sub });
  if (q.source) and.push({ source: q.source });
  const pm = prospectMatch(q);
  if (pm) and.push(pm);
  if (LIFECYCLE[q.lifecycle]) and.push(LIFECYCLE[q.lifecycle]);
  if (Array.isArray(q._payTails)) and.push({ phoneNormalized: { $in: q._payTails } });
  return and.length ? { $and: and } : null;
}
// Extra conditions for a CallRecord query over these users and this range.
async function callFilter(q, ids, from, to) {
  // A call the provider refused for lack of balance never went out: not a call.
  const and = [{ notes: { $not: NOT_PLACED_RX } }];
  if (['Inbound', 'Outbound'].includes(q.direction)) and.push({ direction: q.direction });
  if (q.outcome === 'connected') and.push({ $expr: CONNECTED });
  else if (q.outcome === 'missed') and.push({ missedByAgent: true });
  else if (q.outcome === 'not-connected') and.push({ $expr: { $not: [CONNECTED] } });
  else if (q.outcome) and.push({ status: q.outcome, missedByAgent: { $ne: true }, $expr: { $not: [CONNECTED] } });
  if (q.recorded === '1') and.push({ 'recording.status': 'available' });
  if (q.disposition) and.push({ disposition: q.disposition });
  if (q.campaign && mongoose.isValidObjectId(q.campaign)) and.push({ campaign: new mongoose.Types.ObjectId(q.campaign) });
  const band = TALK_BANDS.findIndex(([sec]) => String(sec) === String(q.talkBand));
  if (band >= 0) {
    const next = TALK_BANDS[band + 1];
    and.push({ $expr: CONNECTED }, { duration: { $gte: TALK_BANDS[band][0], ...(next ? { $lt: next[0] } : {}) } });
  }
  if (q.callType === 'facebook') and.push({ instantLead: true });
  else if (q.callType === 'inbound') and.push({ direction: 'Inbound' });
  else if (q.callType === 'pool' || q.callType === 'dialer') {
    const pool = await mongoose.model('CallCampaign').findOne({ isLeadPool: true, removed: false }).select('_id').lean();
    const poolId = pool ? pool._id : null;
    if (q.callType === 'pool') and.push({ campaign: poolId });
    else and.push({ instantLead: { $ne: true }, direction: { $ne: 'Inbound' }, campaign: { $ne: poolId } });
  }
  const search = String(q.q || '').trim();
  if (search) {
    const rx = new RegExp(escapeRx(search), 'i');
    const or = [{ contactName: rx }, { disposition: rx }];
    const digits = search.replace(/\D/g, '');
    if (digits.length >= 3) or.push({ phone: new RegExp(escapeRx(digits)) });
    const named = await mongoose.model('Lead').find({ removed: false, name: rx }).select('phoneNormalized').limit(300).lean();
    const tails = [...new Set(named.map((l) => l.phoneNormalized).filter((p) => p && p.length === 10))];
    if (tails.length) or.push({ phone: new RegExp(`(${tails.join('|')})$`) });
    and.push({ $or: or });
  }
  const lm = leadMatch(q);
  if (lm) {
    const phones = await mongoose.model('CallRecord').distinct('phone', { removed: false, agent: { $in: ids }, created: { $gte: from, $lte: to } });
    const tails = [...new Set(phones.map(last10).filter((p) => p.length === 10))];
    const hit = new Set(tails.length ? await mongoose.model('Lead').distinct('phoneNormalized', { removed: false, phoneNormalized: { $in: tails }, ...lm }) : []);
    and.push({ phone: { $in: phones.filter((p) => hit.has(last10(p))) } });
  }
  return and;
}
// The same filters on Lead.stageHistory: which leads, and which of their changes.
function responseFilter(q) {
  const lead = {};
  if (q.source) lead.source = q.source;
  const pm = prospectMatch(q);
  if (pm) Object.assign(lead, pm);
  if (LIFECYCLE[q.lifecycle]) Object.assign(lead, LIFECYCLE[q.lifecycle]);
  if (Array.isArray(q._payTails)) lead.phoneNormalized = { $in: q._payTails };
  const search = String(q.q || '').trim();
  if (search) {
    const rx = new RegExp(escapeRx(search), 'i');
    const digits = search.replace(/\D/g, '');
    lead.$or = [{ name: rx }, { email: rx }, ...(digits.length >= 3 ? [{ phone: new RegExp(escapeRx(digits)) }] : [])];
  }
  const step = {};
  if (q.stage) step['stageHistory.toStage'] = q.stage;
  if (q.sub) step['stageHistory.toSubStatus'] = q.sub;
  return { lead, step };
}

// Deals, Quotes, Orders and Products for the same filters. Their owner is typed
// text, so a user / team / role filter matches it by name. Money is INR only:
// adding other currencies to it would be wrong.
async function salesRecords(q, users) {
  const { from, to } = parseRange(q);
  const created = { $gte: from, $lte: to };
  const owners = q.adminId || q.team || q.role ? { owner: { $in: users.flatMap((u) => [u.name, wd.fullName(u)]).filter(Boolean) } } : {};
  const search = String(q.q || '').trim();
  const rx = search ? new RegExp(escapeRx(search), 'i') : null;
  const dealMatch = { removed: false, created, ...owners, ...(q.dealStage ? { stage: q.dealStage } : {}), ...(rx ? { $or: [{ title: rx }, { account: rx }, { contactName: rx }, { contactPhone: rx }] } : {}) };
  const quoteMatch = { removed: false, created, ...owners, ...(q.quoteStatus ? { status: q.quoteStatus } : {}), ...(rx ? { $or: [{ number: rx }, { title: rx }, { account: rx }, { contactName: rx }] } : {}) };
  const orderMatch = { removed: false, created, ...owners, ...(q.orderStatus ? { status: q.orderStatus } : {}), ...(q.orderPayment ? { paymentStatus: q.orderPayment } : {}), ...(rx ? { $or: [{ number: rx }, { account: rx }] } : {}) };
  const sumINR = (field) => ({ $sum: { $cond: [{ $eq: ['$currency', 'INR'] }, { $ifNull: [`$${field}`, 0] }, 0] } });
  const [deals, quotes, orders, products] = await Promise.all([
    mongoose.model('SalesDeal').aggregate([{ $match: dealMatch }, { $group: { _id: null, n: { $sum: 1 }, value: sumINR('amount'), won: { $sum: { $cond: [{ $eq: ['$stage', 'Closed Won'] }, 1, 0] } } } }]),
    mongoose.model('SalesQuote').aggregate([{ $match: quoteMatch }, { $group: { _id: null, n: { $sum: 1 }, value: sumINR('total') } }]),
    mongoose.model('SalesOrder').aggregate([{ $match: orderMatch }, { $group: { _id: null, n: { $sum: 1 }, value: sumINR('total') } }]),
    mongoose.model('Product').countDocuments({ removed: false }),
  ]);
  return {
    deals: (deals[0] && deals[0].n) || 0,
    dealValue: (deals[0] && deals[0].value) || 0,
    dealsWon: (deals[0] && deals[0].won) || 0,
    quotes: (quotes[0] && quotes[0].n) || 0,
    quoteValue: (quotes[0] && quotes[0].value) || 0,
    orders: (orders[0] && orders[0].n) || 0,
    orderValue: (orders[0] && orders[0].value) || 0,
    products,
  };
}

async function salesUsers(q) {
  const filter = { removed: false, role: { $in: q.role && SALES_ROLES.includes(q.role) ? [q.role] : SALES_ROLES } };
  if (q.adminId && mongoose.isValidObjectId(q.adminId)) filter._id = q.adminId;
  else filter.enabled = true;
  const [users, teams, people] = await Promise.all([
    mongoose.model('Admin').find(filter).select('name surname role email photo').sort({ name: 1 }).lean(),
    mongoose.model('Team').find({ removed: false }).select('name lead members').lean(),
    mongoose.model('Admin').find({ removed: false, enabled: true, role: { $in: SALES_ROLES } }).select('name surname role email').sort({ name: 1 }).lean(),
  ]);
  const teamOf = (a) => {
    const keys = [a.name, wd.fullName(a)];
    const t = teams.find((x) => keys.includes(x.lead) || (x.members || []).some((m) => keys.includes(m)));
    return t ? t.name : null;
  };
  let list = users.map((u) => ({ ...u, team: teamOf(u) }));
  if (q.team) list = list.filter((u) => u.team === q.team);
  // A non-manager (q.self, set by workdayController) only ever picks themselves.
  const pick = q.self ? people.filter((u) => String(u._id) === String(q.adminId)) : people;
  return { users: list, teams: q.self ? [] : teams.map((t) => t.name).sort(), roles: q.self ? [] : [...new Set(people.map((u) => u.role))].sort(), people: pick.map((u) => ({ adminId: String(u._id), name: wd.fullName(u) || u.email, role: u.role })) };
}

// Per user × IST day: what CLC-POL-001 counts on top of the attendance facts.
//   attempts = dialer-originated outbound calls, each number once a day, so
//              retries and duplicates don't inflate it (section 6.2)
//   verified = prospects a Team Leader verified that day (section 7)
//   demos    = DemoBooking rows the candidate really joined (section 8)
async function policyFacts(ids, dayKeys, from, to) {
  const k = (a, d) => `${a}|${d}`;
  const facts = { attempts: new Map(), verified: new Map(), demos: new Map(), corrections: new Map(), recovery: new Map(), restDay: new Map() };
  const inLog = dayKeys[dayKeys.length - 1] >= POLICY.dialerLogFrom;
  const day = (field) => ({ $dateToString: { format: '%Y-%m-%d', date: field, timezone: TZ } });
  // Section 6.2 / 8: our own staff's numbers and anything named as a test don't count.
  const [staff, testCampaigns] = inLog
    ? await Promise.all([mongoose.model('Admin').find({ removed: false }).select('phone mobile contactNumber').lean(), mongoose.model('CallCampaign').distinct('_id', { name: /\test\/i })])
    : [[], []];
  const staffTails = [...new Set(staff.flatMap((a) => [a.phone, a.mobile, a.contactNumber]).map(last10).filter((p) => p.length === 10))];
  const internal = staffTails.flatMap((p) => [p, `91${p}`, `+91${p}`, `0${p}`]);
  const [attempts, verified, demos, corrections, rosters, outages, crm] = await Promise.all([
    inLog
      ? mongoose.model('CallRecord').aggregate([
          { $match: { removed: false, agent: { $in: ids }, created: { $gte: from, $lte: to }, direction: 'Outbound', phone: { $nin: internal }, contactName: { $not: /^test\/i }, campaign: { $ne: null, $nin: testCampaigns }, status: { $nin: ['queued', 'dialing', 'cancelled'] }, notes: { $not: NOT_PLACED_RX } } },
          { $group: { _id: { a: '$agent', d: day('$created'), p: '$phone' } } },
          { $group: { _id: { a: '$_id.a', d: '$_id.d' }, n: { $sum: 1 } } },
        ])
      : [],
    inLog
      ? mongoose.model('Lead').aggregate([
          { $match: { removed: false, 'prospectVerification.status': 'verified', 'prospectVerification.owner': { $in: ids }, 'prospectVerification.at': { $gte: from, $lte: to } } },
          { $group: { _id: { a: '$prospectVerification.owner', d: day('$prospectVerification.at') }, n: { $sum: 1 } } },
        ])
      : [],
    inLog
      ? mongoose.model('DemoBooking').aggregate([
          { $match: { removed: false, status: 'attended', agent: { $in: ids }, attendedAt: { $gte: from, $lte: to }, phone: { $nin: internal }, name: { $not: /^test\/i } } },
          { $group: { _id: { a: '$agent', d: day('$attendedAt') }, leads: { $addToSet: '$lead' } } },
        ])
      : [],
    mongoose.model('AttendanceCorrection').find({ admin: { $in: ids }, dayKey: { $in: dayKeys } }).sort({ created: 1 }).lean(),
    mongoose.model('SundayRoster').find({ removed: false, admin: { $in: ids }, $or: [{ sundayKey: { $in: dayKeys } }, { restDayKey: { $in: dayKeys } }] }).lean(),
    mongoose.model('OutageLog').find({ removed: false, from: { $lte: to }, to: { $gte: from } }).lean(),
    inLog ? mongoose.model('LoginActivity').find({ admin: { $in: ids }, loginAt: { $lte: to }, $or: [{ logoutAt: null }, { logoutAt: { $gte: from } }] }).select('admin loginAt logoutAt').lean() : [],
  ]);
  facts.outages = outages;
  facts.crm = crm;
  for (const x of attempts) facts.attempts.set(k(x._id.a, x._id.d), x.n);
  for (const x of verified) facts.verified.set(k(x._id.a, x._id.d), x.n);
  for (const x of demos) facts.demos.set(k(x._id.a, x._id.d), x.leads.length);
  for (const x of corrections) facts.corrections.set(k(x.admin, x.dayKey), x);
  for (const x of rosters) {
    facts.recovery.set(k(x.admin, x.sundayKey), x);
    facts.restDay.set(k(x.admin, x.restDayKey), x);
  }
  return facts;
}

// Per user × IST day: login / logout / worked / breaks / late / leave, from
// the WorkSession or (no session) rebuilt from the dialer's activity log.
async function attendance(users, dayKeys, from, to) {
  const ids = users.map((u) => u._id);
  // A break overrun's weekly grace (policy section 9) depends on the whole
  // calendar week, so the days of the week before the range are read too.
  const weekKeys = [];
  for (let k = policy.weekStart(dayKeys[0]); k < dayKeys[0]; k = istDay(new Date(wd.istAt(k, '12:00').getTime() + 864e5))) weekKeys.push(k);
  const activityFrom = wd.dayBounds(weekKeys[0] || dayKeys[0]).start;
  const dayStart = wd.dayBounds(dayKeys[0]).start;
  const [sessions, leaves, holidays, activity, callDays, facts] = await Promise.all([
    mongoose.model('WorkSession').find({ admin: { $in: ids }, dayKey: { $in: [...weekKeys, ...dayKeys] } }).lean(),
    mongoose
      .model('LeaveRequest')
      .find({ removed: false, status: 'Approved', adminId: { $in: ids.map(String) }, fromDate: { $lte: to }, toDate: { $gte: from } })
      .select('adminId fromDate toDate durationType hours leaveType')
      .lean(),
    wd.holidaysBetween(wd.dayBounds(dayKeys[0]).start, to),
    mongoose
      .model('AgentActivity')
      .find({ agent: { $in: ids }, at: { $gte: activityFrom, $lte: to }, kind: { $in: ['pool_on', 'pool_off', 'break_start', 'break_end'] } })
      .select('agent kind at detail by')
      .sort({ at: 1 })
      .lean(),
    mongoose.model('CallRecord').aggregate([
      { $match: { removed: false, agent: { $in: ids }, created: { $gte: wd.dayBounds(dayKeys[0]).start, $lte: to } } },
      { $group: { _id: { a: '$agent', d: { $dateToString: { format: '%Y-%m-%d', date: '$created', timezone: TZ } } }, firstAt: { $min: '$created' }, lastAt: { $max: { $ifNull: ['$endedAt', '$created'] } }, talkSec: callTotals.talkSec } },
    ]),
    policyFacts(ids, dayKeys, dayStart, to),
  ]);
  const key = (a, d) => `${a}|${d}`;
  const sBy = new Map(sessions.map((s) => [key(s.admin, s.dayKey), s]));
  const cBy = new Map(callDays.map((c) => [key(c._id.a, c._id.d), c]));
  const hBy = new Map(holidays.map((h) => [istDay(h.date), h]));
  const actBy = new Map();
  for (const e of activity) {
    const k = key(e.agent, istDay(e.at));
    if (!actBy.has(k)) actBy.set(k, []);
    actBy.get(k).push(e);
  }
  const derived = (uid, dk) => {
    const ev = actBy.get(key(uid, dk)) || [];
    const c = cBy.get(key(uid, dk));
    const starts = [...ev.filter((e) => e.kind === 'pool_on').map((e) => new Date(e.at)), c ? new Date(c.firstAt) : null].filter(Boolean);
    if (!starts.length) return null;
    const loginAt = new Date(Math.min(...starts));
    const ends = [...ev.filter((e) => e.kind === 'pool_off' && new Date(e.at) > loginAt).map((e) => new Date(e.at)), c ? new Date(c.lastAt) : null].filter(Boolean);
    const breaks = [];
    for (const e of ev) {
      if (e.kind === 'break_start') {
        const mins = Number((/(\d+)\s*min/.exec(e.detail || '') || [])[1]) || 15;
        breaks.push({ label: String(e.detail || 'Break').split(' · ')[0], startAt: e.at, plannedMin: mins });
      } else if (e.kind === 'break_end' && breaks.length && !breaks[breaks.length - 1].endAt) breaks[breaks.length - 1].endAt = e.at;
    }
    return { loginAt, logoutAt: ends.length ? new Date(Math.max(...ends)) : null, breaks, derived: true };
  };

  // Minutes the user was in the dialer pool (pool_on → pool_off) that day; an
  // un-closed pool_on runs to the end of the work span. null = no pool events
  // at all (the log only starts on 23 Oct 2026), i.e. unknown, not zero.
  const dialerMinutes = (uid, dk, endAt) => {
    const ev = (actBy.get(key(uid, dk)) || []).filter((e) => e.kind === 'pool_on' || e.kind === 'pool_off');
    if (!ev.length) return null;
    let on = null;
    let total = 0;
    for (const e of ev) {
      if (e.kind === 'pool_on' && !on) on = new Date(e.at);
      else if (e.kind === 'pool_off' && on) {
        total += minutes(on, e.at);
        on = null;
      }
    }
    if (on && endAt && new Date(endAt) > on) total += minutes(on, endAt);
    return total;
  };
  // The same on → off stretches, in milliseconds.
  const poolSpans = (uid, dk, endAt) => {
    const spans = [];
    let on = null;
    for (const e of actBy.get(key(uid, dk)) || []) {
      if (e.kind === 'pool_on' && on == null) on = new Date(e.at).getTime();
      else if (e.kind === 'pool_off' && on != null) {
        spans.push({ start: on, end: new Date(e.at).getTime() });
        on = null;
      }
    }
    if (on != null && endAt && new Date(endAt).getTime() > on) spans.push({ start: on, end: new Date(endAt).getTime() });
    return spans;
  };

  const today = wd.todayKey();
  const nowMs = Date.now();
  // How many of a day's breaks ran over: longer than planned, or the dialer
  // still off once the break was over and the grace had passed.
  const overrunsOn = (uid, dk) => {
    const s = sBy.get(key(uid, dk)) || derived(uid, dk);
    if (!s || !s.breaks || !s.breaks.length) return 0;
    const graceMs = POLICY.breakOverrunGraceMin * 60000;
    const stop = s.logoutAt ? new Date(s.logoutAt).getTime() : dk === today ? nowMs : wd.istAt(dk, wd.scheduleFor(dk).end).getTime();
    const spans = poolSpans(uid, dk, stop);
    return s.breaks.filter((b) => {
      const start = new Date(b.startAt).getTime();
      const plannedEnd = start + (b.plannedMin || 0) * 60000;
      const end = b.endAt ? new Date(b.endAt).getTime() : plannedEnd;
      if (end > plannedEnd + graceMs) return true;
      const check = end + graceMs;
      return spans.length > 0 && check < stop && check <= nowMs && !spans.some((x) => x.start <= check && x.end >= check);
    }).length;
  };

  const out = new Map(); // uid → [day rows]
  for (const u of users) {
    const uid = String(u._id);
    const mine = leaves.filter((l) => l.adminId === uid);
    const overruns = {};
    for (const dk of [...weekKeys, ...dayKeys]) if (wd.policyApplies(dk) && dk <= today) overruns[dk] = overrunsOn(uid, dk);
    const overrunEvents = policy.breakOverrunEvents(overruns);
    const rows = [];
    for (const dk of dayKeys) {
      const W = wd.scheduleFor(dk);
      const s = sBy.get(key(uid, dk)) || derived(uid, dk);
      const ws = wd.istAt(dk, W.start);
      const we = wd.istAt(dk, W.end);
      const holiday = hBy.get(dk);
      const recovery = facts.recovery.get(key(uid, dk));
      const restDay = facts.restDay.get(key(uid, dk));
      const weeklyOff = W.weeklyOff.includes(wd.istAt(dk, '12:00').getUTCDay()) && !recovery;
      const { start: ds, end: de } = wd.dayBounds(dk);
      const dayLeaves = mine.filter((l) => new Date(l.fromDate) <= de && new Date(l.toDate) >= ds);
      const full = dayLeaves.find((l) => new Date(l.fromDate) <= ws && new Date(l.toDate) >= we);
      const leaveDay = full ? 1 : dayLeaves.reduce((x, l) => x + (l.durationType === 'half' ? 0.5 : l.durationType === 'hours' ? (l.hours || 0) / 8 : 0), 0);
      const startAt = s && (s.loginAt || s.autoStartedAt);
      const endCap = dk === today ? new Date() : we;
      const endAt = s && (s.logoutAt || (startAt && endCap > new Date(startAt) ? endCap : null));
      const breaks = (s && s.breaks ? s.breaks : []).map((b) => {
        const e = b.endAt || new Date(Math.min(new Date(endAt || endCap), b.plannedMin ? new Date(b.startAt).getTime() + b.plannedMin * 60000 : wd.plannedEnd(b)));
        return { label: b.label, startAt: b.startAt, endAt: e, minutes: minutes(b.startAt, e) };
      });
      const breakMin = breaks.reduce((x, b) => x + b.minutes, 0);
      const loginMin = startAt && endAt ? minutes(startAt, endAt) : 0;
      const activeMin = Math.max(0, loginMin - breakMin);
      const pool = dialerMinutes(uid, dk, endAt || endCap);
      const workingDay = !holiday && !weeklyOff && !restDay;

      // CLC-POL-001: what the day's real numbers qualify for. Decides the day
      // from effectiveFrom; before that it's only shown as a preview.
      const applies = wd.policyApplies(dk);
      let policyDay = null;
      if (workingDay && dk >= POLICY.dialerLogFrom) {
        const holes = [
          ...breaks.map((b) => ({ start: new Date(b.startAt).getTime(), end: new Date(b.endAt).getTime() })),
          ...dayLeaves.map((l) => ({ start: new Date(l.fromDate).getTime(), end: new Date(l.toDate).getTime() })),
        ];
        const stop = new Date(endAt || endCap).getTime();
        const spans = poolSpans(uid, dk, stop);
        // Logged outage / training / meeting (section 6.1): credited, not held against them.
        const outs = (facts.outages || []).filter((o) => new Date(o.from) <= we && new Date(o.to) >= ws && (!(o.admins || []).length || o.admins.map(String).includes(uid)));
        const credit = policy.spanMinutes(
          outs.map((o) => ({ start: Math.max(new Date(o.from).getTime(), ws.getTime()), end: Math.min(new Date(o.to).getTime(), we.getTime(), nowMs) })).filter((x) => x.end > x.start),
          [...spans, ...holes]
        );
        // CRM closed while "on the dialer" (unauthorised disconnection): not dialer time.
        const gaps = [];
        const sessions = (facts.crm || [])
          .filter((x) => String(x.admin) === uid && new Date(x.loginAt).getTime() <= stop && (!x.logoutAt || new Date(x.logoutAt).getTime() >= ds.getTime()))
          .map((x) => ({ start: new Date(x.loginAt).getTime(), end: x.logoutAt ? new Date(x.logoutAt).getTime() : stop }))
          .sort((a, b) => a.start - b.start);
        if (sessions.length && !outs.length) {
          let at = ds.getTime();
          for (const x of sessions) {
            if (x.start - at > POLICY.disconnectGraceMin * 60000) gaps.push({ start: at, end: x.start });
            at = Math.max(at, x.end);
          }
          if (stop - at > POLICY.disconnectGraceMin * 60000) gaps.push({ start: at, end: stop });
        }
        const onDialer = policy.spanMinutes(spans, [...holes, ...gaps]);
        const c = cBy.get(key(uid, dk));
        const metrics = {
          verifiedProspects: facts.verified.get(key(uid, dk)) || 0,
          attendedDemos: facts.demos.get(key(uid, dk)) || 0,
          attempts: facts.attempts.get(key(uid, dk)) || 0,
          talkSec: (c && c.talkSec) || 0,
          dialerMin: onDialer + credit,
          lostMin: policy.spanMinutes(spans, holes) - onDialer,
          creditMin: credit,
        };
        const shortLeave = [];
        const o = overrunEvents[dk];
        if (applies) {
          // The system's own auto-start doesn't make someone on time: they, or
          // a manager, must have had the dialer on, or pressed Login, by then.
          const ev = actBy.get(key(uid, dk)) || [];
          const by = wd.istAt(dk, POLICY.dialerBy).getTime() + 59999;
          const selfOn = ev.find((e) => e.kind === 'pool_on' && e.by);
          const login = s && s.loginAt && !s.derived ? new Date(s.loginAt).getTime() : null;
          const onTime = (selfOn && new Date(selfOn.at).getTime() <= by) || (login != null && login <= by);
          const onLeaveThen = dayLeaves.some((l) => new Date(l.fromDate).getTime() <= by && new Date(l.toDate).getTime() >= by);
          if (ev.some((e) => e.kind === 'pool_on') && !onTime && !onLeaveThen && !outs.length) shortLeave.push({ kind: 'dialer-late', at: (selfOn && selfOn.at) || (s && (s.loginAt || s.autoStartedAt)), label: `Dialer not on by ${POLICY.dialerBy}` });
          if (o && o.events && !outs.length) shortLeave.push({ kind: 'break-overrun', label: overruns[dk] >= 2 ? `${overruns[dk]} break overruns` : 'Break overrun after the weekly grace' });
        }
        policyDay = { ...policy.evaluateDay(metrics), metrics, preview: !applies, shortLeave, overruns: overruns[dk] || 0, breakGrace: !!(o && o.grace), outages: outs.map((x) => ({ kind: x.kind, reason: x.reason })) };
      }
      // Time in the pool, without the breaks that fall inside it.
      const breakHoles = breaks.map((b) => ({ start: new Date(b.startAt).getTime(), end: new Date(b.endAt).getTime() }));
      const dialerMin = policyDay && applies ? policyDay.metrics.dialerMin : pool == null ? null : Math.min(activeMin, policy.spanMinutes(poolSpans(uid, dk, endAt || endCap), breakHoles));
      let status;
      if (holiday) status = 'holiday';
      else if (restDay && !startAt) status = 'rest-day';
      else if (weeklyOff && !startAt) status = 'weekly-off';
      else if (full) status = 'leave';
      else if (s && s.loginAt) status = 'present';
      else if (s && s.autoStartedAt) status = 'auto';
      else status = dk === today && new Date() < ws ? 'upcoming' : 'absent';
      // late login → half day / full-day leave (shiftSchedule.workday.lateLogin)
      const penalty = status === 'present' && !weeklyOff ? wd.lateLoginPenalty(dk, s.loginAt, { derived: !!s.derived || !!s.markedPresentBy, leaveDay }) : null;
      if (penalty) status = penalty.kind;
      if (policyDay && applies && !full && status !== 'upcoming') {
        if (dk === today && new Date() < we && startAt) status = 'in-progress';
        else status = { full: 'present', half: 'half-day', absent: 'absent' }[policyDay.level];
      }
      // A manager's correction wins, and keeps what the rules said (section 14).
      const correction = facts.corrections.get(key(uid, dk));
      if (correction && correction.revisedStatus) status = correction.revisedStatus;
      const shortLeaveCount = correction && correction.revisedShortLeave != null ? correction.revisedShortLeave : policyDay ? policyDay.shortLeave.length : 0;
      rows.push({
        dayKey: dk,
        status,
        policy: policyDay,
        shortLeave: shortLeaveCount,
        dayType: holiday ? 'holiday' : restDay ? 'substitute-rest' : recovery ? 'recovery' : weeklyOff ? 'weekly-off' : 'working',
        correction: correction ? { revisedStatus: correction.revisedStatus, originalStatus: correction.originalStatus, reason: correction.reason, by: correction.approvedByName, at: correction.created } : null,
        derived: !!(s && s.derived),
        holiday: holiday ? holiday.name : null,
        leave: dayLeaves.map((l) => l.leaveType).join(', ') || null,
        // approved leave + any late-login leave counted for this day
        leaveDay: leaveDay + (penalty ? penalty.leave : 0),
        lateLoginNote: penalty ? penalty.label : null,
        markedPresentBy: (s && s.markedPresentBy) || null,
        logoutReminderAt: (s && s.logoutReminderAt) || null,
        workingDay,
        loginAt: s && s.loginAt,
        autoStartedAt: s && s.autoStartedAt,
        startAt: startAt || null,
        logoutAt: s && s.logoutAt,
        endAt,
        lateMin: s && s.loginAt && !s.derived ? Math.max(0, minutes(ws, s.loginAt)) : 0,
        loginMin,
        breakMin,
        activeMin,
        dialerMin,
        // Working (not on a break) but out of the dialer.
        offMin: dialerMin == null ? null : Math.max(0, activeMin - dialerMin),
        breaks,
      });
    }
    out.set(uid, rows);
  }
  return out;
}

const fillBuckets = (bucket, from, to, dayKeys) => {
  if (bucket === 'day') return dayKeys;
  if (bucket === 'month') return [...new Set(dayKeys.map((d) => d.slice(0, 7)))];
  const keys = [];
  const step = 3600e3;
  // IST is UTC+5:30, so an IST hour starts at :30 UTC — flooring to a UTC
  // hour put a stray "11 PM" (previous day) bucket in front of a day range.
  const ist = 5.5 * 3600e3;
  for (let t = Math.floor((from.getTime() + ist) / step) * step - ist; t <= to.getTime(); t += step) {
    const d = new Date(t);
    keys.push(`${istDay(d)} ${d.toLocaleTimeString('en-GB', { timeZone: TZ, hour: '2-digit', hour12: false })}`);
  }
  return [...new Set(keys)];
};

// ── What the calls turned into ─────────────────────────────────────────
// Each step = unique leads a user moved INTO that stage / sub-status within
// the range (Lead.stageHistory.changedBy) — the same source as responses.
const STEPS = [
  ['connected', (x) => x.s === 'Connected Leads'],
  ['qualified', (x) => x.s === 'Connected Leads' && /- Qualified$/.test(x.ss || '')],
  ['demoBooked', (x) => x.s === 'Demo Booking' && x.ss === 'Demo Booked'],
  ['demoAttended', (x) => x.s === 'Demo Booking' && x.ss === 'Demo Attended'],
  ['demoMissed', (x) => x.s === 'Demo Booking' && x.ss === 'Demo Not Attended'],
  ['interested', (x) => x.s === 'Interested Leads'],
  ['prospects', (x) => x.s === 'Prospects'],
  ['future', (x) => x.s === 'Future Prospect'],
  ['callback', (x) => x.s === 'Callback'],
  ['enrolled', (x) => x.s === 'Enrolled'],
  ['notInterested', (x) => x.s === 'Not Interested Leads'],
  ['invalid', (x) => x.s === 'Invalid Leads'],
  ['noResponse', (x) => x.s === 'No Response'],
];
// groups: [{ s, ss, leads: [leadId] }] → step counts + reason / plan breakdowns
function salesOutcome(groups) {
  const out = {};
  for (const [key, test] of STEPS) {
    const set = new Set();
    for (const g of groups) if (test(g)) for (const l of g.leads) set.add(String(l));
    out[key] = set.size;
  }
  const breakdown = (stage) => {
    const m = new Map();
    for (const g of groups.filter((x) => x.s === stage)) {
      const k = g.ss || stage;
      if (!m.has(k)) m.set(k, new Set());
      for (const l of g.leads) m.get(k).add(String(l));
    }
    return [...m].map(([key, set]) => ({ key, n: set.size })).sort((a, b) => b.n - a.n);
  };
  out.notInterestedWhy = breakdown('Not Interested Leads');
  out.enrolledPlans = breakdown('Enrolled');
  out.invalidWhy = breakdown('Invalid Leads');
  return out;
}

// Payment links + money, per Sales user. A link belongs to whoever created
// it; the auto-created EMI instalments of a plan belong to whoever created
// that plan's first link (same planGroupId). Range = created or paid in it.
async function payments(ids, from, to, withList, q = {}) {
  const PR = mongoose.model('PaymentRequest');
  const idSet = new Set(ids.map(String));
  const own = await PR.find({ removed: false, createdBy: { $in: ids }, planGroupId: { $nin: [null, ''] } }).select('planGroupId createdBy').lean();
  const groupOwner = new Map(own.map((p) => [p.planGroupId, String(p.createdBy)]));
  const docs = await PR.find({
    removed: false,
    $and: [
      { $or: [{ createdBy: { $in: ids } }, { planGroupId: { $in: [...groupOwner.keys()] } }] },
      { $or: [{ created: { $gte: from, $lte: to } }, { paidAt: { $gte: from, $lte: to } }] },
    ],
  })
    .select('studentName studentEmail studentPhone course amount status paidAt created dueAt createdBy createdByName installmentNo installmentCount planTotal planGroupId')
    .sort({ created: -1 })
    .lean();
  // Filter bar: only the money of leads in that stage / source / prospect state.
  const lm = leadMatch(q);
  let hits = null;
  if (lm) {
    const tails = [...new Set(docs.map((p) => last10(p.studentPhone)).filter((x) => x.length === 10))];
    hits = new Set(tails.length ? await mongoose.model('Lead').distinct('phoneNormalized', { removed: false, phoneNormalized: { $in: tails }, ...lm }) : []);
  }
  const search = String(q.q || '').trim().toLowerCase();
  const blank = () => ({ links: 0, paid: 0, collected: 0, newEnrolments: 0, dealValue: 0, pending: 0, pendingAmount: 0, expired: 0 });
  const by = new Map();
  const total = blank();
  const inRange = (d) => d && new Date(d) >= from && new Date(d) <= to;
  const list = [];
  for (const p of docs) {
    if (hits && !hits.has(last10(p.studentPhone))) continue;
    if (q.payStatus && p.status !== q.payStatus) continue;
    if (search && !`${p.studentName || ''} ${p.studentPhone || ''} ${p.studentEmail || ''} ${p.course || ''}`.toLowerCase().includes(search)) continue;
    const owner = p.createdBy && idSet.has(String(p.createdBy)) ? String(p.createdBy) : groupOwner.get(p.planGroupId);
    if (!owner) continue;
    if (!by.has(owner)) by.set(owner, blank());
    for (const t of [by.get(owner), total]) {
      if (inRange(p.created) && String(p.createdBy || '') === owner) t.links += 1;
      if (p.status === 'paid' && inRange(p.paidAt)) {
        t.paid += 1;
        t.collected += p.amount || 0;
        if ((p.installmentNo || 1) === 1) {
          t.newEnrolments += 1;
          t.dealValue += p.planTotal || p.amount || 0;
        }
      }
      if (p.status === 'created' && inRange(p.created)) {
        t.pending += 1;
        t.pendingAmount += p.amount || 0;
      }
      if ((p.status === 'expired' || p.status === 'failed') && inRange(p.created)) t.expired += 1;
    }
    if (withList && list.length < 100)
      list.push({
        _id: p._id,
        name: p.studentName,
        email: p.studentEmail,
        phone: p.studentPhone,
        course: p.course,
        amount: p.amount,
        status: p.status,
        created: p.created,
        paidAt: p.paidAt,
        dueAt: p.dueAt,
        installment: p.installmentCount > 1 ? `${p.installmentNo || 1}/${p.installmentCount}` : null,
        planTotal: p.planTotal || null,
        by: p.createdByName,
      });
  }
  return { by, total, list };
}

// One user's own pipeline right now: leads whose latest stage change was
// theirs (Lead.assignedUser is barely used here), by stage, plus demos /
// callbacks / follow-ups coming up or overdue.
async function pipelineOf(adminId) {
  const uid = new mongoose.Types.ObjectId(String(adminId));
  const now = new Date();
  const leads = await mongoose.model('Lead').aggregate([
    { $match: { removed: false, 'stageHistory.changedBy': uid } },
    { $project: { name: 1, phone: 1, stage: 1, subStatus: 1, meetingAt: 1, callBackAt: 1, futureFollowUpAt: 1, last: { $arrayElemAt: ['$stageHistory', -1] } } },
    { $match: { 'last.changedBy': uid } },
    { $project: { last: 0 } },
  ]);
  const byStage = new Map();
  for (const l of leads) byStage.set(l.stage, (byStage.get(l.stage) || 0) + 1);
  const pick = (l, at) => ({ _id: l._id, name: l.name, phone: l.phone, stage: l.stage, subStatus: l.subStatus, at });
  const sortAt = (a, b) => new Date(a.at) - new Date(b.at);
  const demos = leads.filter((l) => l.stage === 'Demo Booking' && l.subStatus === 'Demo Booked' && l.meetingAt).map((l) => pick(l, l.meetingAt)).sort(sortAt);
  const callbacks = leads.filter((l) => l.stage === 'Callback' && l.callBackAt).map((l) => pick(l, l.callBackAt)).sort(sortAt);
  const future = leads.filter((l) => l.stage === 'Future Prospect' && l.futureFollowUpAt).map((l) => pick(l, l.futureFollowUpAt)).sort(sortAt);
  const split = (arr) => {
    const overdue = arr.filter((x) => new Date(x.at) < now);
    const upcoming = arr.filter((x) => new Date(x.at) >= now);
    return { overdue: overdue.slice(-30).reverse(), upcoming: upcoming.slice(0, 30), overdueCount: overdue.length, upcomingCount: upcoming.length };
  };
  return {
    leads: leads.length,
    byStage: [...byStage].map(([key, n]) => ({ key, n })).sort((a, b) => b.n - a.n),
    demos: split(demos),
    callbacks: split(callbacks),
    future: split(future),
  };
}

// Stage sets Leads Analytics used (analyticsController/modules/leads.js,
// removed 2026-10-27) — reused by the Used leads section below.
const QUALIFIED = ['Interested Leads', 'Demo Booking', 'Prospects', 'Enrolled'];
const MEETING = ['Demo Booking', 'Prospects', 'Enrolled'];

// The whole report for one query (no adminId = every Sales user / the team).
async function build(q) {
  const { from, to, dayKeys, bucket } = parseRange(q);
  const { users, teams, roles, people } = await salesUsers(q);
  const ids = users.map((u) => u._id);
  const match = { removed: false, agent: { $in: ids }, created: { $gte: from, $lte: to } };
  const fmt = bucket === 'hour' ? '%Y-%m-%d %H' : bucket === 'day' ? '%Y-%m-%d' : '%Y-%m';
  const Lead = mongoose.model('Lead');

  // The same-length window right before — for "vs previous period".
  const prevTo = new Date(from.getTime() - 1);
  const prevFrom = new Date(from.getTime() - (to - from) - 1);
  const [callAnd, prevAnd] = await Promise.all([callFilter(q, ids, from, to), callFilter(q, ids, prevFrom, prevTo)]);
  if (callAnd.length) match.$and = callAnd;
  const rf = responseFilter(q);
  const stepMatch = { 'stageHistory.changedBy': { $in: ids }, 'stageHistory.at': { $gte: from, $lte: to }, ...rf.step };
  const [facets, att, pay, responses, prevCalls] = await Promise.all([
    mongoose.model('CallRecord').aggregate([
      { $match: match },
      { $project: { agent: 1, created: 1, direction: 1, answeredAt: 1, agentLegAnswered: 1, duration: 1, missedByAgent: 1, status: 1, disposition: 1, phone: 1, 'recording.status': 1, 'recording.durationSec': 1 } },
      {
        $facet: {
          totals: [{ $group: { _id: null, ...callTotals } }, { $addFields: { unique: { $size: '$numbers' } } }, { $project: { numbers: 0 } }],
          byUser: [{ $group: { _id: '$agent', ...callTotals, firstCall: { $min: '$created' }, lastCall: { $max: '$created' } } }, { $addFields: { unique: { $size: '$numbers' } } }, { $project: { numbers: 0 } }],
          trend: [{ $group: { _id: { $dateToString: { format: fmt, date: '$created', timezone: TZ } }, calls: { $sum: 1 }, connected: sumIf(CONNECTED), talkSec: callTotals.talkSec } }],
          byDay: [{ $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$created', timezone: TZ } }, calls: { $sum: 1 }, connected: sumIf(CONNECTED), talkSec: callTotals.talkSec, missed: callTotals.missed } }],
          heat: [{ $group: { _id: { d: { $dayOfWeek: { date: '$created', timezone: TZ } }, h: { $hour: { date: '$created', timezone: TZ } } }, calls: { $sum: 1 }, connected: sumIf(CONNECTED) } }],
          outcomes: [{ $group: { _id: { $cond: [CONNECTED, 'connected', { $cond: [{ $eq: ['$missedByAgent', true] }, 'missed', '$status'] }] }, n: { $sum: 1 } } }],
          dispositions: [{ $match: { disposition: { $nin: [null, ''] } } }, { $group: { _id: '$disposition', n: { $sum: 1 } } }, { $sort: { n: -1 } }, { $limit: 12 }],
          talkBands: [
            { $match: { $expr: CONNECTED } },
            { $bucket: { groupBy: '$duration', boundaries: TALK_BANDS.map((b) => b[0]).concat(1e9), default: 'other', output: { n: { $sum: 1 } } } },
          ],
        },
      },
    ]),
    remembered(`att|${ids.join()}|${from.getTime()}|${to.getTime() > Date.now() - 6e4 ? 'now' : to.getTime()}`, 45e3, q.fresh === '1', () => attendance(users, dayKeys, from, to)),
    payments(ids, from, to, true, q),
    Lead.aggregate([
      { $match: { removed: false, 'stageHistory.changedBy': { $in: ids }, 'stageHistory.at': { $gte: from, $lte: to }, ...rf.lead } },
      { $project: { stageHistory: 1 } },
      { $unwind: '$stageHistory' },
      { $match: stepMatch },
      {
        $facet: {
          byStage: [{ $group: { _id: '$stageHistory.toStage', n: { $sum: 1 }, leads: { $addToSet: '$_id' } } }, { $project: { n: 1, leads: { $size: '$leads' } } }, { $sort: { n: -1 } }],
          byUser: [{ $group: { _id: '$stageHistory.changedBy', n: { $sum: 1 }, leads: { $addToSet: '$_id' } } }, { $project: { n: 1, leads: { $size: '$leads' } } }],
          total: [{ $group: { _id: null, n: { $sum: 1 }, leads: { $addToSet: '$_id' } } }, { $project: { n: 1, leads: { $size: '$leads' } } }],
          funnel: [{ $group: { _id: { u: '$stageHistory.changedBy', s: '$stageHistory.toStage', ss: '$stageHistory.toSubStatus' }, leads: { $addToSet: '$_id' } } }],
        },
      },
    ]),
    mongoose.model('CallRecord').aggregate([
      { $match: { removed: false, agent: { $in: ids }, created: { $gte: prevFrom, $lte: prevTo }, ...(prevAnd.length ? { $and: prevAnd } : {}) } },
      { $project: { agent: 1, created: 1, direction: 1, answeredAt: 1, agentLegAnswered: 1, duration: 1, missedByAgent: 1, status: 1, disposition: 1, phone: 1, 'recording.status': 1, 'recording.durationSec': 1 } },
      {
        $facet: {
          totals: [{ $group: { _id: null, ...callTotals } }, { $addFields: { unique: { $size: '$numbers' } } }, { $project: { numbers: 0 } }],
          byUser: [{ $group: { _id: '$agent', ...callTotals } }, { $addFields: { unique: { $size: '$numbers' } } }, { $project: { numbers: 0 } }],
        },
      },
    ]),
  ]);
  const pc = prevCalls[0];
  const pcBy = new Map(pc.byUser.map((x) => [String(x._id), x]));
  const callsPrevOf = (c) => {
    const x = c || {};
    return {
      calls: x.calls || 0,
      connected: x.connected || 0,
      connectRate: x.calls ? Math.round((x.connected / x.calls) * 1000) / 10 : 0,
      talkSec: x.talkSec || 0,
      avgTalkSec: x.connected ? Math.round(x.talkSec / x.connected) : 0,
      unique: x.unique || 0,
      missed: x.missed || 0,
    };
  };
  const f = facets[0];
  const r = responses[0] || { byStage: [], byUser: [], total: [], funnel: [] };
  const fg = (r.funnel || []).map((g) => ({ u: String(g._id.u), s: g._id.s, ss: g._id.ss, leads: g.leads }));
  const salesOf = (uid) => salesOutcome(uid ? fg.filter((g) => g.u === uid) : fg);
  const leadsIn = (list) => new Set(list.flatMap((g) => g.leads.map(String))).size;
  // Unique leads moved into each stage: { 'Demo Booking': 4, ... }
  const stageCounts = (groups) => Object.fromEntries(LEAD_STAGES.map((st) => [st.stage, leadsIn(groups.filter((g) => g.s === st.stage))]));
  // Every stage and sub-status of the pipeline, zero counts included.
  const stageTree = LEAD_STAGES.map((st) => {
    const mine = fg.filter((g) => g.s === st.stage);
    const extra = [...new Set(mine.map((g) => g.ss).filter((x) => x && !st.subStatuses.includes(x)))];
    return {
      stage: st.stage,
      color: st.color,
      n: leadsIn(mine),
      subs: [...st.subStatuses, ...extra].map((key) => ({ key, n: leadsIn(mine.filter((g) => g.ss === key)) })),
    };
  });
  const payBlank = { links: 0, paid: 0, collected: 0, newEnrolments: 0, dealValue: 0, pending: 0, pendingAmount: 0, expired: 0 };
  const blank = { calls: 0, outbound: 0, inbound: 0, connected: 0, talkSec: 0, longestSec: 0, shortCalls: 0, missed: 0, recorded: 0, recordedSec: 0, recordedMissed: 0, unique: 0 };
  const cBy = new Map(f.byUser.map((x) => [String(x._id), x]));
  const rBy = new Map(r.byUser.map((x) => [String(x._id), x]));

  const sumDays = (days) => {
    const t = { shortLeave: 0, inProgress: 0, workingDays: 0, present: 0, auto: 0, worked: 0, absent: 0, leave: 0, late: 0, loginMin: 0, breakMin: 0, activeMin: 0, dialerMin: 0, offMin: 0, dialerDays: 0, loginClock: [] };
    for (const d of days) {
      if (d.workingDay) t.workingDays += 1;
      t.shortLeave += d.shortLeave || 0;
      if (d.status === 'in-progress') t.inProgress += 1;
      if (d.lateMin > 15) t.late += 1;
      // Average start = when the day began: login, the dialer's auto-start, or
      // (no session) the first dialer / call activity.
      if (d.startAt) {
        t.worked += 1;
        t.loginClock.push(minutes(wd.istAt(d.dayKey, '00:00'), d.startAt));
      }
      if (d.status === 'present' || d.status === 'half-day' || d.status === 'late-leave') {
        // a half day is half present; a late-login leave isn't present at all (its leave is in leaveDay)
        t.present += d.status === 'present' ? 1 : d.status === 'half-day' ? 0.5 : 0;
        if (d.status === 'half-day') t.halfDay = (t.halfDay || 0) + 1;
        if (d.status === 'late-leave') t.lateLeave = (t.lateLeave || 0) + 1;
      } else if (d.status === 'auto') t.auto += 1;
      else if (d.status === 'absent' && d.workingDay) t.absent += 1;
      if (d.workingDay) t.leave += d.leaveDay;
      t.loginMin += d.loginMin;
      t.breakMin += d.breakMin;
      t.activeMin += d.activeMin;
      // Only days with a dialer log count towards dialer on / off.
      if (d.dialerMin != null) {
        t.dialerDays += 1;
        t.dialerMin += d.dialerMin;
        t.offMin += d.offMin;
      }
    }
    t.avgLoginClock = t.loginClock.length ? Math.round(t.loginClock.reduce((a, b) => a + b, 0) / t.loginClock.length) : null;
    delete t.loginClock;
    t.leave = Math.round(t.leave * 100) / 100;
    return t;
  };
  const derive = (c, a, resp) => ({
    ...c,
    ...a,
    connectRate: c.calls ? Math.round((c.connected / c.calls) * 1000) / 10 : 0,
    avgTalkSec: c.connected ? Math.round(c.talkSec / c.connected) : 0,
    talkPct: a.activeMin ? Math.round((c.talkSec / 60 / a.activeMin) * 1000) / 10 : 0,
    idleMin: Math.max(0, Math.round(a.activeMin - c.talkSec / 60)),
    callsPerHour: a.activeMin ? Math.round((c.calls / (a.activeMin / 60)) * 10) / 10 : 0,
    responses: resp ? resp.n : 0,
    leadsResponded: resp ? resp.leads : 0,
  });

  const rows = users.map((u) => {
    const uid = String(u._id);
    const days = att.get(uid) || [];
    const c = cBy.get(uid) || blank;
    return {
      adminId: uid,
      name: wd.fullName(u) || u.email,
      role: u.role,
      team: u.team,
      email: u.email,
      firstCall: c.firstCall || null,
      lastCall: c.lastCall || null,
      ...derive({ ...blank, ...c, _id: undefined }, sumDays(days), rBy.get(uid)),
      sales: salesOf(uid),
      stages: stageCounts(fg.filter((g) => g.u === uid)),
      pay: pay.by.get(uid) || payBlank,
      prev: callsPrevOf(pcBy.get(uid)),
    };
  });
  const allDays = [...att.values()].flat();
  const totals = derive({ ...blank, ...(f.totals[0] || {}), _id: undefined }, sumDays(allDays), r.total[0]);
  totals.staff = users.length;
  totals.activeUsers = rows.filter((x) => x.calls > 0).length;
  totals.sales = salesOf(null);
  totals.pay = pay.total;
  totals.prev = callsPrevOf(pc.totals[0]);

  const tBy = new Map(f.trend.map((x) => [x._id, x]));
  const dBy = new Map(f.byDay.map((x) => [x._id, x]));
  const trend = fillBuckets(bucket, from, to, dayKeys).map((k) => ({ key: k, calls: 0, connected: 0, talkSec: 0, ...(tBy.get(k) || {}), _id: undefined }));
  const heat = Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => ({ calls: 0, connected: 0 })));
  for (const h of f.heat) heat[(h._id.d + 5) % 7][h._id.h] = { calls: h.calls, connected: h.connected }; // Mon=0 … Sun=6
  const bandN = new Map(f.talkBands.map((b) => [b._id, b.n]));

  const one = users.length === 1 && q.adminId;
  return {
    range: { from, to, bucket, days: dayKeys.length, prevFrom, prevTo },
    workday: wd.W,
    teams,
    roles,
    people,
    stageTree,
    totals,
    rows,
    trend,
    heat,
    outcomes: f.outcomes.map((o) => ({ key: o._id || 'unknown', n: o.n })).sort((a, b) => b.n - a.n),
    dispositions: f.dispositions.map((d) => ({ key: d._id, n: d.n })),
    talkBands: f.talkBands.length ? TALK_BANDS.map(([sec, key]) => ({ key, n: bandN.get(sec) || 0 })) : [],
    stages: r.byStage.map((s) => ({ key: s._id || '—', n: s.n, leads: s.leads })),
    payments: pay.list,
    days: one ? (att.get(String(users[0]._id)) || []).map((d) => ({ ...d, calls: 0, connected: 0, talkSec: 0, missed: 0, ...(dBy.get(d.dayKey) || {}), _id: undefined })).reverse() : null,
  };
}

// Where one user is right now (today's WorkSession + their dialer state).
async function liveStatus(adminId) {
  const now = new Date();
  const [s, st] = await Promise.all([
    wd.getSession(adminId, wd.todayKey()),
    mongoose.model('AgentCallState').findOne({ agent: adminId }).select('status campaign').lean(),
  ]);
  const dialerOn = !!(st && st.campaign && st.status !== 'Offline');
  let status = 'not-logged-in';
  if (s && s.logoutAt) status = 'logged-out';
  else if (s && (s.breaks || []).some((b) => !b.endAt && now < wd.plannedEnd(b))) status = 'on-break';
  else if (s && s.loginAt) status = 'working';
  else if (s && s.autoStartedAt) status = 'auto-started';
  return { status, dialerOn, dialerStatus: st ? st.status : 'Offline' };
}

// One user against everyone they're ranked with: team averages (team totals,
// so a busy day weighs more) and their rank on calls / connect rate / talk.
function compareWithTeam(me, team) {
  const t = team.totals;
  const peers = team.rows.filter((r) => r.calls > 0);
  const val = (r, key) => (typeof key === 'function' ? key(r) : r[key]);
  const rankBy = (key) => {
    if (!me.calls || !val(me, key)) return null; // nothing to rank on
    const sorted = peers.slice().sort((a, b) => val(b, key) - val(a, key));
    const i = sorted.findIndex((r) => r.adminId === me.adminId);
    return i < 0 ? null : i + 1;
  };
  return {
    staff: team.rows.length,
    active: peers.length,
    avg: {
      connectRate: t.connectRate,
      avgTalkSec: t.avgTalkSec,
      talkPct: t.talkPct,
      callsPerHour: t.callsPerHour,
      responsesPerCall: t.calls ? Math.round((t.responses / t.calls) * 100) / 100 : 0,
      callsPerUser: peers.length ? Math.round(t.calls / peers.length) : 0,
      talkSecPerUser: peers.length ? Math.round(t.talkSec / peers.length) : 0,
    },
    // per calling user, so one person's number reads against a typical peer
    salesAvg: Object.fromEntries(
      ['connected', 'demoBooked', 'demoAttended', 'interested', 'prospects', 'enrolled', 'notInterested'].map((k) => [k, peers.length ? Math.round(((t.sales && t.sales[k]) || 0) / peers.length * 10) / 10 : 0])
    ),
    payAvg: { collected: peers.length ? Math.round(((t.pay && t.pay.collected) || 0) / peers.length) : 0 },
    talkShare: t.talkSec ? Math.round((me.talkSec / t.talkSec) * 1000) / 10 : 0,
    rank: {
      calls: rankBy('calls'),
      connectRate: rankBy('connectRate'),
      talkSec: rankBy('talkSec'),
      demoBooked: rankBy((r) => r.sales.demoBooked),
      enrolled: rankBy((r) => r.sales.enrolled),
    },
  };
}

// ── Used leads (took over Sales › Dashboard › Leads Analytics) ──────────
// "Used" = a number a Sales user actually dialled in the range — the same
// meaning as Leads › Used Leads (leadController/usedLeads.js, built from
// CallRecord). Each number is joined to its CRM lead by phone and the ratios
// are over those numbers, with Leads Analytics' stage sets. Follows the 360°
// filters: every Sales user, one team or one user.
const IN_PROGRESS = ['queued', 'dialing', 'ringing'];
const USED_TESTS = {
  connected: (l) => l.connected,
  qualified: (l) => QUALIFIED.some((x) => l.ever.has(x)),
  meetings: (l) => MEETING.some((x) => l.ever.has(x)),
  enrolled: (l) => l.ever.has('Enrolled'),
  notInterested: (l) => l.stage === 'Not Interested Leads',
  noResponse: (l) => l.stage === 'No Response',
  invalid: (l) => l.stage === 'Invalid Leads',
};
const bucketKey = (d, bucket) => {
  const day = istDay(d);
  if (bucket === 'month') return day.slice(0, 7);
  if (bucket === 'day') return day;
  return `${day} ${new Date(d).toLocaleTimeString('en-GB', { timeZone: TZ, hour: '2-digit', hour12: false })}`;
};

// One row per number dialled in the range (full = the list's extra fields).
async function usedCohort({ ids, from, to, full, q = {} }) {
  const callAnd = await callFilter(q, ids, from, to);
  const calls = await mongoose
    .model('CallRecord')
    .find({ removed: false, agent: { $in: ids }, created: { $gte: from, $lte: to }, status: { $nin: IN_PROGRESS }, ...(callAnd.length ? { $and: callAnd } : {}) })
    .select('phone contactName created answeredAt agentLegAnswered duration agentName')
    .sort({ created: 1 })
    .lean();
  const by = new Map();
  for (const c of calls) {
    const k = last10(c.phone);
    if (k.length !== 10) continue;
    let r = by.get(k);
    if (!r) {
      r = { key: k, phone: c.phone, contactName: c.contactName, calls: 0, connected: false, firstAt: c.created, lastAt: c.created, by: c.agentName || '—' };
      by.set(k, r);
    }
    r.calls += 1;
    r.lastAt = c.created;
    if (c.agentName) r.by = c.agentName;
    if (c.answeredAt && c.agentLegAnswered !== false && c.duration > 0) r.connected = true;
  }
  const leads = by.size
    ? await mongoose
        .model('Lead')
        .find({ removed: false, phoneNormalized: { $in: [...by.keys()] } })
        .select(`${full ? 'name email subStatus nextFollowUpAt ' : ''}phoneNormalized source team stage stageHistory.fromStage stageHistory.toStage`)
        .lean()
    : [];
  const lb = new Map(leads.map((l) => [l.phoneNormalized, l]));
  return [...by.values()].map((r) => {
    const l = lb.get(r.key);
    return {
      ...r,
      _id: l ? l._id : r.key,
      isLead: !!l,
      name: (l && l.name) || r.contactName || 'Unknown number',
      source: l ? l.source || 'Unknown' : 'Not in CRM',
      team: l ? l.team || '' : '',
      stage: l ? l.stage || 'New Lead' : 'Not in CRM',
      subStatus: l ? l.subStatus : null,
      nextFollowUpAt: l ? l.nextFollowUpAt : null,
      ever: new Set(l ? [l.stage || 'New Lead', ...(l.stageHistory || []).flatMap((h) => [h.fromStage, h.toStage]).filter(Boolean)] : []),
    };
  });
}

const groupCount = (list, keyFn) => {
  const m = new Map();
  for (const x of list) {
    const k = keyFn(x);
    m.set(k, (m.get(k) || 0) + 1);
  }
  return [...m].map(([key, n]) => ({ key, n })).sort((a, b) => b.n - a.n);
};

async function usedReport({ ids, from, to, prevFrom, prevTo, bucket, q }) {
  const [cur, prev] = await Promise.all([usedCohort({ ids, from, to, q }), usedCohort({ ids, from: prevFrom, to: prevTo, q })]);
  const keys = fillBuckets(bucket, from, to, parseRange({ from: from.toISOString(), to: to.toISOString() }).dayKeys);
  const series = (list) => {
    const m = new Map(keys.map((k) => [k, 0]));
    for (const l of list) {
      const k = bucketKey(l.firstAt, bucket);
      if (m.has(k)) m.set(k, m.get(k) + 1);
    }
    return keys.map((k) => m.get(k));
  };
  const pct = (a, b) => (b ? Math.round((a / b) * 1000) / 10 : 0);
  const kpi = (key, test) => {
    const c = test ? cur.filter(test) : cur;
    const p = test ? prev.filter(test) : prev;
    return { key, value: c.length, pct: pct(c.length, cur.length), prev: p.length, prevPct: pct(p.length, prev.length), prevTotal: prev.length, series: series(c) };
  };
  return {
    kpis: [kpi('total'), ...Object.entries(USED_TESTS).map(([k, t]) => kpi(k, t))],
    notInCrm: cur.filter((l) => !l.isLead).length,
    trend: (() => {
      const all = series(cur);
      return keys.map((k, i) => ({ key: k, n: all[i] }));
    })(),
    bySource: groupCount(cur, (l) => l.source),
    byStage: groupCount(cur, (l) => l.stage),
    byTeam: groupCount(cur, (l) => l.team || 'No team'),
    byUser: groupCount(cur, (l) => l.by),
  };
}

// GET /workday/admin/360/lead-list?…360 filters…&kpi=&stage=&source=&teamPick=&by=&q=&page=&items=
// The numbers behind the Used leads section, filtered by whichever tile /
// bar was clicked.
async function leadList(req, res) {
  const q = req.query;
  const { from, to } = parseRange(q);
  const { users } = await salesUsers(q);
  const list = await usedCohort({ ids: users.map((u) => u._id), from, to, full: true, q });
  const page = Math.max(1, parseInt(q.page) || 1);
  const items = Math.min(parseInt(q.items) || 25, 200);
  let rows = list;
  if (q.kpi && USED_TESTS[q.kpi]) rows = rows.filter(USED_TESTS[q.kpi]);
  if (q.stage) rows = rows.filter((l) => l.stage === q.stage);
  if (q.source) rows = rows.filter((l) => l.source === q.source);
  if (q.teamPick) rows = rows.filter((l) => (l.team || 'No team') === q.teamPick);
  if (q.by) rows = rows.filter((l) => l.by === q.by);
  const search = String(q.q || '').trim().toLowerCase();
  if (search) rows = rows.filter((l) => `${l.name || ''} ${l.phone || ''} ${l.email || ''}`.toLowerCase().includes(search));
  rows.sort((a, b) => new Date(b.lastAt) - new Date(a.lastAt));
  const count = rows.length;
  return res.status(200).json({
    success: true,
    result: rows.slice((page - 1) * items, page * items).map(({ ever, ...l }) => l),
    pagination: { page, items, count, pages: Math.ceil(count / items) },
  });
}

// GET /workday/admin/360?from=&to=&adminId=&team=
// adminId set → that user's report plus `compare` (vs every Sales user over
// the same range) and `now` (live status).
async function summary(req, res) {
  const q = req.query;
  const result = await build(q);
  if (result.days && result.rows.length === 1) {
    const me = result.rows[0];
    const month = new Date(result.range.to).toLocaleDateString('en-CA', { timeZone: TZ }).slice(0, 7);
    const sameFilters = Object.fromEntries(FILTER_KEYS.filter((k) => q[k]).map((k) => [k, q[k]]));
    const [team, now, pipeline, target] = await Promise.all([
      remembered(`team|${JSON.stringify([q.from, q.to, sameFilters])}`, 60e3, q.fresh === '1', () => build({ from: q.from, to: q.to, ...sameFilters })),
      liveStatus(me.adminId),
      pipelineOf(me.adminId),
      mongoose.model('Target').findOne({ removed: false, admin: me.adminId, period: month }).select('period targetCalls targetDeals targetRevenue targetProspects').lean(),
    ]);
    result.compare = compareWithTeam(me, team);
    result.now = now;
    result.pipeline = pipeline;
    result.target = target;
  }
  // Choices for the filter bar that only the data knows.
  const [campaigns, sources, paths] = await Promise.all([
    remembered('campaigns', 3e5, q.fresh === '1', () => mongoose.model('CallCampaign').find({ removed: false }).select('name').sort({ name: 1 }).limit(100).lean()),
    remembered('sources', 3e5, q.fresh === '1', () => mongoose.model('Lead').distinct('source', { removed: false })),
    mongoose.model('UserEvent').distinct('path', { admin: { $in: result.rows.map((r) => r.adminId) }, at: { $gte: result.range.from, $lte: result.range.to } }),
  ]);
  result.filterOptions = { dispositions: ACTIVE_DISPOSITIONS.map((d) => ({ key: d.code, label: d.label })), campaigns: campaigns.map((c) => ({ key: String(c._id), label: c.name })), talkBands: TALK_BANDS.map(([sec, label]) => ({ key: String(sec), label })), sources: sources.filter(Boolean).sort().slice(0, 200), paths: paths.filter(Boolean).sort().slice(0, 200) };
  return res.status(200).json({ success: true, message: 'ok', result });
}

// GET /workday/admin/360/records?…360 filters… — Deals, Quotes, Orders, Products
// cards, on their own so a deal filter doesn't rebuild the calls and attendance.
async function records(req, res) {
  const { users } = await salesUsers(req.query);
  return res.status(200).json({ success: true, message: 'ok', result: await salesRecords(req.query, users) });
}

// GET /workday/admin/360/leads-report?…360 filters… — the Used leads
// section, on its own request so the rest of the 360° doesn't wait for it.
async function leadsSection(req, res) {
  const q = req.query;
  const { from, to, bucket } = parseRange(q);
  const { users } = await salesUsers(q);
  const prevTo = new Date(from.getTime() - 1);
  const prevFrom = new Date(from.getTime() - (to - from) - 1);
  const result = await usedReport({ ids: users.map((u) => u._id), from, to, prevFrom, prevTo, bucket, q });
  return res.status(200).json({ success: true, message: 'ok', result });
}

// GET /workday/admin/360/export?from=&to=&adminId=&team=  → .xlsx
// Users (one row per person), Days (person × day) and Calls (every call, up
// to 20 000) for the range on screen.
async function exportXlsx(req, res) {
  const XLSX = require('xlsx');
  const q = req.query;
  const { from, to, dayKeys } = parseRange(q);
  const data = await build(q);
  const { users } = await salesUsers(q);
  const att = await attendance(users, dayKeys, from, to);
  const ids = users.map((u) => u._id);
  const CallRecord = mongoose.model('CallRecord');
  const callAnd = await callFilter(q, ids, from, to);
  const onlyCalls = callAnd.length ? { $and: callAnd } : {};
  const [perDay, callRows] = await Promise.all([
    CallRecord.aggregate([
      { $match: { removed: false, agent: { $in: ids }, created: { $gte: from, $lte: to }, ...onlyCalls } },
      { $group: { _id: { a: '$agent', d: { $dateToString: { format: '%Y-%m-%d', date: '$created', timezone: TZ } } }, calls: { $sum: 1 }, connected: sumIf(CONNECTED), talkSec: callTotals.talkSec, missed: callTotals.missed } },
    ]),
    CallRecord.find({ removed: false, agent: { $in: ids }, created: { $gte: from, $lte: to }, ...onlyCalls })
      .select('agentName contactName phone direction status duration answeredAt agentLegAnswered missedByAgent created endedAt disposition recording.status')
      .sort({ created: -1 })
      .limit(20000)
      .lean(),
  ]);
  const pBy = new Map(perDay.map((p) => [`${p._id.a}|${p._id.d}`, p]));
  const t12 = (d) => (d ? new Date(d).toLocaleTimeString('en-IN', { timeZone: TZ, hour: 'numeric', minute: '2-digit' }) : '');
  const hrs = (min) => Math.round(((min || 0) / 60) * 100) / 100;
  const mins = (sec) => Math.round(((sec || 0) / 60) * 10) / 10;

  const usersSheet = data.rows.map((r) => ({
    User: r.name,
    Role: r.role,
    Team: r.team || '',
    'Working days': r.workingDays,
    Present: r.present,
    'Auto-started': r.auto,
    Absent: r.absent,
    'Leave (days)': r.leave,
    'Late days': r.late,
    'Login (h)': hrs(r.loginMin),
    'Break (h)': hrs(r.breakMin),
    'Active (h)': hrs(r.activeMin),
    'Dialer on (h)': hrs(r.dialerMin),
    'Dialer off (h)': hrs(r.offMin),
    Calls: r.calls,
    Outgoing: r.outbound,
    Incoming: r.inbound,
    Connected: r.connected,
    'Connect %': r.connectRate,
    Missed: r.missed,
    'Unique numbers': r.unique,
    'Talk (min)': mins(r.talkSec),
    'Avg talk (s)': r.avgTalkSec,
    'Longest (s)': r.longestSec,
    'Under 30s': r.shortCalls,
    'On phone %': r.talkPct,
    'Idle (h)': hrs(r.idleMin),
    'Calls / hour': r.callsPerHour,
    Responses: r.responses,
    'Leads responded': r.leadsResponded,
    'Demo booked': r.sales.demoBooked,
    'Demo attended': r.sales.demoAttended,
    'Demo not attended': r.sales.demoMissed,
    Interested: r.sales.interested,
    Prospects: r.sales.prospects,
    'Future prospects': r.sales.future,
    Enrolled: r.sales.enrolled,
    'Not interested': r.sales.notInterested,
    'Payment links': r.pay.links,
    'Payments received': r.pay.paid,
    'Collected (₹)': r.pay.collected,
    'New enrolments (paid)': r.pay.newEnrolments,
    'Deal value (₹)': r.pay.dealValue,
    'Pending links': r.pay.pending,
    'Recorded calls': r.recorded,
    'Recorded (min)': mins(r.recordedSec),
  }));
  const STATUS = { present: 'Full day', 'half-day': 'Half day', 'in-progress': 'In progress', 'rest-day': 'Substitute rest day', 'late-leave': 'Leave (late login)', auto: 'Auto-started', absent: 'Absent', leave: 'Leave', holiday: 'Holiday', 'weekly-off': 'Weekly off', upcoming: 'Not started' };
  const daysSheet = [];
  for (const u of users) {
    for (const d of att.get(String(u._id)) || []) {
      if (q.attendance && d.status !== q.attendance) continue;
      const c = pBy.get(`${u._id}|${d.dayKey}`) || {};
      daysSheet.push({
        User: wd.fullName(u) || u.email,
        Date: d.dayKey,
        Status: `${STATUS[d.status] || d.status}${d.derived ? ' (from dialer)' : ''}${d.holiday ? ` · ${d.holiday}` : ''}`,
        Login: t12(d.loginAt),
        'Auto-started': t12(d.autoStartedAt),
        Logout: t12(d.logoutAt),
        'Late (min)': d.lateMin || '',
        'Active (h)': d.activeMin ? hrs(d.activeMin) : '',
        'Dialer on (h)': d.dialerMin == null ? 'no log' : hrs(d.dialerMin),
        'Break (min)': d.breakMin || '',
        Leave: d.leave || '',
        'Day type': d.dayType,
        'Dialer qualifying (h)': d.policy ? hrs(d.policy.metrics.dialerMin) : '',
        'Call attempts': d.policy ? d.policy.metrics.attempts : '',
        'Verified prospects': d.policy ? d.policy.metrics.verifiedProspects : '',
        'Attended demos': d.policy ? d.policy.metrics.attendedDemos : '',
        'Policy result': d.policy ? `${d.policy.level}${d.policy.preview ? ' (preview)' : ''}` : '',
        'Short-leave events': d.shortLeave || '',
        Correction: d.correction ? `${d.correction.originalStatus} → ${d.correction.revisedStatus || 'same'}: ${d.correction.reason} (${d.correction.by})` : '',
        Calls: c.calls || '',
        Connected: c.connected || '',
        'Talk (min)': c.talkSec ? mins(c.talkSec) : '',
        Missed: c.missed || '',
      });
    }
  }
  const callsSheet = callRows.map((c) => {
    const ok = !!(c.answeredAt && c.agentLegAnswered !== false && c.duration > 0);
    return {
      Time: new Date(c.created).toLocaleString('en-IN', { timeZone: TZ }),
      User: c.agentName || '',
      Contact: c.contactName || '',
      Phone: c.phone,
      Type: c.direction,
      Result: ok ? 'Connected' : c.missedByAgent ? 'Missed by user' : c.status,
      'Talk (s)': ok ? c.duration : 0,
      Disposition: c.disposition || '',
      Recording: (c.recording && c.recording.status) === 'available' ? 'Yes' : '',
    };
  });

  const wb = XLSX.utils.book_new();
  const sheet = (rows) => {
    const ws = XLSX.utils.json_to_sheet(rows.length ? rows : [{ '': 'No data' }]);
    if (rows.length) ws['!cols'] = Object.keys(rows[0]).map((k) => ({ wch: Math.max(10, k.length + 2, k === 'User' || k === 'Contact' ? 22 : 0) }));
    return ws;
  };
  XLSX.utils.book_append_sheet(wb, sheet(usersSheet), 'Users');
  XLSX.utils.book_append_sheet(wb, sheet(daysSheet), 'Days');
  XLSX.utils.book_append_sheet(wb, sheet(callsSheet), 'Calls');
  const pay = await payments(ids, from, to, true, q);
  const PAY = { created: 'Link sent', paid: 'Paid', expired: 'Expired', cancelled: 'Cancelled', failed: 'Failed' };
  const paySheet = pay.list.map((p) => ({
    Created: new Date(p.created).toLocaleString('en-IN', { timeZone: TZ }),
    Student: p.name,
    Email: p.email,
    Phone: p.phone || '',
    Course: p.course || '',
    Instalment: p.installment || 'one-time',
    'Amount (₹)': p.amount,
    'Plan total (₹)': p.planTotal || '',
    Status: PAY[p.status] || p.status,
    'Paid at': p.paidAt ? new Date(p.paidAt).toLocaleString('en-IN', { timeZone: TZ }) : '',
    'Created by': p.by,
  }));
  XLSX.utils.book_append_sheet(wb, sheet(paySheet), 'Payments');
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  const who = users.length === 1 && q.adminId ? (wd.fullName(users[0]) || 'user').replace(/[^A-Za-z0-9]+/g, '-') : 'all-sales';
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="sales-360-${who}-${istDay(from)}-to-${istDay(to)}.xlsx"`);
  return res.send(buf);
}

// GET /workday/admin/360/leads?adminId=&team=&from=&to=&stages=A,B&sub=&q=&page=&items=
// Every lead stage change Sales users made in the range (newest first), for
// the KPI card drill-downs (Demos / Interested / Enrolled / Not interested /
// Lead responses). `subs` = how many per sub-status, for the filter chips.
async function leads(req, res) {
  const q = req.query;
  const { from, to } = parseRange(q);
  const { users } = await salesUsers(q);
  const ids = users.map((u) => u._id);
  const page = Math.max(1, parseInt(q.page) || 1);
  const items = Math.min(parseInt(q.items) || 25, 200);
  const stages = String(q.stages || '').split(',').map((x) => x.trim()).filter(Boolean);
  const step = { 'stageHistory.changedBy': { $in: ids }, 'stageHistory.at': { $gte: from, $lte: to } };
  // A card's stages, narrowed by the filter bar's stage when both are set.
  const wantStages = stages.length ? (q.stage ? stages.filter((s) => s === q.stage) : stages) : q.stage ? [q.stage] : null;
  if (wantStages) step['stageHistory.toStage'] = { $in: wantStages };
  const lead = { removed: false, 'stageHistory.changedBy': { $in: ids }, 'stageHistory.at': { $gte: from, $lte: to }, ...responseFilter(q).lead };
  const sub = q.sub ? { 'stageHistory.toSubStatus': q.sub } : {};
  const [out] = await mongoose.model('Lead').aggregate([
    { $match: lead },
    { $unwind: '$stageHistory' },
    { $match: step },
    {
      $facet: {
        subs: [{ $group: { _id: '$stageHistory.toSubStatus', n: { $sum: 1 } } }, { $sort: { n: -1 } }],
        count: [{ $match: sub }, { $count: 'n' }],
        rows: [
          { $match: sub },
          { $sort: { 'stageHistory.at': -1 } },
          { $skip: (page - 1) * items },
          { $limit: items },
          {
            $project: {
              name: 1, phone: 1, email: 1, stage: 1, subStatus: 1, meetingAt: 1, callBackAt: 1,
              at: '$stageHistory.at', fromStage: '$stageHistory.fromStage', fromSubStatus: '$stageHistory.fromSubStatus',
              toStage: '$stageHistory.toStage', toSubStatus: '$stageHistory.toSubStatus', remarks: '$stageHistory.remarks', by: '$stageHistory.changedByName',
            },
          },
        ],
      },
    },
  ]);
  const count = (out.count[0] && out.count[0].n) || 0;
  return res.status(200).json({
    success: true,
    result: out.rows,
    subs: out.subs.map((x) => ({ key: x._id || '—', n: x.n })),
    pagination: { page, items, count, pages: Math.ceil(count / items) },
  });
}

// GET /workday/admin/360/calls?adminId=&from=&to=&q=&outcome=&direction=&recorded=&page=&items=
async function calls(req, res) {
  const q = req.query;
  const { from, to } = parseRange(q);
  const { users } = await salesUsers(q);
  const page = Math.max(1, parseInt(q.page) || 1);
  const items = Math.min(parseInt(q.items) || 25, 200);
  const ids = users.map((u) => u._id);
  const and = [{ removed: false, agent: { $in: ids }, created: { $gte: from, $lte: to } }, ...(await callFilter(q, ids, from, to))];
  const CallRecord = mongoose.model('CallRecord');
  const filter = { $and: and };
  const [rows, count] = await Promise.all([
    CallRecord.find(filter)
      .select('contactName phone direction status duration answeredAt agentLegAnswered created endedAt ringingAt disposition notes agentName missedByAgent recording.status recording.durationSec campaign transferredTo')
      .populate('campaign', 'name')
      .sort({ created: -1 })
      .skip((page - 1) * items)
      .limit(items)
      .lean(),
    CallRecord.countDocuments(filter),
  ]);
  const tails = [...new Set(rows.map((r) => last10(r.phone)).filter((p) => p.length === 10))];
  const leads = tails.length ? await mongoose.model('Lead').find({ removed: false, phoneNormalized: { $in: tails } }).select('name phoneNormalized stage subStatus').lean() : [];
  const lBy = new Map(leads.map((l) => [l.phoneNormalized, l]));
  return res.status(200).json({
    success: true,
    message: 'ok',
    result: rows.map((r) => {
      const lead = lBy.get(last10(r.phone));
      const connected = !!(r.answeredAt && r.agentLegAnswered !== false && r.duration > 0);
      return {
        _id: r._id,
        name: GENERIC_NAMES.includes(r.contactName || '') ? (lead && lead.name) || r.contactName || null : r.contactName,
        phone: r.phone,
        user: r.agentName,
        direction: r.direction,
        status: r.status,
        connected,
        missed: !!r.missedByAgent,
        talkSec: connected ? r.duration : 0,
        at: r.created,
        endedAt: r.endedAt,
        disposition: r.disposition || null,
        notes: agentNotes(r.notes),
        campaign: r.campaign && r.campaign.name,
        stage: lead ? [lead.stage, lead.subStatus].filter(Boolean).join(' · ') : null,
        recording: (r.recording && r.recording.status) || 'unavailable',
        recordingSec: (r.recording && r.recording.durationSec) || 0,
      };
    }),
    pagination: { page, pages: Math.ceil(count / items) || 0, count },
  });
}


// GET /workday/admin/360/attendance?month=YYYY-MM&adminId=&team=
// The Sales 360° attendance calendar: every day of the month (up to today)
// with each user's status — same rules as the report's present / absent /
// late (attendance() above) — plus per-day and per-user counts.
async function attendanceMonth(req, res) {
  const q = req.query;
  const month = /^\d{4}-\d{2}$/.test(String(q.month || '')) ? q.month : wd.todayKey().slice(0, 7);
  const today = wd.todayKey();
  const [y, m] = month.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const allKeys = [];
  for (let d = 1; d <= last; d += 1) allKeys.push(`${month}-${String(d).padStart(2, '0')}`);
  const dayKeys = allKeys.filter((k) => k <= today); // attendance: up to today
  const { users } = await salesUsers(q);
  if (!users.length) {
    return res.status(200).json({ success: true, message: 'ok', result: { month, days: [], upcoming: [], people: [] } });
  }
  const from = wd.dayBounds(allKeys[0]).start;
  const to = wd.dayBounds(allKeys[allKeys.length - 1]).end;
  const att = dayKeys.length ? await attendance(users, dayKeys, from, wd.dayBounds(dayKeys[dayKeys.length - 1]).end) : new Map();

  // Every leave request touching the month — approved, still pending or
  // rejected — shown on its days (attendance() above only counts approved).
  const SHOWN = ['Approved', 'Pending', 'Rejected'];
  const leaveReqs = await mongoose
    .model('LeaveRequest')
    .find({ removed: false, status: { $in: SHOWN }, adminId: { $in: users.map((u) => String(u._id)) }, fromDate: { $lte: to }, toDate: { $gte: from } })
    .select('adminId leaveType status fromDate toDate durationType reason decisionBy decisionNote appliedOn')
    .lean();
  const nameOf = new Map(users.map((u) => [String(u._id), wd.fullName(u) || u.email]));
  const leavesOn = (dk) => {
    const { start, end } = wd.dayBounds(dk);
    return leaveReqs
      .filter((l) => new Date(l.fromDate) <= end && new Date(l.toDate) >= start)
      .map((l) => ({
        adminId: l.adminId,
        name: nameOf.get(l.adminId) || '—',
        status: l.status,
        type: l.leaveType,
        when: wd.durationLabel(l),
        reason: l.reason || null,
        decisionBy: l.decisionBy || null,
      }));
  };

  const LATE_MIN = 15;
  const blank = () => ({ present: 0, halfDay: 0, lateLeave: 0, auto: 0, absent: 0, leave: 0, late: 0, inProgress: 0, shortLeave: 0 });
  const tally = (c, d) => {
    if (d.status === 'present') c.present += 1;
    else if (d.status === 'half-day') c.halfDay += 1;
    else if (d.status === 'late-leave') c.lateLeave += 1;
    else if (d.status === 'auto') c.auto += 1;
    else if (d.status === 'absent') c.absent += 1;
    else if (d.status === 'leave') c.leave += 1;
    else if (d.status === 'in-progress') c.inProgress += 1;
    if (d.lateMin > LATE_MIN) c.late += 1;
    c.shortLeave += d.shortLeave || 0;
  };
  const people = users.map((u) => {
    const rows = att.get(String(u._id)) || [];
    const c = blank();
    rows.forEach((d) => tally(c, d));
    return { adminId: String(u._id), name: wd.fullName(u) || u.email, role: u.role, team: u.team, ...c, workingDays: rows.filter((d) => d.workingDay).length };
  });
  const days = dayKeys.map((dk, i) => {
    const c = blank();
    const list = users.map((u) => {
      const d = (att.get(String(u._id)) || [])[i] || {};
      tally(c, d);
      return { adminId: String(u._id), name: wd.fullName(u) || u.email, status: d.status, loginAt: d.loginAt || d.autoStartedAt || null, logoutAt: d.logoutAt || null, lateMin: d.lateMin || 0, activeMin: d.activeMin || 0, leave: d.leave || null, note: d.lateLoginNote || (d.correction ? `Corrected: ${d.correction.reason}` : null), shortLeave: d.shortLeave || 0, policy: d.policy || null };
    });
    const any = (att.get(String(users[0]._id)) || [])[i] || {};
    const leaves = leavesOn(dk);
    return { dayKey: dk, workingDay: !!any.workingDay, holiday: any.holiday || null, ...c, people: list, leaves };
  });
  // days still to come this month: only the leave requests on them
  const upcoming = allKeys.filter((k) => k > today).map((dk) => ({ dayKey: dk, leaves: leavesOn(dk) })).filter((d) => d.leaves.length);
  people.forEach((p) => {
    const mine = leaveReqs.filter((l) => l.adminId === p.adminId);
    p.leaveRequests = { approved: mine.filter((l) => l.status === 'Approved').length, pending: mine.filter((l) => l.status === 'Pending').length, rejected: mine.filter((l) => l.status === 'Rejected').length };
  });
  return res.status(200).json({ success: true, message: 'ok', result: { month, lateAfterMin: LATE_MIN, days, upcoming, people } });
}

// GET /workday/admin/360/exceptions?from=&to=&adminId=&team=
// Days someone never pressed Login (dialer on / auto-started / calls made
// anyway) and days they never pressed Logout — with when the dialer first
// came on and how many calls they made, so management can mark them present.
async function exceptions(req, res) {
  const q = req.query;
  const { from, to, dayKeys } = parseRange(q);
  const { users } = await salesUsers(q);
  if (!users.length) return res.status(200).json({ success: true, message: 'ok', result: { noLogin: [], noLogout: [] } });
  const att = await attendance(users, dayKeys, from, to);
  const ids = users.map((u) => u._id);
  const start = wd.dayBounds(dayKeys[0]).start;
  const [firstOn, callDays] = await Promise.all([
    mongoose.model('AgentActivity').aggregate([
      { $match: { agent: { $in: ids }, kind: 'pool_on', at: { $gte: start, $lte: to } } },
      { $group: { _id: { a: '$agent', d: { $dateToString: { format: '%Y-%m-%d', date: '$at', timezone: TZ } } }, at: { $min: '$at' }, by: { $first: '$byName' } } },
    ]),
    mongoose.model('CallRecord').aggregate([
      { $match: { removed: false, agent: { $in: ids }, created: { $gte: start, $lte: to } } },
      { $group: { _id: { a: '$agent', d: { $dateToString: { format: '%Y-%m-%d', date: '$created', timezone: TZ } } }, calls: { $sum: 1 }, connected: sumIf(CONNECTED), firstAt: { $min: '$created' } } },
    ]),
  ]);
  const k = (a, d) => `${a}|${d}`;
  const onBy = new Map(firstOn.map((x) => [k(x._id.a, x._id.d), x]));
  const cBy = new Map(callDays.map((x) => [k(x._id.a, x._id.d), x]));
  const today = wd.todayKey();
  const shiftOver = new Date() > wd.istAt(today, wd.W.end);
  const noLogin = [];
  const noLogout = [];
  for (const u of users) {
    const uid = String(u._id);
    const name = wd.fullName(u) || u.email;
    for (const d of att.get(uid) || []) {
      const on = onBy.get(k(uid, d.dayKey));
      const c = cBy.get(k(uid, d.dayKey));
      const realLogin = d.loginAt && !d.derived;
      // worked without Login: auto-started, or dialer / calls with no session
      if (!realLogin && d.workingDay && (d.autoStartedAt || on || c)) {
        noLogin.push({
          adminId: uid,
          name,
          dayKey: d.dayKey,
          autoStartedAt: d.autoStartedAt || null,
          dialerOnAt: on ? on.at : null,
          dialerOnBy: on ? on.by || null : null,
          calls: c ? c.calls : 0,
          connected: c ? c.connected : 0,
          firstCallAt: c ? c.firstAt : null,
        });
      }
      if (d.markedPresentBy) {
        noLogin.push({ adminId: uid, name, dayKey: d.dayKey, markedPresentBy: d.markedPresentBy, loginAt: d.loginAt, calls: c ? c.calls : 0, connected: c ? c.connected : 0, dialerOnAt: on ? on.at : null });
      }
      // logged in but never logged out (today only once the shift is over)
      if (realLogin && !d.markedPresentBy && !d.logoutAt && (d.dayKey < today || shiftOver)) {
        noLogout.push({ adminId: uid, name, dayKey: d.dayKey, loginAt: d.loginAt, countedTo: d.endAt, emailedAt: d.logoutReminderAt || null, calls: c ? c.calls : 0 });
      }
    }
  }
  const byDate = (a, b) => (a.dayKey < b.dayKey ? 1 : a.dayKey > b.dayKey ? -1 : a.name.localeCompare(b.name));
  return res.status(200).json({ success: true, message: 'ok', result: { noLogin: noLogin.sort(byDate), noLogout: noLogout.sort(byDate) } });
}

// GET /workday/admin/360/dialer-report?from=&to=&adminId=&team=
// Auto-dialer capacity vs what actually happened. A call slot = the average
// time one call takes (dial → hang-up) + WRAP_SEC to save the response, so
//   capacity (dialer time) = minutes the dialer was on ÷ slot
//   capacity (full shift)  = days worked × SHIFT_WORK_MIN ÷ slot
// and the ratio = calls made ÷ capacity. Dialer-on time comes from the pool
// on/off log (attendance() above); calls from CallRecord (agent = who took it).
const WRAP_SEC = 15;
const SHIFT_WORK_MIN = 8 * 60; // 10:30–20:00 minus 90 min of breaks
async function dialerReport(req, res) {
  const q = req.query;
  const { from, to, dayKeys } = parseRange(q);
  const { users } = await salesUsers(q);
  if (!users.length) return res.status(200).json({ success: true, message: 'ok', result: null });
  const ids = users.map((u) => u._id);
  const [att, perAgent, perHour] = await Promise.all([
    attendance(users, dayKeys, from, to),
    mongoose.model('CallRecord').aggregate([
      { $match: { removed: false, agent: { $in: ids }, created: { $gte: from, $lte: to } } },
      {
        $group: {
          _id: '$agent',
          calls: { $sum: 1 },
          connected: sumIf(CONNECTED),
          talkSec: { $sum: { $cond: [CONNECTED, { $ifNull: ['$duration', 0] }, 0] } },
          handleSec: { $sum: { $cond: [{ $and: [{ $ne: ['$endedAt', null] }, { $gt: ['$endedAt', '$created'] }] }, { $divide: [{ $subtract: ['$endedAt', '$created'] }, 1000] }, 0] } },
          handleN: sumIf({ $and: [{ $ne: ['$endedAt', null] }, { $gt: ['$endedAt', '$created'] }] }),
        },
      },
    ]),
    mongoose.model('CallRecord').aggregate([
      { $match: { removed: false, agent: { $in: ids }, created: { $gte: from, $lte: to } } },
      { $group: { _id: { $hour: { date: '$created', timezone: TZ } }, calls: { $sum: 1 }, connected: sumIf(CONNECTED) } },
      { $sort: { _id: 1 } },
    ]),
  ]);

  const cBy = new Map(perAgent.map((x) => [String(x._id), x]));
  const all = perAgent.reduce((t, x) => ({ handleSec: t.handleSec + x.handleSec, handleN: t.handleN + x.handleN }), { handleSec: 0, handleN: 0 });
  const avgCallSec = all.handleN ? Math.round(all.handleSec / all.handleN) : 45;
  const slotSec = avgCallSec + WRAP_SEC;

  const rows = users.map((u) => {
    const uid = String(u._id);
    const days = att.get(uid) || [];
    const c = cBy.get(uid) || { calls: 0, connected: 0, talkSec: 0, handleSec: 0, handleN: 0 };
    const dialerMin = days.reduce((s, d) => s + (d.dialerMin || 0), 0);
    const activeMin = days.reduce((s, d) => s + (d.activeMin || 0), 0);
    const daysWorked = days.filter((d) => d.startAt && d.workingDay).length;
    const capacity = Math.floor((dialerMin * 60) / slotSec);
    const shiftCapacity = Math.floor((daysWorked * SHIFT_WORK_MIN * 60) / slotSec);
    return {
      adminId: uid,
      name: wd.fullName(u) || u.email,
      role: u.role,
      daysWorked,
      activeMin,
      dialerMin,
      calls: c.calls,
      connected: c.connected,
      talkSec: c.talkSec,
      avgCallSec: c.handleN ? Math.round(c.handleSec / c.handleN) : null,
      capacity,
      shiftCapacity,
      ratio: capacity ? Math.round((c.calls / capacity) * 1000) / 10 : null,
      shiftRatio: shiftCapacity ? Math.round((c.calls / shiftCapacity) * 1000) / 10 : null,
      callsPerHour: dialerMin ? Math.round((c.calls / dialerMin) * 600) / 10 : null,
    };
  });
  const sum = (k) => rows.reduce((s, r) => s + (r[k] || 0), 0);
  const totals = {
    people: rows.filter((r) => r.daysWorked || r.calls).length,
    daysWorked: sum('daysWorked'),
    activeMin: sum('activeMin'),
    dialerMin: sum('dialerMin'),
    calls: sum('calls'),
    connected: sum('connected'),
    talkSec: sum('talkSec'),
    capacity: sum('capacity'),
    shiftCapacity: sum('shiftCapacity'),
  };
  totals.ratio = totals.capacity ? Math.round((totals.calls / totals.capacity) * 1000) / 10 : null;
  // only the people who actually made calls (dialer on but no calls coming in
  // — e.g. Browser phone not ready — would otherwise swamp the ratio)
  const callers = rows.filter((r) => r.calls > 0);
  totals.callers = callers.length;
  totals.callerCapacity = callers.reduce((s, r) => s + r.capacity, 0);
  totals.callerDialerMin = callers.reduce((s, r) => s + r.dialerMin, 0);
  totals.callerRatio = totals.callerCapacity ? Math.round((totals.calls / totals.callerCapacity) * 1000) / 10 : null;
  totals.shiftRatio = totals.shiftCapacity ? Math.round((totals.calls / totals.shiftCapacity) * 1000) / 10 : null;
  totals.connectRate = totals.calls ? Math.round((totals.connected / totals.calls) * 1000) / 10 : null;
  totals.dialerUse = totals.activeMin ? Math.round((totals.dialerMin / totals.activeMin) * 1000) / 10 : null;
  totals.talkShare = totals.dialerMin ? Math.round((totals.talkSec / 60 / totals.dialerMin) * 1000) / 10 : null;
  totals.callsPerHour = totals.dialerMin ? Math.round((totals.calls / totals.dialerMin) * 600) / 10 : null;
  totals.perDay = dayKeys.length ? Math.round(totals.calls / Math.max(1, dayKeys.filter((k) => !wd.W.weeklyOff.includes(wd.istAt(k, '12:00').getUTCDay())).length)) : 0;

  return res.status(200).json({
    success: true,
    message: 'ok',
    result: {
      range: { from, to, days: dayKeys.length },
      assumptions: { avgCallSec, wrapSec: WRAP_SEC, slotSec, shiftWorkMin: SHIFT_WORK_MIN, callsPerHourMax: Math.floor(3600 / slotSec) },
      totals,
      rows: rows.filter((r) => r.daysWorked || r.calls || r.dialerMin).sort((a, b) => b.calls - a.calls),
      hours: perHour.map((h) => ({ hour: h._id, calls: h.calls, connected: h.connected })),
    },
  });
}

// ── CLC-POL-001 views ────────────────────────────────────────────────────
// GET /workday/admin/360/policy-days?from=&to=&adminId=&team=&role=&attendance=&short=1&dayType=
// Every working day with what each policy route scored, newest first.
async function policyDays(req, res) {
  const q = req.query;
  const { from, to, dayKeys } = parseRange(q);
  const { users } = await salesUsers(q);
  if (!users.length) return res.status(200).json({ success: true, message: 'ok', result: { rows: [], count: 0, effectiveFrom: POLICY.effectiveFrom, rules: POLICY } });
  const att = await attendance(users, dayKeys, from, to);
  const rows = [];
  for (const u of users) {
    const name = wd.fullName(u) || u.email;
    for (const d of att.get(String(u._id)) || []) {
      if (!d.policy && !d.correction) continue;
      if (q.attendance && (d.policy && d.policy.preview ? { full: 'present', half: 'half-day', absent: 'absent' }[d.policy.level] : d.status) !== q.attendance) continue;
      if (q.short === '1' && !d.shortLeave) continue;
      if (q.late === '1' && !(d.lateMin > 15)) continue;
      if (q.dayType && d.dayType !== q.dayType) continue;
      rows.push({
        adminId: String(u._id), name, role: u.role, team: u.team, dayKey: d.dayKey, status: d.status, dayType: d.dayType, startAt: d.startAt, logoutAt: d.logoutAt, breakMin: d.breakMin,
        policy: d.policy, shortLeave: d.shortLeave, correction: d.correction, leave: d.leave,
      });
    }
  }
  rows.sort((a, b) => (a.dayKey < b.dayKey ? 1 : a.dayKey > b.dayKey ? -1 : a.name.localeCompare(b.name)));
  return res.status(200).json({ success: true, message: 'ok', result: { rows: rows.slice(0, 2000), count: rows.length, effectiveFrom: POLICY.effectiveFrom, rules: POLICY } });
}

// POST /workday/admin/360/correct { adminId, dayKey, revisedStatus?, revisedShortLeave?, reason, requestedBy? }
async function correct(req, res) {
  const b = req.body || {};
  const fail = (message) => res.status(400).json({ success: false, result: null, message });
  if (!mongoose.isValidObjectId(b.adminId) || !/^\d{4}-\d{2}-\d{2}$/.test(String(b.dayKey || ''))) return fail('Pick a user and a day.');
  if (b.dayKey > wd.todayKey()) return fail('That day has not come yet.');
  const reason = String(b.reason || '').trim().slice(0, 500);
  if (reason.length < 5) return fail('Write the reason for this correction.');
  const revisedStatus = ['present', 'half-day', 'absent', 'leave'].includes(b.revisedStatus) ? b.revisedStatus : undefined;
  const short = b.revisedShortLeave === '' || b.revisedShortLeave == null ? undefined : Number(b.revisedShortLeave);
  if (short !== undefined && (!Number.isInteger(short) || short < 0 || short > 4)) return fail('Short-leave events must be 0 to 4.');
  if (!revisedStatus && short === undefined) return fail('Change the day status or the short-leave events.');
  const admin = await mongoose.model('Admin').findOne({ _id: b.adminId, removed: false }).select('name surname email role').lean();
  if (!admin) return fail('User not found.');
  const { start, end } = wd.dayBounds(b.dayKey);
  const before = (await attendance([admin], [b.dayKey], start, end)).get(String(admin._id))[0];
  const doc = await mongoose.model('AttendanceCorrection').create({
    admin: admin._id,
    adminName: wd.fullName(admin) || admin.email,
    dayKey: b.dayKey,
    originalStatus: before.status,
    originalShortLeave: before.shortLeave,
    revisedStatus,
    revisedShortLeave: short,
    reason,
    requestedBy: String(b.requestedBy || '').slice(0, 120) || wd.fullName(req.admin),
    approvedBy: req.admin._id,
    approvedByName: wd.fullName(req.admin),
  });
  return res.status(200).json({ success: true, result: doc, message: 'Correction saved. The original entry is kept.' });
}

// GET /workday/admin/360/corrections?from=&to=&adminId=&team=
async function corrections(req, res) {
  const q = req.query;
  const { dayKeys } = parseRange(q);
  const { users } = await salesUsers(q);
  const rows = await mongoose.model('AttendanceCorrection').find({ admin: { $in: users.map((u) => u._id) }, dayKey: { $in: dayKeys } }).sort({ created: -1 }).limit(500).lean();
  return res.status(200).json({ success: true, message: 'ok', result: rows });
}

const { REQUIRED_LEAD, missingDetails, prospectCallStats } = require('../../../services/sales/prospectDetails');
const MANAGEMENT_ROLES = require('../../../config/roles').MANAGEMENT_ROLES;
const LEAD_FIELDS = `${Object.keys(REQUIRED_LEAD).join(' ')} stage subStatus stageUpdatedAt stageHistory prospectVerification prospectHandoffs assignedUser assignedUserName`;

// Who raised a prospect: whoever last moved the lead into Prospects, not
// counting someone it was sent to saving the outcome of their own review call.
function prospectOwner(l) {
  const reviewers = new Set((l.prospectHandoffs || []).map((x) => String(x.to)));
  const into = [...(l.stageHistory || [])].reverse().filter((x) => x.toStage === 'Prospects');
  const h = into.find((x) => !reviewers.has(String(x.changedBy))) || into[0];
  if (h && h.changedBy) return { id: String(h.changedBy), name: h.changedByName, at: h.at };
  return l.assignedUser ? { id: String(l.assignedUser), name: l.assignedUserName, at: l.stageUpdatedAt } : null;
}

// GET /workday/admin/360/prospects?prospect=sent|pending|verified|rejected&from=&to=&adminId=&team=&source=&q=
// No prospect = all: everything waiting, plus what was reviewed in the range.
// sent = sent to me from My Calls and still waiting, whoever raised it.
async function prospects(req, res) {
  const q = req.query;
  const status = ['verified', 'rejected', 'sent', 'pending'].includes(q.prospect) ? q.prospect : '';
  const { from, to } = parseRange(q);
  const { users } = await salesUsers(q);
  const idSet = new Set(users.map((u) => String(u._id)));
  const filter = { removed: false };
  if (status === 'sent') {
    filter['prospectHandoffs.to'] = req.admin._id;
    filter['prospectVerification.status'] = { $exists: false };
    filter.stage = 'Prospects';
  } else if (status === 'pending') {
    filter.stage = 'Prospects';
    filter['prospectVerification.status'] = { $exists: false };
  } else if (status) {
    filter['prospectVerification.status'] = status;
    filter['prospectVerification.at'] = { $gte: from, $lte: to };
  } else {
    filter.$and = [{ $or: [{ stage: 'Prospects', 'prospectVerification.status': { $exists: false } }, { 'prospectVerification.at': { $gte: from, $lte: to } }] }];
  }
  if (q.source) filter.source = q.source;
  const search = String(q.q || '').trim();
  if (search) {
    const rx = new RegExp(escapeRx(search), 'i');
    const digits = search.replace(/\D/g, '');
    filter.$or = [{ name: rx }, { email: rx }, ...(digits.length >= 3 ? [{ phone: new RegExp(escapeRx(digits)) }] : [])];
  }
  // A stage filter other than Prospects leaves only leads that moved on.
  if (q.stage) filter.stage = filter.stage && filter.stage !== q.stage ? '__none__' : q.stage;
  if (q.sub) filter.subStatus = q.sub;
  const leads = await mongoose.model('Lead').find(filter).select(LEAD_FIELDS).sort({ stageUpdatedAt: -1 }).limit(1000).lean();
  // A Team Leader with a team: their team's, plus anything sent to them.
  const scope = req.admin && req.admin.role === 'Team Leader' ? await resolveScope(req.admin) : null;
  const teamNames = scope && !scope.isFullAccess && scope.teamMemberNames ? new Set(scope.teamMemberNames) : null;
  const inTeam = (u) => !teamNames || teamNames.has(u.name) || teamNames.has(wd.fullName(u));
  const teamIds = new Set(users.filter(inTeam).map((u) => String(u._id)));
  const rows = [];
  const tails = [...new Set(leads.map((l) => last10(l.phone)).filter((x) => x.length === 10))];
  const allCalls = tails.length
    ? await mongoose.model('CallRecord').find({ removed: false, phone: { $regex: `(${tails.join('|')})$` } }).select('agent agentName phone created answeredAt agentLegAnswered duration').lean()
    : [];
  const callsBy = new Map();
  for (const c of allCalls) {
    const k = last10(c.phone);
    if (!callsBy.has(k)) callsBy.set(k, []);
    callsBy.get(k).push(c);
  }
  for (const l of leads) {
    const owner = prospectOwner(l);
    const ownerId = (l.prospectVerification && l.prospectVerification.owner && String(l.prospectVerification.owner)) || (owner && owner.id);
    if (status !== 'sent' && (!ownerId || !idSet.has(ownerId))) continue;
    const sentToMe = req.admin && (l.prospectHandoffs || []).some((h) => String(h.to) === String(req.admin._id));
    if (status !== 'sent' && !sentToMe && !teamIds.has(ownerId)) continue;
    rows.push({ _id: l._id, talked: prospectCallStats(l, callsBy.get(last10(l.phone)) || [], ownerId), handoffs: l.prospectHandoffs || [], name: l.name, phone: l.phone, email: l.email, stage: l.stage, subStatus: l.subStatus, owner: (owner && owner.name) || (l.prospectVerification && l.prospectVerification.ownerName) || '—', ownerId, raisedAt: owner && owner.at, missing: missingDetails(l), verification: l.prospectVerification || null });
    if (rows.length >= 200) break;
  }
  return res.status(200).json({ success: true, message: 'ok', result: rows });
}

// POST /workday/admin/360/prospects/:id/decide { status: verified|rejected, notes, allowMissing? }
// The reviewer records their own call's outcome; nobody approves their own.
async function decideProspect(req, res) {
  const fail = (message, code = 400) => res.status(code).json({ success: false, result: null, message });
  if (!mongoose.isValidObjectId(req.params.id)) return fail('Lead not found.', 404);
  const b = req.body || {};
  if (!['verified', 'rejected'].includes(b.status)) return fail('Choose verified or rejected.');
  const notes = String(b.notes || '').trim().slice(0, 1000);
  if (notes.length < 5) return fail('Write what came out of your verification call.');
  const Lead = mongoose.model('Lead');
  const lead = await Lead.findOne({ _id: req.params.id, removed: false }).select(LEAD_FIELDS).lean();
  if (!lead) return fail('Lead not found.', 404);
  if (lead.prospectVerification && lead.prospectVerification.status) return fail(`Already ${lead.prospectVerification.status} by ${lead.prospectVerification.byName}.`, 409);
  const owner = prospectOwner(lead);
  if (!owner) return fail('This prospect has no owner to credit.');
  if (owner.id === String(req.admin._id)) return fail('You cannot verify your own prospect.', 403);
  const tail = last10(lead.phone);
  const call = tail.length === 10
    ? await mongoose.model('CallRecord').findOne({ removed: false, agent: req.admin._id, phone: new RegExp(`${tail}$`), answeredAt: { $ne: null }, duration: { $gt: 0 }, created: { $gte: new Date(Date.now() - 7 * 864e5) } }).select('_id').lean()
    : null;
  const missing = missingDetails(lead);
  // Section 7's checks. Duplicate and invalid are never excused; the Sales
  // Manager may excuse a missing call or details with a written reason.
  const exception = String(b.exception || '').trim().slice(0, 500);
  const canExcuse = MANAGEMENT_ROLES.includes(req.admin.role) && exception.length >= 5;
  if (b.status === 'verified') {
    if (lead.stage !== 'Prospects') return fail(`This lead is in ${lead.stage} now, not Prospects.`);
    if (tail.length !== 10) return fail('This lead has no valid number.');
    const twin = await Lead.findOne({ _id: { $ne: lead._id }, removed: false, phoneNormalized: tail, 'prospectVerification.status': 'verified' }).select('name').lean();
    if (twin) return fail(`Duplicate: this number is already verified as ${twin.name}.`);
    const c = b.checks || {};
    if (!c.genuine || !c.suitable || !c.interested) return fail('Confirm the candidate is genuine, suitable and positively interested.');
    if (!call && !canExcuse) return fail('Call the candidate yourself first: no connected call of yours in the last 7 days.');
    if (missing.length && !canExcuse) return fail(`Missing lead details: ${missing.join(', ')}.`);
  }
  const prospectVerification = { status: b.status, owner: owner.id, ownerName: owner.name, by: req.admin._id, byName: wd.fullName(req.admin), at: new Date(), notes, callFound: !!call, ...(b.status === 'verified' ? { checks: { genuine: true, suitable: true, interested: true }, exception: !call || missing.length ? exception : undefined, missingAtVerify: missing } : {}) };
  await Lead.updateOne({ _id: lead._id }, { $set: { prospectVerification } });
  require('../../../notify').notifyUser({
    recipient: owner.id,
    actorId: req.admin._id,
    actorName: prospectVerification.byName,
    module: 'Sales',
    type: `prospect.${b.status}`,
    title: `Your prospect was ${b.status}`,
    body: `${lead.name} · ${notes.slice(0, 140)}`,
    link: '/',
  });
  return res.status(200).json({ success: true, result: prospectVerification, message: b.status === 'verified' ? 'Prospect verified.' : 'Prospect rejected.' });
}

// Last Sunday of a 'YYYY-MM' month.
function lastSunday(month) {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y, m, 0));
  d.setUTCDate(d.getUTCDate() - d.getUTCDay());
  return d.toISOString().slice(0, 10);
}

// Section 10: leads past their callback, booked demo or follow-up time. They
// belong to the assigned user, else to whoever last moved them by hand, the same
// owner services/sales/overdueTasks.js files them under.
const overdueMatch = (now) => ({ $or: [{ stage: 'Callback', callBackAt: { $lt: now } }, { stage: 'Demo Booking', subStatus: 'Demo Booked', meetingAt: { $lt: now } }, { stage: 'Future Prospect', futureFollowUpAt: { $lt: now } }] });
const OVERDUE_OWNER = { $ifNull: ['$assignedUser', { $let: { vars: { moved: { $filter: { input: '$stageHistory', as: 'h', cond: { $gt: ['$$h.changedBy', null] } } } }, in: { $arrayElemAt: ['$$moved.changedBy', -1] } } }] };
const OVERDUE_DUE = { $switch: { branches: [{ case: { $eq: ['$stage', 'Callback'] }, then: '$callBackAt' }, { case: { $eq: ['$stage', 'Demo Booking'] }, then: '$meetingAt' }], default: '$futureFollowUpAt' } };

// GET /workday/admin/360/targets?month=YYYY-MM&adminId=&team=&role=
// Section 4 + 7: monthly verified-prospect target, what's done by the 20th,
// the carried backlog, the recovery Sunday — plus overdue callbacks / demos /
// follow-ups (section 10) and approved leave against the one paid day (11).
async function targets(req, res) {
  const q = req.query;
  const month = /^\d{4}-\d{2}$/.test(String(q.month || '')) ? q.month : wd.todayKey().slice(0, 7);
  const { users } = await salesUsers(q);
  const ids = users.map((u) => u._id);
  const startMonth = POLICY.effectiveFrom.slice(0, 7);
  const [y, m] = month.split('-').map(Number);
  const monthEnd = wd.dayBounds(`${month}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}`).end;
  const now = new Date();
  const [targetRows, verified, rosters, leaves, overdue] = await Promise.all([
    mongoose.model('Target').find({ removed: false, admin: { $in: ids }, period: { $gte: startMonth, $lte: month } }).lean(),
    mongoose.model('Lead').aggregate([
      { $match: { removed: false, 'prospectVerification.status': 'verified', 'prospectVerification.owner': { $in: ids }, 'prospectVerification.at': { $gte: wd.dayBounds(`${startMonth}-01`).start } } },
      { $project: { owner: '$prospectVerification.owner', day: { $dateToString: { format: '%Y-%m-%d', date: '$prospectVerification.at', timezone: TZ } } } },
    ]),
    mongoose.model('SundayRoster').find({ removed: false, admin: { $in: ids }, sundayKey: lastSunday(month) }).lean(),
    mongoose.model('LeaveRequest').find({ removed: false, status: 'Approved', adminId: { $in: ids.map(String) }, fromDate: { $lte: monthEnd }, toDate: { $gte: wd.dayBounds(`${month}-01`).start } }).select('adminId days leaveType emergency lateNotice').lean(),
    mongoose.model('Lead').aggregate([
      { $match: { removed: false, ...overdueMatch(now) } },
      { $project: { owner: OVERDUE_OWNER, due: OVERDUE_DUE } },
      { $match: { owner: { $in: ids } } },
      { $group: { _id: '$owner', n: { $sum: 1 }, today: sumIf({ $gte: ['$due', wd.dayBounds(wd.todayKey()).start] }) } },
    ]),
  ]);
  const overdueBy = new Map(overdue.map((x) => [String(x._id), x]));
  const rows = users.map((u) => {
    const uid = String(u._id);
    const mine = targetRows.filter((t) => String(t.admin) === uid).sort((a, b) => (a.period < b.period ? -1 : 1));
    const done = verified.filter((v) => String(v.owner) === uid);
    const inMonth = (p) => done.filter((v) => v.day.slice(0, 7) === p).length;
    const t = mine.find((x) => x.period === month);
    const by20 = done.filter((v) => v.day.slice(0, 7) === month && v.day <= `${month}-20`).length;
    const roster = rosters.find((r) => String(r.admin) === uid);
    const earlier = mine.filter((x) => x.period < month).map((x) => ({ period: x.period, target: x.targetProspects, achieved: inMonth(x.period), waived: x.backlogWaived }));
    return {
      adminId: uid,
      name: wd.fullName(u) || u.email,
      role: u.role,
      team: u.team,
      targetProspects: t && t.targetProspects != null ? t.targetProspects : null,
      achieved: inMonth(month),
      by20,
      backlog: policy.prospectBacklog(earlier),
      backlogMonths: earlier,
      backlogWaived: t ? t.backlogWaived || 0 : 0,
      backlogWaivedReason: t ? t.backlogWaivedReason || null : null,
      recoveryDue: !!(t && t.targetProspects && by20 < t.targetProspects && wd.todayKey() > `${month}-20`),
      roster: roster ? { sundayKey: roster.sundayKey, restDayKey: roster.restDayKey, plan: roster.plan, by: roster.byName } : null,
      overdue: (overdueBy.get(uid) || {}).n || 0,
      // The short-leave rule counts one day's misses, so only today's lead to it.
      overdueToday: (overdueBy.get(uid) || {}).today || 0,
      // Section 11: one discretionary paid day a month; statutory leave is separate.
      ...(() => {
        const sum = (list) => Math.round(list.reduce((x, l) => x + (l.days || 0), 0) * 100) / 100;
        const mine = leaves.filter((l) => l.adminId === uid);
        const paid = sum(mine.filter((l) => ['Casual', 'Earned'].includes(l.leaveType)));
        return {
          leaveDays: sum(mine),
          paidLeave: paid,
          overPaid: Math.max(0, paid - 1),
          statutoryLeave: sum(mine.filter((l) => ['Maternity', 'Paternity', 'Bereavement'].includes(l.leaveType))),
          lateNoticeLeaves: mine.filter((l) => l.lateNotice).length,
          emergencyLeaves: mine.filter((l) => l.emergency).length,
        };
      })(),
    };
  });
  return res.status(200).json({ success: true, message: 'ok', result: { month, lastSunday: lastSunday(month), rows } });
}

// GET /workday/admin/360/target-detail?month=YYYY-MM&adminId= — everything behind
// one row of the targets board: the prospects, the overdue leads, the leaves and
// every change of the target.
async function targetDetail(req, res) {
  const q = req.query;
  if (!mongoose.isValidObjectId(q.adminId)) return res.status(400).json({ success: false, result: null, message: 'Pick a user.' });
  const month = /^\d{4}-\d{2}$/.test(String(q.month || '')) ? q.month : wd.todayKey().slice(0, 7);
  const uid = new mongoose.Types.ObjectId(String(q.adminId));
  const [y, m] = month.split('-').map(Number);
  const start = wd.dayBounds(`${month}-01`).start;
  const end = wd.dayBounds(`${month}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}`).end;
  const now = new Date();
  const Lead = mongoose.model('Lead');
  const [target, reviewed, waiting, overdueLeads, leaves] = await Promise.all([
    mongoose.model('Target').findOne({ removed: false, admin: uid, period: month }).select('targetProspects targetProspectsHistory setByName updated').lean(),
    Lead.find({ removed: false, 'prospectVerification.owner': uid, 'prospectVerification.at': { $gte: start, $lte: end } }).select('name phone source stage prospectVerification').sort({ 'prospectVerification.at': -1 }).limit(300).lean(),
    Lead.find({ removed: false, stage: 'Prospects', 'prospectVerification.status': { $exists: false }, 'stageHistory.changedBy': uid }).select('name phone source assignedUser assignedUserName stageUpdatedAt prospectHandoffs stageHistory.toStage stageHistory.changedBy stageHistory.changedByName stageHistory.at').limit(300).lean(),
    Lead.find({ removed: false, $and: [overdueMatch(now), { $or: [{ assignedUser: uid }, { 'stageHistory.changedBy': uid }] }] }).select('name phone stage subStatus assignedUser callBackAt meetingAt futureFollowUpAt stageHistory.changedBy').limit(500).lean(),
    mongoose.model('LeaveRequest').find({ removed: false, status: 'Approved', adminId: String(uid), fromDate: { $lte: end }, toDate: { $gte: start } }).select('leaveType days fromDate toDate durationType hours reason emergency lateNotice approver decisionBy').sort({ fromDate: -1 }).lean(),
  ]);
  const dueOf = (l) => (l.stage === 'Callback' ? l.callBackAt : l.stage === 'Demo Booking' ? l.meetingAt : l.futureFollowUpAt);
  const mine = overdueLeads.filter((l) => String(l.assignedUser || ((l.stageHistory || []).filter((h) => h.changedBy).slice(-1)[0] || {}).changedBy) === String(uid));
  const tasks = mine.length ? await mongoose.model('OverdueTask').find({ admin: uid, lead: { $in: mine.map((l) => l._id) } }).select('lead dueAt status explanation reviewNote').lean() : [];
  const taskOf = new Map(tasks.map((t) => [`${t.lead}|${new Date(t.dueAt).getTime()}`, t]));
  return res.status(200).json({
    success: true,
    message: 'ok',
    result: {
      month,
      target: target ? { setByName: target.setByName, updated: target.updated, history: [...(target.targetProspectsHistory || [])].reverse() } : null,
      reviewed: reviewed.map((l) => ({ _id: l._id, name: l.name, phone: l.phone, source: l.source, stage: l.stage, status: l.prospectVerification.status, by: l.prospectVerification.byName, at: l.prospectVerification.at, notes: l.prospectVerification.notes, by20: istDay(l.prospectVerification.at) <= `${month}-20` })),
      waiting: waiting.filter((l) => (prospectOwner(l) || {}).id === String(uid)).map((l) => ({ _id: l._id, name: l.name, phone: l.phone, source: l.source, raisedAt: prospectOwner(l).at, sentTo: (l.prospectHandoffs || []).map((h) => h.toName).filter(Boolean) })),
      overdue: mine
        .map((l) => {
          const due = dueOf(l);
          const t = taskOf.get(`${l._id}|${new Date(due).getTime()}`) || {};
          return { _id: l._id, name: l.name, phone: l.phone, stage: l.stage, subStatus: l.subStatus, due, status: t.status || null, explanation: t.explanation || null, reviewNote: t.reviewNote || null };
        })
        .sort((a, b) => new Date(b.due) - new Date(a.due)),
      leaves,
    },
  });
}

// POST /workday/admin/360/backlog-waive { adminId, period, waived, reason }
async function waiveBacklog(req, res) {
  const b = req.body || {};
  const fail = (message) => res.status(400).json({ success: false, result: null, message });
  if (!mongoose.isValidObjectId(b.adminId) || !/^\d{4}-\d{2}$/.test(String(b.period || ''))) return fail('Pick a user and a month.');
  const waived = Number(b.waived);
  const reason = String(b.reason || '').trim().slice(0, 500);
  if (!Number.isFinite(waived) || waived < 0) return fail('Enter how many prospects are waived.');
  if (reason.length < 5) return fail('Write the reason for this waiver.');
  const a = await mongoose.model('Admin').findOne({ _id: b.adminId, removed: false }).select('name').lean();
  if (!a) return fail('User not found.');
  const result = await mongoose.model('Target').findOneAndUpdate(
    { admin: a._id, period: b.period },
    { $set: { admin: a._id, adminName: a.name, period: b.period, backlogWaived: waived, backlogWaivedReason: reason, setBy: req.admin._id, setByName: req.admin.name, updated: new Date() } },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  ).lean();
  return res.status(200).json({ success: true, result, message: 'Backlog waiver saved.' });
}

// POST /workday/admin/360/roster { adminId, sundayKey, restDayKey, plan } — a
// recovery Sunday always comes with its substitute rest day and work plan.
async function rosterSunday(req, res) {
  const b = req.body || {};
  const fail = (message) => res.status(400).json({ success: false, result: null, message });
  const isDay = (x) => /^\d{4}-\d{2}-\d{2}$/.test(String(x || ''));
  if (!mongoose.isValidObjectId(b.adminId) || !isDay(b.sundayKey) || !isDay(b.restDayKey)) return fail('Pick a user, the Sunday and the rest day.');
  if (wd.istAt(b.sundayKey, '12:00').getUTCDay() !== 0) return fail('The recovery day must be a Sunday.');
  if (b.sundayKey <= wd.todayKey()) return fail('The work plan must be told in advance: pick a Sunday still to come.');
  const gap = Math.abs(wd.istAt(b.restDayKey, '12:00') - wd.istAt(b.sundayKey, '12:00')) / 864e5;
  if (wd.istAt(b.restDayKey, '12:00').getUTCDay() === 0 || gap < 1 || gap > 7) return fail('The rest day must be another day within 7 days of that Sunday.');
  const plan = String(b.plan || '').trim().slice(0, 1000);
  if (plan.length < 5) return fail('Write the work plan for the day.');
  const compensation = String(b.compensation || '').trim().slice(0, 300);
  if (compensation.length < 3) return fail('Write the overtime or other compensation for the day.');
  if (!b.hrChecked) return fail('HR must confirm state law and exemptions before Sunday work.');
  const a = await mongoose.model('Admin').findOne({ _id: b.adminId, removed: false }).select('name surname email').lean();
  if (!a) return fail('User not found.');
  const doc = await mongoose.model('SundayRoster').findOneAndUpdate(
    { admin: a._id, sundayKey: b.sundayKey },
    { $set: { removed: false, adminName: wd.fullName(a) || a.email, restDayKey: b.restDayKey, plan, compensation, hrChecked: true, by: req.admin._id, byName: wd.fullName(req.admin) } },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  ).lean();
  require('../../../notify').notifyUser({
    recipient: a._id,
    actorId: req.admin._id,
    actorName: wd.fullName(req.admin),
    module: 'HRMS',
    type: 'attendance.recovery',
    title: `Recovery Sunday: ${b.sundayKey}`,
    body: `Rest day instead: ${b.restDayKey}. Plan: ${plan.slice(0, 160)}`,
    link: '/',
  });
  return res.status(200).json({ success: true, result: doc, message: 'Recovery Sunday scheduled and the user notified.' });
}

// POST /workday/admin/360/roster/cancel { adminId, sundayKey }
async function cancelRoster(req, res) {
  const b = req.body || {};
  if (!mongoose.isValidObjectId(b.adminId) || !/^\d{4}-\d{2}-\d{2}$/.test(String(b.sundayKey || ''))) return res.status(400).json({ success: false, result: null, message: 'Pick a user and a Sunday.' });
  await mongoose.model('SundayRoster').updateOne({ admin: b.adminId, sundayKey: b.sundayKey }, { $set: { removed: true } });
  return res.status(200).json({ success: true, result: null, message: 'Recovery Sunday cancelled.' });
}

// ── Everything one user did ──────────────────────────────────────────────
const ACTIVITY_GROUP = {
  shift_login: 'session', shift_logout: 'session', auto_start: 'session', marked_present: 'session',
  pool_on: 'dialer', pool_off: 'dialer', break_start: 'break', break_end: 'break',
  leave_pause: 'leave', leave_applied: 'leave', leave_decided: 'leave',
};
const ACTIVITY_LABEL = {
  shift_login: 'Logged in', shift_logout: 'Logged out', auto_start: 'Dialer auto-started', marked_present: 'Marked present',
  pool_on: 'Dialer on', pool_off: 'Dialer off', break_start: 'Break started', break_end: 'Break ended',
  leave_pause: 'Dialer paused for leave', leave_applied: 'Leave applied', leave_decided: 'Leave decided',
};
const kindsOf = (group) => Object.keys(ACTIVITY_GROUP).filter((k) => ACTIVITY_GROUP[k] === group);
const CALL_TITLE = { 'no-answer': 'No answer', busy: 'Busy', failed: 'Failed', voicemail: 'Voicemail', cancelled: 'Cancelled', completed: 'Ended, no talk' };

// GET /workday/admin/360/activity?from=&to=&adminId=&team=&role=&types=call,click&q=&stage=&sub=&outcome=&direction=&path=&page=&items=
// One merged, newest-first list: every login, dialer switch, break, leave,
// call, lead response, payment link, screen, click, search and idle stretch.
async function activity(req, res) {
  const q = req.query;
  const { from, to } = parseRange(q);
  const { users } = await salesUsers(q);
  const ids = users.map((u) => u._id);
  const page = Math.max(1, parseInt(q.page) || 1);
  const items = Math.min(parseInt(q.items) || 50, 200);
  const cap = page * items;
  const picked = String(q.types || '').split(',').filter(Boolean);
  // A filter on calls / leads / screens narrows the list to what it can apply to.
  const only = q.outcome || q.direction || q.recorded || q.disposition || q.callType || q.talkBand || q.campaign ? ['call'] : leadMatch(q) ? ['response', 'call'] : q.path ? ['screen', 'click', 'search', 'idle'] : null;
  const want = (t) => (!picked.length || picked.includes(t)) && (!only || only.includes(t));
  const search = String(q.q || '').trim();
  const rx = search ? new RegExp(escapeRx(search), 'i') : null;
  const digits = search.replace(/\D/g, '');
  const phoneRx = digits.length >= 3 ? new RegExp(escapeRx(digits)) : null;

  const counts = {};
  const out = [];

  const Act = mongoose.model('AgentActivity');
  for (const group of ['session', 'dialer', 'break', 'leave']) {
    if (only) continue;
    const filter = { agent: { $in: ids }, kind: { $in: kindsOf(group) }, at: { $gte: from, $lte: to } };
    if (rx) filter.$or = [{ detail: rx }, { agentName: rx }, { byName: rx }];
    counts[group] = await Act.countDocuments(filter);
    if (!want(group)) continue;
    const rows = await Act.find(filter).sort({ at: -1 }).limit(cap).lean();
    for (const e of rows) out.push({ id: String(e._id), type: group, at: e.at, user: e.agentName, title: ACTIVITY_LABEL[e.kind] || e.kind, detail: [e.detail, e.byName ? `by ${e.byName}` : null].filter(Boolean).join(' · ') });
  }

  const CallRecord = mongoose.model('CallRecord');
  if (!only || only.includes('call')) {
    const filter = { $and: [{ removed: false, agent: { $in: ids }, created: { $gte: from, $lte: to } }, ...(await callFilter(q, ids, from, to))] };
    counts.call = await CallRecord.countDocuments(filter);
    if (want('call')) {
      const rows = await CallRecord.find(filter).select('contactName phone direction status duration answeredAt agentLegAnswered created disposition agentName missedByAgent recording.status').sort({ created: -1 }).limit(cap).lean();
      for (const c of rows) {
        const ok = !!(c.answeredAt && c.agentLegAnswered !== false && c.duration > 0);
        const outcome = ok ? 'Connected' : c.missedByAgent ? 'Missed by user' : CALL_TITLE[c.status] || c.status;
        out.push({ id: String(c._id), type: 'call', at: c.created, user: c.agentName, title: `${c.direction === 'Inbound' ? 'Incoming from' : 'Outgoing to'} ${c.contactName || c.phone} · ${outcome}`, detail: [ok ? `Talk ${Math.floor(c.duration / 60)}m ${c.duration % 60}s` : null, c.disposition].filter(Boolean).join(' · '), phone: c.phone, leadName: c.contactName });
      }
    }
  }

  if (!only || only.includes('response')) {
    const step = { 'stageHistory.changedBy': { $in: ids }, 'stageHistory.at': { $gte: from, $lte: to } };
    if (q.stage) step['stageHistory.toStage'] = q.stage;
    if (q.sub) step['stageHistory.toSubStatus'] = q.sub;
    if (rx) step.$or = [{ name: rx }, { 'stageHistory.remarks': rx }, { 'stageHistory.toStage': rx }, { 'stageHistory.toSubStatus': rx }, ...(phoneRx ? [{ phone: phoneRx }] : [])];
    const leadOnly = responseFilter({ source: q.source, prospect: q.prospect, me: q.me }).lead;
    const [agg] = await mongoose.model('Lead').aggregate([
      { $match: { removed: false, 'stageHistory.changedBy': { $in: ids }, 'stageHistory.at': { $gte: from, $lte: to }, ...leadOnly } },
      { $unwind: '$stageHistory' },
      { $match: step },
      { $facet: { count: [{ $count: 'n' }], rows: [{ $sort: { 'stageHistory.at': -1 } }, { $limit: cap }, { $project: { name: 1, phone: 1, h: '$stageHistory' } }] } },
    ]);
    counts.response = (agg.count[0] && agg.count[0].n) || 0;
    if (want('response')) {
      for (const r of agg.rows) out.push({ id: `${r._id}-${new Date(r.h.at).getTime()}`, type: 'response', at: r.h.at, user: r.h.changedByName, title: `${r.name || r.phone}: ${r.h.fromStage || 'New'} → ${r.h.toStage}${r.h.toSubStatus && r.h.toSubStatus !== r.h.toStage ? ` · ${r.h.toSubStatus}` : ''}`, detail: r.h.remarks || '', phone: r.phone, leadName: r.name, stage: r.h.toStage, sub: r.h.toSubStatus });
    }
  }

  if (!only) {
    const filter = { removed: false, createdBy: { $in: ids }, created: { $gte: from, $lte: to } };
    if (rx) filter.$or = [{ studentName: rx }, { course: rx }, ...(phoneRx ? [{ studentPhone: phoneRx }] : [])];
    const PR = mongoose.model('PaymentRequest');
    counts.payment = await PR.countDocuments(filter);
    if (want('payment')) {
      const rows = await PR.find(filter).select('studentName studentPhone course amount status created createdByName').sort({ created: -1 }).limit(cap).lean();
      for (const p of rows) out.push({ id: String(p._id), type: 'payment', at: p.created, user: p.createdByName, title: `Payment link ₹${(p.amount || 0).toLocaleString('en-IN')} · ${p.studentName || ''}`, detail: [p.course, p.status].filter(Boolean).join(' · '), phone: p.studentPhone, leadName: p.studentName });
    }
  }

  const UE = mongoose.model('UserEvent');
  for (const kind of ['screen', 'click', 'search', 'idle']) {
    if (only && !only.includes(kind)) continue;
    const filter = { admin: { $in: ids }, kind, at: { $gte: from, $lte: to } };
    if (q.path) filter.path = q.path;
    if (rx) filter.$or = [{ label: rx }, { path: rx }];
    counts[kind] = await UE.countDocuments(filter);
    if (!want(kind)) continue;
    const rows = await UE.find(filter).sort({ at: -1 }).limit(cap).lean();
    for (const e of rows) {
      const title = kind === 'screen' ? `Opened ${e.label || e.path}` : kind === 'click' ? `Clicked "${e.label || 'unnamed'}"` : kind === 'search' ? `Searched "${e.label}"` : `Idle for ${Math.max(1, Math.round((e.seconds || 0) / 60))}m`;
      out.push({ id: String(e._id), type: kind, at: e.at, user: e.adminName, title, detail: e.path || '' });
    }
  }

  out.sort((a, b) => new Date(b.at) - new Date(a.at));
  const shown = Object.keys(counts).filter(want);
  const count = shown.reduce((t, x) => t + (counts[x] || 0), 0);
  const paths = await UE.distinct('path', { admin: { $in: ids }, at: { $gte: from, $lte: to } });
  return res.status(200).json({
    success: true,
    message: 'ok',
    result: out.slice((page - 1) * items, page * items),
    counts,
    paths: paths.filter(Boolean).sort().slice(0, 200),
    pagination: { page, items, count, pages: Math.ceil(count / items) || 0 },
  });
}

// POST /workday/track { events: [{ kind, at, path, label, seconds }] }
// From the logged-in user's own browser (hooks/useActivityTracker.js).
async function track(req, res) {
  const list = Array.isArray(req.body && req.body.events) ? req.body.events.slice(0, 200) : [];
  const now = Date.now();
  const adminName = wd.fullName(req.admin) || req.admin.email;
  const docs = [];
  for (const e of list) {
    if (!e || !['screen', 'click', 'search', 'idle'].includes(e.kind)) continue;
    const at = new Date(e.at).getTime();
    // a browser's clock can be off; anything over a day away isn't believable
    if (!Number.isFinite(at) || Math.abs(now - at) > 864e5) continue;
    docs.push({ admin: req.admin._id, adminName, kind: e.kind, at: new Date(at), path: String(e.path || '').slice(0, 200), label: String(e.label || '').slice(0, 120), ...(e.kind === 'idle' ? { seconds: Math.min(86400, Math.max(0, Number(e.seconds) || 0)) } : {}) });
  }
  // Talking on the phone isn't idle: drop a stretch that a connected call fills
  // at least half of.
  const idle = docs.filter((d) => d.kind === 'idle');
  const skip = new Set();
  if (idle.length) {
    const first = new Date(Math.min(...idle.map((d) => d.at.getTime())));
    const talks = await mongoose.model('CallRecord').find({ removed: false, agent: req.admin._id, answeredAt: { $ne: null }, duration: { $gt: 0 }, endedAt: { $gte: first } }).select('answeredAt endedAt').lean();
    for (const d of idle) {
      const start = d.at.getTime();
      const end = start + d.seconds * 1000;
      const offCallMin = policy.spanMinutes([{ start, end }], talks.map((c) => ({ start: new Date(c.answeredAt).getTime(), end: new Date(c.endedAt || c.answeredAt).getTime() })));
      if (offCallMin * 60 <= d.seconds / 2) skip.add(d);
    }
  }
  const keep = docs.filter((d) => !skip.has(d));
  if (keep.length) await mongoose.model('UserEvent').insertMany(keep, { ordered: false });
  return res.status(200).json({ success: true, result: { saved: keep.length }, message: 'ok' });
}

module.exports = { parseRange, salesUsers, prepareFilters, salesRecords, callFilter, leadMatch, responseFilter, attendance, summary, records, calls, leads, leadList, leadsSection, exportXlsx, attendanceMonth, exceptions, dialerReport, policyDays, correct, corrections, prospects, decideProspect, targets, targetDetail, waiveBacklog, rosterSunday, cancelRoster, activity, track };
