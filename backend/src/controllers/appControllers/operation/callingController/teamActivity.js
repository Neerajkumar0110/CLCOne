const mongoose = require('mongoose');
const { NON_SALES_ROLES } = require('../../../../config/roles');
const { FULL_ACCESS_ROLES } = require('../../../../services/access/salesScope');
const { callReachedCustomer } = require('../../../../services/calling/callingShared');
const { istDateKey } = require('../../../../services/calling/shiftHelpers');
const { getOnlineUserIds } = require('../../../../socket');
const { setPoolMembership } = require('./leadPool');

// Lead Management → "Team Activity" tab (management only: owner/Super
// Admin/Admin/Sales Manager/Team Manager). Every Sales user, with their
// live Instant Lead Pool state (management can switch it on/off for them),
// today's numbers and a 7-day IST day-by-day breakdown:
//   loginHours — real app time from LoginActivity (socket sessions)
//   poolMinutes — time in the Instant Lead Pool, today only (AgentCallState
//                 keeps no history of earlier days)
//   calls / connected / talkSeconds — from CallRecord, every call of theirs
const DAYS = 7;
const DAY_MS = 86400000;

function deny(res) {
  return res.status(403).json({ success: false, result: null, message: 'Team Activity is management-only.' });
}

function lastDayKeys(now) {
  const keys = [];
  for (let i = DAYS - 1; i >= 0; i -= 1) keys.push(istDateKey(new Date(now.getTime() - i * DAY_MS)));
  return keys;
}

// GET /api/calling/team-activity
const list = async (req, res) => {
  if (!FULL_ACCESS_ROLES.includes(req.admin.role)) return deny(res);

  const Admin = mongoose.model('Admin');
  const Team = mongoose.model('Team');
  const LoginActivity = mongoose.model('LoginActivity');
  const CallRecord = mongoose.model('CallRecord');
  const CallCampaign = mongoose.model('CallCampaign');
  const AgentCallState = mongoose.model('AgentCallState');
  const Lead = mongoose.model('Lead');

  const now = new Date();
  const dayKeys = lastDayKeys(now);
  const todayKey = dayKeys[dayKeys.length - 1];
  const since = new Date(`${dayKeys[0]}T00:00:00+05:30`);

  const admins = await Admin.find({ removed: false, enabled: true, role: { $nin: NON_SALES_ROLES } })
    .select('name surname email phone role photo businessName businessSegment lastSeenAt created dialerAutoStartOff')
    .sort({ name: 1 })
    .lean();
  const ids = admins.map((a) => a._id);

  const [teams, sessions, calls, states, pool, leadAgg] = await Promise.all([
    Team.find({ removed: false }).select('name lead members color').lean(),
    LoginActivity.find({ removed: false, admin: { $in: ids }, loginAt: { $gte: since } })
      .select('admin loginAt logoutAt durationSeconds')
      .lean(),
    CallRecord.find({ removed: false, agent: { $in: ids }, created: { $gte: since } })
      .select('agent created duration status disposition')
      .lean(),
    AgentCallState.find({ agent: { $in: ids } }).lean(),
    CallCampaign.findOne({ isLeadPool: true, removed: false }).select('_id').lean(),
    Lead.aggregate([
      { $match: { removed: false, assignedUser: { $in: ids } } },
      { $group: { _id: { u: '$assignedUser', stage: '$stage' }, n: { $sum: 1 } } },
    ]),
  ]);

  // 11:00 auto-start: who has it switched off, and who is on a whole-day leave today
  const wd = require('../../../../services/hr/workday');
  const leaveToday = new Map();
  await Promise.all(admins.map(async (a) => {
    const off = await wd.dayOff(a, todayKey);
    if (off && off.kind === 'leave') leaveToday.set(String(a._id), off.label);
  }));

  const online = new Set(getOnlineUserIds());
  const blankDay = (day) => ({ day, loginSeconds: 0, calls: 0, connected: 0, talkSeconds: 0 });
  const byUser = new Map(ids.map((id) => [String(id), new Map(dayKeys.map((k) => [k, blankDay(k)]))]));

  sessions.forEach((s) => {
    const days = byUser.get(String(s.admin));
    const d = days && days.get(istDateKey(new Date(s.loginAt)));
    if (!d) return;
    if (s.durationSeconds != null) d.loginSeconds += s.durationSeconds;
    // Still-open session: count it live only while they're actually online
    // (same guard as hrms loginActivityController/summary.js — an orphaned
    // open session after a server restart must not grow forever).
    else if (online.has(String(s.admin))) d.loginSeconds += Math.max(0, Math.round((now - new Date(s.loginAt)) / 1000));
  });

  calls.forEach((c) => {
    const days = byUser.get(String(c.agent));
    const d = days && days.get(istDateKey(new Date(c.created)));
    if (!d) return;
    d.calls += 1;
    if (callReachedCustomer(c)) d.connected += 1;
    d.talkSeconds += c.duration || 0;
  });

  const leadsByUser = new Map();
  leadAgg.forEach((r) => {
    const k = String(r._id.u);
    if (!leadsByUser.has(k)) leadsByUser.set(k, { total: 0, byStage: {} });
    const e = leadsByUser.get(k);
    e.total += r.n;
    e.byStage[r._id.stage || 'Unknown'] = r.n;
  });

  const stateByUser = new Map(states.map((s) => [String(s.agent), s]));

  const result = admins.map((a) => {
    const key = String(a._id);
    const fullName = `${a.name} ${a.surname || ''}`.trim();
    const st = stateByUser.get(key);
    const poolOn = !!(st && pool && st.status !== 'Offline' && String(st.campaign) === String(pool._id));
    const joinedToday = !!(st && st.shiftJoinedAt && istDateKey(st.shiftJoinedAt) === todayKey);
    const poolMinutesToday =
      joinedToday && poolOn
        ? Math.max(0, Math.round((now - new Date(st.shiftJoinedAt)) / 60000) - (st.breakMinutesToday || 0))
        : 0;
    const days = [...byUser.get(key).values()];
    const week = days.reduce(
      (t, d) => ({
        loginSeconds: t.loginSeconds + d.loginSeconds,
        calls: t.calls + d.calls,
        connected: t.connected + d.connected,
        talkSeconds: t.talkSeconds + d.talkSeconds,
        activeDays: t.activeDays + (d.loginSeconds > 0 || d.calls > 0 ? 1 : 0),
      }),
      { loginSeconds: 0, calls: 0, connected: 0, talkSeconds: 0, activeDays: 0 }
    );

    return {
      _id: a._id,
      name: fullName,
      email: a.email,
      phone: a.phone || null,
      role: a.role,
      photo: a.photo || null,
      businessName: a.businessName || null,
      businessSegment: a.businessSegment || null,
      joined: a.created,
      lastSeenAt: a.lastSeenAt || null,
      online: online.has(key),
      teams: teams
        .filter((t) => t.lead === fullName || t.lead === a.name || (t.members || []).some((m) => m === fullName || m === a.name))
        .map((t) => ({ name: t.name, color: t.color, isLead: t.lead === fullName || t.lead === a.name })),
      pool: {
        on: poolOn,
        status: st ? st.status : 'Offline',
        since: st ? st.since : null,
        minutesToday: poolMinutesToday,
        breakMinutesToday: joinedToday ? st.breakMinutesToday || 0 : 0,
        breaksTakenToday: joinedToday ? st.breaksTakenToday || [] : [],
      },
      autoStart: { off: !!a.dialerAutoStartOff, onLeave: leaveToday.get(key) || null },
      today: byUser.get(key).get(todayKey),
      week,
      days,
      leads: leadsByUser.get(key) || { total: 0, byStage: {} },
    };
  });

  return res.status(200).json({ success: true, result, days: dayKeys, message: 'ok' });
};

// POST /api/calling/team-activity/:id/pool { on } — management switches a
// Sales user into / out of the Instant Lead Pool on their behalf.
const setPool = async (req, res) => {
  if (!FULL_ACCESS_ROLES.includes(req.admin.role)) return deny(res);

  const Admin = mongoose.model('Admin');
  const agent = await Admin.findOne({ _id: req.params.id, removed: false })
    .select('name surname role enabled phone')
    .lean();
  if (!agent) return res.status(404).json({ success: false, result: null, message: 'User not found.' });
  if (NON_SALES_ROLES.includes(agent.role)) {
    return res.status(400).json({ success: false, result: null, message: 'The Instant Lead Pool is Sales-only.' });
  }
  if (!agent.enabled) {
    return res.status(400).json({ success: false, result: null, message: 'This account is disabled.' });
  }

  const on = !!(req.body && req.body.on);
  // The pool bridges an answered customer to the agent's own phone — with
  // no number on file there's nowhere to send the call.
  if (on && !agent.phone) {
    return res.status(400).json({
      success: false,
      result: null,
      message: `${agent.name} has no phone number on their profile — add one before switching them on.`,
    });
  }
  await setPoolMembership(agent, on, req.admin);

  return res.status(200).json({
    success: true,
    result: { on },
    message: `${agent.name} ${on ? 'is now in' : 'left'} the Instant Lead Pool.`,
  });
};

// POST /api/calling/team-activity/:id/auto-start { off } — management turns
// the 11:00 dialer auto-start off (or back on) for one Sales user.
const setAutoStart = async (req, res) => {
  if (!FULL_ACCESS_ROLES.includes(req.admin.role)) return deny(res);
  const Admin = mongoose.model('Admin');
  const off = !!(req.body && req.body.off);
  const agent = await Admin.findOneAndUpdate({ _id: req.params.id, removed: false }, { $set: { dialerAutoStartOff: off } }, { new: true })
    .select('name surname role')
    .lean();
  if (!agent) return res.status(404).json({ success: false, result: null, message: 'User not found.' });
  return res.status(200).json({
    success: true,
    result: { off },
    message: off ? `${agent.name}'s dialer will not auto-start at 11:00.` : `${agent.name}'s dialer auto-starts at 11:00 again.`,
  });
};

module.exports = { list, setPool, setAutoStart };
