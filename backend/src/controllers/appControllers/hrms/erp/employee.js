const mongoose = require('mongoose');
const E = require('../../../../services/hr/erpAttendance');
const V = require('../../../../services/hr/erpViews');
const L = require('../../../../services/hr/erpLeave');

// /api/attendance-erp/me/* — the /employee portal. Every handler works on
// req.admin only: an employee can never read another person's data.
const ok = (res, result, message = 'ok') => res.status(200).json({ success: true, result, message });
const bad = (res, message, status = 400) => res.status(status).json({ success: false, result: null, message });
const me = (req) => req.admin;
const tracked = (fn) => async (req, res) => (E.isTrackedRole(req.admin.role) ? fn(req, res) : bad(res, 'The employee portal is for staff accounts.', 403));

const profileOf = async (adminId) => mongoose.model('ErpProfile').findOne({ admin: adminId }).lean();

// GET /me/today
const today = tracked(async (req, res) => {
  const a = me(req);
  const now = new Date();
  const S = await E.getSettings();
  const dk = E.todayKey(now);
  const d = await V.day(a._id, dk, now);
  // this week (Mon → Sat)
  const wd = E.weekday(dk);
  const monday = E.addDays(dk, -((wd + 6) % 7));
  const weekTot = await E.totalsByAdminDay(monday, E.addDays(monday, 5), [a._id]);
  const week = [0, 1, 2, 3, 4, 5].map((i) => {
    const k = E.addDays(monday, i);
    const x = weekTot[`${a._id}|${k}`];
    return { dayKey: k, work: x ? x.totals.work : 0, today: k === dk, future: k > dk };
  });
  const profile = await profileOf(a._id);
  const [balance, recent, devices, unread] = await Promise.all([
    E.leaveBalance(a._id, Number(dk.slice(0, 4)), S, profile),
    mongoose.model('LeaveRequest').find({ removed: false, adminId: String(a._id) }).select('-decisionToken').sort({ appliedOn: -1, created: -1 }).limit(3).lean(),
    mongoose.model('ErpDevice').find({ admin: a._id, revoked: false }).select('-tokenHash').lean(),
    mongoose.model('Notification').countDocuments({ recipient: a._id, removed: false, readAt: null }),
  ]);
  // yesterday never closed → "needs review" card with a note box
  const review = await mongoose.model('ErpSession').findOne({ admin: a._id, status: 'needs_review', dayKey: { $lt: dk }, reviewNote: { $in: [null, ''] } }).sort({ dayKey: -1 }).lean();
  let reviewInfo = null;
  if (review) {
    const rd = await V.day(a._id, review.dayKey, now);
    reviewInfo = { dayKey: review.dayKey, lastAt: review.lastHeartbeatAt, work: rd.totals.work };
  }
  return ok(res, {
    now,
    day: d,
    settings: { requiredMin: S.requiredMin, workStart: S.workStart, workEnd: S.workEnd, lunchMin: S.lunchMin, inactivitySec: S.inactivitySec, heartbeatSec: S.heartbeatSec, offlineSec: S.offlineSec, breaks: S.breaks, inactiveBanner: S.inactiveBanner, lateAfter: S.lateAfter, weeklyOff: S.weeklyOff },
    week,
    balance,
    recent: recent.map((l) => ({ ...l, label: L.leaveLabel(l) })),
    agent: devices.map((x) => ({ ...x, online: x.lastSeenAt && Date.now() - new Date(x.lastSeenAt) < 2 * 60000 })),
    unread,
    review: reviewInfo,
    profile: { employeeCode: profile && profile.employeeCode, department: profile && profile.department, designation: (profile && profile.designation) || a.role },
  });
});

const start = tracked(async (req, res) => {
  const s = await E.startSession(me(req), { source: 'portal', ua: req.headers['user-agent'] });
  return ok(res, { status: s && s.status }, 'Your day has started.');
});

// POST /me/heartbeat { kb, mouse, touch, scroll, agoMs } — flags only.
const heartbeat = async (req, res) => {
  if (!E.isTrackedRole(req.admin.role)) return ok(res, { tracked: false });
  const b = req.body || {};
  const r = await E.heartbeat(me(req), { kb: !!b.kb, mouse: !!b.mouse, touch: !!b.touch, scroll: !!b.scroll, agoMs: Number(b.agoMs) || 0 }, { source: 'browser', ua: req.headers['user-agent'] });
  const s = r.session;
  return ok(res, s ? { status: s.status, dayKey: s.dayKey, lastActivityAt: s.lastActivityAt, currentBreak: s.currentBreak || null } : { status: null });
};

const breakStart = tracked(async (req, res) => {
  const r = await E.breakStart(me(req), { kind: req.body && req.body.kind === 'LUNCH' ? 'LUNCH' : 'BREAK', key: req.body && req.body.key });
  return r.ok ? ok(res, { status: r.session.status }, `${r.session.currentBreak.label} started.`) : bad(res, r.error);
});
const breakEnd = tracked(async (req, res) => {
  const r = await E.breakEnd(me(req));
  return r.ok ? ok(res, { status: r.session.status }, 'Welcome back — you are active again.') : bad(res, r.error);
});
const logout = tracked(async (req, res) => {
  const s = await E.logout(me(req), { type: 'manual' });
  return ok(res, { status: s && s.status }, 'Logged out. Your day is saved.');
});

// GET /me/attendance?period=daily|weekly|monthly|custom&date=&month=&from=&to=&status=
const attendance = tracked(async (req, res) => {
  const a = me(req);
  const now = new Date();
  const S = await E.getSettings();
  const tk = E.todayKey(now);
  const q = req.query;
  let from;
  let to;
  if (q.period === 'daily') from = to = (q.date || tk).slice(0, 10);
  else if (q.period === 'weekly') {
    const base = (q.date || tk).slice(0, 10);
    from = E.addDays(base, -((E.weekday(base) + 6) % 7));
    to = E.addDays(from, 6);
  } else if (q.period === 'custom' && q.from && q.to) {
    from = q.from.slice(0, 10);
    to = q.to.slice(0, 10);
  } else {
    const m = (q.month || tk.slice(0, 7)).slice(0, 7);
    from = `${m}-01`;
    const last = new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)), 0)).getUTCDate();
    to = `${m}-${String(last).padStart(2, '0')}`;
  }
  if (to > tk) to = tk;
  if (from > to) return ok(res, { from, to, rows: [], summary: null });
  if (to === tk) await V.refreshOpen([a._id], now);
  const [tot, leaves, hol] = await Promise.all([E.totalsByAdminDay(from, to, [a._id]), E.leavesBetween(from, to, { adminIds: [a._id] }), E.holidayKeys(from, to)]);
  const rows = [];
  for (let d = to; d >= from; d = E.addDays(d, -1)) {
    const x = tot[`${a._id}|${d}`];
    const leave = E.leaveOnDay(leaves, a._id, d, S);
    const st = E.dayStatus(x && x.session, x ? x.totals : E.totalsOf(null, []), { dayKey: d, S, now, leave, holiday: hol[d], weeklyOff: S.weeklyOff.includes(E.weekday(d)) });
    rows.push({
      dayKey: d,
      loginAt: x && x.session.loginAt,
      logoutAt: x && x.session.logoutAt,
      totals: x ? x.totals : null,
      status: st.status,
      tags: st.tags,
      holiday: hol[d] || null,
      leave: leave ? leave.leaveType : null,
      periods: x ? x.periods.map((p) => ({ type: p.type, startAt: p.startAt, endAt: p.endAt })) : [],
    });
  }
  const filtered = q.status && q.status !== 'All' ? rows.filter((r) => r.status === q.status || r.tags.includes(q.status)) : rows;
  const wdays = (await E.workingDays(from, to, S)).length;
  const att = rows.filter((r) => r.totals && r.loginAt);
  const summary = {
    workingDays: wdays,
    present: rows.filter((r) => ['Present', 'Online', 'Inactive', 'Lunch', 'Break', 'Offline', 'Short', 'Needs review'].includes(r.status)).length,
    late: rows.filter((r) => r.tags.includes('Late')).length,
    short: rows.filter((r) => r.status === 'Short').length,
    half: rows.filter((r) => r.status === 'Half Day').length,
    leave: rows.filter((r) => r.status === 'Leave').length,
    avgWork: att.length ? Math.round(att.reduce((n, r) => n + r.totals.work, 0) / att.length) : 0,
  };
  return ok(res, { from, to, rows: filtered, summary, required: S.requiredMin });
});

const dayDetail = tracked(async (req, res) => ok(res, await V.day(me(req)._id, String(req.query.date || E.todayKey()).slice(0, 10))));

// GET /me/leaves?status=&type=&year=
const leaves = tracked(async (req, res) => {
  const a = me(req);
  const S = await E.getSettings();
  const year = Number(req.query.year) || Number(E.todayKey().slice(0, 4));
  const q = { removed: false, adminId: String(a._id), fromDate: { $lte: E.dayEnd(`${year}-12-31`) }, toDate: { $gte: E.dayStart(`${year}-01-01`) } };
  const all = await mongoose.model('LeaveRequest').find(q).select('-decisionToken').sort({ fromDate: -1 }).lean();
  const counts = { All: all.length, Pending: 0, Approved: 0, Rejected: 0, Cancelled: 0 };
  all.forEach((l) => {
    counts[l.status] = (counts[l.status] || 0) + 1;
  });
  let list = all;
  if (req.query.status && req.query.status !== 'All') list = list.filter((l) => l.status === req.query.status);
  if (req.query.type && req.query.type !== 'All') list = list.filter((l) => l.leaveType === req.query.type);
  return ok(res, { balance: await E.leaveBalance(a._id, year, S, await profileOf(a._id)), counts, list: list.map((l) => ({ ...l, label: L.leaveLabel(l) })), types: E.LEAVE_TYPES });
});

const applyLeave = tracked(async (req, res) => {
  const r = await L.apply(me(req), req.body || {}, req.file);
  return r.ok ? ok(res, { ...r.leave.toObject(), label: L.leaveLabel(r.leave) }, 'Request sent. HR has been emailed.') : bad(res, r.error);
});

const cancelLeave = tracked(async (req, res) => {
  const r = await require('../../../../services/hr/workday').cancelLeave(me(req), req.params.id);
  return r.ok ? ok(res, r.leave, 'Request cancelled.') : bad(res, r.error);
});

// Attachment of my own leave.
const attachment = async (req, res) => {
  const l = await mongoose.model('LeaveRequest').findOne({ _id: req.params.id, removed: false }).lean();
  if (!l || !l.attachmentId) return bad(res, 'No attachment.', 404);
  const isAdmin = require('./admin').isErpAdmin(req);
  if (!isAdmin && String(l.adminId) !== String(req.admin._id)) return bad(res, 'Not allowed.', 403);
  const f = await mongoose.model('ErpFile').findById(l.attachmentId).lean();
  if (!f) return bad(res, 'File not found.', 404);
  res.setHeader('Content-Type', f.mime || 'application/octet-stream');
  res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(f.name || 'attachment')}"`);
  return res.send(Buffer.from(f.data.buffer || f.data));
};

// GET /me/calendar?month=YYYY-MM
const calendar = tracked(async (req, res) => {
  const a = me(req);
  const now = new Date();
  const S = await E.getSettings();
  const m = String(req.query.month || E.todayKey().slice(0, 7)).slice(0, 7);
  const from = `${m}-01`;
  const last = new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)), 0)).getUTCDate();
  const to = `${m}-${String(last).padStart(2, '0')}`;
  const [tot, leaves, hol] = await Promise.all([E.totalsByAdminDay(from, to, [a._id]), E.leavesBetween(from, to, { adminIds: [a._id], statuses: ['Approved', 'Pending'] }), E.holidayKeys(from, to)]);
  const days = [];
  for (let d = from; d <= to; d = E.addDays(d, 1)) {
    const x = tot[`${a._id}|${d}`];
    const approved = E.leaveOnDay(leaves.filter((l) => l.status === 'Approved'), a._id, d, S);
    const pending = E.leaveOnDay(leaves.filter((l) => l.status === 'Pending'), a._id, d, S);
    const st = E.dayStatus(x && x.session, x ? x.totals : E.totalsOf(null, []), { dayKey: d, S, now, leave: approved, holiday: hol[d], weeklyOff: S.weeklyOff.includes(E.weekday(d)) });
    days.push({ dayKey: d, status: st.status, tags: st.tags, work: x ? x.totals.work : 0, holiday: hol[d] || null, leave: approved ? approved.leaveType : null, pending: pending ? pending.leaveType : null, weeklyOff: S.weeklyOff.includes(E.weekday(d)) });
  }
  const done = days.filter((d) => d.work > 0);
  return ok(res, {
    month: m,
    days,
    summary: {
      present: days.filter((d) => ['Present', 'Short', 'Online', 'Inactive', 'Lunch', 'Break', 'Offline'].includes(d.status)).length,
      late: days.filter((d) => d.tags.includes('Late')).length,
      leave: days.filter((d) => d.status === 'Leave').length,
      avgWork: done.length ? Math.round(done.reduce((n, d) => n + d.work, 0) / done.length) : 0,
    },
  });
});

const profile = tracked(async (req, res) => {
  const a = await mongoose.model('Admin').findById(req.admin._id).select('name surname email role phone photo created reportsTo').lean();
  const p = (await profileOf(a._id)) || {};
  const rep = p.reportsTo || a.reportsTo;
  const reports = rep ? await mongoose.model('Admin').findById(rep).select('name surname').lean() : null;
  const S = await E.getSettings();
  const s = await mongoose.model('ErpSession').findOne({ admin: a._id, dayKey: E.todayKey() }).lean();
  const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  return ok(res, {
    name: E.fullName(a),
    email: a.email,
    role: a.role,
    photo: a.photo,
    employeeCode: p.employeeCode || '',
    department: p.department || '',
    designation: p.designation || a.role,
    joiningDate: p.joiningDate || a.created,
    reportsTo: reports ? E.fullName(reports) : '',
    shift: `${p.shiftName || 'General'} ${S.workStart} – ${S.workEnd}`,
    weeklyOff: S.weeklyOff.map((d) => DAYS[d]).join(', '),
    signedIn: s && s.loginAt ? { at: s.loginAt, device: s.device } : null,
  });
});

const notifications = async (req, res) => {
  const list = await mongoose.model('Notification').find({ recipient: req.admin._id, removed: false }).sort({ created: -1 }).limit(40).lean();
  return ok(res, { list, unread: list.filter((n) => !n.readAt).length });
};
const notificationsReadAll = async (req, res) => {
  await mongoose.model('Notification').updateMany({ recipient: req.admin._id, readAt: null }, { $set: { readAt: new Date() } });
  return ok(res, true, 'All marked as read.');
};

// GET /me/idle?date= — my "no input for 5 min" records
const idle = tracked(async (req, res) => {
  const dk = String(req.query.date || E.todayKey()).slice(0, 10);
  if (dk === E.todayKey()) await V.refreshOpen([req.admin._id]);
  const list = await mongoose.model('ErpActivity').find({ admin: req.admin._id, dayKey: dk, type: 'INACTIVE' }).sort({ startAt: 1 }).lean();
  const now = new Date();
  return ok(res, {
    dayKey: dk,
    list: list.map((p) => ({ ...p, minutes: Math.round(E.minsBetween(p.startAt, p.endAt || now)) })),
    total: Math.round(list.filter((p) => !p.countedAsWork).reduce((n, p) => n + E.minsBetween(p.startAt, p.endAt || now), 0)),
  });
});
const idleNote = tracked(async (req, res) => {
  const note = String((req.body && req.body.note) || '').trim().slice(0, 300);
  if (!note) return bad(res, 'Write a note.');
  const p = await mongoose.model('ErpActivity').findOneAndUpdate({ _id: req.params.id, admin: req.admin._id, type: 'INACTIVE' }, { $set: { employeeNote: note } }, { new: true });
  if (!p) return bad(res, 'Record not found.', 404);
  require('../../../../notify').notify({ audience: 'management', actorId: req.admin._id, actorName: E.fullName(req.admin), module: 'HRMS', type: 'erp.idle-note', title: 'Note on an inactive time', body: `${E.fullName(req.admin)} · ${E.hmOf(p.startAt)}–${E.hmOf(p.endAt) || 'now'}: ${note}`, link: '/hr/work-tracker' });
  return ok(res, p, 'Note sent to HR.');
});

const reviewNote = tracked(async (req, res) => {
  const note = String((req.body && req.body.note) || '').trim().slice(0, 500);
  if (!note) return bad(res, 'Write a note.');
  const s = await mongoose.model('ErpSession').findOneAndUpdate({ admin: req.admin._id, dayKey: String(req.body.dayKey || ''), status: 'needs_review' }, { $set: { reviewNote: note } }, { new: true });
  if (!s) return bad(res, 'Session not found.', 404);
  require('../../../../notify').notify({ audience: 'management', actorId: req.admin._id, actorName: E.fullName(req.admin), module: 'HRMS', type: 'erp.review-note', title: 'Note on a session to review', body: `${E.fullName(req.admin)} · ${s.dayKey}: ${note}`, link: '/hr/work-tracker' });
  return ok(res, true, 'Note sent to HR.');
});

// POST /me/report { dayKey, note } — "Report a problem" on a day (My Attendance)
const report = tracked(async (req, res) => {
  const note = String((req.body && req.body.note) || '').trim().slice(0, 500);
  const dk = String((req.body && req.body.dayKey) || '').slice(0, 10);
  if (!note || !/^\d{4}-\d{2}-\d{2}$/.test(dk)) return bad(res, 'Write what is wrong.');
  await mongoose.model('ErpSession').updateOne({ admin: req.admin._id, dayKey: dk }, { $set: { reviewNote: note } });
  require('../../../../notify').notify({ audience: 'management', actorId: req.admin._id, actorName: E.fullName(req.admin), module: 'HRMS', type: 'erp.report', title: 'Attendance problem reported', body: `${E.fullName(req.admin)} · ${dk}: ${note}`, link: '/hr/work-tracker' });
  return ok(res, true, 'Sent to HR.');
});

const agent = tracked(async (req, res) => {
  const list = await mongoose.model('ErpDevice').find({ admin: req.admin._id, revoked: false }).select('-tokenHash').lean();
  return ok(res, list.map((x) => ({ ...x, online: x.lastSeenAt && Date.now() - new Date(x.lastSeenAt) < 2 * 60000 })));
});

module.exports = { today, start, heartbeat, breakStart, breakEnd, logout, attendance, dayDetail, leaves, applyLeave, cancelLeave, attachment, calendar, profile, notifications, notificationsReadAll, idle, idleNote, reviewNote, report, agent };
