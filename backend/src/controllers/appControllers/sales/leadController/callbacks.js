const mongoose = require('mongoose');
const { leadScopeFilter } = require('./scope');

// GET /api/lead/callbacks?team=&assignedUser=&days=7
// The dedicated Callback / task section. Returns every lead currently in
// the "Call Back" stage with a scheduled callBackAt, bucketed into
// overdue / today / upcoming, newest-urgency first.
const callbacks = async (req, res) => {
  const Lead = mongoose.model('Lead');

  const now = new Date();
  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);
  const todayEnd = new Date(now);
  todayEnd.setHours(23, 59, 59, 999);

  const upcomingDays = Math.min(parseInt(req.query.days) || 30, 120);
  const horizon = new Date(todayEnd.getTime() + upcomingDays * 86400000);

  const filter = {
    removed: false,
    stage: 'Call Back',
    callBackAt: { $ne: null, $lte: horizon },
  };
  if (req.query.team) filter.team = req.query.team;
  if (req.query.assignedUser) filter.assignedUser = req.query.assignedUser;

  // Row-level visibility — same rule as every other Lead read path (see
  // scope.js). This was previously the one un-scoped raw-record endpoint
  // behind the "Callbacks" tab: any authenticated user could see every
  // team's callbacks company-wide.
  const scopeFilter = await leadScopeFilter(req.admin, req);
  const query = Object.keys(scopeFilter).length ? { $and: [filter, scopeFilter] } : filter;

  const leads = await Lead.find(query)
    .sort({ callBackAt: 1 })
    .limit(500)
    .populate('assignedUser', 'name surname')
    .lean();

  const overdue = [];
  const today = [];
  const upcoming = [];
  for (const l of leads) {
    const t = new Date(l.callBackAt);
    if (t < todayStart) overdue.push(l);
    else if (t <= todayEnd) today.push(l);
    else upcoming.push(l);
  }

  return res.status(200).json({
    success: true,
    result: {
      overdue,
      today,
      upcoming,
      counts: { overdue: overdue.length, today: today.length, upcoming: upcoming.length },
    },
    message: 'Successfully found callbacks',
  });
};

module.exports = callbacks;
