const mongoose = require('mongoose');
const { MANAGEMENT_ROLES } = require('@/config/roles');

const RANGE_DAYS = { '1M': 30, '3M': 90, '6M': 182, '1Y': 365 };

function secondsToLabel(totalSeconds) {
  const s = Math.max(0, Math.round(totalSeconds || 0));
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${String(sec).padStart(2, '0')}`;
}

function dayBucketKey(d) {
  return new Date(d).toISOString().slice(0, 10);
}

function weekBucketKey(d) {
  const date = new Date(d);
  const onejan = new Date(date.getFullYear(), 0, 1);
  const week = Math.ceil(((date - onejan) / 86400000 + onejan.getDay() + 1) / 7);
  return `${date.getFullYear()}-W${String(week).padStart(2, '0')}`;
}

// GET /api/dashboard/summary?range=1M|3M|6M|1Y&team=<name>&agent=<name>
const summary = async (req, res) => {
  const Team = mongoose.model('Team');
  const Call = mongoose.model('Call');
  const Lead = mongoose.model('Lead');

  const range = RANGE_DAYS[req.query.range] ? req.query.range : '1M';
  const since = new Date(Date.now() - RANGE_DAYS[range] * 24 * 60 * 60 * 1000);

  const isManagement = MANAGEMENT_ROLES.includes(req.admin.role);

  let myTeam = null;
  if (!isManagement) {
    myTeam = await Team.findOne({ removed: false, members: req.admin.name }).exec();
  }

  // Resolve the actual scope for this request — this is the only place
  // authorization for team/agent filtering happens.
  let scopeTeam = null;
  let scopeAgent = null;

  if (isManagement) {
    scopeTeam = req.query.team || null;
    scopeAgent = req.query.agent || null;
  } else if (myTeam) {
    scopeTeam = myTeam.name; // team-wide — naturally includes their own rows
  } else {
    scopeAgent = req.admin.name; // no team — just their own data
  }

  const callMatch = { removed: false, created: { $gte: since } };
  if (scopeTeam) callMatch.team = scopeTeam;
  if (scopeAgent) callMatch.calledBy = scopeAgent;

  // Leads only carry a team string, not an individual owner — an agent
  // filter can't narrow leads any further than its team already does.
  const leadMatch = { removed: false, created: { $gte: since } };
  if (scopeTeam) leadMatch.team = scopeTeam;

  const [calls, leads, allTeams] = await Promise.all([
    Call.find(callMatch).select('status duration calledBy created').lean(),
    Lead.find(leadMatch).select('status created').lean(),
    isManagement ? Team.find({ removed: false }).select('name members').lean() : Promise.resolve([]),
  ]);

  const totalCalls = calls.length;
  const connected = calls.filter((c) => c.status === 'Connected').length;
  const missed = totalCalls - connected;
  const totalDuration = calls.reduce((s, c) => s + (c.duration || 0), 0);
  const connectRatePct = totalCalls ? Math.round((connected / totalCalls) * 100) : 0;

  const totalLeads = leads.length;
  const wonLeads = leads.filter((l) => l.status === 'Won').length;
  const conversionRatePct = totalLeads ? Math.round((wonLeads / totalLeads) * 100) : 0;

  const outcome = { Connected: 0, Missed: 0, 'No Answer': 0, Busy: 0, Voicemail: 0 };
  calls.forEach((c) => {
    outcome[c.status] = (outcome[c.status] || 0) + 1;
  });

  const bucketByDay = range === '1M';
  const bucketMap = {};
  calls.forEach((c) => {
    const key = bucketByDay ? dayBucketKey(c.created) : weekBucketKey(c.created);
    if (!bucketMap[key]) bucketMap[key] = { connected: 0, missed: 0 };
    if (c.status === 'Connected') bucketMap[key].connected++;
    else bucketMap[key].missed++;
  });
  const callsOverTime = Object.keys(bucketMap)
    .sort()
    .map((key) => ({ label: key, connected: bucketMap[key].connected, missed: bucketMap[key].missed }));

  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const todayMatch = { removed: false, created: { $gte: startOfToday } };
  if (scopeTeam) todayMatch.team = scopeTeam;
  if (scopeAgent) todayMatch.calledBy = scopeAgent;
  const todaysCalls = await Call.find(todayMatch).select('status').lean();
  const callStatusToday = { Connected: 0, Missed: 0, 'No Answer': 0, Busy: 0, Voicemail: 0 };
  todaysCalls.forEach((c) => {
    callStatusToday[c.status] = (callStatusToday[c.status] || 0) + 1;
  });

  const agentNames = scopeAgent
    ? [scopeAgent]
    : [...new Set(calls.map((c) => c.calledBy).filter(Boolean))];

  const agents = agentNames
    .map((name) => {
      const mine = calls.filter((c) => c.calledBy === name);
      const conn = mine.filter((c) => c.status === 'Connected').length;
      const dur = mine.reduce((s, c) => s + (c.duration || 0), 0);
      return {
        name,
        calls: mine.length,
        connected: conn,
        missed: mine.length - conn,
        connectRatePct: mine.length ? Math.round((conn / mine.length) * 100) : 0,
        avgDurationLabel: secondsToLabel(mine.length ? dur / mine.length : 0),
      };
    })
    .sort((a, b) => b.calls - a.calls);

  const topPerformer = agents[0] || null;

  return res.status(200).json({
    success: true,
    result: {
      range,
      scope: {
        isManagement,
        role: req.admin.role,
        team: scopeTeam,
        agent: scopeAgent,
      },
      filters: {
        teams: isManagement ? allTeams.map((t) => t.name) : myTeam ? [myTeam.name] : [],
        agents: isManagement
          ? [...new Set(allTeams.flatMap((t) => t.members))]
          : myTeam
          ? myTeam.members
          : [req.admin.name],
      },
      kpis: {
        totalCalls,
        connected,
        missed,
        avgDurationLabel: secondsToLabel(totalCalls ? totalDuration / totalCalls : 0),
        connectRatePct,
        totalLeads,
        wonLeads,
        conversionRatePct,
      },
      callsOverTime,
      outcome,
      callStatusToday,
      topPerformer,
      agents,
    },
    message: 'Successfully computed dashboard summary',
  });
};

module.exports = summary;
