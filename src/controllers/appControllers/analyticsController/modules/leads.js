const mongoose = require('mongoose');
const {
  bucketConfig,
  bucketCounts,
  R,
  kpi,
  ratio,
  chart,
  groupBy,
  teamNamesForBiz,
} = require('../shared');
const { applyDrawer, drillToMongo, paginate } = require('./_util');

// Stage buckets (mirror salesDashboardController + config/leadStages.js order).
const QUALIFIED = ['SUP Call', 'Interested', 'Sales Meeting', 'Opportunity', 'Enrolled'];
const MEETING = ['Sales Meeting', 'Opportunity', 'Enrolled'];
const OPPORTUNITY = ['Opportunity', 'Enrolled'];
const INTERESTED_EVER = ['Interested', 'Sales Meeting', 'Opportunity', 'Enrolled'];
const CONTACTED_EVER = ['Contacted', 'SUP Call', 'Fresh Lead', ...INTERESTED_EVER];

const DATE_FIELDS = { created: 'created', stageUpdatedAt: 'stageUpdatedAt' };

const DRAWER_SPEC = {
  source: { field: 'source', kind: 'in' },
  stage: { field: 'stage', kind: 'in' },
  team: { field: 'team', kind: 'in' },
  owner: { field: 'assignedUserName', kind: 'in' },
  city: { field: 'city', kind: 'regex' },
  hasFollowUp: { field: 'nextFollowUpAt', kind: 'bool' },
};

function everStages(l) {
  const hist = Array.isArray(l.stageHistory) ? l.stageHistory : [];
  return new Set([
    l.stage || 'New Lead',
    ...hist.flatMap((h) => [h.fromStage, h.toStage].filter(Boolean)),
  ]);
}

async function baseFilter(query) {
  const dateField = DATE_FIELDS[query.dateBasis] || 'created';
  const filter = { removed: false };
  const teamNames = await teamNamesForBiz(query.businessType);
  if (teamNames) filter.team = { $in: teamNames };
  applyDrawer(filter, query, DRAWER_SPEC);
  return { filter, dateField };
}

function classify(leads) {
  let qualified = 0,
    contacted = 0,
    meetings = 0,
    enrolled = 0,
    noResponse = 0,
    invalid = 0,
    interested = 0,
    opportunity = 0,
    newLeads = 0;
  for (const l of leads) {
    const stage = l.stage || 'New Lead';
    const ever = everStages(l);
    if (QUALIFIED.some((s) => ever.has(s))) qualified += 1;
    if (
      !!l.lastContactAt ||
      stage !== 'New Lead' ||
      CONTACTED_EVER.some((s) => ever.has(s))
    )
      contacted += 1;
    if (MEETING.some((s) => ever.has(s))) meetings += 1;
    if (INTERESTED_EVER.some((s) => ever.has(s))) interested += 1;
    if (OPPORTUNITY.some((s) => ever.has(s))) opportunity += 1;
    if (stage === 'Enrolled' || ever.has('Enrolled')) enrolled += 1;
    if (stage === 'No Response') noResponse += 1;
    if (stage === 'Invalid') invalid += 1;
    if (stage === 'New Lead') newLeads += 1;
  }
  return { qualified, contacted, meetings, enrolled, noResponse, invalid, interested, opportunity, newLeads };
}

async function summary({ from, to, prevFrom, prevTo, query }) {
  const Lead = mongoose.model('Lead');
  const Call = mongoose.model('Call');
  const CallRecord = mongoose.model('CallRecord');
  const { filter, dateField } = await baseFilter(query);

  const [leads, prevLeads] = await Promise.all([
    Lead.find({ ...filter, [dateField]: { $gte: from, $lte: to } })
      .select('_id stage subStatus stageHistory source team assignedUserName created stageUpdatedAt lastContactAt nextFollowUpAt city')
      .limit(50000)
      .lean(),
    Lead.find({ ...filter, [dateField]: { $gte: prevFrom, $lte: prevTo } })
      .select('_id stage stageHistory lastContactAt')
      .limit(50000)
      .lean(),
  ]);

  // Calls in the window scoped to the same teams — for the Lead → Calling ratio.
  const callFilter = { removed: false, created: { $gte: from, $lte: to } };
  if (filter.team) callFilter.team = filter.team;
  const [calls, callRecs] = await Promise.all([
    Call.find(callFilter).select('lead').limit(100000).lean(),
    CallRecord.find(callFilter).select('callLead').limit(100000).lean(),
  ]);
  const calledLeadIds = new Set([
    ...calls.map((c) => String(c.lead || '')),
    ...callRecs.map((c) => String(c.callLead || '')),
  ]);
  calledLeadIds.delete('');
  const leadsWithCall = leads.filter((l) => calledLeadIds.has(String(l._id))).length;

  const cur = classify(leads);
  const prev = classify(prevLeads);
  const total = leads.length;
  const prevTotal = prevLeads.length;

  const bkt = bucketConfig(from, to);
  const sr = (rows, pred) => bucketCounts(rows.filter(pred), dateField, bkt);
  const allSeries = bucketCounts(leads, dateField, bkt);

  const kpis = [
    kpi('total', 'Total Leads', total, prevTotal, allSeries),
    kpi('qualified', 'Qualified', cur.qualified, prev.qualified,
      sr(leads, (l) => QUALIFIED.some((s) => everStages(l).has(s)))),
    kpi('contacted', 'First Response', cur.contacted, prev.contacted,
      sr(leads, (l) => l.lastContactAt || (l.stage && l.stage !== 'New Lead'))),
    kpi('meetings', 'Sales Meetings', cur.meetings, prev.meetings,
      sr(leads, (l) => MEETING.some((s) => everStages(l).has(s)))),
    kpi('enrolled', 'Enrolled', cur.enrolled, prev.enrolled,
      sr(leads, (l) => l.stage === 'Enrolled' || everStages(l).has('Enrolled'))),
    kpi('noResponse', 'No Response', cur.noResponse, prev.noResponse,
      sr(leads, (l) => l.stage === 'No Response'), { positiveWhenDown: true }),
    kpi('invalid', 'Invalid / Junk', cur.invalid, prev.invalid,
      sr(leads, (l) => l.stage === 'Invalid'), { positiveWhenDown: true }),
    kpi('convPct', 'Lead → Enrolled', total ? (cur.enrolled / total) * 100 : 0,
      prevTotal ? (prev.enrolled / prevTotal) * 100 : 0, [], { fmt: 'pct' }),
  ];

  const ratios = [
    ratio('leadQualification', 'Qualification', R(cur.qualified, total), R(prev.qualified, prevTotal)),
    ratio('firstResponse', 'First Response', R(cur.contacted, total), R(prev.contacted, prevTotal)),
    ratio('leadToSalesMeeting', 'Lead → Meeting', R(cur.meetings, total), R(prev.meetings, prevTotal)),
    ratio('salesMeetingToEnrolled', 'Meeting → Enrolled', R(cur.enrolled, cur.meetings), R(prev.enrolled, prev.meetings)),
    ratio('noResponseRate', 'No Response', R(cur.noResponse, total), R(prev.noResponse, prevTotal), { positiveWhenDown: true }),
    ratio('leadToCalling', 'Lead → Calling', R(leadsWithCall, total), null),
  ];

  const bySource = groupBy(leads, (l) => l.source || 'Unknown');
  const byStage = groupBy(leads, (l) => l.stage || 'New Lead', { sort: false });
  const byTeam = groupBy(leads, (l) => l.team || 'Unassigned');
  const byOwner = groupBy(leads, (l) => l.assignedUserName || 'Unassigned');

  const charts = {
    trend: chart(bkt.labels, [{ label: 'Leads', data: allSeries }]),
    bySource: chart(bySource.map((x) => x.label), [{ label: 'Leads', data: bySource.map((x) => x.value) }]),
    byStage: chart(byStage.map((x) => x.label), [{ label: 'Leads', data: byStage.map((x) => x.value) }]),
    byTeam: chart(byTeam.map((x) => x.label), [{ label: 'Leads', data: byTeam.map((x) => x.value) }]),
    byOwner: chart(byOwner.map((x) => x.label), [{ label: 'Leads', data: byOwner.map((x) => x.value) }]),
  };

  const funnel = [
    { key: 'new', label: 'New', value: total },
    { key: 'contacted', label: 'Contacted', value: cur.contacted },
    { key: 'interested', label: 'Interested', value: cur.interested },
    { key: 'meeting', label: 'Sales Meeting', value: cur.meetings },
    { key: 'opportunity', label: 'Opportunity', value: cur.opportunity },
    { key: 'enrolled', label: 'Enrolled', value: cur.enrolled },
  ];

  return {
    range: { from, to, prevFrom, prevTo, bucket: bkt.unit },
    businessType: query.businessType || 'all',
    totals: { leads: total, ...cur },
    kpis,
    ratios,
    charts,
    funnel,
    table: { mode: 'server', meta: { total } },
    facets: {
      sources: [...new Set(leads.map((l) => l.source).filter(Boolean))].sort(),
      teams: [...new Set(leads.map((l) => l.team).filter(Boolean))].sort(),
      owners: [...new Set(leads.map((l) => l.assignedUserName).filter(Boolean))].sort(),
    },
  };
}

async function rows({ from, to, query }) {
  const Lead = mongoose.model('Lead');
  const { filter, dateField } = await baseFilter(query);
  const full = {
    ...filter,
    [dateField]: { $gte: from, $lte: to },
    ...drillToMongo(query),
  };
  if (query.q) {
    full.$or = [
      { name: { $regex: query.q, $options: 'i' } },
      { phone: { $regex: query.q, $options: 'i' } },
      { email: { $regex: query.q, $options: 'i' } },
    ];
  }
  const { items, skip, sort } = paginate(query);
  const [docs, count] = await Promise.all([
    Lead.find(full)
      .select('name phone email source stage subStatus assignedUserName team city created nextFollowUpAt')
      .sort(sort)
      .skip(skip)
      .limit(items)
      .lean(),
    Lead.countDocuments(full),
  ]);
  return {
    rows: docs.map((d) => ({ ...d, id: String(d._id) })),
    pagination: { page: Math.floor(skip / items) + 1, pages: Math.max(1, Math.ceil(count / items)), count },
  };
}

module.exports = { summary, rows };
