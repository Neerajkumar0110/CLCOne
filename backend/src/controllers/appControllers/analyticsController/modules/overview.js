const mongoose = require('mongoose');
const { MANAGEMENT_ROLES } = require('../../../../config/roles');
const { bucketConfig, bucketCounts, R, kpi, ratio, chart, groupBy } = require('../shared');

const DEAL_OPEN = ['Qualification', 'Needs Analysis', 'Proposal', 'Negotiation'];
const QUALIFIED = ['SUP Call', 'Interested', 'Sales Meeting', 'Opportunity', 'Enrolled'];
const MEETING = ['Sales Meeting', 'Opportunity', 'Enrolled'];

function everStages(l) {
  const hist = Array.isArray(l.stageHistory) ? l.stageHistory : [];
  return new Set([l.stage || 'New Lead', ...hist.flatMap((h) => [h.fromStage, h.toStage].filter(Boolean))]);
}

// Resolve the data scope for this request (mirrors dashboardController).
async function resolveScope(req) {
  const isManagement = MANAGEMENT_ROLES.includes(req.admin && req.admin.role);
  if (isManagement) return { isManagement, team: null, agent: null };
  const Team = mongoose.model('Team');
  const myTeam = await Team.findOne({ removed: false, members: req.admin.name }).lean();
  return myTeam
    ? { isManagement, team: myTeam.name, agent: null }
    : { isManagement, team: null, agent: req.admin.name };
}

async function summary({ from, to, prevFrom, prevTo, query, req }) {
  const Lead = mongoose.model('Lead');
  const Call = mongoose.model('Call');
  const CallRecord = mongoose.model('CallRecord');
  const SalesDeal = mongoose.model('SalesDeal');
  const SalesOrder = mongoose.model('SalesOrder');
  const SalesQuote = mongoose.model('SalesQuote');
  const Student = mongoose.model('Student');

  const scope = await resolveScope(req);
  const leadMatch = { removed: false };
  const callMatch = { removed: false };
  if (scope.team) {
    leadMatch.team = scope.team;
    callMatch.team = scope.team;
  }
  if (scope.agent) callMatch.calledBy = scope.agent;

  const win = (f) => ({ $gte: f === 'prev' ? prevFrom : from, $lte: f === 'prev' ? prevTo : to });

  const [leads, prevLeadCount, calls, callRecs, deals, orders, quotes, students, prevStudents] =
    await Promise.all([
      Lead.find({ ...leadMatch, created: win() })
        .select('_id name phone source stage subStatus assignedUserName team stageHistory created')
        .limit(50000)
        .lean(),
      Lead.countDocuments({ ...leadMatch, created: win('prev') }),
      Call.find({ ...callMatch, created: win() }).select('status created').limit(100000).lean(),
      CallRecord.find({ ...(scope.team ? { team: scope.team } : {}), removed: false, created: win() })
        .select('status answeredAt created')
        .limit(100000)
        .lean(),
      SalesDeal.find({ removed: false, created: win() }).select('stage amount created').limit(60000).lean(),
      SalesOrder.find({ removed: false, created: win() }).select('status total paymentStatus created').limit(60000).lean(),
      SalesQuote.find({ removed: false, created: win() }).select('status created').limit(60000).lean(),
      Student.find({ removed: false, created: win() }).select('status created').limit(60000).lean(),
      Student.countDocuments({ removed: false, created: win('prev') }),
    ]);

  const bkt = bucketConfig(from, to);

  const connected =
    calls.filter((c) => c.status === 'Connected').length +
    callRecs.filter((c) => c.answeredAt || ['connected', 'completed'].includes(c.status)).length;
  const enrolled = leads.filter((l) => l.stage === 'Enrolled' || everStages(l).has('Enrolled')).length;
  const contacted = leads.filter((l) => (l.stage && l.stage !== 'New Lead')).length;
  const qualified = leads.filter((l) => QUALIFIED.some((s) => everStages(l).has(s))).length;
  const meetings = leads.filter((l) => MEETING.some((s) => everStages(l).has(s))).length;

  const wonDeals = deals.filter((d) => d.stage === 'Closed Won');
  const lostDeals = deals.filter((d) => d.stage === 'Closed Lost');
  const openDeals = deals.filter((d) => DEAL_OPEN.includes(d.stage));
  const revenue = orders.filter((o) => o.paymentStatus === 'Paid').reduce((s, o) => s + (o.total || 0), 0);
  const fulfilled = orders.filter((o) => ['Fulfilled', 'Invoiced', 'Partially Fulfilled'].includes(o.status)).length;
  const acceptedQ = quotes.filter((q) => q.status === 'Accepted').length;

  const leadSeries = bucketCounts(leads, 'created', bkt);
  const callSeries = bucketCounts([...calls, ...callRecs], 'created', bkt);
  const enrolSeries = bucketCounts(leads.filter((l) => l.stage === 'Enrolled'), 'created', bkt);
  const revSeries = bucketCounts(orders, 'created', bkt, (o) => (o.paymentStatus === 'Paid' ? o.total || 0 : 0));

  const dealsByStage = groupBy(deals, (d) => d.stage || 'Qualification', { sort: false });

  return {
    range: { from, to, prevFrom, prevTo, bucket: bkt.unit },
    businessType: 'all',
    scope: scope.isManagement ? 'company' : scope.team ? `team:${scope.team}` : 'self',
    totals: { leads: leads.length, connected, enrolled, wonDeals: wonDeals.length, revenue, orders: orders.length },
    kpis: [
      kpi('leads', 'Total Leads', leads.length, prevLeadCount, leadSeries),
      kpi('students', 'New Students', students.length, prevStudents, enrolSeries),
      kpi('connected', 'Calls Connected', connected, 0, callSeries),
      kpi('wonDeals', 'Deals Won', wonDeals.length, 0, []),
      kpi('revenue', 'Revenue (paid orders)', revenue, 0, revSeries, { fmt: 'money' }),
      kpi('pipelineValue', 'Open Pipeline Value', openDeals.reduce((s, d) => s + (d.amount || 0), 0), 0, [], { fmt: 'money' }),
      kpi('orders', 'Total Orders', orders.length, 0, bucketCounts(orders, 'created', bkt)),
      kpi('lostDeals', 'Lost Deals', lostDeals.length, 0, [], { positiveWhenDown: true }),
    ],
    ratios: [
      ratio('leadToEnrolled', 'Lead → Enrolled', R(enrolled, leads.length)),
      ratio('callConnect', 'Call connect', R(connected, calls.length + callRecs.length)),
      ratio('dealWin', 'Deal win', R(wonDeals.length, wonDeals.length + lostDeals.length)),
      ratio('quoteAcceptance', 'Quote acceptance', R(acceptedQ, quotes.length)),
      ratio('orderFulfilment', 'Order fulfilment', R(fulfilled, orders.length)),
    ],
    charts: {
      trend: chart(bkt.labels, [
        { label: 'Leads', data: leadSeries },
        { label: 'Calls', data: callSeries },
        { label: 'Enrolments', data: enrolSeries },
      ]),
      revenueByMonth: chart(bkt.labels, [{ label: 'Revenue', data: revSeries }]),
      companyFunnel: chart(
        ['Leads', 'Contacted', 'Qualified', 'Meeting', 'Enrolled'],
        [{ label: 'Count', data: [leads.length, contacted, qualified, meetings, enrolled] }]
      ),
      dealsByStage: chart(dealsByStage.map((x) => x.label), [{ label: 'Deals', data: dealsByStage.map((x) => x.value) }]),
    },
    funnel: [
      { key: 'new', label: 'Leads', value: leads.length },
      { key: 'contacted', label: 'Contacted', value: contacted },
      { key: 'qualified', label: 'Qualified', value: qualified },
      { key: 'meeting', label: 'Meeting', value: meetings },
      { key: 'enrolled', label: 'Enrolled', value: enrolled },
    ],
    table: {
      mode: 'client',
      rows: leads
        .slice()
        .sort((a, b) => new Date(b.created) - new Date(a.created))
        .slice(0, 200)
        .map((l) => ({
          id: String(l._id),
          name: l.name,
          phone: l.phone,
          source: l.source,
          stage: l.stage,
          assignedUserName: l.assignedUserName,
          team: l.team,
          created: l.created,
        })),
      meta: { total: leads.length },
    },
    facets: {
      sources: [...new Set(leads.map((l) => l.source).filter(Boolean))].sort(),
      teams: [...new Set(leads.map((l) => l.team).filter(Boolean))].sort(),
    },
  };
}

module.exports = { summary };
