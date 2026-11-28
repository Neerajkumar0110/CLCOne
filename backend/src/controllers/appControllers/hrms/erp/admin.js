const mongoose = require('mongoose');
const XLSX = require('xlsx');
const E = require('../../../../services/hr/erpAttendance');
const V = require('../../../../services/hr/erpViews');
const L = require('../../../../services/hr/erpLeave');
const { FULL_ACCESS_ROLES } = require('../../../../services/access/salesScope');

// /api/attendance-erp/admin/* — HRMS › Work & Leave Tracker › Attendance ERP.
// Management (same roles as the Work & Leave Tracker) or an employee marked
// "HR Admin" in Employees. Checked here on every request, not only in the UI.
const ok = (res, result, message = 'ok') => res.status(200).json({ success: true, result, message });
const bad = (res, message, status = 400) => res.status(status).json({ success: false, result: null, message });
const isErpAdmin = (req) => !!req.admin && FULL_ACCESS_ROLES.includes(req.admin.role);
const guard = (fn) => async (req, res) => {
  if (!isErpAdmin(req)) {
    const p = await mongoose.model('ErpProfile').findOne({ admin: req.admin._id }).select('erpRole').lean();
    if (!p || p.erpRole !== 'hr_admin') return bad(res, 'Attendance ERP admin only.', 403);
  }
  return fn(req, res);
};
const Act = () => mongoose.model('ErpActivity');
const Sess = () => mongoose.model('ErpSession');
const oid = (x) => (mongoose.isValidObjectId(x) ? new mongoose.Types.ObjectId(String(x)) : null);
const keyOf = (v, fb) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) ? String(v) : fb);
const monthOf = (v) => (/^\d{4}-\d{2}$/.test(String(v || '')) ? String(v) : E.todayKey().slice(0, 7));
const hhmm = (v) => (/^\d{2}:\d{2}$/.test(String(v || '').trim()) ? String(v).trim() : null);
const hm = (m) => `${String(Math.floor((m || 0) / 60)).padStart(2, '0')}h ${String(Math.round(m || 0) % 60).padStart(2, '0')}m`;
const ONLINE = ['Online', 'Inactive', 'Lunch', 'Break', 'Offline'];

function matchEmp(e, q) {
  if (!q) return true;
  const s = String(q).toLowerCase();
  return [e.name, e.email, e.employeeCode, e.department, e.designation].some((x) => String(x || '').toLowerCase().includes(s));
}
async function empMap() {
  const list = await E.trackedEmployees({ includeDisabled: true, includeUntracked: true });
  const map = {};
  list.forEach((e) => {
    map[String(e._id)] = e;
  });
  return { list, map };
}

// ── Dashboard (A1) ───────────────────────────────────────────────────────────
const dashboard = guard(async (req, res) => {
  const now = new Date();
  const S = await E.getSettings();
  const tk = E.todayKey(now);
  const emps = await E.trackedEmployees();
  const dept = req.query.dept && req.query.dept !== 'All' ? req.query.dept : null;
  const scoped = dept ? emps.filter((e) => e.department === dept) : emps;
  const rows = await V.dayRows(tk, now, scoped);
  const ids = scoped.map((e) => e._id);
  const present = rows.filter((r) => r.session && r.session.loginAt);
  const live = { active: 0, inactive: 0, lunch: 0, break: 0, offline: 0 };
  rows.forEach((r) => {
    if (r.live && live[r.live] != null) live[r.live] += 1;
    else if (r.session && r.session.loginAt) live.offline += 1;
  });
  const onLeave = rows.filter((r) => r.status === 'Leave');
  const pendingAll = await mongoose.model('LeaveRequest').find({ removed: false, status: 'Pending' }).select('-decisionToken').sort({ appliedOn: 1, created: 1 }).lean();
  const pending = pendingAll.filter((l) => !dept || ids.map(String).includes(String(l.adminId)));
  const joinedThisMonth = scoped.filter((e) => e.joiningDate && E.todayKey(new Date(e.joiningDate)).slice(0, 7) === tk.slice(0, 7)).length;
  const kpis = {
    total: scoped.length,
    joinedThisMonth,
    present: present.length,
    late: present.filter((r) => r.tags.includes('Late')).length,
    online: live.active + live.inactive + live.lunch + live.break,
    active: live.active,
    inactive: live.inactive,
    onLeave: onLeave.length,
    leaveTypes: onLeave.reduce((m, r) => ({ ...m, [r.leave.leaveType]: (m[r.leave.leaveType] || 0) + 1 }), {}),
    absent: rows.filter((r) => r.status === 'Absent' || r.status === 'Not logged in').length,
    completed: rows.filter((r) => r.totals.work >= S.requiredMin).length,
    pending: pending.length,
    oldestPendingAt: pending[0] ? pending[0].appliedOn || pending[0].created : null,
  };
  // people who need attention first (inactive, offline), then breaks, then active
  const order = { inactive: 0, offline: 1, lunch: 2, break: 3, active: 4 };
  const liveList = rows
    .filter((r) => r.session && r.session.loginAt && r.session.status !== 'logged_out')
    .sort((a, b) => (order[a.live] ?? 5) - (order[b.live] ?? 5))
    .slice(0, 6);
  // trend: last 14 working days
  const days = [];
  for (let d = tk; days.length < 14 && d >= E.addDays(tk, -40); d = E.addDays(d, -1)) if (!S.weeklyOff.includes(E.weekday(d))) days.unshift(d);
  const hol = await E.holidayKeys(days[0], tk);
  const wdays = days.filter((d) => !hol[d]);
  const sess = await Sess().find({ dayKey: { $in: wdays }, admin: { $in: ids } }).select('admin dayKey loginAt').lean();
  const lv = await E.leavesBetween(wdays[0] || tk, tk, { adminIds: ids });
  const trend = wdays.map((d) => {
    const ds = sess.filter((s) => s.dayKey === d && s.loginAt);
    const late = ds.filter((s) => s.loginAt > E.istAt(d, S.lateAfter)).length;
    const leaveN = scoped.filter((e) => E.leaveOnDay(lv, e._id, d, S)).length;
    return { dayKey: d, onTime: ds.length - late, late, absent: Math.max(0, scoped.length - ds.length - leaveN) };
  });
  // monthly hours by department
  const m = tk.slice(0, 7);
  const tot = await E.totalsByAdminDay(`${m}-01`, tk, ids);
  const byDept = {};
  Object.values(tot).forEach((x) => {
    if (!x.session.loginAt) return;
    const e = scoped.find((y) => String(y._id) === String(x.session.admin));
    const k = (e && e.department) || 'Other';
    byDept[k] = byDept[k] || { work: 0, days: 0 };
    byDept[k].work += x.totals.work;
    byDept[k].days += 1;
  });
  const depts = Object.entries(byDept)
    .map(([name, v]) => ({ name, avg: Math.round(v.work / v.days) }))
    .sort((a, b) => b.avg - a.avg);
  // leave statistics (approved, this month)
  const ml = await E.leavesBetween(`${m}-01`, `${m}-31`, { adminIds: ids });
  const leaveStats = {};
  ml.forEach((l) => {
    leaveStats[l.leaveType] = (leaveStats[l.leaveType] || 0) + (Number(l.days) || 1);
  });
  return ok(res, {
    now,
    kpis,
    live,
    liveList,
    pending: pending.slice(0, 3).map((l) => ({ ...l, label: L.leaveLabel(l) })),
    today: rows
      .filter((r) => r.session && r.session.loginAt)
      .sort((a, b) => new Date(a.session.loginAt) - new Date(b.session.loginAt))
      .slice(0, 6),
    trend,
    depts,
    leaveStats,
    required: S.requiredMin,
    departments: S.departments,
  });
});

// ── Live (A2) ────────────────────────────────────────────────────────────────
const live = guard(async (req, res) => {
  const now = new Date();
  const S = await E.getSettings();
  const tk = E.todayKey(now);
  const rows = await V.dayRows(tk, now);
  const counts = { active: 0, inactive: 0, lunch: 0, break: 0, offline: 0, loggedOut: 0, notIn: 0, leave: 0, absent: 0 };
  rows.forEach((r) => {
    if (r.live) counts[r.live] += 1;
    else if (r.session && r.session.loginAt) counts.loggedOut += 1;
    else {
      counts.notIn += 1;
      if (r.status === 'Leave') counts.leave += 1;
      else counts.absent += 1;
    }
  });
  const longestInactive = rows.filter((r) => r.live === 'inactive' && r.session.since).reduce((mx, r) => Math.max(mx, E.minsBetween(r.session.since, now)), 0);
  // activity feed — status changes of the day, newest first
  const periods = await Act().find({ dayKey: tk }).sort({ startAt: -1 }).limit(60).lean();
  const names = {};
  rows.forEach((r) => {
    names[String(r.employee._id)] = r.employee.name;
  });
  const feed = [];
  const lastBy = {};
  [...periods].reverse().forEach((p) => {
    const prev = lastBy[String(p.admin)];
    lastBy[String(p.admin)] = p;
    const n = names[String(p.admin)];
    if (!n) return;
    if (p.type === 'INACTIVE') feed.push({ admin: p.admin, name: n, at: p.startAt, kind: 'inactive', text: `went Inactive (${Math.round(S.inactivitySec / 60)} min, no input)` });
    else if (p.type === 'ACTIVE' && prev && prev.type === 'INACTIVE') feed.push({ admin: p.admin, name: n, at: p.startAt, kind: 'active', text: `back to Active after ${Math.round(E.minsBetween(prev.startAt, p.startAt))} min` });
    else if (p.type === 'OFFLINE') feed.push({ admin: p.admin, name: n, at: p.startAt, kind: 'offline', text: 'lost connection, now Offline (session kept open)' });
    else if (p.type === 'LUNCH' || p.type === 'BREAK') feed.push({ admin: p.admin, name: n, at: p.startAt, kind: 'lunch', text: `started ${p.label || 'a break'}${p.auto ? ' (on schedule)' : ''}` });
  });
  rows.forEach((r) => {
    if (r.session && r.session.logoutAt) {
      const short = r.totals.work < S.requiredMin;
      feed.push({ admin: r.employee._id, name: r.employee.name, at: r.session.logoutAt, kind: short ? 'short' : 'out', text: `logged out${r.tags.includes('Early Logout') ? ' early' : ''} · ${hm(r.totals.work)}${short ? ` (short ${Math.round(S.requiredMin - r.totals.work)}m)` : ' worked'}` });
    }
    if (r.live && r.totals.work >= S.requiredMin) feed.push({ admin: r.employee._id, name: r.employee.name, at: new Date(now.getTime() - (r.totals.work - S.requiredMin) * 60000), kind: 'done', text: `completed ${Math.round(S.requiredMin / 60)}h actual work ✓` });
  });
  feed.sort((a, b) => new Date(b.at) - new Date(a.at));
  return ok(res, {
    now,
    counts,
    longestInactive: Math.round(longestInactive),
    cards: rows.filter((r) => r.session && r.session.loginAt),
    feed: feed.slice(0, 14),
    required: S.requiredMin,
    inactivitySec: S.inactivitySec,
    departments: S.departments,
  });
});

// ── Attendance (A3) ──────────────────────────────────────────────────────────
const attendance = guard(async (req, res) => {
  const now = new Date();
  const S = await E.getSettings();
  const q = req.query;
  const dk = keyOf(q.date, E.todayKey(now));
  let rows = await V.dayRows(dk, now);
  rows = rows.filter((r) => matchEmp(r.employee, q.q));
  if (q.dept && q.dept !== 'All') rows = rows.filter((r) => r.employee.department === q.dept);
  if (q.employee && q.employee !== 'All') rows = rows.filter((r) => String(r.employee._id) === String(q.employee));
  if (q.status && q.status !== 'All') rows = rows.filter((r) => r.status === q.status || r.tags.includes(q.status));
  if (q.late === '1') rows = rows.filter((r) => r.tags.includes('Late'));
  if (q.early === '1') rows = rows.filter((r) => r.tags.includes('Early Logout'));
  if (q.missing === '1') rows = rows.filter((r) => r.session && r.session.loginAt && !r.session.logoutAt);
  if (q.under8 === '1') rows = rows.filter((r) => r.session && r.session.loginAt && r.totals.work < S.requiredMin);
  if (q.manual === '1') rows = rows.filter((r) => r.session && r.session.manual);
  const summary = {};
  rows.forEach((r) => {
    const k = ONLINE.includes(r.status) ? 'Present' : r.status === 'Not logged in' ? 'Absent' : r.status;
    summary[k] = (summary[k] || 0) + 1;
    if (r.tags.includes('Late')) summary.Late = (summary.Late || 0) + 1;
  });
  rows.sort((a, b) => {
    const la = a.session && a.session.loginAt ? new Date(a.session.loginAt).getTime() : Infinity;
    const lb = b.session && b.session.loginAt ? new Date(b.session.loginAt).getTime() : Infinity;
    return la - lb;
  });
  const sales = await salesDay(rows.map((r) => r.employee._id), dk).catch(() => ({}));
  rows = rows.map((r) => (sales[String(r.employee._id)] ? { ...r, sales: sales[String(r.employee._id)] } : r));
  return ok(res, { dayKey: dk, rows, summary, settings: { workStart: S.workStart, workEnd: S.workEnd, lateAfter: S.lateAfter, requiredMin: S.requiredMin }, departments: S.departments });
});

// ── Sales users: their Workday (header Login / breaks / dialer) + calls ──────
// Read-only view of the data the Sales flow already writes (services/hr/workday,
// CallRecord) — the Sales login is unchanged; the ERP only shows it.
async function salesDay(adminIds, dk) {
  const wd = require('../../../../services/hr/workday');
  const ids = adminIds.map((x) => oid(x)).filter(Boolean);
  if (!ids.length) return {};
  const admins = await mongoose.model('Admin').find({ _id: { $in: ids } }).select('name surname role').lean();
  const sales = admins.filter((a) => wd.isSales(a)).map((a) => a._id);
  if (!sales.length) return {};
  const start = E.dayStart(dk);
  const end = E.dayEnd(dk);
  const isToday = dk === E.todayKey();
  const now = new Date();
  const until = isToday ? now : end;
  const [sessions, states, calls] = await Promise.all([
    mongoose.model('WorkSession').find({ dayKey: dk, admin: { $in: sales } }).lean(),
    isToday ? mongoose.model('AgentCallState').find({ agent: { $in: sales } }).select('agent status campaign breakKey').lean() : [],
    mongoose.model('CallRecord').aggregate([
      { $match: { removed: false, agent: { $in: sales }, created: { $gte: start, $lte: end } } },
      {
        $group: {
          _id: '$agent',
          calls: { $sum: 1 },
          connected: { $sum: { $cond: [{ $and: [{ $ne: ['$answeredAt', null] }, { $ne: ['$agentLegAnswered', false] }, { $gt: ['$duration', 0] }] }, 1, 0] } },
          talkSec: { $sum: { $ifNull: ['$duration', 0] } },
          inbound: { $sum: { $cond: [{ $eq: ['$direction', 'Inbound'] }, 1, 0] } },
        },
      },
    ]),
  ]);
  const out = {};
  for (const id of sales) {
    const k = String(id);
    const s = sessions.find((x) => String(x.admin) === k);
    const st = states.find((x) => String(x.agent) === k);
    const c = calls.find((x) => String(x._id) === k) || { calls: 0, connected: 0, talkSec: 0, inbound: 0 };
    const breaks = ((s && s.breaks) || []).map((b) => {
      const e = b.endAt || (until >= wd.plannedEnd(b) ? wd.plannedEnd(b) : null);
      return { label: b.label, startAt: b.startAt, endAt: e, min: Math.max(0, Math.round((new Date(e || until) - new Date(b.startAt)) / 60000)), open: !e, auto: !!b.auto };
    });
    out[k] = {
      loginAt: (s && s.loginAt) || null,
      autoStartedAt: (s && s.autoStartedAt) || null,
      logoutAt: (s && s.logoutAt) || null,
      lateMin: s && s.loginAt ? wd.lateMinutes(dk, s.loginAt) : null,
      breaks,
      breakMin: breaks.reduce((t, b) => t + b.min, 0),
      dialer: st ? { on: !!(st.campaign && st.status !== 'Offline'), status: st.status, breakKey: st.breakKey || null } : null,
      calls: c.calls,
      connected: c.connected,
      inbound: c.inbound,
      talkSec: c.talkSec,
    };
  }
  return out;
}

// ── "Attendance ERP login" email (User Management › All Users ✉) ─────────────
// Everyone except Sales (they get their login with the account email and use
// the header Login), the owner and Super Admin — Candidates / Teachers too.
// Sending it puts the person in the ERP as an employee. Sign-in is by OTP to
// that same email.
const invite = guard(async (req, res) => {
  const id = oid(req.params.id);
  if (!id) return bad(res, 'Bad user.');
  const a = await mongoose.model('Admin').findOne({ _id: id, removed: false }).select('name surname email role enabled').lean();
  if (!a) return bad(res, 'User not found.', 404);
  if (!E.isTrackedRole(a.role)) return bad(res, 'The owner and Super Admin are never tracked in the Attendance ERP.');
  if (E.isSalesRole(a.role)) return bad(res, 'Sales users already get their login with the account email and use the header Login — no ERP email needed.');
  if (!a.enabled) return bad(res, 'This user is deactivated — activate them first.');
  const r = await require('../../../../services/hr/erpInvite').sendErpInvite(a);
  if (!r || !r.sent) return bad(res, r && r.skipped ? `Email not sent: ${r.skipped}.` : 'Email could not be sent. Try again.');
  const by = E.fullName(req.admin);
  await mongoose.model('ErpProfile').updateOne({ admin: a._id }, { $set: { invitedAt: new Date(), invitedBy: by, updated: new Date() }, $setOnInsert: { admin: a._id } }, { upsert: true });
  E.forgetTracked(a._id); // now in the ERP
  await E.audit(req, { action: 'Sent ERP login email', employee: a._id, employeeName: E.fullName(a), oldValue: '', newValue: a.email, reason: '' });
  return ok(res, { sentAt: new Date(), to: a.email }, `Login email sent to ${a.email}.`);
});
// last invite per Sales user — { adminId: { at, by } } for the ✉ tooltip
const invites = guard(async (req, res) => {
  const rows = await mongoose.model('ErpProfile').find({ invitedAt: { $ne: null } }).select('admin invitedAt invitedBy').lean();
  const out = {};
  rows.forEach((p) => {
    out[String(p.admin)] = { at: p.invitedAt, by: p.invitedBy };
  });
  return ok(res, out);
});

// ── Attendance detail (A4) ───────────────────────────────────────────────────
const detail = guard(async (req, res) => {
  const adminId = oid(req.params.adminId);
  if (!adminId) return bad(res, 'Bad employee.');
  const dk = keyOf(req.query.date, E.todayKey());
  const S = await E.getSettings();
  const { map } = await empMap();
  const emp = map[String(adminId)];
  if (!emp) return bad(res, 'Employee not found.', 404);
  const d = await V.day(adminId, dk);
  const slots = (d.session && d.session.slots) || {};
  const kbBeats = Object.values(slots).reduce((n, x) => n + (x.k || 0), 0);
  const msBeats = Object.values(slots).reduce((n, x) => n + (x.m || 0), 0);
  const totalBeats = d.session && d.session.loginAt ? Math.round((E.minsBetween(d.session.loginAt, d.session.logoutAt || new Date()) * 60) / S.heartbeatSec) : 0;
  const device = await mongoose.model('ErpDevice').findOne({ admin: adminId, revoked: false }).sort({ lastSeenAt: -1 }).select('-tokenHash').lean();
  const history = await mongoose.model('ErpAudit').find({ employee: adminId, dayKey: dk }).sort({ at: -1 }).lean();
  const sales = (await salesDay([adminId], dk).catch(() => ({})))[String(adminId)] || null;
  return ok(res, { employee: emp, ...d, sales, signals: { kbBeats, msBeats, totalBeats, kbMin: Math.round((kbBeats * S.heartbeatSec) / 60), msMin: Math.round((msBeats * S.heartbeatSec) / 60) }, device, history, settings: { workStart: S.workStart, workEnd: S.workEnd, lateAfter: S.lateAfter } });
});

// cut [from, to) out of a session's periods; optionally put a new period there
async function carve(session, from, to, newType, extra = {}) {
  const far = new Date('2999-01-01');
  const list = await Act().find({ session: session._id }).sort({ startAt: 1 });
  for (const p of list) {
    const ps = p.startAt;
    const pe = p.endAt || far;
    if (pe <= from || ps >= to) continue;
    if (ps >= from && pe <= to) await Act().deleteOne({ _id: p._id });
    else if (ps < from && pe > to) {
      const rest = p.toObject();
      delete rest._id;
      await Act().create({ ...rest, startAt: to, endAt: p.endAt || null });
      p.endAt = from;
      await p.save();
    } else if (ps < from) {
      p.endAt = from;
      await p.save();
    } else {
      p.startAt = to;
      await p.save();
    }
  }
  if (newType) await Act().create({ session: session._id, admin: session.admin, dayKey: session.dayKey, type: newType, startAt: from, endAt: to, source: 'admin', ...extra });
}

const STATUS_CHOICES = ['Present', 'Short', 'Half Day', 'Absent', 'Leave', 'Holiday', 'Weekly Off', 'Late', 'Early Logout', 'Incomplete'];

// POST /admin/attendance/correct { adminId, date, field: login|logout|lunch|status, value, reason }
const correct = guard(async (req, res) => {
  const b = req.body || {};
  const adminId = oid(b.adminId);
  const dk = keyOf(b.date, null);
  const reason = String(b.reason || '').trim();
  if (!adminId || !dk) return bad(res, 'Pick the employee and day.');
  if (!reason) return bad(res, 'A reason is required.');
  const { map } = await empMap();
  const emp = map[String(adminId)];
  if (!emp) return bad(res, 'Employee not found.', 404);
  const r = await E.withLock(adminId, async () => {
    const s = await Sess().findOne({ admin: adminId, dayKey: dk });
    if (!s && b.field !== 'status') return { error: 'No attendance that day — use "Manual attendance" instead.' };
    let oldV;
    let newV;
    if (b.field === 'logout') {
      const t = hhmm(b.value);
      if (!t) return { error: 'Enter the time as HH:MM.' };
      const at = E.istAt(dk, t);
      if (at <= s.loginAt) return { error: 'Logout must be after login.' };
      oldV = s.logoutAt ? E.hmOf(s.logoutAt) : s.status === 'needs_review' ? 'none (needs review)' : 'none';
      await carve(s, at, new Date('2999-01-01'), null);
      s.logoutAt = at;
      s.logoutType = 'admin';
      s.status = 'logged_out';
      s.currentBreak = undefined;
      newV = t;
    } else if (b.field === 'login') {
      const t = hhmm(b.value);
      if (!t) return { error: 'Enter the time as HH:MM.' };
      const at = E.istAt(dk, t);
      if (s.logoutAt && at >= s.logoutAt) return { error: 'Login must be before logout.' };
      oldV = E.hmOf(s.loginAt);
      if (at < s.loginAt) await Act().create({ session: s._id, admin: s.admin, dayKey: dk, type: 'ACTIVE', startAt: at, endAt: s.loginAt, source: 'admin' });
      else await carve(s, s.loginAt, at, null);
      s.loginAt = at;
      newV = t;
    } else if (b.field === 'lunch') {
      const m = /^(\d{2}:\d{2})\s*[-–]\s*(\d{2}:\d{2})$/.exec(String(b.value || '').trim());
      if (!m) return { error: 'Enter lunch as HH:MM–HH:MM.' };
      const from = E.istAt(dk, m[1]);
      const to = E.istAt(dk, m[2]);
      if (to <= from) return { error: 'Lunch end must be after its start.' };
      const old = await Act().find({ session: s._id, type: 'LUNCH' }).lean();
      oldV = old.length ? old.map((p) => `${E.hmOf(p.startAt)}–${E.hmOf(p.endAt) || 'now'}`).join(', ') : 'none';
      await Act().updateMany({ session: s._id, type: 'LUNCH' }, { $set: { type: 'ACTIVE', source: 'admin' } });
      await carve(s, from, to, 'LUNCH', { label: 'Lunch' });
      if (!(s.breaksTaken || []).includes('lunch')) s.breaksTaken = [...(s.breaksTaken || []), 'lunch'];
      newV = `${m[1]}–${m[2]}`;
    } else if (b.field === 'status') {
      if (!STATUS_CHOICES.includes(b.value)) return { error: 'Pick a status.' };
      if (!s) return { error: 'No attendance that day — use "Manual attendance" or "Mark leave".' };
      oldV = s.statusOverride || 'automatic';
      s.statusOverride = b.value;
      newV = b.value;
    } else return { error: 'Pick what to change.' };
    s.manual = true;
    s.updated = new Date();
    await s.save();
    E.emitChange(s);
    return { oldV, newV };
  });
  if (r.error) return bad(res, r.error);
  const label = { login: 'Corrected login', logout: 'Corrected logout', lunch: 'Corrected lunch', status: 'Changed status' }[b.field];
  await E.audit(req, { action: label, employee: adminId, employeeName: emp.name, oldValue: r.oldV, newValue: r.newV, reason, dayKey: dk });
  require('../../../../notify').notifyUser({ recipient: adminId, actorId: req.admin._id, actorName: E.fullName(req.admin), module: 'HRMS', type: 'erp.correction', title: 'Attendance corrected', body: `${dk}: ${label.toLowerCase()} ${r.oldV} → ${r.newV}`, link: '/employee/attendance' });
  return ok(res, true, 'Correction saved and added to the audit log.');
});

// POST /admin/attendance/manual { adminId, date, login, logout, lunch?, reason }
const manual = guard(async (req, res) => {
  const b = req.body || {};
  const adminId = oid(b.adminId);
  const dk = keyOf(b.date, null);
  const reason = String(b.reason || '').trim();
  const li = hhmm(b.login);
  const lo = hhmm(b.logout);
  if (!adminId || !dk || !li || !lo) return bad(res, 'Pick the employee, the day, login and logout (HH:MM).');
  if (!reason) return bad(res, 'A reason is required.');
  if (lo <= li) return bad(res, 'Logout must be after login.');
  const { map } = await empMap();
  const emp = map[String(adminId)];
  if (!emp) return bad(res, 'Employee not found.', 404);
  const r = await E.withLock(adminId, async () => {
    if (await Sess().exists({ admin: adminId, dayKey: dk })) return { error: 'There is already attendance that day — use a correction.' };
    const loginAt = E.istAt(dk, li);
    const logoutAt = E.istAt(dk, lo);
    const s = await Sess().create({ admin: adminId, adminName: emp.name, role: emp.role, dayKey: dk, loginAt, logoutAt, logoutType: 'admin', startSource: 'manual', status: 'logged_out', manual: true, lastActivityAt: logoutAt, lastHeartbeatAt: logoutAt });
    await Act().create({ session: s._id, admin: adminId, dayKey: dk, type: 'ACTIVE', startAt: loginAt, endAt: logoutAt, source: 'admin' });
    const m = /^(\d{2}:\d{2})\s*[-–]\s*(\d{2}:\d{2})$/.exec(String(b.lunch || '').trim());
    if (m && m[2] > m[1]) await carve(s, E.istAt(dk, m[1]), E.istAt(dk, m[2]), 'LUNCH', { label: 'Lunch' });
    return { ok: true };
  });
  if (r.error) return bad(res, r.error);
  await E.audit(req, { action: 'Added manual attendance', employee: adminId, employeeName: emp.name, oldValue: 'Absent', newValue: `Present ${li}–${lo}${b.lunch ? ` (lunch ${b.lunch})` : ''}`, reason, dayKey: dk });
  return ok(res, true, 'Manual attendance added.');
});

// POST /admin/attendance/mark-leave { adminId, from, to, leaveType, dayType, reason }
const markLeave = guard(async (req, res) => {
  const b = req.body || {};
  const adminId = oid(b.adminId);
  const reason = String(b.reason || '').trim();
  const type = E.LEAVE_TYPES.includes(b.leaveType) ? b.leaveType : null;
  const from = keyOf(b.from, null);
  const to = keyOf(b.to || b.from, null);
  if (!adminId || !type || !from || !to || to < from) return bad(res, 'Pick the employee, leave type and dates.');
  if (!reason) return bad(res, 'A reason is required.');
  const { map } = await empMap();
  const emp = map[String(adminId)];
  if (!emp) return bad(res, 'Employee not found.', 404);
  const S = await E.getSettings();
  const dayType = from === to && ['first', 'second'].includes(b.dayType) ? b.dayType : 'full';
  const days = await L.countDays(from, to, dayType);
  let fromDate = E.dayStart(from);
  let toDate = E.dayEnd(to);
  if (dayType === 'first') toDate = E.istAt(from, S.lunchWindowStart);
  if (dayType === 'second') fromDate = E.istAt(from, S.lunchWindowStart);
  const leave = await mongoose.model('LeaveRequest').create({
    employee: emp.name,
    leaveType: type,
    fromDate,
    toDate,
    days: days || 1,
    halfDay: dayType !== 'full',
    halfPart: dayType === 'full' ? undefined : dayType,
    durationType: dayType !== 'full' ? 'half' : from === to ? 'full' : 'multi',
    reason,
    status: 'Approved',
    appliedOn: new Date(),
    decisionDate: new Date(),
    decisionBy: E.fullName(req.admin),
    adminId: String(adminId),
    source: 'erp-admin',
  });
  await E.audit(req, { action: 'Marked leave', employee: adminId, employeeName: emp.name, oldValue: 'Absent', newValue: `${type} · ${L.leaveLabel(leave)}`, reason, dayKey: from });
  require('../../../../notify').notifyUser({ recipient: adminId, actorId: req.admin._id, actorName: E.fullName(req.admin), module: 'HRMS', type: 'leave.approved', title: 'Leave marked by HR', body: `${type} · ${L.leaveLabel(leave)}`, link: '/employee/leaves' });
  return ok(res, leave, 'Leave marked.');
});

// ── Leaves (A5) ──────────────────────────────────────────────────────────────
async function enrichLeaves(list, map) {
  const S = await E.getSettings();
  const out = [];
  for (const l of list) {
    const e = map[String(l.adminId)] || null;
    let balance = null;
    if (e) {
      const b = (await E.leaveBalance(e._id, new Date(l.fromDate).getUTCFullYear(), S, { leaveAdjust: e.leaveAdjust })).find((x) => x.type === l.leaveType);
      if (b) balance = { now: b.left + (l.status === 'Approved' ? Number(l.days) || 0 : 0), after: b.left - (l.status === 'Pending' ? Number(l.days) || 0 : 0), total: b.total };
    }
    const same = await mongoose
      .model('LeaveRequest')
      .find({ removed: false, _id: { $ne: l._id }, status: { $in: ['Approved', 'Pending'] }, fromDate: { $lte: l.toDate }, toDate: { $gte: l.fromDate } })
      .select('employee adminId status')
      .lean();
    out.push({
      ...l,
      label: L.leaveLabel(l),
      emp: e ? { _id: e._id, name: e.name, employeeCode: e.employeeCode, department: e.department, designation: e.designation } : { name: l.employee },
      balance,
      sameDay: same.map((x) => ({ name: x.employee, status: x.status, department: (map[String(x.adminId)] || {}).department || '' })),
    });
  }
  return out;
}

const leaves = guard(async (req, res) => {
  const q = req.query;
  const { map } = await empMap();
  const base = { removed: false };
  if (q.from && q.to) Object.assign(base, { fromDate: { $lte: E.dayEnd(keyOf(q.to, E.todayKey())) }, toDate: { $gte: E.dayStart(keyOf(q.from, E.todayKey())) } });
  const all = await mongoose.model('LeaveRequest').find(base).select('-decisionToken').sort({ appliedOn: -1, created: -1 }).limit(500).lean();
  let list = all;
  if (q.type && q.type !== 'All') list = list.filter((l) => l.leaveType === q.type);
  if (q.dept && q.dept !== 'All') list = list.filter((l) => (map[String(l.adminId)] || {}).department === q.dept);
  if (q.q) list = list.filter((l) => `${l.employee} ${l.reason || ''}`.toLowerCase().includes(String(q.q).toLowerCase()));
  const counts = { Pending: 0, Approved: 0, Rejected: 0, All: list.length };
  list.forEach((l) => {
    if (counts[l.status] != null) counts[l.status] += 1;
  });
  const status = q.status || 'Pending';
  if (status !== 'All') list = list.filter((l) => l.status === status);
  return ok(res, { counts, list: await enrichLeaves(list.slice(0, 100), map), recipients: L.recipients().map((r) => r.replace(/^(.{3}).*(@.*)$/, '$1•••$2')) });
});

const leaveDecide = guard(async (req, res) => {
  const b = req.body || {};
  if (!['approve', 'reject'].includes(b.action)) return bad(res, 'Pick approve or reject.');
  const r = await L.decide(req, req.params.id, b.action, b.reason, { email: b.email !== false });
  return r.ok ? ok(res, r.leave, b.action === 'approve' ? 'Leave approved — the employee has been emailed.' : 'Leave rejected — the employee has been emailed.') : bad(res, r.error);
});

// ── Leave calendar (A6) ──────────────────────────────────────────────────────
const calendar = guard(async (req, res) => {
  const S = await E.getSettings();
  const m = monthOf(req.query.month);
  const from = E.addDays(`${m}-01`, -7);
  const to = E.addDays(`${m}-28`, 14);
  const { map } = await empMap();
  let leaves = await E.leavesBetween(from, to, { statuses: ['Approved', 'Pending', 'Rejected'] });
  if (req.query.dept && req.query.dept !== 'All') leaves = leaves.filter((l) => (map[String(l.adminId)] || {}).department === req.query.dept);
  if (req.query.employee && req.query.employee !== 'All') leaves = leaves.filter((l) => String(l.adminId) === String(req.query.employee));
  const hol = await E.holidayKeys(from, to);
  const upcoming = await mongoose.model('LeaveRequest').find({ removed: false, status: { $in: ['Approved', 'Pending'] }, fromDate: { $gte: E.dayStart(E.todayKey()) } }).sort({ fromDate: 1 }).limit(6).select('-decisionToken').lean();
  const upHol = await mongoose.model('Holiday').find({ removed: false, date: { $gte: E.dayStart(E.todayKey()) } }).sort({ date: 1 }).limit(3).lean();
  return ok(res, {
    month: m,
    weeklyOff: S.weeklyOff,
    holidays: hol,
    leaves: leaves.map((l) => ({ _id: l._id, adminId: l.adminId, employee: l.employee, department: (map[String(l.adminId)] || {}).department || '', leaveType: l.leaveType, status: l.status, fromKey: E.todayKey(new Date(l.fromDate)), toKey: E.todayKey(new Date(l.toDate)), days: l.days, reason: l.reason, label: L.leaveLabel(l) })),
    upcoming: [
      ...upcoming.map((l) => ({ kind: 'leave', name: l.employee, type: l.leaveType, status: l.status, label: L.leaveLabel(l), at: l.fromDate })),
      ...upHol.map((h) => ({ kind: 'holiday', name: h.name, at: h.date, label: L.fmtDate(h.date) })),
    ]
      .sort((a, b) => new Date(a.at) - new Date(b.at))
      .slice(0, 6),
    departments: S.departments,
  });
});

// ── Reports (A7) ─────────────────────────────────────────────────────────────
async function monthly(q) {
  const m = monthOf(q.month);
  let { list } = await empMap();
  list = list.filter((e) => e.enabled && e.tracked);
  if (q.dept && q.dept !== 'All') list = list.filter((e) => e.department === q.dept);
  if (q.employee && q.employee !== 'All') list = list.filter((e) => String(e._id) === String(q.employee));
  return { month: m, ...(await V.monthRows(m, list)) };
}
const reportMonthly = guard(async (req, res) => {
  const S = await E.getSettings();
  const r = await monthly(req.query);
  const prevM = E.addDays(`${r.month}-01`, -1).slice(0, 7);
  const prev = await monthly({ ...req.query, month: prevM });
  const att = (x) => {
    const wd = x.rows.reduce((n, y) => n + y.workingDays, 0);
    return wd ? Math.round((x.rows.reduce((n, y) => n + y.present + y.halfDays * 0.5, 0) / wd) * 100) : 0;
  };
  const attended = r.rows.reduce((n, y) => n + y.attended, 0);
  const topLate = [...r.rows].sort((a, b) => b.lateDays - a.lateDays)[0];
  return ok(res, {
    ...r,
    kpis: {
      workingDays: r.workingDays,
      attendancePct: att(r),
      attendanceDelta: prev.rows.some((y) => y.attended) ? att(r) - att(prev) : null,
      avgWork: attended ? Math.round(r.rows.reduce((n, y) => n + y.workMin, 0) / attended) : 0,
      lateLogins: r.rows.reduce((n, y) => n + y.lateDays, 0),
      topLate: topLate && topLate.lateDays ? { name: topLate.employee.name, n: topLate.lateDays } : null,
      overtime: r.rows.reduce((n, y) => n + y.overtimeMin, 0),
    },
    required: S.requiredMin,
    departments: S.departments,
  });
});

// GET /admin/export?kind=daily|monthly|leaves|audit|idle&format=xlsx|csv&…
const exportFile = guard(async (req, res) => {
  const q = req.query;
  let rows = [];
  let name = 'attendance';
  if (q.kind === 'monthly') {
    const r = await monthly(q);
    name = `attendance-${r.month}`;
    rows = r.rows.map((y) => ({ Employee: y.employee.name, Code: y.employee.employeeCode, Department: y.employee.department, 'Working days': y.workingDays, Present: y.present, Absent: y.absent, Leaves: y.leaves, 'Half days': y.halfDays, 'Late days': y.lateDays, 'Active hours': hm(y.workMin), 'Avg / day': hm(y.avgMin), Overtime: hm(y.overtimeMin) }));
  } else if (q.kind === 'leaves') {
    const list = await mongoose.model('LeaveRequest').find({ removed: false }).sort({ fromDate: -1 }).limit(2000).lean();
    name = 'leaves';
    rows = list.map((l) => ({ Employee: l.employee, Type: l.leaveType, From: L.fmtDate(l.fromDate), To: L.fmtDate(l.toDate), Days: l.days, Reason: l.reason, Status: l.status, 'Decided by': l.decisionBy || '', Note: l.decisionNote || '' }));
  } else if (q.kind === 'audit') {
    const list = await mongoose.model('ErpAudit').find({}).sort({ at: -1 }).limit(5000).lean();
    name = 'audit-log';
    rows = list.map((a) => ({ Admin: a.actorName, Action: a.action, Employee: a.employeeName || '', When: new Date(a.at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }), 'Old value': a.oldValue, 'New value': a.newValue, Reason: a.reason }));
  } else if (q.kind === 'idle') {
    const dk = keyOf(q.date, E.todayKey());
    const list = await Act().find({ type: 'INACTIVE', dayKey: dk }).sort({ startAt: 1 }).lean();
    const { map } = await empMap();
    name = `inactivity-${dk}`;
    rows = list.map((p) => ({ Employee: (map[String(p.admin)] || {}).name || '', 'Last input': E.hmOf(p.lastInputAt), 'Inactive at': E.hmOf(p.startAt), 'Back at': E.hmOf(p.endAt) || 'still inactive', Minutes: Math.round(E.minsBetween(p.startAt, p.endAt || new Date())), Laptop: p.laptop || '', Source: p.source || '', 'Employee note': p.employeeNote || '', Decision: p.countedAsWork ? `Counted as work (${p.countedBy}: ${p.countedReason})` : p.endAt ? 'Not work' : 'Still inactive' }));
  } else {
    const dk = keyOf(q.date, E.todayKey());
    const r = await V.dayRows(dk);
    name = `attendance-${dk}`;
    rows = r.map((y) => ({ Employee: y.employee.name, Code: y.employee.employeeCode, Department: y.employee.department, Login: y.session ? E.hmOf(y.session.loginAt) : '', Logout: y.session ? E.hmOf(y.session.logoutAt) || '' : '', Active: hm(y.totals.active), Inactive: hm(y.totals.inactive), Lunch: hm(y.totals.lunch), 'Total work': hm(y.totals.work), Status: [y.status, ...y.tags].join(' · ') }));
  }
  const ws = XLSX.utils.json_to_sheet(rows.length ? rows : [{ Info: 'No rows' }]);
  if (q.format === 'csv') {
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${name}.csv"`);
    return res.send(`﻿${XLSX.utils.sheet_to_csv(ws)}`);
  }
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${name}.xlsx"`);
  return res.send(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
});

// ── Employees (A8) ───────────────────────────────────────────────────────────
const employees = guard(async (req, res) => {
  const q = req.query;
  const S = await E.getSettings();
  let { list } = await empMap();
  // only people with an ERP login: tracked ones, plus Sales / switched-off ones so they can be switched back on
  list = list.filter((e) => e.tracked || e.trackingOff || E.isSalesRole(e.role));
  list = list.filter((e) => matchEmp(e, q.q));
  if (q.dept && q.dept !== 'All') list = list.filter((e) => e.department === q.dept);
  if (q.role && q.role !== 'All') list = list.filter((e) => e.role === q.role);
  if (q.status === 'Active') list = list.filter((e) => e.enabled);
  else if (q.status === 'Disabled') list = list.filter((e) => !e.enabled);
  const all = await E.trackedEmployees({ includeDisabled: true, includeUntracked: true });
  const year = Number(E.todayKey().slice(0, 4));
  const withBal = [];
  for (const e of list.sort((a, b) => Number(b.enabled) - Number(a.enabled) || a.name.localeCompare(b.name))) withBal.push({ ...e, balance: await E.leaveBalance(e._id, year, S, { leaveAdjust: e.leaveAdjust }) });
  return ok(res, { list: withBal, counts: { active: all.filter((e) => e.enabled).length, disabled: all.filter((e) => !e.enabled).length }, departments: S.departments, managers: all.filter((e) => e.enabled).map((e) => ({ _id: e._id, name: e.name })), leaveTypes: E.LEAVE_TYPES });
});

// PUT /admin/employees/:id { name, employeeCode, department, designation, joiningDate, shiftName, reportsTo, erpRole, enabled, leaveAdjust, reason }
const employeeUpdate = guard(async (req, res) => {
  const id = oid(req.params.id);
  const b = req.body || {};
  if (!id) return bad(res, 'Bad employee.');
  const A = mongoose.model('Admin');
  const a = await A.findOne({ _id: id, removed: false });
  if (!a || !E.isTrackedRole(a.role)) return bad(res, 'Employee not found.', 404);
  const P = mongoose.model('ErpProfile');
  const p = (await P.findOne({ admin: id })) || new P({ admin: id });
  const changes = [];
  const set = (field, val, label) => {
    const old = p[field] instanceof Date ? E.todayKey(p[field]) : p[field] == null ? '' : String(p[field]);
    const nv = val instanceof Date ? E.todayKey(val) : val == null ? '' : String(val);
    if (old !== nv) {
      changes.push({ label, old, nv });
      p[field] = val;
    }
  };
  if (b.employeeCode !== undefined) set('employeeCode', String(b.employeeCode).trim().slice(0, 30), 'Employee code');
  if (b.department !== undefined) set('department', String(b.department).trim().slice(0, 60), 'Department');
  if (b.designation !== undefined) set('designation', String(b.designation).trim().slice(0, 80), 'Designation');
  if (b.joiningDate) set('joiningDate', E.istAt(keyOf(String(b.joiningDate).slice(0, 10), E.todayKey()), '12:00'), 'Joining date');
  if (b.shiftName !== undefined) set('shiftName', String(b.shiftName).slice(0, 40), 'Shift');
  if (b.reportsTo !== undefined) set('reportsTo', oid(b.reportsTo) || undefined, 'Reports to');
  if (b.erpRole && ['employee', 'hr_admin'].includes(b.erpRole)) set('erpRole', b.erpRole, 'ERP role');
  if (typeof b.tracked === 'boolean' && b.tracked !== E.isTracked(a, p)) {
    changes.push({ label: 'Track attendance', old: E.isTracked(a, p) ? 'On' : 'Off', nv: b.tracked ? 'On' : 'Off' });
    p.trackingEnabled = b.tracked;
    E.forgetTracked(a._id);
  }
  let balChange = null;
  if (b.leaveAdjust && typeof b.leaveAdjust === 'object') {
    const old = JSON.stringify(p.leaveAdjust || {});
    const clean = {};
    E.LEAVE_TYPES.forEach((t) => {
      const n = Number(b.leaveAdjust[t]);
      if (n) clean[t] = Math.max(-365, Math.min(365, n));
    });
    if (old !== JSON.stringify(clean)) {
      balChange = { old, nv: JSON.stringify(clean) };
      p.leaveAdjust = clean;
      p.markModified('leaveAdjust');
    }
  }
  let nameChange = null;
  if (b.name && String(b.name).trim() && String(b.name).trim() !== E.fullName(a)) {
    const parts = String(b.name).trim().split(/\s+/);
    nameChange = { old: E.fullName(a), nv: String(b.name).trim() };
    a.name = parts.shift();
    a.surname = parts.join(' ');
  }
  let statusChange = null;
  if (typeof b.enabled === 'boolean' && b.enabled !== a.enabled) {
    if (String(a._id) === String(req.admin._id)) return bad(res, 'You cannot disable your own account.');
    if (a.role === 'owner') return bad(res, 'The owner account cannot be disabled here.');
    statusChange = { old: a.enabled ? 'Active' : 'Disabled', nv: b.enabled ? 'Active' : 'Disabled' };
    a.enabled = b.enabled;
  }
  const reason = String(b.reason || '').trim();
  if ((statusChange || balChange || changes.some((c) => c.label === 'ERP role')) && !reason) return bad(res, 'A reason is required to change status, ERP role or leave balance.');
  p.updated = new Date();
  await p.save();
  if (nameChange || statusChange) await a.save();
  const emp = E.fullName(a);
  for (const c of changes) await E.audit(req, { action: `Changed ${c.label.toLowerCase()}`, employee: id, employeeName: emp, oldValue: c.old, newValue: c.nv, reason });
  if (nameChange) await E.audit(req, { action: 'Changed name', employee: id, employeeName: emp, oldValue: nameChange.old, newValue: nameChange.nv, reason });
  if (statusChange) await E.audit(req, { action: 'Changed status', employee: id, employeeName: emp, oldValue: statusChange.old, newValue: statusChange.nv, reason });
  if (balChange) await E.audit(req, { action: 'Edited balance', employee: id, employeeName: emp, oldValue: balChange.old, newValue: balChange.nv, reason });
  return ok(res, true, 'Employee saved.');
});

// ── Audit + notifications (A9) ───────────────────────────────────────────────
const auditList = guard(async (req, res) => {
  const q = req.query;
  const f = {};
  if (q.actor && q.actor !== 'All') f.actorName = q.actor;
  if (q.action && q.action !== 'All') f.action = q.action;
  if (q.employee && q.employee !== 'All' && oid(q.employee)) f.employee = oid(q.employee);
  const days = Number(q.days) || 30;
  f.at = { $gte: new Date(Date.now() - days * 864e5) };
  const list = await mongoose.model('ErpAudit').find(f).sort({ at: -1 }).limit(300).lean();
  const [actors, actions] = await Promise.all([mongoose.model('ErpAudit').distinct('actorName'), mongoose.model('ErpAudit').distinct('action')]);
  return ok(res, { list, actors, actions });
});
const notifications = guard(async (req, res) => {
  const list = await mongoose.model('Notification').find({ recipient: req.admin._id, removed: false, module: 'HRMS' }).sort({ created: -1 }).limit(40).lean();
  return ok(res, { list, unread: list.filter((n) => !n.readAt).length });
});
const notificationsReadAll = guard(async (req, res) => {
  await mongoose.model('Notification').updateMany({ recipient: req.admin._id, module: 'HRMS', readAt: null }, { $set: { readAt: new Date() } });
  return ok(res, true, 'All marked as read.');
});

// ── Settings (A10) ───────────────────────────────────────────────────────────
const settingsGet = guard(async (req, res) => {
  const S = await E.getSettings(true);
  const year = Number(E.todayKey().slice(0, 4));
  const holidays = await mongoose.model('Holiday').find({ removed: false, date: { $gte: E.dayStart(`${year}-01-01`), $lte: E.dayEnd(`${year + 1}-12-31`) } }).sort({ date: 1 }).lean();
  return ok(res, { settings: S, holidays, recipients: L.recipients().map((r) => r.replace(/^(.{3}).*(@.*)$/, '$1•••$2')), env: { admin: !!process.env.LEAVE_ADMIN_EMAIL, notification: !!process.env.LEAVE_NOTIFICATION_EMAIL } });
});
const SETTING_KEYS = ['workStart', 'workEnd', 'requiredMin', 'lateAfter', 'lunchMin', 'lunchWindowStart', 'lunchWindowEnd', 'autoLunch', 'breaks', 'inactivitySec', 'heartbeatSec', 'offlineSec', 'autoCloseAt', 'countScrollTouch', 'inactiveBanner', 'pauseDialerOnInactive', 'allowSecondDevice', 'rules', 'weeklyOff', 'leaveQuota', 'emailEmployee', 'approvers', 'departments'];
const settingsSave = guard(async (req, res) => {
  const b = (req.body && req.body.settings) || {};
  const cur = await E.getSettings(true);
  const next = {};
  SETTING_KEYS.forEach((k) => {
    if (b[k] !== undefined) next[k] = b[k];
  });
  for (const k of ['workStart', 'workEnd', 'lateAfter', 'lunchWindowStart', 'lunchWindowEnd', 'autoCloseAt']) if (next[k] !== undefined && !hhmm(next[k])) return bad(res, `${k}: use HH:MM.`);
  if (next.inactivitySec !== undefined && (Number(next.inactivitySec) < 60 || Number(next.inactivitySec) > 3600)) return bad(res, 'Inactivity threshold must be 1–60 minutes.');
  if (next.requiredMin !== undefined && (Number(next.requiredMin) < 60 || Number(next.requiredMin) > 960)) return bad(res, 'Daily required hours must be 1–16 hours.');
  ['requiredMin', 'lunchMin', 'inactivitySec', 'heartbeatSec', 'offlineSec'].forEach((k) => {
    if (next[k] !== undefined) next[k] = Number(next[k]);
  });
  const saved = await E.saveSettings(next, E.fullName(req.admin));
  const reason = String((req.body && req.body.reason) || '').trim();
  for (const k of Object.keys(next)) {
    const o = JSON.stringify(cur[k]);
    const n = JSON.stringify(saved[k]);
    if (o !== n) await E.audit(req, { action: 'Changed setting', employeeName: '—', oldValue: `${k}: ${o}`, newValue: `${k}: ${n}`, reason });
  }
  return ok(res, saved, 'Settings saved. They apply from now.');
});
const holidayAdd = guard(async (req, res) => {
  const b = req.body || {};
  const dk = keyOf(b.date, null);
  if (!dk || !String(b.name || '').trim()) return bad(res, 'Enter the holiday name and date.');
  const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const h = await mongoose.model('Holiday').create({ name: String(b.name).trim().slice(0, 80), date: E.istAt(dk, '12:00'), type: 'Company', day: DAYS[E.weekday(dk)], year: Number(dk.slice(0, 4)) });
  await E.audit(req, { action: 'Added holiday', employeeName: '—', newValue: `${h.name} · ${dk}`, reason: b.reason || '' });
  return ok(res, h, 'Holiday added.');
});
const holidayRemove = guard(async (req, res) => {
  const h = await mongoose.model('Holiday').findOneAndUpdate({ _id: req.params.id, removed: false }, { $set: { removed: true } });
  if (!h) return bad(res, 'Holiday not found.', 404);
  await E.audit(req, { action: 'Removed holiday', employeeName: '—', oldValue: `${h.name} · ${E.todayKey(new Date(h.date))}`, reason: (req.body && req.body.reason) || '' });
  return ok(res, true, 'Holiday removed.');
});

// ── System tracking (A13) ────────────────────────────────────────────────────
const agentState = (dev, row) => {
  if (!dev) return 'Not installed';
  const seen = dev.lastSeenAt && Date.now() - new Date(dev.lastSeenAt) < 2 * 60000;
  if (seen) return 'Online';
  if (row && row.session && row.session.lastHeartbeatAt && Date.now() - new Date(row.session.lastHeartbeatAt) < 2 * 60000 && dev.power !== 'off') return 'Stopped';
  return 'Offline';
};
const system = guard(async (req, res) => {
  const now = new Date();
  const tk = E.todayKey(now);
  const rows = await V.dayRows(tk, now);
  const devices = await mongoose.model('ErpDevice').find({ revoked: false }).select('-tokenHash').sort({ lastSeenAt: -1 }).lean();
  const devBy = {};
  devices.forEach((d) => {
    if (!devBy[String(d.admin)]) devBy[String(d.admin)] = d;
  });
  const idle = await Act().aggregate([{ $match: { dayKey: tk, type: 'INACTIVE' } }, { $group: { _id: '$admin', n: { $sum: 1 }, min: { $sum: { $divide: [{ $subtract: [{ $ifNull: ['$endAt', '$$NOW'] }, '$startAt'] }, 60000] } } } }]);
  const idleBy = {};
  idle.forEach((x) => {
    idleBy[String(x._id)] = x;
  });
  const q = req.query;
  let list = rows.map((r) => {
    const d = devBy[String(r.employee._id)] || null;
    const state = agentState(d, r);
    const online = state === 'Online';
    const lastInput = d && online ? d.lastInputAt : r.session && r.session.lastActivityAt;
    return {
      employee: r.employee,
      device: d,
      agent: state,
      power: d ? (state === 'Online' ? d.power : d.power === 'off' ? 'off' : state === 'Stopped' ? 'on' : 'off') : null,
      kbAt: d && online ? d.lastKbAt : r.session && r.session.lastKbAt,
      mouseAt: d && online ? d.lastMouseAt : r.session && r.session.lastMouseAt,
      noInputMin: r.live && lastInput ? Math.round(E.minsBetween(lastInput, now)) : null,
      idleCount: (idleBy[String(r.employee._id)] || {}).n || 0,
      idleMin: Math.round((idleBy[String(r.employee._id)] || {}).min || 0),
      status: r.status,
      live: r.live,
      session: r.session,
    };
  });
  const kpis = {
    total: rows.length,
    withAgent: list.filter((x) => x.device).length,
    agentOnline: list.filter((x) => x.agent === 'Online').length,
    inUse: list.filter((x) => x.live === 'active').length,
    idle5: list.filter((x) => x.live === 'inactive').length,
    locked: list.filter((x) => x.agent === 'Online' && ['locked', 'sleep'].includes(x.power)).length,
    off: list.filter((x) => x.device && x.power === 'off').length,
    alerts: 0,
  };
  const alerts = [];
  list.forEach((x) => {
    if (x.agent === 'Stopped') alerts.push({ admin: x.employee._id, name: x.employee.name, kind: 'stopped', text: `agent stopped at ${E.hmOf(x.device.lastSeenAt)} while the portal / CRM was still open. Shown as "Browser only" since then.` });
    if (x.device && Math.abs(x.device.clockSkewSec || 0) > 120) alerts.push({ admin: x.employee._id, name: x.employee.name, kind: 'clock', text: `laptop clock ${Math.round(Math.abs(x.device.clockSkewSec) / 60)} min ${x.device.clockSkewSec > 0 ? 'ahead of' : 'behind'} the server. Server time used.` });
  });
  kpis.alerts = alerts.length;
  if (q.q) list = list.filter((x) => matchEmp(x.employee, q.q) || String((x.device && x.device.hostname) || '').toLowerCase().includes(String(q.q).toLowerCase()));
  if (q.dept && q.dept !== 'All') list = list.filter((x) => x.employee.department === q.dept);
  if (q.state && q.state !== 'All') list = list.filter((x) => (q.state === 'In use' ? x.live === 'active' : q.state === 'Idle 5+ min' ? x.live === 'inactive' : q.state === 'Locked / sleep' ? ['locked', 'sleep'].includes(x.power) : q.state === 'Off' ? x.power === 'off' : true));
  if (q.agent && q.agent !== 'All') list = list.filter((x) => x.agent === q.agent);
  list.sort((a, b) => (b.device ? 1 : 0) - (a.device ? 1 : 0) || (a.live ? 0 : 1) - (b.live ? 0 : 1));
  return ok(res, { now, kpis, list, alerts, departments: (await E.getSettings()).departments });
});

const systemDay = guard(async (req, res) => {
  const adminId = oid(req.params.adminId);
  if (!adminId) return bad(res, 'Bad employee.');
  const dk = keyOf(req.query.date, E.todayKey());
  const S = await E.getSettings();
  const { map } = await empMap();
  const d = await V.day(adminId, dk);
  const device = await mongoose.model('ErpDevice').findOne({ admin: adminId, revoked: false }).sort({ lastSeenAt: -1 }).select('-tokenHash').lean();
  const events = await mongoose.model('ErpDeviceEvent').find({ admin: adminId, dayKey: dk }).sort({ at: 1 }).lean();
  // 10-minute heatmap
  const s = d.session;
  const startH = Math.min(Number(S.workStart.slice(0, 2)), s && s.loginAt ? Number(E.hmOf(s.loginAt).slice(0, 2)) : 23);
  const endRef = s ? s.logoutAt || (dk === E.todayKey() ? new Date() : d.periods.reduce((mx, p) => (p.endAt && p.endAt > mx ? p.endAt : mx), s.loginAt)) : null;
  const endH = Math.max(Number(S.workEnd.slice(0, 2)), endRef ? Number(E.hmOf(endRef).slice(0, 2)) : 0);
  const slots = (s && s.slots) || {};
  const lockRanges = [];
  let lockStart = null;
  events.forEach((e) => {
    if (['lock', 'sleep'].includes(e.kind) && !lockStart) lockStart = e.at;
    if (['unlock', 'wake'].includes(e.kind) && lockStart) {
      lockRanges.push([lockStart, e.at]);
      lockStart = null;
    }
  });
  if (lockStart) lockRanges.push([lockStart, endRef || new Date()]);
  const rowsH = [];
  for (let h = startH; h <= endH; h += 1) {
    const cells = [];
    for (let m = 0; m < 60; m += 10) {
      const key = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
      const from = E.istAt(dk, key);
      const to = new Date(from.getTime() + 600000);
      const share = { ACTIVE: 0, INACTIVE: 0, LUNCH: 0, BREAK: 0, OFFLINE: 0 };
      d.periods.forEach((p) => {
        const pe = p.endAt || (s && s.status !== 'logged_out' && s.status !== 'needs_review' ? new Date() : p.startAt);
        const ov = Math.min(to, pe) - Math.max(from, p.startAt);
        if (ov > 0) share[p.type] += ov;
      });
      const locked = lockRanges.reduce((n, [a, b]) => n + Math.max(0, Math.min(to, b) - Math.max(from, a)), 0);
      const top = Object.entries(share).sort((a, b) => b[1] - a[1])[0];
      const sl = slots[key] || { k: 0, m: 0 };
      let state = 'O';
      if (!top[1]) state = 'O';
      else if (top[0] === 'LUNCH' || top[0] === 'BREAK' || locked > 300000) state = 'L';
      else if (top[0] === 'OFFLINE') state = 'O';
      else if (top[0] === 'INACTIVE') state = 'I';
      else if (sl.k) state = 'K';
      else state = 'M';
      cells.push({ key, state, k: sl.k, m: sl.m });
    }
    rowsH.push({ hour: `${String(h).padStart(2, '0')}:00`, cells });
  }
  const kbBeats = Object.values(slots).reduce((n, x) => n + (x.k || 0), 0);
  const msBeats = Object.values(slots).reduce((n, x) => n + (x.m || 0), 0);
  const inact = d.periods.filter((p) => p.type === 'INACTIVE');
  const lockedMin = Math.round(lockRanges.reduce((n, [a, b]) => n + E.minsBetween(a, b), 0));
  const timeline = [
    ...events.map((e) => ({ at: e.at, kind: e.kind, text: { boot: 'Laptop switched on (boot)', unlock: 'Unlocked', lock: 'Locked', sleep: 'Sleep (lid closed)', wake: 'Woke up', shutdown: 'Shut down', agent_start: 'Agent started', agent_stop: 'Agent stopped', clock_skew: 'Laptop clock is off' }[e.kind] || e.kind, detail: e.detail })),
    ...inact.map((p) => ({ at: p.startAt, kind: 'idle', text: `No keyboard / mouse ${Math.round(S.inactivitySec / 60)} min (till ${E.hmOf(p.endAt) || 'now'})` })),
    ...(s && s.loginAt ? [{ at: s.loginAt, kind: 'login', text: 'Signed in' }] : []),
    ...(s && s.logoutAt ? [{ at: s.logoutAt, kind: 'logout', text: 'Logged out' }] : []),
  ].sort((a, b) => new Date(a.at) - new Date(b.at));
  return ok(res, {
    employee: map[String(adminId)] || null,
    dayKey: dk,
    device,
    heat: rowsH,
    stats: { kbMin: Math.round((kbBeats * S.heartbeatSec) / 60), msMin: Math.round((msBeats * S.heartbeatSec) / 60), idleCount: inact.length, idleMin: Math.round(inact.reduce((n, p) => n + E.minsBetween(p.startAt, p.endAt || new Date()), 0)), lockedMin, lunchMin: d.totals.lunch },
    timeline,
    status: d.status,
    live: d.live,
  });
});

// ── Inactivity log (A14) ─────────────────────────────────────────────────────
const idleLog = guard(async (req, res) => {
  const now = new Date();
  const q = req.query;
  const dk = keyOf(q.date, E.todayKey(now));
  if (dk === E.todayKey(now)) await V.refreshOpen(null, now);
  const { map } = await empMap();
  const all = await Act().find({ type: 'INACTIVE', dayKey: dk }).sort({ startAt: -1 }).lean();
  const mins = (p) => E.minsBetween(p.startAt, p.endAt || now);
  const withEmp = all.filter((p) => map[String(p.admin)]).map((p) => ({ ...p, minutes: Math.round(mins(p)), emp: map[String(p.admin)] }));
  const byEmp = {};
  withEmp.forEach((p) => {
    byEmp[p.emp.name] = (byEmp[p.emp.name] || 0) + 1;
  });
  const longest = withEmp.reduce((mx, p) => (!mx || p.minutes > mx.minutes ? p : mx), null);
  const most = Object.entries(byEmp).sort((a, b) => b[1] - a[1])[0];
  const kpis = {
    count: withEmp.length,
    people: new Set(withEmp.map((p) => String(p.admin))).size,
    total: Math.round(withEmp.filter((p) => !p.countedAsWork).reduce((n, p) => n + p.minutes, 0)),
    longest: longest ? { name: longest.emp.name, minutes: longest.minutes, from: longest.startAt, to: longest.endAt } : null,
    most: most ? { name: most[0], n: most[1] } : null,
    open: withEmp.filter((p) => !p.endAt).length,
    counted: withEmp.filter((p) => p.countedAsWork).length,
  };
  let list = withEmp;
  if (q.q) list = list.filter((p) => matchEmp(p.emp, q.q));
  if (q.employee && q.employee !== 'All') list = list.filter((p) => String(p.admin) === String(q.employee));
  if (q.dept && q.dept !== 'All') list = list.filter((p) => p.emp.department === q.dept);
  if (q.source && q.source !== 'All') list = list.filter((p) => (p.source || 'browser') === q.source.toLowerCase());
  if (Number(q.min) > 0) list = list.filter((p) => p.minutes >= Number(q.min));
  if (q.decision === 'notwork') list = list.filter((p) => !p.countedAsWork && p.endAt);
  else if (q.decision === 'counted') list = list.filter((p) => p.countedAsWork);
  else if (q.decision === 'note') list = list.filter((p) => p.employeeNote);
  // open first, then newest
  list.sort((a, b) => (a.endAt ? 1 : 0) - (b.endAt ? 1 : 0) || new Date(b.startAt) - new Date(a.startAt));
  // live laptop info for open rows
  for (const p of list.filter((x) => !x.endAt)) {
    const dev = await mongoose.model('ErpDevice').findOne({ admin: p.admin, revoked: false, lastSeenAt: { $gte: new Date(Date.now() - 2 * 60000) } }).lean();
    p.source = dev ? 'agent' : 'browser';
    p.laptop = dev ? (dev.power === 'locked' ? `Locked at ${E.hmOf(dev.powerSince)}` : dev.power === 'sleep' ? `Sleep (lid closed) ${E.hmOf(dev.powerSince)}` : 'Screen on, unlocked') : 'Browser only (no agent)';
  }
  // month: who was inactive most
  const m = dk.slice(0, 7);
  const top = await Act().aggregate([
    { $match: { type: 'INACTIVE', dayKey: { $gte: `${m}-01`, $lte: `${m}-31` }, countedAsWork: { $ne: true } } },
    { $group: { _id: '$admin', n: { $sum: 1 }, min: { $sum: { $divide: [{ $subtract: [{ $ifNull: ['$endAt', '$$NOW'] }, '$startAt'] }, 60000] } } } },
    { $sort: { min: -1 } },
    { $limit: 6 },
  ]);
  // last 30 days by IST hour
  const hours = await Act().aggregate([
    { $match: { type: 'INACTIVE', startAt: { $gte: new Date(now.getTime() - 30 * 864e5) } } },
    { $group: { _id: { $hour: { date: '$startAt', timezone: 'Asia/Kolkata' } }, n: { $sum: 1 } } },
    { $sort: { _id: 1 } },
  ]);
  return ok(res, {
    dayKey: dk,
    kpis,
    list: list.slice(0, 300),
    top: top.map((t) => ({ name: (map[String(t._id)] || {}).name || '—', n: t.n, min: Math.round(t.min) })),
    hours: hours.map((h) => ({ hour: h._id, n: h.n })),
    departments: (await E.getSettings()).departments,
    employees: Object.values(map).filter((e) => e.enabled).map((e) => ({ _id: e._id, name: e.name })),
  });
});

const idleCount = guard(async (req, res) => {
  const reason = String((req.body && req.body.reason) || '').trim();
  if (!reason) return bad(res, 'A reason is required.');
  const p = await Act().findOne({ _id: req.params.id, type: 'INACTIVE' });
  if (!p) return bad(res, 'Record not found.', 404);
  if (p.countedAsWork) return bad(res, 'Already counted as work.');
  p.countedAsWork = true;
  p.countedBy = E.fullName(req.admin);
  p.countedReason = reason.slice(0, 300);
  p.countedAt = new Date();
  await p.save();
  const { map } = await empMap();
  const emp = map[String(p.admin)];
  await E.audit(req, { action: 'Counted inactive time as work', employee: p.admin, employeeName: emp ? emp.name : '', oldValue: `Inactive ${E.hmOf(p.startAt)}–${E.hmOf(p.endAt) || 'now'}`, newValue: 'Counted as work', reason, dayKey: p.dayKey });
  require('../../../../notify').notifyUser({ recipient: p.admin, actorId: req.admin._id, actorName: E.fullName(req.admin), module: 'HRMS', type: 'erp.idle-counted', title: 'Inactive time counted as work', body: `${p.dayKey} ${E.hmOf(p.startAt)}–${E.hmOf(p.endAt) || 'now'}: ${reason}`, link: '/employee/agent' });
  return ok(res, p, 'Counted as work — added to the audit log.');
});

// GET /admin/employees-lite — for filters / pickers
const employeesLite = guard(async (req, res) => {
  const S = await E.getSettings();
  const list = await E.trackedEmployees();
  return ok(res, { list: list.map((e) => ({ _id: e._id, name: e.name, department: e.department, employeeCode: e.employeeCode })), departments: S.departments, leaveTypes: E.LEAVE_TYPES });
});

module.exports = {
  invite,
  invites,
  isErpAdmin,
  dashboard,
  live,
  attendance,
  detail,
  correct,
  manual,
  markLeave,
  leaves,
  leaveDecide,
  calendar,
  reportMonthly,
  exportFile,
  employees,
  employeeUpdate,
  employeesLite,
  auditList,
  notifications,
  notificationsReadAll,
  settingsGet,
  settingsSave,
  holidayAdd,
  holidayRemove,
  system,
  systemDay,
  idleLog,
  idleCount,
};
