const mongoose = require('mongoose');
const { istDateKey } = require('../calling/shiftHelpers');
const { SALES_ROLES } = require('../../config/roles');

// ─────────────────────────────────────────────────────────────────────────────
// Attendance ERP engine (HRMS › Work & Leave Tracker › Attendance ERP and the
// /employee portal). Design: Claude canvas "Attendance & Leave ERP Design".
//
//   login / logout  → ErpSession (one per employee per IST day)
//   heartbeat       → every 30 s from the browser tracker (any CRM / portal
//                     tab, one beat for all tabs) and from the CLC Desktop
//                     Agent. Carries only "was the mouse / keyboard used".
//   periods         → ErpActivity rows: ACTIVE / INACTIVE / LUNCH / BREAK /
//                     OFFLINE, derived on the SERVER from server time:
//                       no input for inactivitySec (5 min)  → INACTIVE
//                       (starts at last input + 5 min, so the 5 min itself
//                        still counts as work)
//                       any input again                     → ACTIVE
//                       no heartbeat for offlineSec (2 min) → OFFLINE (not a
//                        logout — the session continues when they're back)
//                       not closed by autoCloseAt / next day → Needs review
//   actual work     = Σ ACTIVE (+ INACTIVE an admin counted as work).
//                     Never logout − login.
//
// The state is advanced lazily (every beat and every read) and by the minute
// job (jobs/erpAttendanceTick.js), so it is right even where background jobs
// are off. Every write for one employee goes through a per-employee lock.
// ─────────────────────────────────────────────────────────────────────────────

const Session = () => mongoose.model('ErpSession');
const Activity = () => mongoose.model('ErpActivity');
const Setting = () => mongoose.model('ErpSetting');
const Leave = () => mongoose.model('LeaveRequest');

// Real CLC shift (user, 2026-11-28): 10:00 – 20:30, late after 10:15. Settings › Working hours overrides.
const DEFAULTS = {
  workStart: '10:00',
  workEnd: '20:30',
  requiredMin: 480,
  lateAfter: '10:15',
  lunchMin: 60,
  lunchWindowStart: '13:00',
  lunchWindowEnd: '14:30',
  autoLunch: true,
  breaks: [
    { key: 'tea1', label: 'Tea break 1', start: '11:30', min: 10 },
    { key: 'tea2', label: 'Tea break 2', start: '16:30', min: 10 },
  ],
  inactivitySec: 300,
  heartbeatSec: 30,
  offlineSec: 120,
  autoCloseAt: '23:59',
  countScrollTouch: true,
  inactiveBanner: true,
  pauseDialerOnInactive: false,
  allowSecondDevice: false,
  rules: { halfMin: 240, halfMax: 359, shortMin: 360, shortMax: 479, presentMin: 480 },
  weeklyOff: [0], // 0 = Sunday … 6 = Saturday
  leaveQuota: { Casual: 12, Sick: 6, Earned: 15, Emergency: 3, Other: 0 },
  emailEmployee: true,
  approvers: 'Owner + HR Admin',
  departments: ['Sales', 'Marketing', 'LMS', 'Tech', 'Operations', 'HR', 'Finance', 'Support'],
};
const LEAVE_TYPES = ['Casual', 'Sick', 'Earned', 'Emergency', 'Other'];

// ── time helpers (IST) ───────────────────────────────────────────────────────
const istAt = (dayKey, hm = '00:00') => new Date(`${dayKey}T${hm}:00+05:30`);
const todayKey = (now = new Date()) => istDateKey(now);
const dayStart = (dayKey) => istAt(dayKey, '00:00');
const dayEnd = (dayKey) => new Date(dayStart(dayKey).getTime() + 864e5 - 1);
const weekday = (dayKey) => istAt(dayKey, '12:00').getUTCDay();
const addDays = (dayKey, n) => istDateKey(new Date(istAt(dayKey, '12:00').getTime() + n * 864e5));
const ms = (d) => new Date(d).getTime();
const minsBetween = (a, b) => Math.max(0, (new Date(b) - new Date(a)) / 60000);
const hmOf = (d) =>
  d ? new Date(d).toLocaleTimeString('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: false }) : null;
const slotOf = (d) => {
  const hm = hmOf(d);
  return `${hm.slice(0, 2)}:${String(Math.floor(Number(hm.slice(3)) / 10) * 10).padStart(2, '0')}`;
};
const fullName = (a) => (a ? `${a.name || ''} ${a.surname || ''}`.trim() || a.email : '');
// Who is in the ERP (user, 2026-11-28) — only people who have a login to it:
//   • Sales roles: always (they get their login with the account welcome email
//     and use the header Login / Logout).
//   • Everyone else — Admin, Support, Finance, and also Candidates / Teachers:
//     only once they were sent the "Attendance ERP login" email (User
//     Management › All Users ✉ → ErpProfile.invitedAt) or "Track attendance"
//     was switched on — and tracking starts when they sign in (same email + OTP).
//   • Never: the owner and Super Admin.
// isTrackedRole = the role may be in the ERP at all; trackedAdmin = this person is.
const NEVER_TRACKED_ROLES = ['owner', 'Super Admin'];
const isTrackedRole = (role) => !!role && !NEVER_TRACKED_ROLES.includes(role);
const isSalesRole = (role) => SALES_ROLES.includes(role);
const trackCache = new Map(); // adminId → { v, at }
function forgetTracked(adminId) {
  if (adminId) trackCache.delete(String(adminId));
  else trackCache.clear();
}
async function trackedAdmin(admin) {
  if (!admin || !isTrackedRole(admin.role)) return false;
  const k = String(admin._id);
  const c = trackCache.get(k);
  if (c && Date.now() - c.at < 60000) return c.v;
  const p = await mongoose.model('ErpProfile').findOne({ admin: admin._id }).select('trackingEnabled invitedAt').lean();
  const v = isTracked(admin, p);
  trackCache.set(k, { v, at: Date.now() });
  return v;
}

// ── settings ─────────────────────────────────────────────────────────────────
let cache = null;
let cacheAt = 0;
async function getSettings(fresh = false) {
  if (!fresh && cache && Date.now() - cacheAt < 30000) return cache;
  const doc = await Setting().findOne({ key: 'main' }).lean();
  const d = (doc && doc.data) || {};
  cache = { ...DEFAULTS, ...d, rules: { ...DEFAULTS.rules, ...(d.rules || {}) }, leaveQuota: { ...DEFAULTS.leaveQuota, ...(d.leaveQuota || {}) } };
  cacheAt = Date.now();
  return cache;
}
async function saveSettings(data, by) {
  const merged = { ...(await getSettings(true)), ...data };
  await Setting().updateOne({ key: 'main' }, { $set: { data: merged, updated: new Date(), updatedBy: by } }, { upsert: true });
  cache = null;
  return getSettings(true);
}

// ── per-employee lock (heartbeats from several tabs + the agent) ────────────
const locks = new Map();
function withLock(key, fn) {
  const k = String(key);
  const run = (locks.get(k) || Promise.resolve()).then(fn, fn);
  const tail = run.catch(() => {});
  locks.set(k, tail);
  tail.then(() => {
    if (locks.get(k) === tail) locks.delete(k);
  });
  return run;
}

function emitChange(session) {
  try {
    require('../../socket').emitErp('erp:attendance', { admin: String(session.admin), status: session.status, dayKey: session.dayKey }, session.admin);
  } catch (e) {
    /* no socket server */
  }
}

// ── periods ──────────────────────────────────────────────────────────────────
async function openPeriods(session) {
  const list = await Activity().find({ session: session._id, endAt: null }).sort({ startAt: 1 });
  // A race left two open — close each at the next one's start.
  for (let i = 0; i < list.length - 1; i += 1) {
    list[i].endAt = list[i + 1].startAt > list[i].startAt ? list[i + 1].startAt : list[i].startAt;
    await list[i].save();
  }
  return list.length ? list[list.length - 1] : null;
}

async function describeLaptop(adminId, from, to) {
  const ev = await mongoose
    .model('ErpDeviceEvent')
    .find({ admin: adminId, at: { $gte: from, $lte: to || new Date() }, kind: { $in: ['lock', 'sleep', 'shutdown'] } })
    .sort({ at: 1 })
    .lean();
  const dev = await mongoose.model('ErpDevice').findOne({ admin: adminId, revoked: false, lastSeenAt: { $gte: new Date(ms(from) - 5 * 60000) } }).lean();
  if (ev.length) {
    const e = ev[0];
    const label = { lock: 'Locked', sleep: 'Sleep (lid closed)', shutdown: 'Shut down' }[e.kind];
    return { laptop: `${label} at ${hmOf(e.at)}`, source: 'agent' };
  }
  if (dev) return { laptop: 'Screen on, unlocked', source: 'agent' };
  return { laptop: 'Browser only (no agent)', source: 'browser' };
}

async function closePeriod(p, at) {
  const end = new Date(Math.max(new Date(at).getTime(), ms(p.startAt)));
  if (end - p.startAt < 1000 && p.type !== 'INACTIVE') {
    await Activity().deleteOne({ _id: p._id });
    return null;
  }
  p.endAt = end;
  if (p.type === 'INACTIVE' && !p.laptop) Object.assign(p, await describeLaptop(p.admin, p.startAt, end));
  await p.save();
  return p;
}

async function newPeriod(session, type, startAt, extra = {}) {
  return Activity().create({ session: session._id, admin: session.admin, dayKey: session.dayKey, type, startAt, ...extra });
}

const STATUS_OF = { ACTIVE: 'active', INACTIVE: 'inactive', LUNCH: 'lunch', BREAK: 'break', OFFLINE: 'offline' };

// Move the session forward to `now` using only what is already known (no new
// beat). Handles ACTIVE → INACTIVE (5 min), * → OFFLINE (2 min without a
// beat) and the end of a lunch / break.
async function advance(session, now, S) {
  if (['logged_out', 'needs_review'].includes(session.status)) return;
  const T = S.inactivitySec * 1000;
  const OFF = S.offlineSec * 1000;
  for (let guard = 0; guard < 6; guard += 1) {
    const p = await openPeriods(session);
    const lastAct = session.lastActivityAt || session.loginAt;
    const lastHb = session.lastHeartbeatAt || session.loginAt;
    if (!p) {
      await newPeriod(session, now - lastAct < T ? 'ACTIVE' : 'INACTIVE', now, now - lastAct < T ? {} : { lastInputAt: lastAct });
      continue;
    }
    const hbDead = ms(lastHb) + OFF < ms(now);
    if (p.type === 'ACTIVE') {
      const idleAt = new Date(ms(lastAct) + T);
      if (idleAt <= now && (!hbDead || idleAt <= lastHb)) {
        await closePeriod(p, idleAt);
        await newPeriod(session, 'INACTIVE', idleAt, { lastInputAt: lastAct });
        continue;
      }
      if (hbDead) {
        await closePeriod(p, lastHb);
        await newPeriod(session, 'OFFLINE', new Date(Math.max(lastHb, p.startAt)));
        continue;
      }
    } else if (p.type === 'INACTIVE') {
      if (hbDead) {
        await closePeriod(p, new Date(Math.max(lastHb, p.startAt)));
        await newPeriod(session, 'OFFLINE', new Date(Math.max(lastHb, p.startAt)));
        continue;
      }
    } else if (p.type === 'LUNCH' || p.type === 'BREAK') {
      const end = (session.currentBreak && session.currentBreak.plannedEndAt) || new Date(ms(p.startAt) + (p.type === 'LUNCH' ? S.lunchMin : 10) * 60000);
      if (end <= now) {
        await closePeriod(p, end);
        session.currentBreak = undefined;
        if (ms(lastHb) + OFF < ms(end)) {
          await newPeriod(session, 'OFFLINE', end);
        } else {
          if (!session.lastActivityAt || session.lastActivityAt < end) session.lastActivityAt = end; // 5-min grace after a break
          await newPeriod(session, 'ACTIVE', end);
        }
        continue;
      }
    }
    session.status = STATUS_OF[p.type];
    return;
  }
}

// The day ended (autoCloseAt / next day) with the session still open: close
// it at the last sign of life and hand it to an admin as "Needs review".
async function closeStale(session, S) {
  if (['logged_out', 'needs_review'].includes(session.status)) return false;
  const end = dayEnd(session.dayKey);
  await advance(session, end, S);
  const p = await openPeriods(session);
  if (p) {
    if (p.type === 'OFFLINE') await closePeriod(p, p.startAt);
    else await closePeriod(p, new Date(Math.min(end, Math.max(session.lastHeartbeatAt || p.startAt, p.startAt))));
  }
  session.status = 'needs_review';
  session.logoutType = 'auto';
  session.currentBreak = undefined;
  session.updated = new Date();
  await session.save();
  emitChange(session);
  require('../../notify').notify({
    audience: 'management',
    actorId: null,
    actorName: 'Attendance ERP',
    module: 'HRMS',
    type: 'erp.review',
    title: 'Session needs review',
    body: `${session.adminName} — ${session.dayKey}: never logged out (last activity ${hmOf(session.lastHeartbeatAt) || '—'}).`,
    link: '/hr/work-tracker?erp=attendance',
  });
  return true;
}

async function closeStaleFor(adminId, S, now = new Date()) {
  const tk = todayKey(now);
  const old = await Session().find({ admin: adminId, dayKey: { $lt: tk }, status: { $nin: ['logged_out', 'needs_review'] } });
  for (const s of old) await closeStale(s, S);
}

function parseUa(ua = '') {
  const browser = /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
  const os = /Windows/.test(ua) ? 'Windows' : /Mac OS X/.test(ua) && !/Mobile/.test(ua) ? 'macOS' : /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Linux/.test(ua) ? 'Linux' : '';
  return { browser, os, ua: String(ua).slice(0, 300) };
}

// ── login / logout ───────────────────────────────────────────────────────────
// Called from the CRM login (issueSession), the portal and the first activity
// of the day. A second call the same day is a page refresh / another tab:
// nothing new is created. After a logout the same day it is a re-login: the
// gap is kept as OFFLINE and the session continues.
async function startSession(admin, { source = 'login', ua, now = new Date() } = {}) {
  if (!admin || !(await trackedAdmin(admin))) return null;
  return withLock(admin._id, async () => {
    const S = await getSettings();
    await closeStaleFor(admin._id, S, now);
    const dk = todayKey(now);
    let s = await Session().findOne({ admin: admin._id, dayKey: dk });
    if (!s) {
      try {
        s = await Session().create({
          admin: admin._id,
          adminName: fullName(admin),
          role: admin.role,
          dayKey: dk,
          loginAt: now,
          startSource: source,
          lastActivityAt: now,
          lastHeartbeatAt: now,
          status: 'active',
          device: ua ? parseUa(ua) : undefined,
        });
      } catch (e) {
        if (e.code !== 11000) throw e;
        s = await Session().findOne({ admin: admin._id, dayKey: dk });
      }
      if (!(await Activity().exists({ session: s._id }))) await newPeriod(s, 'ACTIVE', now);
      emitChange(s);
      return s;
    }
    if (s.status === 'logged_out') {
      await newPeriod(s, 'OFFLINE', s.logoutAt || now).then((p) => closePeriod(p, now));
      s.logoutAt = undefined;
      s.logoutType = undefined;
      s.status = 'active';
      s.lastActivityAt = now;
      s.lastHeartbeatAt = now;
      await newPeriod(s, 'ACTIVE', now);
    } else if (s.status !== 'needs_review') {
      await advance(s, now, S);
      await applyBeat(s, now, { input: true, agoMs: 0 }, S);
    }
    if (ua) s.device = parseUa(ua);
    s.updated = new Date();
    await s.save();
    emitChange(s);
    return s;
  });
}

async function logout(admin, { type = 'manual', now = new Date() } = {}) {
  if (!admin) return null;
  return withLock(admin._id, async () => {
    const S = await getSettings();
    const s = await Session().findOne({ admin: admin._id, dayKey: todayKey(now) });
    if (!s || ['logged_out', 'needs_review'].includes(s.status)) return s;
    await advance(s, now, S);
    const p = await openPeriods(s);
    if (p) await closePeriod(p, p.type === 'OFFLINE' ? p.startAt : now);
    s.status = 'logged_out';
    s.logoutAt = now;
    s.logoutType = type;
    s.currentBreak = undefined;
    s.updated = new Date();
    await s.save();
    emitChange(s);
    return s;
  });
}

// ── heartbeat ────────────────────────────────────────────────────────────────
async function applyBeat(s, now, f, S) {
  const input = !!(f.input || f.kb || f.mouse || (S.countScrollTouch && (f.touch || f.scroll)));
  const ago = Math.min(Math.max(Number(f.agoMs) || 0, 0), (S.heartbeatSec + 15) * 1000);
  const inputAt = new Date(ms(now) - ago);
  s.lastHeartbeatAt = now;
  if (input) {
    if (!s.lastActivityAt || inputAt > s.lastActivityAt) s.lastActivityAt = inputAt;
    if (f.kb) s.lastKbAt = inputAt;
    if (f.mouse || f.touch || f.scroll) s.lastMouseAt = inputAt;
    const k = slotOf(now);
    const cur = (s.slots && s.slots[k]) || { k: 0, m: 0 };
    s.slots = { ...(s.slots || {}), [k]: { k: cur.k + (f.kb ? 1 : 0), m: cur.m + (f.mouse || f.touch || f.scroll || (!f.kb && input) ? 1 : 0) } };
    s.markModified('slots');
  }
  const p = await openPeriods(s);
  if (!p) return;
  if (p.type === 'OFFLINE') {
    await closePeriod(p, now);
    if (input) await newPeriod(s, 'ACTIVE', now);
    else await newPeriod(s, 'INACTIVE', now, { lastInputAt: s.lastActivityAt });
  } else if (p.type === 'INACTIVE' && input) {
    const at = new Date(Math.max(inputAt, p.startAt));
    await closePeriod(p, at);
    await newPeriod(s, 'ACTIVE', at);
  }
  const np = await openPeriods(s);
  if (np) s.status = STATUS_OF[np.type];
}

// f: { kb, mouse, touch, scroll, input, agoMs } — flags only, never key data.
async function heartbeat(admin, f = {}, { source = 'browser', ua, now = new Date() } = {}) {
  if (!admin || !(await trackedAdmin(admin))) return { tracked: false };
  return withLock(admin._id, async () => {
    const S = await getSettings();
    await closeStaleFor(admin._id, S, now);
    const dk = todayKey(now);
    let s = await Session().findOne({ admin: admin._id, dayKey: dk });
    const input = !!(f.input || f.kb || f.mouse || f.touch || f.scroll);
    if (!s) {
      // Still logged in from yesterday (kept-signed-in token): the first
      // activity of the day starts the day.
      if (!input) return { session: null };
      s = await Session().create({
        admin: admin._id,
        adminName: fullName(admin),
        role: admin.role,
        dayKey: dk,
        loginAt: now,
        startSource: 'activity',
        lastActivityAt: now,
        lastHeartbeatAt: now,
        status: 'active',
        device: ua ? parseUa(ua) : undefined,
      }).catch(async (e) => {
        if (e.code !== 11000) throw e;
        return Session().findOne({ admin: admin._id, dayKey: dk });
      });
      if (!(await Activity().exists({ session: s._id }))) await newPeriod(s, 'ACTIVE', now);
      emitChange(s);
      return { session: s };
    }
    if (['logged_out', 'needs_review'].includes(s.status)) return { session: s };
    // A Sales user talking on a dialer call doesn't touch the mouse — the call
    // itself counts as activity, so a long call is never marked Inactive.
    if (!(f.input || f.kb || f.mouse || f.touch || f.scroll)) {
      const cs = await mongoose.model('AgentCallState').findOne({ agent: admin._id }).select('status').lean().catch(() => null);
      if (cs && ['Ringing', 'OnCall'].includes(cs.status)) f = { ...f, input: true, call: true };
    }
    const before = s.status;
    await advance(s, now, S);
    await applyBeat(s, now, f, S);
    if (ua && source === 'browser' && !s.device) s.device = parseUa(ua);
    s.updated = new Date();
    await s.save();
    if (s.status !== before) emitChange(s);
    return { session: s };
  });
}

// ── lunch / breaks ───────────────────────────────────────────────────────────
// `mirror` = { key, label, min }: a Sales Workday break (header widget / its
// auto breaks) copied as-is — no ERP break list or lunch rule applies.
async function breakStart(admin, { kind = 'BREAK', key, auto = false, now = new Date(), mirror } = {}) {
  return withLock(admin._id, async () => {
    const S = await getSettings();
    const s = await Session().findOne({ admin: admin._id, dayKey: todayKey(now) });
    if (!s || ['logged_out', 'needs_review'].includes(s.status)) return { ok: false, error: 'Start your day first.' };
    await advance(s, now, S);
    if (s.currentBreak && s.currentBreak.startAt) return { ok: false, error: `You are already on ${s.currentBreak.label}.` };
    let label;
    let min;
    let k;
    if (mirror) {
      k = mirror.key;
      label = mirror.label;
      min = mirror.min;
    } else if (kind === 'LUNCH') {
      k = 'lunch';
      label = 'Lunch';
      min = S.lunchMin;
      if ((s.breaksTaken || []).includes('lunch')) return { ok: false, error: 'Lunch is already taken today.' };
    } else {
      const b = S.breaks.find((x) => x.key === key && !(s.breaksTaken || []).includes(x.key)) || S.breaks.find((x) => !(s.breaksTaken || []).includes(x.key));
      if (!b) return { ok: false, error: 'All breaks are used for today.' };
      k = b.key;
      label = b.label;
      min = b.min;
    }
    const p = await openPeriods(s);
    if (p) await closePeriod(p, now);
    const plannedEndAt = new Date(ms(now) + min * 60000);
    await newPeriod(s, kind === 'LUNCH' ? 'LUNCH' : 'BREAK', now, { label, auto });
    s.currentBreak = { kind, key: k, label, startAt: now, plannedEndAt };
    s.breaksTaken = [...(s.breaksTaken || []), k];
    s.status = kind === 'LUNCH' ? 'lunch' : 'break';
    s.updated = new Date();
    await s.save();
    emitChange(s);
    return { ok: true, session: s };
  });
}

async function breakEnd(admin, { now = new Date() } = {}) {
  return withLock(admin._id, async () => {
    const s = await Session().findOne({ admin: admin._id, dayKey: todayKey(now) });
    if (!s || !s.currentBreak || !s.currentBreak.startAt) return { ok: false, error: 'You are not on a break.' };
    const p = await openPeriods(s);
    if (p && (p.type === 'LUNCH' || p.type === 'BREAK')) await closePeriod(p, now);
    s.currentBreak = undefined;
    s.lastActivityAt = now;
    s.lastHeartbeatAt = now;
    await newPeriod(s, 'ACTIVE', now);
    s.status = 'active';
    s.updated = new Date();
    await s.save();
    emitChange(s);
    return { ok: true, session: s };
  });
}

// ── totals & status ──────────────────────────────────────────────────────────
function totalsOf(session, periods, now = new Date()) {
  const t = { active: 0, inactive: 0, counted: 0, lunch: 0, break: 0, offline: 0, work: 0, session: 0, inactiveCount: 0 };
  const open = session && !['logged_out', 'needs_review'].includes(session.status);
  for (const p of periods || []) {
    const end = p.endAt || (open ? now : p.startAt);
    const m = minsBetween(p.startAt, end);
    if (p.type === 'ACTIVE') t.active += m;
    else if (p.type === 'INACTIVE') {
      t.inactiveCount += 1;
      if (p.countedAsWork) t.counted += m;
      else t.inactive += m;
    } else if (p.type === 'LUNCH') t.lunch += m;
    else if (p.type === 'BREAK') t.break += m;
    else if (p.type === 'OFFLINE') t.offline += m;
  }
  t.work = t.active + t.counted;
  if (session && session.loginAt) {
    const last = (periods || []).reduce((mx, p) => Math.max(mx, ms(p.endAt || (open ? now : p.startAt))), ms(session.loginAt));
    t.session = minsBetween(session.loginAt, session.logoutAt || (open ? now : new Date(last)));
  }
  for (const k of Object.keys(t)) if (k !== 'inactiveCount') t[k] = Math.round(t[k]);
  return t;
}

const LIVE_LABEL = { active: 'Online', inactive: 'Inactive', lunch: 'Lunch', break: 'Break', offline: 'Offline' };

// ctx: { dayKey, S, now, leave (approved full-day leave or null), holiday, weeklyOff }
function dayStatus(session, totals, ctx) {
  const { S, now, dayKey } = ctx;
  const tags = [];
  if (!session || !session.loginAt) {
    if (ctx.leave) return { status: 'Leave', tags, live: null };
    if (ctx.holiday) return { status: 'Holiday', tags, live: null };
    if (ctx.weeklyOff) return { status: 'Weekly Off', tags, live: null };
    if (dayKey > todayKey(now)) return { status: '—', tags, live: null };
    if (dayKey === todayKey(now) && now < istAt(dayKey, S.workEnd)) return { status: 'Not logged in', tags, live: null };
    return { status: 'Absent', tags, live: null };
  }
  if (session.loginAt > istAt(dayKey, S.lateAfter)) tags.push('Late');
  if (session.logoutAt && session.logoutAt < istAt(dayKey, S.workEnd)) tags.push('Early Logout');
  if (session.statusOverride) return { status: session.statusOverride, tags: [...tags, 'Manual'], live: null };
  if (session.status === 'needs_review') return { status: 'Needs review', tags, live: null };
  const open = session.status !== 'logged_out';
  if (open && dayKey === todayKey(now)) return { status: LIVE_LABEL[session.status] || 'Online', tags, live: session.status };
  const w = totals.work;
  const R = S.rules;
  let status = 'Absent';
  if (w >= R.presentMin) status = 'Present';
  else if (w >= R.shortMin) status = 'Short';
  else if (w >= R.halfMin) status = 'Half Day';
  if (session.manual) tags.push('Manual');
  return { status, tags, live: null };
}

// ── leaves / holidays helpers ────────────────────────────────────────────────
async function leavesBetween(fromKey, toKey, { adminIds, statuses = ['Approved'] } = {}) {
  const q = { removed: false, status: { $in: statuses }, fromDate: { $lte: dayEnd(toKey) }, toDate: { $gte: dayStart(fromKey) } };
  if (adminIds) q.adminId = { $in: adminIds.map(String) };
  return Leave().find(q).select('-decisionToken').lean();
}
// Full-day leave on dayKey (an hours leave doesn't make the day "Leave").
function leaveOnDay(leaves, adminId, dayKey, S) {
  const ws = istAt(dayKey, S.workStart);
  const we = istAt(dayKey, S.workEnd);
  return (
    leaves.find(
      (l) => String(l.adminId) === String(adminId) && l.durationType !== 'hours' && l.durationType !== 'half' && new Date(l.fromDate) <= we && new Date(l.toDate) >= ws
    ) || null
  );
}
async function holidayKeys(fromKey, toKey) {
  const hs = await mongoose
    .model('Holiday')
    .find({ removed: false, date: { $gte: dayStart(fromKey), $lte: dayEnd(toKey) } })
    .lean();
  const map = {};
  hs.forEach((h) => {
    map[istDateKey(new Date(h.date))] = h.name;
  });
  return map;
}

// Working days in [fromKey, toKey] (weekly offs + holidays left out).
async function workingDays(fromKey, toKey, S) {
  const hol = await holidayKeys(fromKey, toKey);
  const out = [];
  for (let d = fromKey; d <= toKey; d = addDays(d, 1)) if (!S.weeklyOff.includes(weekday(d)) && !hol[d]) out.push(d);
  return out;
}

// Σ work / inactive / lunch / … per (admin, day) for a day range — one query.
async function totalsByAdminDay(fromKey, toKey, adminIds) {
  const now = new Date();
  const q = { dayKey: { $gte: fromKey, $lte: toKey } };
  if (adminIds) q.admin = { $in: adminIds.map((x) => new mongoose.Types.ObjectId(String(x))) };
  const sessions = await Session().find(q).lean();
  const periods = sessions.length ? await Activity().find({ session: { $in: sessions.map((s) => s._id) } }).lean() : [];
  const bySession = {};
  periods.forEach((p) => {
    (bySession[String(p.session)] = bySession[String(p.session)] || []).push(p);
  });
  const out = {};
  sessions.forEach((s) => {
    out[`${s.admin}|${s.dayKey}`] = { session: s, totals: totalsOf(s, bySession[String(s._id)] || [], now), periods: bySession[String(s._id)] || [] };
  });
  return out;
}

// Is this account in the attendance lists? (see trackedAdmin above)
function isTracked(a, p) {
  if (!a || !isTrackedRole(a.role)) return false;
  if (p && typeof p.trackingEnabled === 'boolean') return p.trackingEnabled;
  return isSalesRole(a.role) || !!(p && p.invitedAt);
}

async function trackedEmployees({ includeDisabled = false, includeUntracked = false } = {}) {
  const q = { removed: false, role: { $nin: NEVER_TRACKED_ROLES } };
  if (!includeDisabled) q.enabled = true;
  const admins = await mongoose.model('Admin').find(q).select('name surname email role enabled photo phone created reportsTo').lean();
  const profiles = await mongoose.model('ErpProfile').find({ admin: { $in: admins.map((a) => a._id) } }).lean();
  const pmap = {};
  profiles.forEach((p) => {
    pmap[String(p.admin)] = p;
  });
  return admins.filter((a) => includeUntracked || isTracked(a, pmap[String(a._id)])).map((a) => {
    const p = pmap[String(a._id)] || {};
    return {
      _id: a._id,
      name: fullName(a),
      email: a.email,
      role: a.role,
      enabled: a.enabled,
      photo: a.photo,
      phone: a.phone,
      created: a.created,
      employeeCode: p.employeeCode || '',
      department: p.department || '',
      designation: p.designation || a.role,
      joiningDate: p.joiningDate || a.created,
      shiftName: p.shiftName || 'General',
      reportsTo: p.reportsTo || a.reportsTo || null,
      erpRole: p.erpRole || 'employee',
      tracked: isTracked(a, pmap[String(a._id)]),
      trackingOff: p.trackingEnabled === false,
      leaveAdjust: p.leaveAdjust || {},
    };
  });
}

// Leave balance for the year: quota (Settings) + adjustment − approved days.
async function leaveBalance(adminId, year, S, profile) {
  const from = `${year}-01-01`;
  const to = `${year}-12-31`;
  const ls = await leavesBetween(from, to, { adminIds: [adminId], statuses: ['Approved', 'Pending'] });
  const adj = (profile && profile.leaveAdjust) || {};
  return LEAVE_TYPES.map((type) => {
    const used = ls.filter((l) => l.status === 'Approved' && (l.leaveType || 'Casual') === type).reduce((n, l) => n + (Number(l.days) || 1), 0);
    const pending = ls.filter((l) => l.status === 'Pending' && (l.leaveType || 'Casual') === type).reduce((n, l) => n + (Number(l.days) || 1), 0);
    const total = (Number(S.leaveQuota[type]) || 0) + (Number(adj[type]) || 0);
    return { type, total, used, pending, left: Math.max(0, total - used) };
  });
}

// ── minute job ───────────────────────────────────────────────────────────────
// Advances every open session (so Live / Inactivity Log are right even when
// nobody is looking), starts lunch on its own at the lunch window, and closes
// open sessions after autoCloseAt / at the day change.
async function tick(now = new Date()) {
  const S = await getSettings();
  const tk = todayKey(now);
  const open = await Session().find({ status: { $nin: ['logged_out', 'needs_review'] } });
  const autoCloseAt = istAt(tk, S.autoCloseAt);
  let changed = 0;
  for (const s of open) {
    await withLock(s.admin, async () => {
      const fresh = await Session().findById(s._id);
      if (!fresh || ['logged_out', 'needs_review'].includes(fresh.status)) return;
      if (fresh.dayKey < tk || now >= autoCloseAt) {
        if (await closeStale(fresh, S)) changed += 1;
        return;
      }
      const before = fresh.status;
      await advance(fresh, now, S);
      fresh.updated = new Date();
      await fresh.save();
      if (fresh.status !== before) {
        changed += 1;
        emitChange(fresh);
      }
    });
    // Lunch starts on its own at the window start for anyone working who hasn't taken it.
    if (S.autoLunch && s.dayKey === tk && !(s.breaksTaken || []).includes('lunch') && ['active', 'inactive'].includes(s.status)) {
      const ws = istAt(tk, S.lunchWindowStart);
      const we = istAt(tk, S.lunchWindowEnd);
      if (now >= ws && now < we) {
        const a = await mongoose.model('Admin').findById(s.admin).select('name surname role').lean();
        if (a && !require('./workday').isSales(a)) await breakStart(a, { kind: 'LUNCH', auto: true, now });
      }
    }
  }
  return changed;
}

async function audit(req, { action, employee, employeeName, oldValue, newValue, reason, dayKey }) {
  const a = req && req.admin;
  return mongoose.model('ErpAudit').create({
    actor: a ? a._id : undefined,
    actorName: a ? fullName(a) : 'System',
    action,
    employee,
    employeeName,
    oldValue: oldValue == null ? '' : String(oldValue).slice(0, 500),
    newValue: newValue == null ? '' : String(newValue).slice(0, 500),
    reason: reason ? String(reason).slice(0, 1000) : '',
    dayKey,
  });
}

module.exports = {
  DEFAULTS,
  LEAVE_TYPES,
  istAt,
  todayKey,
  dayStart,
  dayEnd,
  weekday,
  addDays,
  hmOf,
  slotOf,
  minsBetween,
  ms,
  fullName,
  isTrackedRole,
  isSalesRole,
  trackedAdmin,
  forgetTracked,
  NEVER_TRACKED_ROLES,
  getSettings,
  saveSettings,
  withLock,
  emitChange,
  openPeriods,
  closePeriod,
  newPeriod,
  advance,
  closeStale,
  closeStaleFor,
  startSession,
  logout,
  heartbeat,
  breakStart,
  breakEnd,
  totalsOf,
  dayStatus,
  leavesBetween,
  leaveOnDay,
  holidayKeys,
  workingDays,
  totalsByAdminDay,
  trackedEmployees,
  isTracked,
  leaveBalance,
  describeLaptop,
  parseUa,
  tick,
  audit,
};
