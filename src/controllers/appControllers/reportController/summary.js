const mongoose = require('mongoose');
const { MANAGEMENT_ROLES } = require('../../../config/roles');
const { stageForStatus } = require('../../../config/leadStages');

const RANGE_DAYS = { '1W': 7, '1M': 30, '3M': 90, '6M': 182, '1Y': 365 };
const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function secondsToLabel(totalSeconds) {
  const s = Math.max(0, Math.round(totalSeconds || 0));
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${String(sec).padStart(2, '0')}`;
}

// GET /api/report/summary?range=1W|1M|3M|6M|1Y&team=<name>&agent=<name>
//
// Unlike dashboard/summary and performance/summary, this is not scoped down
// for non-management callers — it's blocked outright, full stop. Only
// MANAGEMENT_ROLES (owner, Super Admin, Admin, Sales Manager) can call it.
const summary = async (req, res) => {
  if (!MANAGEMENT_ROLES.includes(req.admin.role)) {
    return res.status(403).json({
      success: false,
      result: null,
      message: 'Reports are only available to Super Admin, Admin and Sales Manager.',
    });
  }

  const Team = mongoose.model('Team');
  const Call = mongoose.model('Call');
  const Lead = mongoose.model('Lead');
  const Payment = mongoose.model('Payment');
  const Client = mongoose.model('Client');
  const Invoice = mongoose.model('Invoice');
  const Message = mongoose.model('Message');
  const Admin = mongoose.model('Admin');

  const range = RANGE_DAYS[req.query.range] ? req.query.range : '1M';
  const since = new Date(Date.now() - RANGE_DAYS[range] * 24 * 60 * 60 * 1000);

  const allTeams = await Team.find({ removed: false }).select('name members color').lean();

  const scopeTeam = req.query.team || null;
  const scopeAgent = req.query.agent || null;

  // ---- Calls — real per-agent data. ----
  const callMatch = { removed: false, created: { $gte: since } };
  if (scopeTeam) callMatch.team = scopeTeam;
  if (scopeAgent) callMatch.calledBy = scopeAgent;
  const calls = await Call.find(callMatch).select('status duration calledBy created').lean();

  // ---- Leads — team-level only, Lead has no individual owner (see Lead.js). ----
  const leadMatch = { removed: false, created: { $gte: since } };
  if (scopeTeam) leadMatch.team = scopeTeam;
  const leads = await Lead.find(leadMatch).select('status created').lean();
  const totalLeads = leads.length;
  // "Won" == the "Enrolled" pipeline stage now (legacy 'Won' folds in via
  // stageForStatus — see config/leadStages.js).
  const wonLeads = leads.filter((l) => stageForStatus(l.status) === 'Enrolled').length;

  // ---- Payments & new Clients — real per-agent data via createdBy, resolved
  // to a team in JS since neither model carries a team field of its own. ----
  const memberSet = scopeTeam
    ? new Set((allTeams.find((t) => t.name === scopeTeam) || {}).members || [])
    : null;
  const inScope = (name) => {
    if (!name) return false;
    if (scopeAgent) return name === scopeAgent;
    if (scopeTeam) return memberSet.has(name);
    return true;
  };

  const rawPayments = await Payment.find({ removed: false, created: { $gte: since } })
    .select('amount createdBy created')
    .lean();
  const payments = rawPayments.filter((p) => inScope(p.createdBy?.name));

  const rawClients = await Client.find({ removed: false, created: { $gte: since } })
    .select('createdBy created')
    .populate('createdBy', 'name')
    .lean();
  const clients = rawClients.filter((c) => inScope(c.createdBy?.name));

  const agentNames = scopeAgent
    ? [scopeAgent]
    : scopeTeam
    ? allTeams.find((t) => t.name === scopeTeam)?.members || []
    : [...new Set(allTeams.flatMap((t) => t.members))];

  const teamForAgent = (name) => allTeams.find((t) => t.members.includes(name)) || null;

  // Invoice.createdBy and Message.from are Admin ObjectId refs (unlike
  // Call.calledBy/Payment.createdBy.name which are already resolved to
  // names) — resolve agentNames to ids once so invoices/messages can be
  // attributed per agent the same way calls/deals already are.
  const agentAdmins = await Admin.find({ removed: false, name: { $in: agentNames } })
    .select('_id name')
    .lean();
  const idByName = new Map(agentAdmins.map((a) => [a.name, a._id.toString()]));
  const agentIds = agentAdmins.map((a) => a._id);

  const rawInvoices = await Invoice.find({ removed: false, created: { $gte: since }, createdBy: { $in: agentIds } })
    .select('createdBy taxTotal')
    .lean();
  const rawMessages = await Message.find({ removed: false, created: { $gte: since }, from: { $in: agentIds } })
    .select('from')
    .lean();

  const agents = agentNames
    .map((name) => {
      const myCalls = calls.filter((c) => c.calledBy === name);
      const conn = myCalls.filter((c) => c.status === 'Connected').length;
      const dur = myCalls.reduce((s, c) => s + (c.duration || 0), 0);
      const longest = myCalls.reduce((m, c) => Math.max(m, c.duration || 0), 0);
      const myPayments = payments.filter((p) => p.createdBy?.name === name);
      const myClients = clients.filter((c) => c.createdBy?.name === name);
      const team = teamForAgent(name);

      const myId = idByName.get(name);
      const myInvoices = myId ? rawInvoices.filter((i) => i.createdBy?.toString() === myId) : [];
      const myMessages = myId ? rawMessages.filter((m) => m.from?.toString() === myId) : [];

      return {
        name,
        team: team?.name || null,
        color: team?.color || '#2563EB',
        calls: myCalls.length,
        connected: conn,
        connectRatePct: myCalls.length ? Math.round((conn / myCalls.length) * 100) : 0,
        talkMinutes: Math.round(dur / 60),
        avgDurationLabel: secondsToLabel(myCalls.length ? dur / myCalls.length : 0),
        longestCallSec: longest,
        customers: myClients.length,
        deals: myPayments.length,
        revenue: myPayments.reduce((s, p) => s + (p.amount || 0), 0),
        invoices: myInvoices.length,
        taxCollected: myInvoices.reduce((s, i) => s + (i.taxTotal || 0), 0),
        messages: myMessages.length,
      };
    })
    .sort((a, b) => b.calls - a.calls);

  const totals = agents.reduce(
    (acc, a) => {
      acc.calls += a.calls;
      acc.connected += a.connected;
      acc.talkMinutes += a.talkMinutes;
      acc.customers += a.customers;
      acc.deals += a.deals;
      acc.revenue += a.revenue;
      acc.invoices += a.invoices;
      acc.taxCollected += a.taxCollected;
      acc.messages += a.messages;
      return acc;
    },
    { calls: 0, connected: 0, talkMinutes: 0, customers: 0, deals: 0, revenue: 0, invoices: 0, taxCollected: 0, messages: 0 }
  );

  const longestCallSec = calls.reduce((m, c) => Math.max(m, c.duration || 0), 0);

  // Real Mon–Sun talk-time distribution (grouped by day of week, not calendar
  // date) — stays meaningful no matter how long the selected range is.
  const weekdayMinutes = [0, 0, 0, 0, 0, 0, 0]; // Sun..Sat, matches Date#getDay()
  calls.forEach((c) => {
    weekdayMinutes[new Date(c.created).getDay()] += (c.duration || 0) / 60;
  });
  const talkByWeekday = DAY_LABELS.map((label, idx) => ({
    label,
    minutes: Math.round(weekdayMinutes[(idx + 1) % 7]),
  }));

  return res.status(200).json({
    success: true,
    result: {
      range,
      scope: { team: scopeTeam, agent: scopeAgent },
      filters: {
        teams: allTeams.map((t) => t.name),
        agents: agentNames,
      },
      totals: {
        ...totals,
        connectRatePct: totals.calls ? Math.round((totals.connected / totals.calls) * 100) : 0,
        avgDurationLabel: secondsToLabel(totals.calls ? (totals.talkMinutes * 60) / totals.calls : 0),
        longestCallSec,
        avgDealSize: totals.deals ? Math.round(totals.revenue / totals.deals) : 0,
        leads: totalLeads,
        wonLeads,
        conversionRatePct: totalLeads ? Math.round((wonLeads / totalLeads) * 100) : 0,
      },
      agents,
      talkByWeekday,
    },
    message: 'Successfully computed report summary',
  });
};

module.exports = summary;
