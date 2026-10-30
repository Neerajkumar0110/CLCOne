const crypto = require('crypto');
const mongoose = require('mongoose');
const shiftSchedule = require('../../config/shiftSchedule');
const { istDateKey } = require('../calling/shiftHelpers');
const { logActivity } = require('../activity/agentActivity');
const { SALES_ROLES } = require('../../config/roles');

// The working day, end to end:
//   header Login  → WorkSession + auto-dialer ON (Sales)
//   breaks        → dialer paused for the break, back on after
//   Logout        → dialer OFF
//   11:00         → anyone in Sales not logged in is put on the dialer anyway
//   leave         → applied from the header calendar, emailed to the approver
//                   with one-click Approve / Reject; approved leave keeps the
//                   dialer off for exactly that window (1–2 h, half / full day)
//   holiday       → HR's Holiday list: shown to everyone, no auto-start
// Every step lands in AgentActivity so the admin tracker can replay a day.

const W = shiftSchedule.workday;
const APPROVER_EMAIL = () => process.env.LEAVE_APPROVER_EMAIL || 'neeraj@careerlabconsulting.com';
const PUBLIC_BASE = () =>
  (process.env.PUBLIC_API_BASE_URL || process.env.PLIVO_PUBLIC_BASE_URL || 'https://clcone.careerlabconsulting.com').replace(/\/+$/, '');

const Session = () => mongoose.model('WorkSession');
const Leave = () => mongoose.model('LeaveRequest');
const fullName = (a) => (a ? `${a.name || ''} ${a.surname || ''}`.trim() : '');
const isSales = (a) => !!a && SALES_ROLES.includes(a.role);

// IST wall-clock → Date. dayKey 'YYYY-MM-DD', hm 'HH:mm'.
const istAt = (dayKey, hm = '00:00') => new Date(`${dayKey}T${hm}:00+05:30`);
const todayKey = () => istDateKey(new Date());
const dayBounds = (dayKey) => ({ start: istAt(dayKey, '00:00'), end: new Date(istAt(dayKey, '00:00').getTime() + 864e5 - 1) });
const weekday = (dayKey) => istAt(dayKey, '12:00').getUTCDay();
const fmtTime = (d) => new Date(d).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: 'numeric', minute: '2-digit' });
const fmtDay = (d) => new Date(d).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', weekday: 'short', day: 'numeric', month: 'short' });

// ── calendar facts ───────────────────────────────────────────────────────
async function holidayOn(dayKey) {
  const { start, end } = dayBounds(dayKey);
  return mongoose.model('Holiday').findOne({ removed: false, date: { $gte: start, $lte: end } }).select('name type date').lean();
}

async function holidaysBetween(from, to) {
  return mongoose
    .model('Holiday')
    .find({ removed: false, date: { $gte: from, $lte: to } })
    .select('name type date')
    .sort({ date: 1 })
    .lean();
}

// Approved leave covering `at` (a Date) for this user.
async function activeLeave(adminId, at = new Date()) {
  return Leave().findOne({ removed: false, adminId: String(adminId), status: 'Approved', fromDate: { $lte: at }, toDate: { $gte: at } }).lean();
}

// Approved leave that takes the WHOLE working day off (full / multi-day, or
// both halves) — the dialer isn't started at all that day.
async function fullDayLeave(adminId, dayKey) {
  const ws = istAt(dayKey, W.start);
  const we = istAt(dayKey, W.end);
  return Leave().findOne({ removed: false, adminId: String(adminId), status: 'Approved', fromDate: { $lte: ws }, toDate: { $gte: we } }).lean();
}

// A real login (not one rebuilt from dialer activity) after the late-login
// cut-offs: after halfDayAfter = half day, after fullDayAfter = full-day
// leave. A day already covered by approved part-day leave isn't penalised.
// → null | { kind: 'half-day' | 'late-leave', leave: 0.5 | 1, label }
function lateLoginPenalty(dayKey, loginAt, { derived = false, leaveDay = 0 } = {}) {
  const rule = W.lateLogin;
  if (!rule || !loginAt || derived || leaveDay > 0) return null;
  const at = new Date(loginAt);
  if (rule.fullDayAfter && at > istAt(dayKey, rule.fullDayAfter)) return { kind: 'late-leave', leave: 1, label: `Full-day leave (logged in after ${rule.fullDayAfter})` };
  if (rule.halfDayAfter && at > istAt(dayKey, rule.halfDayAfter)) return { kind: 'half-day', leave: 0.5, label: `Half day (logged in after ${rule.halfDayAfter})` };
  return null;
}

async function dayOff(admin, dayKey) {
  if (W.weeklyOff.includes(weekday(dayKey))) return { kind: 'weekly-off', label: 'Weekly off' };
  const h = await holidayOn(dayKey);
  if (h) return { kind: 'holiday', label: h.name, holiday: h };
  const l = admin ? await fullDayLeave(admin._id, dayKey) : null;
  if (l) return { kind: 'leave', label: `On leave (${l.leaveType})`, leave: l };
  return null;
}

// ── dialer helpers ───────────────────────────────────────────────────────
const poolCtl = () => require('../../controllers/appControllers/operation/callingController/leadPool');

async function poolState(adminId) {
  return mongoose.model('AgentCallState').findOne({ agent: adminId }).select('status campaign pausedUntil breakKey').lean();
}
const inPool = (st) => !!(st && st.campaign && st.status !== 'Offline');

// Turn the dialer on for a Sales user unless today is off for them; then
// apply any approved hourly / half-day leave running right now.
async function startDialer(admin, by, why) {
  if (!isSales(admin)) return { started: false, reason: 'not-sales' };
  const off = await dayOff(admin, todayKey());
  if (off) return { started: false, reason: off.label };
  await poolCtl().setPoolMembership(admin, true, by);
  await enforceLeave(admin);
  return { started: true, why };
}

// Approved leave running now → pause the dialer until it ends (or switch it
// off for a whole-day leave). Idempotent.
async function enforceLeave(admin, now = new Date()) {
  const l = await activeLeave(admin._id, now);
  if (!l) return false;
  const st = await poolState(admin._id);
  if (!inPool(st)) return false;
  if (await fullDayLeave(admin._id, istDateKey(now))) {
    await poolCtl().setPoolMembership(admin, false, null);
    logActivity(admin, 'leave_pause', { detail: `Dialer off — ${l.leaveType} leave today` });
    return true;
  }
  if (st.status === 'Paused' && st.breakKey === 'leave') return false;
  if (['Ringing', 'OnCall'].includes(st.status)) return false; // let the live call finish; next tick pauses
  await mongoose
    .model('AgentCallState')
    .updateOne({ agent: admin._id }, { $set: { status: 'Paused', pausedUntil: new Date(l.toDate), breakKey: 'leave', since: now } });
  logActivity(admin, 'leave_pause', { detail: `Dialer paused until ${fmtTime(l.toDate)} — ${l.leaveType} leave` });
  return true;
}

// ── session ──────────────────────────────────────────────────────────────
async function getSession(adminId, dayKey = todayKey()) {
  return Session().findOne({ admin: adminId, dayKey }).lean();
}

async function login(admin) {
  const dayKey = todayKey();
  const now = new Date();
  const s = await Session().findOneAndUpdate(
    { admin: admin._id, dayKey },
    {
      $setOnInsert: { admin: admin._id, dayKey, created: now },
      $set: { adminName: fullName(admin), role: admin.role, updated: now },
      $unset: { logoutAt: '' },
    },
    { upsert: true, new: true }
  );
  if (!s.loginAt) {
    s.loginAt = now;
    if (!s.startSource) s.startSource = 'login';
    await s.save();
  }
  logActivity(admin, 'shift_login', { by: admin, detail: s.autoStartedAt ? 'after 11:00 auto-start' : 'header Login' });
  const dialer = await startDialer(admin, admin, 'login');
  return { session: s.toObject(), dialer };
}

// A break runs until the user ends it or its planned length passes (the
// dialer tick resumes them then without touching the session) — so an
// unended break past its planned end counts as ended at that point.
const plannedEnd = (b) => new Date(new Date(b.startAt).getTime() + (b.plannedMin || 0) * 60000);
function settleBreaks(s, now) {
  for (const b of s.breaks || []) if (!b.endAt && now >= plannedEnd(b)) b.endAt = plannedEnd(b);
  return (s.breaks || []).find((b) => !b.endAt) || null;
}
async function closeOpenBreak(s, now) {
  const open = settleBreaks(s, now);
  if (open) open.endAt = now;
  return open;
}

// When the user's dialer first came on that day (pool_on), else their first
// call, else the 11:00 auto-start — the start of a day with no Login.
async function firstActivityAt(adminId, dayKey) {
  const { start, end } = dayBounds(dayKey);
  const [on, call, s] = await Promise.all([
    mongoose.model('AgentActivity').findOne({ agent: adminId, kind: 'pool_on', at: { $gte: start, $lte: end } }).sort({ at: 1 }).select('at').lean(),
    mongoose.model('CallRecord').findOne({ removed: false, agent: adminId, created: { $gte: start, $lte: end } }).sort({ created: 1 }).select('created').lean(),
    Session().findOne({ admin: adminId, dayKey }).select('autoStartedAt').lean(),
  ]);
  const cands = [on && on.at, call && call.created, s && s.autoStartedAt].filter(Boolean).map((d) => new Date(d));
  return cands.length ? new Date(Math.min(...cands)) : null;
}

// Management (Sales 360°) marks a day present for someone who never pressed
// Login — loginAt becomes when their dialer first came on that day.
async function markPresent(adminId, dayKey, by) {
  const admin = await mongoose.model('Admin').findOne({ _id: adminId, removed: false }).select('name surname role').lean();
  if (!admin) return { ok: false, error: 'User not found.' };
  const s = await Session().findOne({ admin: adminId, dayKey }).lean();
  if (s && s.loginAt && !s.markedPresentBy) return { ok: false, error: 'They already logged in that day.' };
  const at = (await firstActivityAt(adminId, dayKey)) || istAt(dayKey, W.start);
  const now = new Date();
  const session = await Session().findOneAndUpdate(
    { admin: adminId, dayKey },
    {
      $setOnInsert: { admin: adminId, dayKey, created: now },
      $set: { adminName: fullName(admin), role: admin.role, loginAt: at, startSource: 'manager', markedPresentBy: by.name, markedPresentAt: now, updated: now },
    },
    { upsert: true, new: true }
  ).lean();
  logActivity(admin, 'marked_present', { by: by.id ? { _id: by.id, name: by.name } : null, detail: `${dayKey} marked present by ${by.name} — start ${fmtTime(at)}` });
  require('../../notify').notifyUser({
    recipient: admin._id,
    actorId: by.id || null,
    actorName: by.name,
    module: 'HRMS',
    type: 'attendance.marked',
    title: 'You were marked present',
    body: `${dayKey} — by ${by.name} (from ${fmtTime(at)}, when your dialer came on).`,
    link: '/',
  });
  return { ok: true, session };
}

// Management (or the tick) pops the "please log in" prompt on the user's screen now.
function remindLogin(adminId, by) {
  try {
    require('../../socket').emitCallToAgent(adminId, 'workday:remind-login', { by: by ? by.name : null, at: new Date() });
    return true;
  } catch (e) {
    return false;
  }
}

// After the shift (end + 30 min): logged in today, never logged out → email
// them once (WorkSession.logoutReminderAt).
async function logoutReminderTick(now = new Date()) {
  const dayKey = todayKey();
  if (now < new Date(istAt(dayKey, W.end).getTime() + 30 * 60000)) return 0;
  const { mailReady, sendMailWithRetry } = require('../mail/transport');
  if (!mailReady()) return 0;
  const open = await Session().find({ dayKey, loginAt: { $ne: null }, logoutAt: null, logoutReminderAt: null }).lean();
  let sent = 0;
  for (const s of open) {
    const a = await mongoose.model('Admin').findOne({ _id: s.admin, removed: false, enabled: true }).select('name surname email role').lean();
    if (!a || !a.email || !isSales(a)) continue;
    await Session().updateOne({ _id: s._id }, { $set: { logoutReminderAt: now } });
    await sendMailWithRetry({
      from: `"CLC One" <${process.env.GMAIL_USER}>`,
      to: a.email,
      subject: `You didn't log out today — ${dayKey}`,
      html: `<div style="font-family:Segoe UI,Arial,sans-serif;max-width:520px;margin:auto;padding:24px;border:1px solid #e2e8f0;border-radius:14px">
        <h2 style="margin:0 0 6px;color:#0f172a">You didn't log out today</h2>
        <p style="margin:0 0 14px;color:#475569">Hi ${escapeHtml(a.name)}, you logged in at <b>${fmtTime(s.loginAt)}</b> but never pressed <b>Logout</b>. Your working time is counted to the end of the shift (${W.end}).</p>
        <p style="margin:0;color:#475569">Please press <b>Logout</b> in CLC One at the end of every working day.</p>
      </div>`,
    }).catch((e) => console.error('[workday] logout reminder email failed:', e.message));
    sent += 1;
  }
  return sent;
}

async function logout(admin) {
  const now = new Date();
  const s = await Session().findOne({ admin: admin._id, dayKey: todayKey() });
  if (s) {
    await closeOpenBreak(s, now);
    s.logoutAt = now;
    s.updated = now;
    await s.save();
  }
  if (inPool(await poolState(admin._id))) await poolCtl().setPoolMembership(admin, false, admin);
  logActivity(admin, 'shift_logout', { by: admin });
  return s ? s.toObject() : null;
}

async function startBreak(admin, key) {
  const def = shiftSchedule.breaks.find((b) => b.key === key);
  if (!def) return { ok: false, error: 'Unknown break.' };
  const now = new Date();
  const s = await Session().findOne({ admin: admin._id, dayKey: todayKey() });
  if (!s || !s.loginAt || s.logoutAt) return { ok: false, error: 'Log in first.' };
  if (settleBreaks(s, now)) return { ok: false, error: 'You are already on a break.' };
  if ((s.breaks || []).some((b) => b.key === key)) return { ok: false, error: `You've already taken today's ${def.label}.` };
  s.breaks.push({ key, label: def.label, plannedMin: def.durationMin, startAt: now });
  s.updated = now;
  await s.save();

  const st = await poolState(admin._id);
  if (inPool(st) && !['Ringing', 'OnCall'].includes(st.status)) {
    await mongoose.model('AgentCallState').updateOne(
      { agent: admin._id },
      {
        $set: { status: 'Paused', pausedUntil: new Date(now.getTime() + def.durationMin * 60000), breakKey: key, since: now },
        $addToSet: { breaksTakenToday: key },
        $inc: { breakMinutesToday: def.durationMin },
      }
    );
  }
  logActivity(admin, 'break_start', { by: admin, detail: `${def.label} · ${def.durationMin} min` });
  return { ok: true, session: s.toObject(), label: def.label, until: new Date(now.getTime() + def.durationMin * 60000) };
}

async function endBreak(admin) {
  const now = new Date();
  const s = await Session().findOne({ admin: admin._id, dayKey: todayKey() });
  const open = s ? await closeOpenBreak(s, now) : null;
  if (!open) return { ok: false, error: 'You are not on a break.' };
  s.updated = now;
  await s.save();
  const r = await mongoose
    .model('AgentCallState')
    .updateOne({ agent: admin._id, status: 'Paused', breakKey: open.key }, { $set: { status: 'Available', since: now }, $unset: { pausedUntil: '', breakKey: '' } });
  logActivity(admin, 'break_end', { by: admin, detail: `${open.label} ended early` });
  if (r.modifiedCount) await enforceLeave(admin);
  return { ok: true, session: s.toObject() };
}

// ── leave ────────────────────────────────────────────────────────────────
// body: { durationType: hours|half|full|multi, date, toDate?, hours?, fromTime?, halfPart?, leaveType, reason }
function leaveWindow(b) {
  const date = String(b.date || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { error: 'Pick a date.' };
  if (b.durationType === 'hours') {
    const hours = Math.min(8, Math.max(1, Number(b.hours) || 1));
    const fromTime = /^\d{2}:\d{2}$/.test(b.fromTime || '') ? b.fromTime : W.start;
    const from = istAt(date, fromTime);
    return { from, to: new Date(from.getTime() + hours * 3600e3), days: Math.round((hours / 8) * 100) / 100, hours, fromTime };
  }
  if (b.durationType === 'half') {
    const second = b.halfPart === 'second';
    return { from: istAt(date, second ? W.halfSplit : W.start), to: istAt(date, second ? W.end : W.halfSplit), days: 0.5, halfPart: second ? 'second' : 'first' };
  }
  if (b.durationType === 'multi') {
    const toDate = String(b.toDate || '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(toDate) || toDate < date) return { error: 'Pick an end date on or after the start date.' };
    const days = Math.round((istAt(toDate) - istAt(date)) / 864e5) + 1;
    if (days > 60) return { error: 'At most 60 days at once.' };
    return { from: istAt(date, '00:00'), to: dayBounds(toDate).end, days };
  }
  return { from: istAt(date, '00:00'), to: dayBounds(date).end, days: 1, durationType: 'full' };
}

const LEAVE_TYPES = ['Casual', 'Sick', 'Earned', 'Unpaid', 'Comp Off', 'Maternity', 'Paternity', 'Bereavement'];

function durationLabel(l) {
  if (l.durationType === 'hours') return `${l.hours} hour${l.hours === 1 ? '' : 's'} · ${fmtDay(l.fromDate)}, ${fmtTime(l.fromDate)}–${fmtTime(l.toDate)}`;
  if (l.durationType === 'half') return `Half day (${l.halfPart === 'second' ? 'second' : 'first'} half) · ${fmtDay(l.fromDate)}`;
  if (l.durationType === 'multi') return `${l.days} days · ${fmtDay(l.fromDate)} – ${fmtDay(l.toDate)}`;
  return `Full day · ${fmtDay(l.fromDate)}`;
}

async function applyLeave(admin, b) {
  const win = leaveWindow(b);
  if (win.error) return { ok: false, error: win.error };
  if (win.to < new Date()) return { ok: false, error: 'That time has already passed.' };
  const overlap = await Leave().findOne({
    removed: false,
    adminId: String(admin._id),
    status: { $in: ['Pending', 'Approved'] },
    fromDate: { $lt: win.to },
    toDate: { $gt: win.from },
  }).lean();
  if (overlap) return { ok: false, error: `You already have a ${overlap.status.toLowerCase()} leave in that time (${durationLabel(overlap)}).` };

  const token = crypto.randomBytes(24).toString('hex');
  const leave = await Leave().create({
    employee: fullName(admin) || admin.email,
    department: isSales(admin) ? 'Sales' : undefined,
    leaveType: LEAVE_TYPES.includes(b.leaveType) ? b.leaveType : 'Casual',
    fromDate: win.from,
    toDate: win.to,
    days: win.days,
    halfDay: b.durationType === 'half',
    reason: String(b.reason || '').slice(0, 1000),
    status: 'Pending',
    appliedOn: new Date(),
    adminId: String(admin._id),
    durationType: ['hours', 'half', 'multi'].includes(b.durationType) ? b.durationType : 'full',
    hours: win.hours,
    halfPart: win.halfPart,
    fromTime: win.fromTime,
    approver: APPROVER_EMAIL(),
    decisionToken: token,
  });
  logActivity(admin, 'leave_applied', { by: admin, detail: `${leave.leaveType} · ${durationLabel(leave)}` });
  sendLeaveEmail(admin, leave).catch((e) => console.error('[leave] email failed:', e.message));
  // Real-time to management (bell + popup), alongside the approver email.
  require('../../notify').notify({
    audience: 'management',
    actorId: admin._id,
    actorName: fullName(admin),
    module: 'HRMS',
    type: 'leave.applied',
    title: `${fullName(admin)} applied for leave`,
    body: `${leave.leaveType} · ${durationLabel(leave)}${leave.reason ? ` — ${leave.reason.slice(0, 120)}` : ''}`,
    link: '/hr/work-tracker',
  });
  return { ok: true, leave };
}

function escapeHtml(s) {
  return String(s || '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
}

async function sendLeaveEmail(admin, leave) {
  const { mailReady, sendMailWithRetry } = require('../mail/transport');
  if (!mailReady()) return;
  const link = (action) => `${PUBLIC_BASE()}/api/workday-public/leave-decision?id=${leave._id}&token=${leave.decisionToken}&action=${action}`;
  const btn = (href, bg, label) =>
    `<a href="${href}" style="display:inline-block;padding:12px 26px;border-radius:10px;background:${bg};color:#fff;font-weight:700;text-decoration:none;margin-right:10px">${label}</a>`;
  const row = (k, v) => `<tr><td style="padding:6px 0;color:#64748b;width:130px">${k}</td><td style="padding:6px 0;color:#0f172a;font-weight:600">${v}</td></tr>`;
  await sendMailWithRetry({
    from: `"CLC One" <${process.env.GMAIL_USER}>`,
    to: APPROVER_EMAIL(),
    subject: `Leave request — ${fullName(admin)} · ${durationLabel(leave)}`,
    html: `<div style="font-family:Segoe UI,Arial,sans-serif;max-width:560px;margin:auto;padding:24px;border:1px solid #e2e8f0;border-radius:14px">
      <h2 style="margin:0 0 4px;color:#0f172a">Leave request</h2>
      <p style="margin:0 0 18px;color:#64748b">${escapeHtml(fullName(admin))} (${escapeHtml(admin.role || '')}) has applied for leave.</p>
      <table style="width:100%;border-collapse:collapse;font-size:14px">
        ${row('Employee', escapeHtml(fullName(admin)))}
        ${row('Type', escapeHtml(leave.leaveType))}
        ${row('When', escapeHtml(durationLabel(leave)))}
        ${row('Reason', escapeHtml(leave.reason || '—'))}
      </table>
      <div style="margin:24px 0 8px">${btn(link('approve'), '#16a34a', 'Approve')}${btn(link('reject'), '#dc2626', 'Reject')}</div>
      <p style="color:#94a3b8;font-size:12px;margin-top:18px">You can also decide from CLC One → HRMS → Work &amp; Leave Tracker.</p>
    </div>`,
  });
}

// action: approve|reject. by = { name, id? }. Returns { ok, leave } or { ok:false, error }.
async function decideLeave(leaveId, action, by, note) {
  const leave = await Leave().findOne({ _id: leaveId, removed: false });
  if (!leave) return { ok: false, error: 'Leave request not found.' };
  if (leave.status !== 'Pending') return { ok: false, error: `This leave is already ${leave.status.toLowerCase()}.`, leave };
  const approved = action === 'approve';
  leave.status = approved ? 'Approved' : 'Rejected';
  leave.decisionDate = new Date();
  leave.decisionBy = by.name;
  leave.decisionNote = note ? String(note).slice(0, 500) : leave.decisionNote;
  leave.decisionToken = undefined;
  leave.updated = new Date();
  await leave.save();

  const applicant = leave.adminId && mongoose.isValidObjectId(leave.adminId)
    ? await mongoose.model('Admin').findById(leave.adminId).select('name surname role').lean()
    : null;
  if (applicant) {
    logActivity(applicant, 'leave_decided', { by: by.id ? { _id: by.id, name: by.name } : null, detail: `${leave.status} by ${by.name} · ${durationLabel(leave)}` });
    require('../../notify').notifyUser({
      recipient: applicant._id,
      actorId: by.id || null,
      actorName: by.name,
      module: 'HRMS',
      type: approved ? 'leave.approved' : 'leave.rejected',
      title: `Your leave was ${approved ? 'approved' : 'rejected'}`,
      body: `${durationLabel(leave)}${leave.decisionNote ? ` — ${leave.decisionNote}` : ''}`,
      link: '/',
    });
    if (approved) await enforceLeave(applicant).catch(() => {});
  }
  return { ok: true, leave };
}

async function cancelLeave(admin, leaveId) {
  const leave = await Leave().findOne({ _id: leaveId, removed: false, adminId: String(admin._id) });
  if (!leave) return { ok: false, error: 'Leave request not found.' };
  if (!['Pending', 'Approved'].includes(leave.status)) return { ok: false, error: `This leave is already ${leave.status.toLowerCase()}.` };
  if (leave.status === 'Approved' && leave.fromDate <= new Date()) return { ok: false, error: 'This leave has already started.' };
  const wasApproved = leave.status === 'Approved';
  leave.status = 'Cancelled';
  leave.decisionToken = undefined;
  leave.updated = new Date();
  await leave.save();
  require('../../notify').notify({
    audience: 'management',
    actorId: admin._id,
    actorName: fullName(admin),
    module: 'HRMS',
    type: 'leave.cancelled',
    title: `${fullName(admin)} cancelled a${wasApproved ? 'n approved' : ' pending'} leave`,
    body: `${leave.leaveType} · ${durationLabel(leave)}`,
    link: '/hr/work-tracker',
  });
  return { ok: true, leave };
}

// ── the 11:00 auto-start + leave enforcement (jobs/workdayTick.js) ───────
async function autoStartTick(now = new Date()) {
  const dayKey = istDateKey(now);
  if (now < istAt(dayKey, W.autoStartAt) || now > istAt(dayKey, W.end)) return 0;
  if (W.weeklyOff.includes(weekday(dayKey)) || (await holidayOn(dayKey))) return 0;
  const admins = await mongoose
    .model('Admin')
    // dialerAutoStartOff: management turned the auto-start off for them (Team Activity)
    .find({ removed: false, enabled: true, role: { $in: SALES_ROLES }, dialerAutoStartOff: { $ne: true } })
    .select('name surname role phone mobile contactNumber email')
    .lean();
  const sessions = await Session().find({ dayKey, admin: { $in: admins.map((a) => a._id) } }).select('admin loginAt autoStartedAt').lean();
  const sBy = new Map(sessions.map((s) => [String(s.admin), s]));
  let started = 0;
  for (const a of admins) {
    const s = sBy.get(String(a._id));
    if (s && (s.loginAt || s.autoStartedAt)) continue; // logged in, or already auto-started today
    if (!(a.phone || a.mobile || a.contactNumber)) continue; // nowhere to ring
    if (await dayOff(a, dayKey)) continue;
    if (await activeLeave(a._id, now)) continue; // on hourly / half-day leave right now — try again after
    await Session().updateOne(
      { admin: a._id, dayKey },
      { $setOnInsert: { admin: a._id, dayKey, created: now }, $set: { adminName: fullName(a), role: a.role, autoStartedAt: now, startSource: 'auto', updated: now } },
      { upsert: true }
    );
    if (!inPool(await poolState(a._id))) await poolCtl().setPoolMembership(a, true, null);
    logActivity(a, 'auto_start', { detail: `Dialer auto-started at ${fmtTime(now)} — not logged in` });
    started += 1;
  }
  return started;
}

async function leaveEnforcementTick(now = new Date()) {
  const live = await Leave().find({ removed: false, status: 'Approved', fromDate: { $lte: now }, toDate: { $gte: now }, adminId: { $ne: null } }).select('adminId').lean();
  const ids = [...new Set(live.map((l) => l.adminId).filter((id) => mongoose.isValidObjectId(id)))];
  if (!ids.length) return 0;
  const admins = await mongoose.model('Admin').find({ _id: { $in: ids } }).select('name surname role').lean();
  let n = 0;
  for (const a of admins) if (await enforceLeave(a, now)) n += 1;
  return n;
}

module.exports = {
  W,
  plannedEnd,
  todayKey,
  istAt,
  dayBounds,
  holidayOn,
  holidaysBetween,
  activeLeave,
  dayOff,
  getSession,
  login,
  logout,
  startBreak,
  endBreak,
  applyLeave,
  decideLeave,
  cancelLeave,
  durationLabel,
  lateLoginPenalty,
  markPresent,
  remindLogin,
  logoutReminderTick,
  firstActivityAt,
  leaveWindow,
  autoStartTick,
  leaveEnforcementTick,
  isSales,
  fullName,
  LEAVE_TYPES,
};
