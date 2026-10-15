const mongoose = require('mongoose');
const { SALES_ROLES } = require('../../../config/roles');
const { getOnlineUserIds } = require('../../../socket');
const { istDateKey } = require('../../../services/calling/shiftHelpers');
const { callReachedCustomer } = require('../../../services/calling/callingShared');

// GET /api/admin/overview/:id — everything about one user for User
// Management's click-a-row detail modal: profile, when they joined, who they
// report to, their teams, login history (last 7 IST days + recent
// sessions), calls, assigned leads by stage and Instant Lead Pool state.
// Same Sales-only scoping as read.js: a Sales Manager/Team Manager asking
// for a non-Sales user gets a plain 404.
const DAYS = 7;
const DAY_MS = 86400000;

const overview = async (req, res) => {
  const Admin = mongoose.model('Admin');
  const user = await Admin.findOne({ _id: req.params.id }).lean();
  const scopedOut =
    user && ['Sales Manager', 'Team Manager'].includes(req.admin.role) && !SALES_ROLES.includes(user.role);
  if (!user || scopedOut) {
    return res.status(404).json({ success: false, result: null, message: 'No document found' });
  }

  const Team = mongoose.model('Team');
  const LoginActivity = mongoose.model('LoginActivity');
  const CallRecord = mongoose.model('CallRecord');
  const CallCampaign = mongoose.model('CallCampaign');
  const AgentCallState = mongoose.model('AgentCallState');
  const Lead = mongoose.model('Lead');

  const now = new Date();
  const dayKeys = [];
  for (let i = DAYS - 1; i >= 0; i -= 1) dayKeys.push(istDateKey(new Date(now.getTime() - i * DAY_MS)));
  const since = new Date(`${dayKeys[0]}T00:00:00+05:30`);
  const fullName = `${user.name} ${user.surname || ''}`.trim();
  const online = getOnlineUserIds().map(String).includes(String(user._id));

  const [reportsTo, teams, sessions, lastSession, loginCount, calls, totalCalls, state, pool, leadAgg] = await Promise.all([
    user.reportsTo ? Admin.findById(user.reportsTo).select('name surname role').lean() : null,
    Team.find({ removed: false, $or: [{ lead: { $in: [fullName, user.name] } }, { members: { $in: [fullName, user.name] } }] })
      .select('name lead color')
      .lean(),
    LoginActivity.find({ removed: false, admin: user._id, loginAt: { $gte: since } })
      .sort({ loginAt: -1 })
      .select('loginAt logoutAt durationSeconds')
      .lean(),
    LoginActivity.findOne({ removed: false, admin: user._id }).sort({ loginAt: -1 }).select('loginAt').lean(),
    LoginActivity.countDocuments({ removed: false, admin: user._id }),
    CallRecord.find({ removed: false, agent: user._id, created: { $gte: since } })
      .select('created duration status disposition')
      .lean(),
    CallRecord.countDocuments({ removed: false, agent: user._id }),
    AgentCallState.findOne({ agent: user._id }).lean(),
    CallCampaign.findOne({ isLeadPool: true, removed: false }).select('_id').lean(),
    Lead.aggregate([
      { $match: { removed: false, assignedUser: user._id } },
      { $group: { _id: '$stage', n: { $sum: 1 } } },
    ]),
  ]);

  const byDay = new Map(dayKeys.map((k) => [k, { day: k, loginSeconds: 0, sessions: 0, calls: 0, connected: 0, talkSeconds: 0 }]));
  const sessionSeconds = (s) =>
    s.durationSeconds != null
      ? s.durationSeconds
      : online
        ? Math.max(0, Math.round((now - new Date(s.loginAt)) / 1000))
        : 0;
  sessions.forEach((s) => {
    const d = byDay.get(istDateKey(new Date(s.loginAt)));
    if (!d) return;
    d.sessions += 1;
    d.loginSeconds += sessionSeconds(s);
  });
  calls.forEach((c) => {
    const d = byDay.get(istDateKey(new Date(c.created)));
    if (!d) return;
    d.calls += 1;
    if (callReachedCustomer(c)) d.connected += 1;
    d.talkSeconds += c.duration || 0;
  });

  const poolOn = !!(state && pool && state.status !== 'Offline' && String(state.campaign) === String(pool._id));
  const leadsByStage = Object.fromEntries(leadAgg.map((r) => [r._id || 'Unknown', r.n]));

  return res.status(200).json({
    success: true,
    result: {
      _id: user._id,
      name: fullName,
      email: user.email,
      phone: user.phone || null,
      photo: user.photo || null,
      role: user.role,
      subRole: user.subRole || null,
      businessName: user.businessName || null,
      businessSegment: user.businessSegment || null,
      enabled: user.enabled,
      removed: user.removed,
      created: user.created,
      lastSeenAt: user.lastSeenAt || null,
      online,
      reportsTo: reportsTo ? { name: `${reportsTo.name} ${reportsTo.surname || ''}`.trim(), role: reportsTo.role } : null,
      teams: teams.map((t) => ({ name: t.name, color: t.color, isLead: t.lead === fullName || t.lead === user.name })),
      login: {
        lastLoginAt: lastSession ? lastSession.loginAt : null,
        totalSessions: loginCount,
        recentSessions: sessions.slice(0, 10).map((s) => ({
          loginAt: s.loginAt,
          logoutAt: s.logoutAt || null,
          seconds: sessionSeconds(s),
        })),
      },
      days: [...byDay.values()],
      totalCalls,
      pool: {
        on: poolOn,
        status: state ? state.status : 'Offline',
        breakMinutesToday:
          state && state.shiftJoinedAt && istDateKey(state.shiftJoinedAt) === istDateKey(now) ? state.breakMinutesToday || 0 : 0,
      },
      leads: { total: leadAgg.reduce((t, r) => t + r.n, 0), byStage: leadsByStage },
    },
    message: 'ok',
  });
};

module.exports = overview;
