const mongoose = require('mongoose');
const wd = require('../../../services/hr/workday');
const shiftSchedule = require('../../../config/shiftSchedule');
const { FULL_ACCESS_ROLES } = require('../../../services/access/salesScope');
const { SALES_ROLES } = require('../../../config/roles');
const sales360 = require('./sales360');

// /api/workday — the header Login / break / leave widget (any CRM user) and
// the admin "Work & Leave Tracker" (management). Logic lives in
// services/hr/workday.js; this file is request/response only.
const ok = (res, result, message = 'ok') => res.status(200).json({ success: true, result, message });
const bad = (res, message, status = 400) => res.status(status).json({ success: false, result: null, message });
const isManager = (req) => FULL_ACCESS_ROLES.includes(req.admin.role);
const done = (res, r, okMsg) => (r.ok ? ok(res, r.leave || r.session || r, okMsg) : bad(res, r.error));

// ── me ───────────────────────────────────────────────────────────────────
// GET /workday/me?from=&to=  (from/to ISO: the calendar month on screen)
const me = async (req, res) => {
  const a = req.admin;
  const dayKey = wd.todayKey();
  const now = new Date();
  const from = req.query.from ? new Date(req.query.from) : new Date(now.getTime() - 45 * 864e5);
  const to = req.query.to ? new Date(req.query.to) : new Date(now.getTime() + 75 * 864e5);
  const [session, holiday, off, leaveNow, leaves, holidays, st] = await Promise.all([
    wd.getSession(a._id, dayKey),
    wd.holidayOn(dayKey),
    wd.dayOff(a, dayKey),
    wd.activeLeave(a._id, now),
    mongoose
      .model('LeaveRequest')
      .find({ removed: false, adminId: String(a._id), toDate: { $gte: from }, fromDate: { $lte: to } })
      .select('-decisionToken')
      .sort({ fromDate: -1 })
      .lean(),
    wd.holidaysBetween(from, to),
    mongoose.model('AgentCallState').findOne({ agent: a._id }).select('status campaign pausedUntil breakKey').lean(),
  ]);
  const openBreak = session && (session.breaks || []).find((b) => !b.endAt && now < wd.plannedEnd(b));
  return ok(res, {
    dayKey,
    now,
    session,
    loggedIn: !!(session && session.loginAt && !session.logoutAt),
    autoStarted: !!(session && session.autoStartedAt && !session.loginAt),
    onBreak: openBreak ? { key: openBreak.key, label: openBreak.label, until: wd.plannedEnd(openBreak) } : null,
    breaks: shiftSchedule.breaks.map((b) => ({ key: b.key, label: b.label, durationMin: b.durationMin, window: `${b.start}–${b.end}`, taken: !!(session && (session.breaks || []).some((x) => x.key === b.key)) })),
    holiday,
    dayOff: off,
    leaveNow: leaveNow ? { _id: leaveNow._id, label: wd.durationLabel(leaveNow), until: leaveNow.toDate } : null,
    dialer: { eligible: wd.isSales(a), on: !!(st && st.campaign && st.status !== 'Offline'), status: st ? st.status : 'Offline', pausedUntil: st && st.pausedUntil },
    leaves: leaves.map((l) => ({ ...l, label: wd.durationLabel(l) })),
    holidays,
    workday: wd.W,
    leaveTypes: wd.LEAVE_TYPES,
  });
};

// The header widget is for Sales users only (not admins, Support, Finance or
// LMS accounts) — every self-service endpoint goes through this.
const salesOnly = (fn) => async (req, res) => (wd.isSales(req.admin) ? fn(req, res) : bad(res, 'Login / leave here is for Sales users only.', 403));

const login = async (req, res) => {
  const r = await wd.login(req.admin);
  const msg = r.dialer.started ? 'Logged in — auto-dialer is on, calls will start coming.' : r.dialer.reason === 'not-sales' ? 'Logged in.' : `Logged in — dialer stays off (${r.dialer.reason}).`;
  return ok(res, r, msg);
};
const logout = async (req, res) => ok(res, await wd.logout(req.admin), 'Logged out — auto-dialer is off.');
const breakStart = async (req, res) => {
  const r = await wd.startBreak(req.admin, String((req.body && req.body.key) || ''));
  return r.ok ? ok(res, r, `${r.label} started.`) : bad(res, r.error, 409);
};
const breakEnd = async (req, res) => {
  const r = await wd.endBreak(req.admin);
  return r.ok ? ok(res, r, 'Welcome back — dialer resumed.') : bad(res, r.error, 409);
};
const leaveApply = async (req, res) => done(res, await wd.applyLeave(req.admin, req.body || {}), 'Leave applied — sent for approval.');
const leaveCancel = async (req, res) =>
  mongoose.isValidObjectId(req.params.id) ? done(res, await wd.cancelLeave(req.admin, req.params.id), 'Leave cancelled.') : bad(res, 'Leave request not found.', 404);

// ── admin ────────────────────────────────────────────────────────────────
const guard = (fn) => async (req, res) => (isManager(req) ? fn(req, res) : bad(res, 'Management only.', 403));
// Management sees anyone; everyone else only themselves (their own 360°,
// day timeline and month report) — adminId is forced to the caller.
const selfOrManager = (fn) => async (req, res) => {
  if (!isManager(req)) {
    req.query.adminId = String(req.admin._id);
    req.query.team = '';
    req.query.self = '1';
  }
  return fn(req, res);
};
const minutes = (a, b) => Math.max(0, Math.round((new Date(b) - new Date(a)) / 60000));

// GET /workday/admin/board?date=YYYY-MM-DD&role=&team=&status=&q=
const board = guard(async (req, res) => {
  const dayKey = /^\d{4}-\d{2}-\d{2}$/.test(req.query.date || '') ? req.query.date : wd.todayKey();
  const { start, end } = wd.dayBounds(dayKey);
  const isToday = dayKey === wd.todayKey();
  const now = new Date();
  const until = isToday ? now : end;

  // Sales users only — the only people the header Login / leave flow is for.
  const staffFilter = { removed: false, enabled: true, role: { $in: SALES_ROLES } };
  if (req.query.role && SALES_ROLES.includes(req.query.role)) staffFilter.role = req.query.role;
  const admins = await mongoose.model('Admin').find(staffFilter).select('name surname role email').lean();
  const ids = admins.map((a) => a._id);
  const idStr = ids.map(String);

  const Team = mongoose.model('Team');
  const teams = await Team.find({ removed: false }).select('name lead members').lean();
  const teamOf = (a) => {
    const keys = [a.name, wd.fullName(a)];
    const t = teams.find((x) => keys.includes(x.lead) || (x.members || []).some((m) => keys.includes(m)));
    return t ? t.name : null;
  };

  const [sessions, leaves, holiday, states, calls] = await Promise.all([
    mongoose.model('WorkSession').find({ dayKey, admin: { $in: ids } }).lean(),
    mongoose.model('LeaveRequest').find({ removed: false, adminId: { $in: idStr }, status: { $in: ['Approved', 'Pending'] }, fromDate: { $lte: end }, toDate: { $gte: start } }).select('-decisionToken').lean(),
    wd.holidayOn(dayKey),
    isToday ? mongoose.model('AgentCallState').find({ agent: { $in: ids } }).select('agent status campaign pausedUntil breakKey').lean() : [],
    mongoose.model('CallRecord').aggregate([
      { $match: { removed: false, agent: { $in: ids }, created: { $gte: start, $lte: end } } },
      {
        $group: {
          _id: '$agent',
          calls: { $sum: 1 },
          connected: { $sum: { $cond: [{ $and: [{ $ne: ['$answeredAt', null] }, { $ne: ['$agentLegAnswered', false] }, { $gt: ['$duration', 0] }] }, 1, 0] } },
          talkSec: { $sum: { $ifNull: ['$duration', 0] } },
        },
      },
    ]),
  ]);
  const sBy = new Map(sessions.map((s) => [String(s.admin), s]));
  const stBy = new Map(states.map((s) => [String(s.agent), s]));
  const cBy = new Map(calls.map((c) => [String(c._id), c]));
  const weeklyOff = wd.W.weeklyOff.includes(wd.istAt(dayKey, '12:00').getUTCDay());

  let rows = admins.map((a) => {
    const id = String(a._id);
    const s = sBy.get(id);
    const st = stBy.get(id);
    const myLeaves = leaves.filter((l) => l.adminId === id);
    const approved = myLeaves.filter((l) => l.status === 'Approved');
    const breaks = (s && s.breaks ? s.breaks : []).map((b) => {
      const e = b.endAt || (until >= wd.plannedEnd(b) ? wd.plannedEnd(b) : null);
      return { key: b.key, label: b.label, startAt: b.startAt, endAt: e, minutes: minutes(b.startAt, e || until), open: !e };
    });
    const breakMin = breaks.reduce((t, b) => t + b.minutes, 0);
    const startedAt = s && (s.loginAt || s.autoStartedAt);
    const stoppedAt = s && s.logoutAt;
    const workedMin = startedAt ? Math.max(0, minutes(startedAt, stoppedAt || until) - breakMin) : 0;
    const onLeaveNow = isToday && approved.some((l) => new Date(l.fromDate) <= now && new Date(l.toDate) >= now);
    const fullLeave = approved.some((l) => new Date(l.fromDate) <= wd.istAt(dayKey, wd.W.start) && new Date(l.toDate) >= wd.istAt(dayKey, wd.W.end));

    let status;
    if (holiday) status = 'holiday';
    else if (fullLeave) status = 'on-leave';
    else if (stoppedAt) status = 'logged-out';
    else if (breaks.some((b) => b.open)) status = 'on-break';
    else if (onLeaveNow) status = 'on-leave';
    else if (s && s.loginAt) status = 'working';
    else if (s && s.autoStartedAt) status = 'auto-started';
    else if (weeklyOff) status = 'weekly-off';
    else status = 'not-logged-in';

    const c = cBy.get(id) || { calls: 0, connected: 0, talkSec: 0 };
    return {
      adminId: id,
      name: wd.fullName(a) || a.email,
      role: a.role,
      team: teamOf(a),
      status,
      loginAt: s && s.loginAt,
      autoStartedAt: s && s.autoStartedAt,
      logoutAt: stoppedAt,
      lateMin: s && s.loginAt ? Math.max(0, minutes(wd.istAt(dayKey, wd.W.start), s.loginAt)) : null,
      workedMin,
      breakMin,
      breaks,
      dialer: st ? { on: !!(st.campaign && st.status !== 'Offline'), status: st.status, pausedUntil: st.pausedUntil, breakKey: st.breakKey } : null,
      leaves: myLeaves.map((l) => ({ _id: l._id, status: l.status, leaveType: l.leaveType, label: wd.durationLabel(l) })),
      calls: c.calls,
      connected: c.connected,
      talkSec: c.talkSec,
    };
  });

  if (req.query.team) rows = rows.filter((r) => r.team === req.query.team);
  const kpi = {
    staff: rows.length,
    working: rows.filter((r) => r.status === 'working').length,
    onBreak: rows.filter((r) => r.status === 'on-break').length,
    onLeave: rows.filter((r) => r.status === 'on-leave').length,
    autoStarted: rows.filter((r) => r.status === 'auto-started').length,
    notLoggedIn: rows.filter((r) => r.status === 'not-logged-in').length,
    loggedOut: rows.filter((r) => r.status === 'logged-out').length,
    late: rows.filter((r) => r.lateMin > 15).length,
    calls: rows.reduce((t, r) => t + r.calls, 0),
    pendingLeaves: await mongoose.model('LeaveRequest').countDocuments({ removed: false, status: 'Pending' }),
  };
  if (req.query.status) rows = rows.filter((r) => r.status === req.query.status);
  if (req.query.q) {
    const q = String(req.query.q).toLowerCase();
    rows = rows.filter((r) => r.name.toLowerCase().includes(q));
  }
  const order = { working: 0, 'on-break': 1, 'auto-started': 2, 'on-leave': 3, 'not-logged-in': 4, 'logged-out': 5, 'weekly-off': 6, holiday: 7 };
  rows.sort((x, y) => order[x.status] - order[y.status] || x.name.localeCompare(y.name));

  return ok(res, {
    dayKey,
    isToday,
    holiday,
    weeklyOff,
    workday: wd.W,
    kpi,
    rows,
    teams: teams.map((t) => t.name).sort(),
    roles: [...new Set(admins.map((a) => a.role))].sort(),
  });
});

// GET /workday/admin/leaves?status=&from=&to=&q=&page=&items=
const leaves = guard(async (req, res) => {
  const q = req.query;
  const filter = { removed: false };
  if (q.status && q.status !== 'All') filter.status = q.status;
  if (q.from || q.to) {
    if (q.to) filter.fromDate = { $lte: new Date(q.to) };
    if (q.from) filter.toDate = { $gte: new Date(q.from) };
  }
  if (q.q) filter.employee = new RegExp(String(q.q).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
  const page = parseInt(q.page) || 1;
  const items = Math.min(parseInt(q.items) || 20, 200);
  const LeaveRequest = mongoose.model('LeaveRequest');
  const [rows, count, byStatus] = await Promise.all([
    LeaveRequest.find(filter).select('-decisionToken').sort({ status: 1, fromDate: -1 }).skip((page - 1) * items).limit(items).lean(),
    LeaveRequest.countDocuments(filter),
    LeaveRequest.aggregate([{ $match: { removed: false } }, { $group: { _id: '$status', n: { $sum: 1 } } }]),
  ]);
  return res.status(200).json({
    success: true,
    result: rows.map((l) => ({ ...l, label: wd.durationLabel(l) })),
    counts: Object.fromEntries(byStatus.map((s) => [s._id, s.n])),
    pagination: { page, pages: Math.ceil(count / items) || 0, count },
    message: 'ok',
  });
});

// POST /workday/admin/leave/:id/decide { action: approve|reject, note? }
const decide = guard(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return bad(res, 'Leave request not found.', 404);
  const action = req.body && req.body.action === 'reject' ? 'reject' : 'approve';
  const r = await wd.decideLeave(req.params.id, action, { id: req.admin._id, name: wd.fullName(req.admin) }, req.body && req.body.note);
  return done(res, r, `Leave ${action === 'approve' ? 'approved' : 'rejected'}.`);
});

// GET /workday/admin/timeline?adminId=&date= — one user's day, event by event.
const timeline = selfOrManager(async (req, res) => {
  const { adminId } = req.query;
  if (!mongoose.isValidObjectId(adminId)) return bad(res, 'Pick a user.');
  const dayKey = /^\d{4}-\d{2}-\d{2}$/.test(req.query.date || '') ? req.query.date : wd.todayKey();
  const { start, end } = wd.dayBounds(dayKey);
  const [events, session, calls, user, responses] = await Promise.all([
    mongoose.model('AgentActivity').find({ agent: adminId, at: { $gte: start, $lte: end } }).sort({ at: 1 }).lean(),
    wd.getSession(adminId, dayKey),
    mongoose
      .model('CallRecord')
      .find({ removed: false, agent: adminId, created: { $gte: start, $lte: end } })
      .select('contactName phone direction status duration answeredAt agentLegAnswered created endedAt disposition missedByAgent recording.status')
      .sort({ created: 1 })
      .lean(),
    mongoose.model('Admin').findById(adminId).select('name surname role email').lean(),
    // lead responses this user entered that day
    mongoose.model('Lead').aggregate([
      { $match: { removed: false, stageHistory: { $elemMatch: { changedBy: new mongoose.Types.ObjectId(adminId), at: { $gte: start, $lte: end } } } } },
      { $unwind: '$stageHistory' },
      { $match: { 'stageHistory.changedBy': new mongoose.Types.ObjectId(adminId), 'stageHistory.at': { $gte: start, $lte: end } } },
      { $project: { _id: 0, leadId: '$_id', name: 1, phone: 1, at: '$stageHistory.at', fromStage: '$stageHistory.fromStage', toStage: '$stageHistory.toStage', toSubStatus: '$stageHistory.toSubStatus', remarks: '$stageHistory.remarks' } },
      { $sort: { at: 1 } },
      { $limit: 500 },
    ]),
  ]);
  return ok(res, { dayKey, user: user ? { name: wd.fullName(user), role: user.role, email: user.email } : null, session, events, calls, responses });
});

// GET /workday/admin/report?month=YYYY-MM&adminId=  → .xlsx
// A month of attendance for every Sales user (or one): Summary (one row per
// person), Daily (person × day) and Leaves sheets. Days after today are left
// out; a past day with no Logout is counted up to the shift end.
const report = selfOrManager(async (req, res) => {
  const XLSX = require('xlsx');
  const month = /^\d{4}-\d{2}$/.test(req.query.month || '') ? req.query.month : wd.todayKey().slice(0, 7);
  const first = `${month}-01`;
  const nDays = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).getUTCDate();
  const today = wd.todayKey();
  const dayKeys = Array.from({ length: nDays }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`).filter((k) => k <= today);
  if (!dayKeys.length) return bad(res, 'That month has not started yet.');
  const from = wd.dayBounds(first).start;
  const to = wd.dayBounds(dayKeys[dayKeys.length - 1]).end;

  const userFilter = { removed: false, role: { $in: SALES_ROLES } };
  if (req.query.adminId) {
    if (!mongoose.isValidObjectId(req.query.adminId)) return bad(res, 'Pick a valid user.');
    userFilter._id = req.query.adminId;
  } else userFilter.enabled = true;
  const users = await mongoose.model('Admin').find(userFilter).select('name surname role email').sort({ name: 1 }).lean();
  if (!users.length) return bad(res, 'No Sales user found.');
  const ids = users.map((u) => u._id);

  const [sessions, leaves, holidays, calls, activity] = await Promise.all([
    mongoose.model('WorkSession').find({ admin: { $in: ids }, dayKey: { $in: dayKeys } }).lean(),
    mongoose.model('LeaveRequest').find({ removed: false, adminId: { $in: ids.map(String) }, fromDate: { $lte: to }, toDate: { $gte: from } }).select('-decisionToken').sort({ fromDate: 1 }).lean(),
    wd.holidaysBetween(from, to),
    mongoose.model('CallRecord').aggregate([
      { $match: { removed: false, agent: { $in: ids }, created: { $gte: from, $lte: to } } },
      {
        $group: {
          _id: { a: '$agent', d: { $dateToString: { format: '%Y-%m-%d', date: '$created', timezone: 'Asia/Kolkata' } } },
          calls: { $sum: 1 },
          connected: { $sum: { $cond: [{ $and: [{ $ne: ['$answeredAt', null] }, { $ne: ['$agentLegAnswered', false] }, { $gt: ['$duration', 0] }] }, 1, 0] } },
          talkSec: { $sum: { $ifNull: ['$duration', 0] } },
          firstAt: { $min: '$created' },
          lastAt: { $max: { $ifNull: ['$endedAt', '$created'] } },
        },
      },
    ]),
    mongoose
      .model('AgentActivity')
      .find({ agent: { $in: ids }, at: { $gte: from, $lte: to }, kind: { $in: ['pool_on', 'pool_off', 'break_start', 'break_end'] } })
      .select('agent kind at detail')
      .sort({ at: 1 })
      .lean(),
  ]);
  const sKey = (a, d) => `${a}|${d}`;
  const sBy = new Map(sessions.map((s) => [sKey(s.admin, s.dayKey), s]));

  // Days before the header Login existed (or a day someone worked without
  // pressing it) have no WorkSession — rebuild one from the dialer's own
  // log: first pool-on / call = start, last pool-off / call = end, breaks
  // from break_start → break_end (or the break's planned length).
  const actBy = new Map();
  for (const e of activity) {
    const k = sKey(e.agent, new Date(e.at).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }));
    if (!actBy.has(k)) actBy.set(k, []);
    actBy.get(k).push(e);
  }
  const derivedSession = (uid, dk, c) => {
    const ev = actBy.get(sKey(uid, dk)) || [];
    const ons = ev.filter((e) => e.kind === 'pool_on').map((e) => new Date(e.at));
    const offs = ev.filter((e) => e.kind === 'pool_off').map((e) => new Date(e.at));
    const starts = [...ons, c && c.calls ? new Date(c.firstAt) : null].filter(Boolean);
    if (!starts.length) return null;
    const startAt = new Date(Math.min(...starts));
    const ends = [...offs.filter((d) => d > startAt), c && c.calls ? new Date(c.lastAt) : null].filter(Boolean);
    const breaks = [];
    for (const e of ev) {
      if (e.kind === 'break_start') {
        const mins = Number((/(\d+)\s*min/.exec(e.detail || '') || [])[1]) || 15;
        breaks.push({ label: String(e.detail || 'Break').split(' · ')[0], startAt: e.at, plannedMin: mins });
      } else if (e.kind === 'break_end' && breaks.length && !breaks[breaks.length - 1].endAt) breaks[breaks.length - 1].endAt = e.at;
    }
    return { loginAt: startAt, logoutAt: ends.length ? new Date(Math.max(...ends)) : null, breaks, derived: true };
  };
  const cBy = new Map(calls.map((c) => [sKey(c._id.a, c._id.d), c]));
  const istDay = (d) => new Date(d).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
  const hBy = new Map(holidays.map((h) => [istDay(h.date), h]));
  const t12 = (d) => (d ? new Date(d).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: 'numeric', minute: '2-digit' }) : '');
  const hmStr = (min) => (min ? `${Math.floor(min / 60)}h ${String(min % 60).padStart(2, '0')}m` : '');
  const hrs = (min) => Math.round((min / 60) * 100) / 100;
  const W = wd.W;

  const summary = [];
  const daily = [];
  for (const u of users) {
    const uid = String(u._id);
    const name = wd.fullName(u) || u.email;
    const myLeaves = leaves.filter((l) => l.adminId === uid);
    const approved = myLeaves.filter((l) => l.status === 'Approved');
    const t = { working: 0, present: 0, auto: 0, absent: 0, leave: 0, late: 0, worked: 0, brk: 0, calls: 0, conn: 0, talk: 0, loginMins: [] };

    for (const dk of dayKeys) {
      const cRaw = cBy.get(sKey(uid, dk));
      const c = cRaw || { calls: 0, connected: 0, talkSec: 0 };
      const s = sBy.get(sKey(uid, dk)) || derivedSession(uid, dk, cRaw);
      const ws = wd.istAt(dk, W.start);
      const we = wd.istAt(dk, W.end);
      const holiday = hBy.get(dk);
      const weeklyOff = W.weeklyOff.includes(wd.istAt(dk, '12:00').getUTCDay());
      const dayLeaves = approved.filter((l) => new Date(l.fromDate) <= wd.dayBounds(dk).end && new Date(l.toDate) >= wd.dayBounds(dk).start);
      const full = dayLeaves.find((l) => new Date(l.fromDate) <= ws && new Date(l.toDate) >= we);
      // leave counted for THIS day: whole day = 1, half = 0.5, hours = h / 8
      const leaveDay = full ? 1 : dayLeaves.reduce((x, l) => x + (l.durationType === 'half' ? 0.5 : l.durationType === 'hours' ? (l.hours || 0) / 8 : 0), 0);

      const startAt = s && (s.loginAt || s.autoStartedAt);
      const endCap = dk === today ? new Date() : we;
      const endAt = s && (s.logoutAt || (startAt && endCap > new Date(startAt) ? endCap : null));
      const breakMin = (s && s.breaks ? s.breaks : []).reduce((x, b) => {
        const e = b.endAt || new Date(Math.min(new Date(endAt || endCap), wd.plannedEnd(b)));
        return x + Math.max(0, minutes(b.startAt, e));
      }, 0);
      const workedMin = startAt && endAt ? Math.max(0, minutes(startAt, endAt) - breakMin) : 0;
      const lateMin = s && s.loginAt ? Math.max(0, minutes(ws, s.loginAt)) : 0;

      let status;
      if (holiday) status = `Holiday (${holiday.name})`;
      else if (weeklyOff && !startAt) status = 'Weekly off';
      else if (full) status = `On leave (${full.leaveType})`;
      else if (s && s.loginAt) status = s.derived ? 'Present (from dialer activity)' : 'Present';
      else if (s && s.autoStartedAt) status = 'Auto-started (not logged in)';
      else status = 'Absent';

      const workingDay = !holiday && !weeklyOff;
      if (workingDay) t.working += 1;
      if (s && s.loginAt) {
        t.present += 1;
        t.loginMins.push(minutes(wd.istAt(dk, '00:00'), s.loginAt));
        if (lateMin > 15) t.late += 1;
      } else if (s && s.autoStartedAt) t.auto += 1;
      else if (workingDay && !full) t.absent += 1;
      if (workingDay) t.leave += leaveDay;
      t.worked += workedMin;
      t.brk += breakMin;
      t.calls += c.calls;
      t.conn += c.connected;
      t.talk += c.talkSec;

      daily.push({
        User: name,
        Role: u.role,
        Date: dk,
        Day: wd.istAt(dk, '12:00').toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', weekday: 'short' }),
        Status: status,
        Login: t12(s && s.loginAt),
        'Auto-started': t12(s && s.autoStartedAt),
        Logout: t12(s && s.logoutAt),
        'Late (min)': lateMin || '',
        Worked: hmStr(workedMin),
        'Worked (h)': workedMin ? hrs(workedMin) : '',
        'Break (min)': breakMin || '',
        Breaks: (s && s.breaks ? s.breaks : []).map((b) => `${b.label} ${t12(b.startAt)}`).join(', '),
        Leave: dayLeaves.map((l) => `${l.leaveType} · ${wd.durationLabel(l)}`).join('; '),
        Calls: c.calls || '',
        Connected: c.connected || '',
        'Talk (min)': c.talkSec ? Math.round(c.talkSec / 60) : '',
      });
    }

    const avgLogin = t.loginMins.length ? Math.round(t.loginMins.reduce((a, b) => a + b, 0) / t.loginMins.length) : null;
    const expected = t.working - t.leave;
    summary.push({
      User: name,
      Role: u.role,
      Email: u.email,
      'Working days': t.working,
      Present: t.present,
      'Auto-started only': t.auto,
      Absent: t.absent,
      'Leave (days)': Math.round(t.leave * 100) / 100,
      'Attendance %': expected > 0 ? Math.round((t.present / expected) * 100) : '',
      'Late days (15m+)': t.late,
      'Avg login': avgLogin === null ? '' : `${((Math.floor(avgLogin / 60) + 11) % 12) + 1}:${String(avgLogin % 60).padStart(2, '0')} ${avgLogin < 720 ? 'AM' : 'PM'}`,
      'Worked (h)': hrs(t.worked),
      'Avg / present day (h)': t.present ? hrs(t.worked / t.present) : '',
      'Breaks (h)': hrs(t.brk),
      Calls: t.calls,
      Connected: t.conn,
      'Talk (h)': hrs(t.talk / 60),
      'Leaves applied': myLeaves.length,
      'Leaves approved': approved.length,
    });
  }

  const leaveRows = leaves.map((l) => ({
    Employee: l.employee,
    Type: l.leaveType,
    When: wd.durationLabel(l),
    Days: l.days,
    Status: l.status,
    Reason: l.reason || '',
    'Applied on': l.appliedOn ? new Date(l.appliedOn).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) : '',
    'Decided by': l.decisionBy || '',
    Note: l.decisionNote || '',
  }));

  const wb = XLSX.utils.book_new();
  const sheet = (rows, widths) => {
    const ws = XLSX.utils.json_to_sheet(rows.length ? rows : [{ '': 'No data' }]);
    if (rows.length) ws['!cols'] = Object.keys(rows[0]).map((k) => ({ wch: widths[k] || Math.max(10, k.length + 2) }));
    return ws;
  };
  XLSX.utils.book_append_sheet(wb, sheet(summary, { User: 22, Email: 28, 'Avg login': 11 }), 'Summary');
  XLSX.utils.book_append_sheet(wb, sheet(daily, { User: 22, Status: 26, Breaks: 34, Leave: 40 }), 'Daily');
  XLSX.utils.book_append_sheet(wb, sheet(leaveRows, { Employee: 22, When: 36, Reason: 40, Note: 30 }), 'Leaves');
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

  const label = new Date(`${first}T12:00:00Z`).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' }).replace(/\s+/g, '-');
  const who = users.length === 1 && req.query.adminId ? (wd.fullName(users[0]) || 'user').replace(/[^A-Za-z0-9]+/g, '-') : 'all-sales';
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="attendance-${who}-${label}.xlsx"`);
  return res.send(buf);
});

// ── public: the email's one-click Approve / Reject ──────────────────────
// GET /api/workday-public/leave-decision?id=&token=&action=
const publicDecision = async (req, res) => {
  const page = (title, body, color) =>
    res
      .status(200)
      .type('html')
      .send(
        `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title></head>` +
          `<body style="margin:0;font-family:Segoe UI,Arial,sans-serif;background:#f1f5f9;display:grid;place-items:center;min-height:100vh">` +
          `<div style="background:#fff;padding:36px 40px;border-radius:16px;box-shadow:0 10px 30px rgba(15,23,42,.08);max-width:440px;text-align:center">` +
          `<div style="width:56px;height:56px;border-radius:50%;background:${color}1a;color:${color};display:grid;place-items:center;margin:0 auto 14px;font-size:28px">●</div>` +
          `<h2 style="margin:0 0 8px;color:#0f172a">${title}</h2><p style="color:#475569;margin:0">${body}</p></div></body></html>`
      );
  const { id, token, action } = req.query;
  if (!mongoose.isValidObjectId(id) || !token || !['approve', 'reject'].includes(action)) return page('Invalid link', 'This approval link is not valid.', '#dc2626');
  const leave = await mongoose.model('LeaveRequest').findOne({ _id: id, removed: false }).lean();
  if (!leave) return page('Not found', 'This leave request no longer exists.', '#dc2626');
  if (leave.status !== 'Pending') return page(`Already ${leave.status.toLowerCase()}`, `${leave.employee}'s leave (${wd.durationLabel(leave)}) was already ${leave.status.toLowerCase()}${leave.decisionBy ? ` by ${leave.decisionBy}` : ''}.`, '#64748b');
  if (leave.decisionToken !== String(token)) return page('Link expired', 'This approval link is no longer valid — decide from HRMS instead.', '#dc2626');
  const approverName = process.env.LEAVE_APPROVER_NAME || 'Neeraj (email)';
  const r = await wd.decideLeave(id, action, { name: approverName }, null);
  if (!r.ok) return page('Could not update', r.error, '#dc2626');
  const approved = action === 'approve';
  return page(approved ? 'Leave approved' : 'Leave rejected', `${leave.employee} — ${wd.durationLabel(leave)}. They have been notified in CLC One.`, approved ? '#16a34a' : '#dc2626');
};

module.exports = {
  me: salesOnly(me),
  login: salesOnly(login),
  logout: salesOnly(logout),
  breakStart: salesOnly(breakStart),
  breakEnd: salesOnly(breakEnd),
  leaveApply: salesOnly(leaveApply),
  leaveCancel: salesOnly(leaveCancel),
  board,
  leaves,
  decide,
  timeline,
  report,
  sales360: selfOrManager(sales360.summary),
  sales360Calls: selfOrManager(sales360.calls),
  sales360Leads: selfOrManager(sales360.leads),
  sales360LeadList: selfOrManager(sales360.leadList),
  sales360LeadsReport: selfOrManager(sales360.leadsSection),
  sales360Export: selfOrManager(sales360.exportXlsx),
  sales360Attendance: selfOrManager(sales360.attendanceMonth),
  publicDecision,
};
