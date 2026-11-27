const mongoose = require('mongoose');
const E = require('./erpAttendance');

// Read models for the Attendance ERP screens (admin + /employee portal):
// one employee's day, every employee's day, a month per employee. All
// numbers are minutes; the frontend formats them.

const lean = (q) => q.lean();

// Bring open sessions up to date before reading them (works without the job).
async function refreshOpen(adminIds, now = new Date()) {
  const S = await E.getSettings();
  const q = { dayKey: E.todayKey(now), status: { $nin: ['logged_out', 'needs_review'] } };
  if (adminIds) q.admin = { $in: adminIds };
  const open = await mongoose.model('ErpSession').find(q).select('_id admin').lean();
  for (const o of open) {
    await E.withLock(o.admin, async () => {
      const s = await mongoose.model('ErpSession').findById(o._id);
      if (!s || ['logged_out', 'needs_review'].includes(s.status)) return;
      const before = s.status;
      await E.advance(s, now, S);
      await s.save();
      if (before !== s.status) E.emitChange(s);
    });
  }
  // yesterday's still-open sessions → needs review
  const stale = await mongoose
    .model('ErpSession')
    .find({ dayKey: { $lt: E.todayKey(now) }, status: { $nin: ['logged_out', 'needs_review'] }, ...(adminIds ? { admin: { $in: adminIds } } : {}) })
    .select('admin')
    .lean();
  for (const s of stale) await E.withLock(s.admin, () => E.closeStaleFor(s.admin, S, now));
}

function timelineOf(session, periods, now) {
  const items = [];
  if (!session) return items;
  const open = !['logged_out', 'needs_review'].includes(session.status);
  if (session.loginAt) items.push({ kind: 'login', at: session.loginAt, title: 'Login', note: [session.device && session.device.browser, session.device && session.device.os].filter(Boolean).join(' on ') });
  periods.forEach((p) => {
    const end = p.endAt || (open ? now : p.startAt);
    items.push({
      kind: p.type,
      _id: p._id,
      at: p.startAt,
      end: p.endAt,
      open: !p.endAt,
      minutes: Math.round(E.minsBetween(p.startAt, end)),
      label: p.label,
      auto: p.auto,
      lastInputAt: p.lastInputAt,
      laptop: p.laptop,
      source: p.source,
      employeeNote: p.employeeNote,
      countedAsWork: p.countedAsWork,
      countedBy: p.countedBy,
      countedReason: p.countedReason,
    });
  });
  if (session.logoutAt) items.push({ kind: 'logout', at: session.logoutAt, title: 'Logout', note: { manual: 'Clicked Logout · session closed cleanly', auth: 'Signed out of the CRM', admin: 'Closed by an admin', auto: 'Closed automatically' }[session.logoutType] || '' });
  if (session.status === 'needs_review') items.push({ kind: 'review', at: session.lastHeartbeatAt || session.loginAt, title: 'Never logged out', note: 'Needs review' });
  return items;
}

// One employee, one day.
async function day(adminId, dayKey, now = new Date()) {
  const S = await E.getSettings();
  if (dayKey === E.todayKey(now)) await refreshOpen([adminId], now);
  const session = await lean(mongoose.model('ErpSession').findOne({ admin: adminId, dayKey }));
  const periods = session ? await lean(mongoose.model('ErpActivity').find({ session: session._id }).sort({ startAt: 1 })) : [];
  const totals = E.totalsOf(session, periods, now);
  const [leaves, hol] = await Promise.all([E.leavesBetween(dayKey, dayKey, { adminIds: [adminId] }), E.holidayKeys(dayKey, dayKey)]);
  const leave = E.leaveOnDay(leaves, adminId, dayKey, S);
  const st = E.dayStatus(session, totals, { dayKey, S, now, leave, holiday: hol[dayKey], weeklyOff: S.weeklyOff.includes(E.weekday(dayKey)) });
  return { dayKey, session, periods, totals, ...st, leave, holiday: hol[dayKey] || null, required: S.requiredMin, remaining: Math.max(0, S.requiredMin - totals.work), timeline: timelineOf(session, periods, now) };
}

// Every tracked employee on one day (admin Attendance / Dashboard / Live).
async function dayRows(dayKey, now = new Date(), employees) {
  const S = await E.getSettings();
  const emps = employees || (await E.trackedEmployees());
  if (dayKey === E.todayKey(now)) await refreshOpen(null, now);
  const ids = emps.map((e) => e._id);
  const [tot, leaves, hol] = await Promise.all([E.totalsByAdminDay(dayKey, dayKey, ids), E.leavesBetween(dayKey, dayKey, { adminIds: ids }), E.holidayKeys(dayKey, dayKey)]);
  const weeklyOff = S.weeklyOff.includes(E.weekday(dayKey));
  return emps.map((e) => {
    const x = tot[`${e._id}|${dayKey}`] || { session: null, totals: E.totalsOf(null, [], now), periods: [] };
    const leave = E.leaveOnDay(leaves, e._id, dayKey, S);
    const st = E.dayStatus(x.session, x.totals, { dayKey, S, now, leave, holiday: hol[dayKey], weeklyOff });
    const openP = x.periods.find((p) => !p.endAt);
    const s = x.session;
    return {
      employee: e,
      dayKey,
      session: s
        ? {
            _id: s._id,
            loginAt: s.loginAt,
            logoutAt: s.logoutAt,
            logoutType: s.logoutType,
            status: s.status,
            lastActivityAt: s.lastActivityAt,
            lastHeartbeatAt: s.lastHeartbeatAt,
            lastKbAt: s.lastKbAt,
            lastMouseAt: s.lastMouseAt,
            currentBreak: s.currentBreak,
            manual: s.manual,
            device: s.device,
            since: openP ? openP.startAt : null,
          }
        : null,
      totals: x.totals,
      status: st.status,
      tags: st.tags,
      live: st.live,
      leave: leave ? { leaveType: leave.leaveType, days: leave.days } : null,
      remaining: Math.max(0, S.requiredMin - x.totals.work),
      required: S.requiredMin,
    };
  });
}

// Per-employee month summary (Reports, My Attendance summary).
async function monthRows(monthKey, employees, now = new Date()) {
  const S = await E.getSettings();
  const from = `${monthKey}-01`;
  const lastDay = new Date(Date.UTC(Number(monthKey.slice(0, 4)), Number(monthKey.slice(5, 7)), 0)).getUTCDate();
  const monthEnd = `${monthKey}-${String(lastDay).padStart(2, '0')}`;
  const tk = E.todayKey(now);
  const to = monthEnd < tk ? monthEnd : tk;
  const ids = employees.map((e) => e._id);
  if (from > to) return { from, to: monthEnd, workingDays: 0, rows: employees.map((e) => ({ employee: e, workingDays: 0, present: 0, absent: 0, leaves: 0, halfDays: 0, lateDays: 0, short: 0, workMin: 0, avgMin: 0, overtimeMin: 0, inactiveMin: 0 })) };
  const [wdays, tot, leaves, hol] = await Promise.all([E.workingDays(from, to, S), E.totalsByAdminDay(from, to, ids), E.leavesBetween(from, to, { adminIds: ids }), E.holidayKeys(from, to)]);
  const rows = employees.map((e) => {
    const r = { employee: e, workingDays: wdays.length, present: 0, absent: 0, leaves: 0, halfDays: 0, lateDays: 0, short: 0, workMin: 0, attended: 0, overtimeMin: 0, inactiveMin: 0 };
    for (let d = from; d <= to; d = E.addDays(d, 1)) {
      const x = tot[`${e._id}|${d}`];
      const leave = E.leaveOnDay(leaves, e._id, d, S);
      const st = E.dayStatus(x && x.session, x ? x.totals : E.totalsOf(null, []), { dayKey: d, S, now, leave, holiday: hol[d], weeklyOff: S.weeklyOff.includes(E.weekday(d)) });
      if (x && x.session && x.session.loginAt) {
        r.workMin += x.totals.work;
        r.inactiveMin += x.totals.inactive;
        r.attended += 1;
        r.overtimeMin += Math.max(0, x.totals.work - S.requiredMin);
      }
      if (st.tags.includes('Late')) r.lateDays += 1;
      if (['Present', 'Online', 'Inactive', 'Lunch', 'Break', 'Offline'].includes(st.status)) r.present += 1;
      else if (st.status === 'Short') {
        r.present += 1;
        r.short += 1;
      } else if (st.status === 'Half Day') r.halfDays += 1;
      else if (st.status === 'Leave') r.leaves += 1;
      else if (st.status === 'Absent' && wdays.includes(d)) r.absent += 1;
      else if (st.status === 'Needs review') r.present += 1;
    }
    r.avgMin = r.attended ? Math.round(r.workMin / r.attended) : 0;
    return r;
  });
  return { from, to: monthEnd, workingDays: wdays.length, rows };
}

module.exports = { refreshOpen, day, dayRows, monthRows, timelineOf };
