const mongoose = require('mongoose');
const {
  bucketConfig,
  bucketCounts,
  R,
  kpi,
  ratio,
  chart,
  groupBy,
  resolveDashboardScope,
  scopeFacets,
  ownerScopeFilter,
  teamFieldScopeFilter,
} = require('../shared');

const DEAL_OPEN = ['Qualification', 'Needs Analysis', 'Proposal', 'Negotiation'];
// Updated 2026-10 for the new lead-stage taxonomy — see config/leadStages.js.
const QUALIFIED = ['Interested Leads', 'Demo Booking', 'Prospects', 'Enrolled'];
const MEETING = ['Demo Booking', 'Prospects', 'Enrolled'];

function everStages(l) {
  const hist = Array.isArray(l.stageHistory) ? l.stageHistory : [];
  return new Set([l.stage || 'New Lead', ...hist.flatMap((h) => [h.fromStage, h.toStage].filter(Boolean))]);
}

async function summary({ from, to, prevFrom, prevTo, query, req }) {
  const Lead = mongoose.model('Lead');
  const Call = mongoose.model('Call');
  const CallRecord = mongoose.model('CallRecord');
  const SalesDeal = mongoose.model('SalesDeal');
  const SalesOrder = mongoose.model('SalesOrder');
  const SalesQuote = mongoose.model('SalesQuote');
  const Student = mongoose.model('Student');

  const scope = await resolveDashboardScope(req);
  const leadMatch = { removed: false, ...teamFieldScopeFilter(scope, 'team', 'assignedUserName') };
  const callMatch = { removed: false, ...teamFieldScopeFilter(scope, 'team', 'calledBy') };
  const callRecMatch = { removed: false, ...teamFieldScopeFilter(scope, 'team', 'agentName') };
  const dealMatch = { removed: false, ...ownerScopeFilter(scope, 'owner') };
  const orderMatch = { removed: false, ...ownerScopeFilter(scope, 'owner') };
  const quoteMatch = { removed: false, ...ownerScopeFilter(scope, 'owner') };
  const studentMatch = { removed: false, ...ownerScopeFilter(scope, 'counselor') };

  const win = (f) => ({ $gte: f === 'prev' ? prevFrom : from, $lte: f === 'prev' ? prevTo : to });

  const [leads, prevLeadCount, calls, callRecs, deals, orders, quotes, students, prevStudents] =
    await Promise.all([
      Lead.find({ ...leadMatch, created: win() })
        .select('_id name phone source stage subStatus assignedUserName team stageHistory created')
        .limit(50000)
        .lean(),
      Lead.countDocuments({ ...leadMatch, created: win('prev') }),
      Call.find({ ...callMatch, created: win() }).select('status created').limit(100000).lean(),
      CallRecord.find({ ...callRecMatch, created: win() }).select('status answeredAt created').limit(100000).lean(),
      SalesDeal.find({ ...dealMatch, created: win() }).select('stage amount created').limit(60000).lean(),
      SalesOrder.find({ ...orderMatch, created: win() }).select('status total paymentStatus created').limit(60000).lean(),
      SalesQuote.find({ ...quoteMatch, created: win() }).select('status created').limit(60000).lean(),
      Student.find({ ...studentMatch, created: win() }).select('status created').limit(60000).lean(),
      Student.countDocuments({ ...studentMatch, created: win('prev') }),
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
  const { teams: teamOptions, names: agentOptions, orgTree } = await scopeFacets(scope);

  return {
    range: { from, to, prevFrom, prevTo, bucket: bkt.unit },
    businessType: 'all',
    scope: scope.isFullAccess ? 'company' : scope.team ? `team:${scope.team}` : 'self',
    totals: { leads: leads.length, connected, enrolled, wonDeals: wonDeals.length, revenue, orders: orders.length },
    kpis: [
      kpi('leads', 'Total Leads', leads.length, prevLeadCount, leadSeries),
      kpi('students', 'New Candidates', students.length, prevStudents, enrolSeries),
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
        ['Leads', 'Contacted', 'Qualified', 'Demo Booking', 'Enrolled'],
        [{ label: 'Count', data: [leads.length, contacted, qualified, meetings, enrolled] }]
      ),
      dealsByStage: chart(dealsByStage.map((x) => x.label), [{ label: 'Deals', data: dealsByStage.map((x) => x.value) }]),
    },
    funnel: [
      { key: 'new', label: 'Leads', value: leads.length },
      { key: 'contacted', label: 'Contacted', value: contacted },
      { key: 'qualified', label: 'Qualified', value: qualified },
      { key: 'meeting', label: 'Demo Booking', value: meetings },
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
      // Scope-derived (real team roster), not data-derived — an empty
      // result window would otherwise leave these filter dropdowns with no
      // options at all, even though scoping itself is working correctly.
      teams: teamOptions,
      agents: agentOptions,
      orgTree,
    },
  };
}

module.exports = { summary };
