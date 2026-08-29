const mongoose = require('mongoose');
const { getOnlineUserIds } = require('../../../socket');
const { dayRange, isSameDayAsToday } = require('./_dayRange');

// GET /api/loginactivity/summary?date=YYYY-MM-DD&page=1&limit=10 — every
// registered admin ("jitne register hai sab yaha show ho"), paginated 10 at
// a time, each with that day's login count, total logged-in hours, and live
// online/offline status (see backend/src/socket.js's session tracking).
const summary = async (req, res) => {
  const Admin = mongoose.model('Admin');
  const LoginActivity = mongoose.model('LoginActivity');

  const page = Math.max(parseInt(req.query.page) || 1, 1);
  const limit = Math.min(parseInt(req.query.limit) || 10, 100);
  const skip = (page - 1) * limit;
  const { start, end } = dayRange(req.query.date);
  const isToday = isSameDayAsToday(req.query.date);

  const [admins, count] = await Promise.all([
    Admin.find({ removed: false, enabled: true })
      .select('name surname role')
      .sort({ name: 1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    Admin.countDocuments({ removed: false, enabled: true }),
  ]);

  const adminIds = admins.map((a) => a._id);
  const sessions = await LoginActivity.find({
    removed: false,
    admin: { $in: adminIds },
    loginAt: { $gte: start, $lt: end },
  })
    .select('admin loginAt logoutAt durationSeconds')
    .lean();

  const onlineIds = new Set(getOnlineUserIds());

  const now = new Date();
  const statsByAdmin = {};
  sessions.forEach((s) => {
    const key = String(s.admin);
    if (!statsByAdmin[key]) statsByAdmin[key] = { loginCount: 0, totalSeconds: 0 };
    statsByAdmin[key].loginCount += 1;
    if (s.durationSeconds != null) {
      statsByAdmin[key].totalSeconds += s.durationSeconds;
    } else if (isToday && onlineIds.has(key)) {
      // Still-open AND actually online right now — count elapsed time so
      // far so "hours today" stays live. A session can be "open" (no
      // durationSeconds) without the admin being online if the server
      // restarted mid-session before it could close cleanly (see the
      // startup cleanup in socket.js) — don't count elapsed time for those,
      // or an orphaned session would inflate this forever.
      statsByAdmin[key].totalSeconds += Math.max(0, Math.round((now - new Date(s.loginAt)) / 1000));
    }
  });

  const result = admins.map((a) => {
    const stats = statsByAdmin[String(a._id)] || { loginCount: 0, totalSeconds: 0 };
    return {
      _id: a._id,
      name: a.surname ? `${a.name} ${a.surname}` : a.name,
      role: a.role,
      online: onlineIds.has(String(a._id)),
      loginCount: stats.loginCount,
      hoursToday: Math.round((stats.totalSeconds / 3600) * 100) / 100,
    };
  });

  return res.status(200).json({
    success: true,
    result,
    pagination: { page, pages: Math.ceil(count / limit) || 1, count },
    message: 'Successfully computed login activity summary',
  });
};

module.exports = summary;
