const mongoose = require('mongoose');
const wd = require('../../../services/hr/workday');
const { SALES_ROLES } = require('../../../config/roles');

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

async function salesUsers(q) {
  const filter = { removed: false, role: { $in: SALES_ROLES } };
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
  return { users: list, teams: q.self ? [] : teams.map((t) => t.name).sort(), people: pick.map((u) => ({ adminId: String(u._id), name: wd.fullName(u) || u.email, role: u.role })) };
}

// Per user × IST day: login / logout / worked / breaks / late / leave, from
// the WorkSession or (no session) rebuilt from the dialer's activity log.
async function attendance(users, dayKeys, from, to) {
  const ids = users.map((u) => u._id);
  const [sessions, leaves, holidays, activity, callDays] = await Promise.all([
    mongoose.model('WorkSession').find({ admin: { $in: ids }, dayKey: { $in: dayKeys } }).lean(),
    mongoose
      .model('LeaveRequest')
      .find({ removed: false, status: 'Approved', adminId: { $in: ids.map(String) }, fromDate: { $lte: to }, toDate: { $gte: from } })
      .select('adminId fromDate toDate durationType hours leaveType')
      .lean(),
    wd.holidaysBetween(wd.dayBounds(dayKeys[0]).start, to),
    mongoose
      .model('AgentActivity')
      .find({ agent: { $in: ids }, at: { $gte: wd.dayBounds(dayKeys[0]).start, $lte: to }, kind: { $in: ['pool_on', 'pool_off', 'break_start', 'break_end'] } })
      .select('agent kind at detail')
      .sort({ at: 1 })
      .lean(),
    mongoose.model('CallRecord').aggregate([
      { $match: { removed: false, agent: { $in: ids }, created: { $gte: wd.dayBounds(dayKeys[0]).start, $lte: to } } },
      { $group: { _id: { a: '$agent', d: { $dateToString: { format: '%Y-%m-%d', date: '$created', timezone: TZ } } }, firstAt: { $min: '$created' }, lastAt: { $max: { $ifNull: ['$endedAt', '$created'] } } } },
    ]),
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

  const today = wd.todayKey();
  const W = wd.W;
  const out = new Map(); // uid → [day rows]
  for (const u of users) {
    const uid = String(u._id);
    const mine = leaves.filter((l) => l.adminId === uid);
    const rows = [];
    for (const dk of dayKeys) {
      const s = sBy.get(key(uid, dk)) || derived(uid, dk);
      const ws = wd.istAt(dk, W.start);
      const we = wd.istAt(dk, W.end);
      const holiday = hBy.get(dk);
      const weeklyOff = W.weeklyOff.includes(wd.istAt(dk, '12:00').getUTCDay());
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
      const dialerMin = pool == null ? null : Math.min(activeMin, pool);
      let status;
      if (holiday) status = 'holiday';
      else if (weeklyOff && !startAt) status = 'weekly-off';
      else if (full) status = 'leave';
      else if (s && s.loginAt) status = 'present';
      else if (s && s.autoStartedAt) status = 'auto';
      else status = dk === today && new Date() < ws ? 'upcoming' : 'absent';
      // late login → half day / full-day leave (shiftSchedule.workday.lateLogin)
      const penalty = status === 'present' && !weeklyOff ? wd.lateLoginPenalty(dk, s.loginAt, { derived: !!s.derived, leaveDay }) : null;
      if (penalty) status = penalty.kind;
      rows.push({
        dayKey: dk,
        status,
        derived: !!(s && s.derived),
        holiday: holiday ? holiday.name : null,
        leave: dayLeaves.map((l) => l.leaveType).join(', ') || null,
        // approved leave + any late-login leave counted for this day
        leaveDay: leaveDay + (penalty ? penalty.leave : 0),
        lateLoginNote: penalty ? penalty.label : null,
        workingDay: !holiday && !weeklyOff,
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
async function payments(ids, from, to, withList) {
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
  const blank = () => ({ links: 0, paid: 0, collected: 0, newEnrolments: 0, dealValue: 0, pending: 0, pendingAmount: 0, expired: 0 });
  const by = new Map();
  const total = blank();
  const inRange = (d) => d && new Date(d) >= from && new Date(d) <= to;
  const list = [];
  for (const p of docs) {
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
    { $addFields: { last: { $arrayElemAt: ['$stageHistory', -1] } } },
    { $match: { 'last.changedBy': uid } },
    { $project: { name: 1, phone: 1, stage: 1, subStatus: 1, meetingAt: 1, callBackAt: 1, futureFollowUpAt: 1 } },
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
  const { users, teams, people } = await salesUsers(q);
  const ids = users.map((u) => u._id);
  const match = { removed: false, agent: { $in: ids }, created: { $gte: from, $lte: to } };
  const fmt = bucket === 'hour' ? '%Y-%m-%d %H' : bucket === 'day' ? '%Y-%m-%d' : '%Y-%m';
  const Lead = mongoose.model('Lead');

  // The same-length window right before — for "vs previous period".
  const prevTo = new Date(from.getTime() - 1);
  const prevFrom = new Date(from.getTime() - (to - from) - 1);
  const [facets, att, pay, responses, prevCalls] = await Promise.all([
    mongoose.model('CallRecord').aggregate([
      { $match: match },
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
            { $bucket: { groupBy: '$duration', boundaries: [0, 30, 60, 180, 300, 600, 1e9], default: 'other', output: { n: { $sum: 1 } } } },
          ],
        },
      },
    ]),
    attendance(users, dayKeys, from, to),
    payments(ids, from, to, true),
    Lead.aggregate([
      { $match: { removed: false, 'stageHistory.changedBy': { $in: ids }, 'stageHistory.at': { $gte: from, $lte: to } } },
      { $unwind: '$stageHistory' },
      { $match: { 'stageHistory.changedBy': { $in: ids }, 'stageHistory.at': { $gte: from, $lte: to } } },
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
      { $match: { removed: false, agent: { $in: ids }, created: { $gte: prevFrom, $lte: prevTo } } },
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
  const payBlank = { links: 0, paid: 0, collected: 0, newEnrolments: 0, dealValue: 0, pending: 0, pendingAmount: 0, expired: 0 };
  const blank = { calls: 0, outbound: 0, inbound: 0, connected: 0, talkSec: 0, longestSec: 0, shortCalls: 0, missed: 0, recorded: 0, recordedSec: 0, recordedMissed: 0, unique: 0 };
  const cBy = new Map(f.byUser.map((x) => [String(x._id), x]));
  const rBy = new Map(r.byUser.map((x) => [String(x._id), x]));

  const sumDays = (days) => {
    const t = { workingDays: 0, present: 0, auto: 0, worked: 0, absent: 0, leave: 0, late: 0, loginMin: 0, breakMin: 0, activeMin: 0, dialerMin: 0, offMin: 0, dialerDays: 0, loginClock: [] };
    for (const d of days) {
      if (d.workingDay) t.workingDays += 1;
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
        if (d.lateMin > 15) t.late += 1;
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
  const BANDS = { 0: '< 30s', 30: '30s–1m', 60: '1–3m', 180: '3–5m', 300: '5–10m', 600: '10m+' };

  const one = users.length === 1 && q.adminId;
  return {
    range: { from, to, bucket, days: dayKeys.length, prevFrom, prevTo },
    workday: wd.W,
    teams,
    people,
    totals,
    rows,
    trend,
    heat,
    outcomes: f.outcomes.map((o) => ({ key: o._id || 'unknown', n: o.n })).sort((a, b) => b.n - a.n),
    dispositions: f.dispositions.map((d) => ({ key: d._id, n: d.n })),
    talkBands: f.talkBands.map((b) => ({ key: BANDS[b._id] || b._id, n: b.n })),
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
async function usedCohort({ ids, from, to, full }) {
  const calls = await mongoose
    .model('CallRecord')
    .find({ removed: false, agent: { $in: ids }, created: { $gte: from, $lte: to }, status: { $nin: IN_PROGRESS } })
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

async function usedReport({ ids, from, to, prevFrom, prevTo, bucket }) {
  const [cur, prev] = await Promise.all([usedCohort({ ids, from, to }), usedCohort({ ids, from: prevFrom, to: prevTo })]);
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
    trend: keys.map((k, i) => ({ key: k, n: series(cur)[i] })),
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
  const list = await usedCohort({ ids: users.map((u) => u._id), from, to, full: true });
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
    const [team, now, pipeline, target] = await Promise.all([
      build({ from: q.from, to: q.to }),
      liveStatus(me.adminId),
      pipelineOf(me.adminId),
      mongoose.model('Target').findOne({ removed: false, admin: me.adminId, period: month }).select('period targetCalls targetDeals targetRevenue').lean(),
    ]);
    result.compare = compareWithTeam(me, team);
    result.now = now;
    result.pipeline = pipeline;
    result.target = target;
  }
  return res.status(200).json({ success: true, message: 'ok', result });
}

// GET /workday/admin/360/leads-report?…360 filters… — the Used leads
// section, on its own request so the rest of the 360° doesn't wait for it.
async function leadsSection(req, res) {
  const q = req.query;
  const { from, to, bucket } = parseRange(q);
  const { users } = await salesUsers(q);
  const prevTo = new Date(from.getTime() - 1);
  const prevFrom = new Date(from.getTime() - (to - from) - 1);
  const result = await usedReport({ ids: users.map((u) => u._id), from, to, prevFrom, prevTo, bucket });
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
  const [perDay, callRows] = await Promise.all([
    CallRecord.aggregate([
      { $match: { removed: false, agent: { $in: ids }, created: { $gte: from, $lte: to } } },
      { $group: { _id: { a: '$agent', d: { $dateToString: { format: '%Y-%m-%d', date: '$created', timezone: TZ } } }, calls: { $sum: 1 }, connected: sumIf(CONNECTED), talkSec: callTotals.talkSec, missed: callTotals.missed } },
    ]),
    CallRecord.find({ removed: false, agent: { $in: ids }, created: { $gte: from, $lte: to } })
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
  const STATUS = { present: 'Present', auto: 'Auto-started', absent: 'Absent', leave: 'Leave', holiday: 'Holiday', 'weekly-off': 'Weekly off', upcoming: 'Not started' };
  const daysSheet = [];
  for (const u of users) {
    for (const d of att.get(String(u._id)) || []) {
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
  const pay = await payments(ids, from, to, true);
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
  if (stages.length) step['stageHistory.toStage'] = { $in: stages };
  const search = String(q.q || '').trim();
  const lead = { removed: false, 'stageHistory.changedBy': { $in: ids }, 'stageHistory.at': { $gte: from, $lte: to } };
  if (search) {
    const rx = new RegExp(escapeRx(search), 'i');
    const digits = search.replace(/\D/g, '');
    lead.$or = [{ name: rx }, { email: rx }, ...(digits.length >= 3 ? [{ phone: new RegExp(escapeRx(digits)) }] : [])];
  }
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
  const and = [{ removed: false, agent: { $in: users.map((u) => u._id) }, created: { $gte: from, $lte: to } }];
  if (['Inbound', 'Outbound'].includes(q.direction)) and.push({ direction: q.direction });
  if (q.outcome === 'connected') and.push({ $expr: CONNECTED });
  else if (q.outcome === 'missed') and.push({ missedByAgent: true });
  else if (q.outcome === 'not-connected') and.push({ $expr: { $not: [CONNECTED] } });
  if (q.recorded === '1') and.push({ 'recording.status': 'available' });
  const search = String(q.q || '').trim();
  if (search) {
    const rx = new RegExp(escapeRx(search), 'i');
    const or = [{ contactName: rx }, { disposition: rx }];
    const digits = search.replace(/\D/g, '');
    if (digits.length >= 3) or.push({ phone: new RegExp(escapeRx(digits)) });
    const leads = await mongoose.model('Lead').find({ removed: false, name: rx }).select('phoneNormalized').limit(300).lean();
    const tails = [...new Set(leads.map((l) => l.phoneNormalized).filter((p) => p && p.length === 10))];
    if (tails.length) or.push({ phone: new RegExp(`(${tails.join('|')})$`) });
    and.push({ $or: or });
  }
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
        notes: r.notes || null,
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
  const blank = () => ({ present: 0, halfDay: 0, lateLeave: 0, auto: 0, absent: 0, leave: 0, late: 0 });
  const tally = (c, d) => {
    if (d.status === 'present') c.present += 1;
    else if (d.status === 'half-day') c.halfDay += 1;
    else if (d.status === 'late-leave') c.lateLeave += 1;
    else if (d.status === 'auto') c.auto += 1;
    else if (d.status === 'absent') c.absent += 1;
    else if (d.status === 'leave') c.leave += 1;
    if (d.lateMin > LATE_MIN) c.late += 1;
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
      return { adminId: String(u._id), name: wd.fullName(u) || u.email, status: d.status, loginAt: d.loginAt || d.autoStartedAt || null, logoutAt: d.logoutAt || null, lateMin: d.lateMin || 0, activeMin: d.activeMin || 0, leave: d.leave || null, note: d.lateLoginNote || null };
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

module.exports = { summary, calls, leads, leadList, leadsSection, exportXlsx, attendanceMonth };
