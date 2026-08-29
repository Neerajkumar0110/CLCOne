const mongoose = require('mongoose');
const { MANAGEMENT_ROLES } = require('../../../config/roles');

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

// GET /api/performance/summary?range=1M|3M|6M|1Y&team=<name>&agent=<name>
//
// Same scoping rule as dashboard/summary: MANAGEMENT_ROLES (owner, Super
// Admin, Admin, Sales Manager) see company-wide data and may filter by team
// or agent; everyone else is force-scoped server-side to their own team (or
// just themselves, if they're not on one) — a non-management caller can
// never see another team's numbers, regardless of what they pass in the
// query string.
const summary = async (req, res) => {
  const Team = mongoose.model('Team');
  const Call = mongoose.model('Call');
  const Payment = mongoose.model('Payment');

  const range = RANGE_DAYS[req.query.range] ? req.query.range : '1M';
  const since = new Date(Date.now() - RANGE_DAYS[range] * 24 * 60 * 60 * 1000);

  const isManagement = MANAGEMENT_ROLES.includes(req.admin.role);

  const allTeams = await Team.find({ removed: false }).select('name members color').lean();

  let myTeam = null;
  if (!isManagement) {
    myTeam = allTeams.find((t) => t.members.includes(req.admin.name)) || null;
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

  // ---- Calls — real per-agent data, filtered straight in the query. ----
  const callMatch = { removed: false, created: { $gte: since } };
  if (scopeTeam) callMatch.team = scopeTeam;
  if (scopeAgent) callMatch.calledBy = scopeAgent;
  const calls = await Call.find(callMatch).select('status duration calledBy created').lean();

  // ---- Payments — real per-agent revenue. Payment has no team field of its
  // own (createdBy is autopopulated with the Admin doc — see Payment model),
  // so team scoping is applied here in JS against that team's member list
  // rather than in the query. ----
  const memberSet = scopeTeam
    ? new Set((allTeams.find((t) => t.name === scopeTeam) || {}).members || [])
    : null;

  const rawPayments = await Payment.find({ removed: false, created: { $gte: since } })
    .select('amount createdBy created')
    .lean();

  const payments = rawPayments.filter((p) => {
    const name = p.createdBy?.name;
    if (!name) return false;
    if (scopeAgent) return name === scopeAgent;
    if (scopeTeam) return memberSet.has(name);
    return true; // management, no team/agent filter — every payment is in scope
  });

  // Which agents to report on — identical enforcement to what scoped the
  // queries above, so a non-management caller only ever sees their own team.
  const agentNames = scopeAgent
    ? [scopeAgent]
    : scopeTeam
    ? (allTeams.find((t) => t.name === scopeTeam)?.members || [])
    : isManagement
    ? [...new Set(allTeams.flatMap((t) => t.members))]
    : [req.admin.name];

  const teamForAgent = (name) => allTeams.find((t) => t.members.includes(name)) || null;

  const agents = agentNames
    .map((name) => {
      const myCalls = calls.filter((c) => c.calledBy === name);
      const conn = myCalls.filter((c) => c.status === 'Connected').length;
      const dur = myCalls.reduce((s, c) => s + (c.duration || 0), 0);
      const myPayments = payments.filter((p) => p.createdBy?.name === name);
      const sales = myPayments.reduce((s, p) => s + (p.amount || 0), 0);
      const team = teamForAgent(name);

      return {
        name,
        team: team?.name || null,
        color: team?.color || '#2563EB',
        calls: myCalls.length,
        connected: conn,
        missed: myCalls.length - conn,
        connectRatePct: myCalls.length ? Math.round((conn / myCalls.length) * 100) : 0,
        avgDurationLabel: secondsToLabel(myCalls.length ? dur / myCalls.length : 0),
        deals: myPayments.length,
        sales,
      };
    })
    .sort((a, b) => b.calls - a.calls);

  const totals = agents.reduce(
    (acc, a) => {
      acc.calls += a.calls;
      acc.connected += a.connected;
      acc.deals += a.deals;
      acc.sales += a.sales;
      return acc;
    },
    { calls: 0, connected: 0, deals: 0, sales: 0 }
  );

  const bucketByDay = range === '1M';
  const callBucket = {};
  calls.forEach((c) => {
    const key = bucketByDay ? dayBucketKey(c.created) : weekBucketKey(c.created);
    callBucket[key] = (callBucket[key] || 0) + 1;
  });
  const salesBucket = {};
  payments.forEach((p) => {
    const key = bucketByDay ? dayBucketKey(p.created) : weekBucketKey(p.created);
    salesBucket[key] = (salesBucket[key] || 0) + (p.amount || 0);
  });
  const weeklyTrend = [...new Set([...Object.keys(callBucket), ...Object.keys(salesBucket)])]
    .sort()
    .map((key) => ({ label: key, calls: callBucket[key] || 0, sales: salesBucket[key] || 0 }));

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
        agents: agentNames,
      },
      totals: {
        ...totals,
        connectRatePct: totals.calls ? Math.round((totals.connected / totals.calls) * 100) : 0,
        avgDealSize: totals.deals ? Math.round(totals.sales / totals.deals) : 0,
      },
      agents,
      weeklyTrend,
    },
    message: 'Successfully computed performance summary',
  });
};

module.exports = summary;
