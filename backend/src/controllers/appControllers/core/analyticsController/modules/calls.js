const mongoose = require('mongoose');
const { bucketConfig, bucketCounts, R, kpi, ratio, chart, groupBy, teamNamesForBiz } = require('../shared');
const { applyDrawer, drillToMongo, paginate } = require('./_util');

const CONNECTED_CR = ['connected', 'completed', 'onhold', 'transferred'];
const MISSED_CR = ['no-answer', 'busy', 'cancelled'];
const FAILED_CR = ['failed'];

const DRAWER = {
  direction: { field: 'direction', kind: 'in' },
  status: { field: 'status', kind: 'in' },
  agent: { field: 'agentName', kind: 'in' },
  disposition: { field: 'disposition', kind: 'in' },
};

// Normalise a CallRecord or legacy Call into one shape.
function normRecord(r) {
  const connected = CONNECTED_CR.includes(r.status) || !!r.answeredAt;
  const missed = MISSED_CR.includes(r.status);
  const failed = FAILED_CR.includes(r.status);
  return {
    id: String(r._id),
    when: r.created,
    contactName: r.contactName || '',
    phone: r.phone || '',
    agentName: r.agentName || '',
    direction: r.direction === 'Inbound' ? 'Inbound' : 'Outbound',
    status: r.status,
    duration: r.duration || 0,
    disposition: r.disposition || '',
    leadId: r.callLead ? String(r.callLead) : '',
    connected,
    missed,
    failed,
    voicemail: r.status === 'voicemail',
    ringing: !!r.ringingAt || !!r.answeredAt || connected,
    completed: r.status === 'completed' || !!r.endedAt,
  };
}
function normLegacy(r) {
  const connected = r.status === 'Connected';
  return {
    id: String(r._id),
    when: r.created,
    contactName: r.contactName || '',
    phone: r.phone || '',
    agentName: r.calledBy || '',
    direction: r.direction === 'Inbound' ? 'Inbound' : 'Outbound',
    status: r.status,
    duration: r.duration || 0,
    disposition: '',
    leadId: r.lead ? String(r.lead) : '',
    connected,
    missed: r.status === 'Missed' || r.status === 'No Answer' || r.status === 'Busy',
    failed: false,
    voicemail: r.status === 'Voicemail',
    ringing: true,
    completed: connected,
  };
}

async function loadWindow(from, to, query) {
  const CallRecord = mongoose.model('CallRecord');
  const Call = mongoose.model('Call');
  const teamNames = await teamNamesForBiz(query.businessType);

  const crFilter = { removed: false, created: { $gte: from, $lte: to } };
  const legacyFilter = { removed: false, created: { $gte: from, $lte: to } };
  if (teamNames) {
    crFilter.team = { $in: teamNames };
    legacyFilter.team = { $in: teamNames };
  }
  applyDrawer(crFilter, query, DRAWER);

  const [crs, legacy] = await Promise.all([
    CallRecord.find(crFilter)
      .select('contactName phone agentName direction status duration disposition callLead ringingAt answeredAt endedAt created')
      .limit(100000)
      .lean(),
    Call.find(legacyFilter).select('contactName phone calledBy direction status duration lead created').limit(100000).lean(),
  ]);
  return [...crs.map(normRecord), ...legacy.map(normLegacy)];
}

function stats(rows) {
  const connected = rows.filter((r) => r.connected).length;
  const missed = rows.filter((r) => r.missed).length;
  const failed = rows.filter((r) => r.failed).length;
  const voicemail = rows.filter((r) => r.voicemail).length;
  const talk = rows.reduce((s, r) => s + (r.duration || 0), 0);
  const leads = new Set(rows.map((r) => r.leadId).filter(Boolean));
  return {
    total: rows.length,
    connected,
    missed,
    failed,
    voicemail,
    talk,
    avgDuration: connected ? talk / connected : 0,
    uniqueLeads: leads.size,
    connectRate: R(connected, rows.length),
    missRate: R(missed, rows.length),
    callsPerLead: R(rows.length, leads.size),
  };
}

async function summary({ from, to, prevFrom, prevTo, query }) {
  const [cur, prev] = await Promise.all([loadWindow(from, to, query), loadWindow(prevFrom, prevTo, query)]);
  const c = stats(cur);
  const p = stats(prev);
  const bkt = bucketConfig(from, to);

  const connSeries = bucketCounts(cur.filter((r) => r.connected), 'when', bkt);
  const missSeries = bucketCounts(cur.filter((r) => r.missed), 'when', bkt);

  const byStatus = groupBy(cur, (r) => r.status || 'unknown');
  const byDir = ['Outbound', 'Inbound'].map((d) => ({ label: d, value: cur.filter((r) => r.direction === d).length }));
  const byAgent = groupBy(cur, (r) => r.agentName || '—');
  const byHour = Array.from({ length: 24 }, (_, h) => ({
    label: `${h}:00`,
    value: cur.filter((r) => new Date(r.when).getHours() === h).length,
  }));

  return {
    range: { from, to, prevFrom, prevTo, bucket: bkt.unit },
    businessType: query.businessType || 'all',
    totals: c,
    kpis: [
      kpi('total', 'Total Calls', c.total, p.total, bucketCounts(cur, 'when', bkt)),
      kpi('connected', 'Connected', c.connected, p.connected, connSeries),
      kpi('missed', 'Missed / No-Answer', c.missed, p.missed, missSeries, { positiveWhenDown: true }),
      kpi('failed', 'Failed', c.failed, p.failed, [], { positiveWhenDown: true }),
      kpi('avgDuration', 'Avg Duration', c.avgDuration, p.avgDuration, [], { fmt: 'sec' }),
      kpi('talk', 'Total Talk Time', c.talk, p.talk, [], { fmt: 'sec' }),
      kpi('uniqueLeads', 'Unique Leads Called', c.uniqueLeads, p.uniqueLeads, []),
      kpi('voicemail', 'Voicemail', c.voicemail, p.voicemail, [], { positiveWhenDown: true }),
    ],
    ratios: [
      ratio('connectRate', 'Connect rate', c.connectRate, p.connectRate),
      ratio('missRate', 'Miss rate', c.missRate, p.missRate, { positiveWhenDown: true }),
      ratio('avgHandleTime', 'Avg handle time (s)', { value: c.avgDuration, numerator: Math.round(c.avgDuration), denominator: c.connected }, null),
      ratio('callsPerLead', 'Calls per lead', c.callsPerLead, null),
    ],
    charts: {
      trend: chart(bkt.labels, [
        { label: 'Connected', data: connSeries },
        { label: 'Missed', data: missSeries },
      ]),
      byStatus: chart(byStatus.map((x) => x.label), [{ label: 'Calls', data: byStatus.map((x) => x.value) }]),
      byDirection: chart(byDir.map((x) => x.label), [{ label: 'Calls', data: byDir.map((x) => x.value) }]),
      byAgent: chart(byAgent.map((x) => x.label), [{ label: 'Calls', data: byAgent.map((x) => x.value) }]),
      byHour: chart(byHour.map((x) => x.label), [{ label: 'Calls', data: byHour.map((x) => x.value) }]),
    },
    funnel: [
      { key: 'dialed', label: 'Dialed', value: c.total },
      { key: 'ringing', label: 'Ringing', value: cur.filter((r) => r.ringing).length },
      { key: 'connected', label: 'Connected', value: c.connected },
      { key: 'completed', label: 'Completed', value: cur.filter((r) => r.completed).length },
    ],
    table: { mode: 'server', meta: { total: c.total } },
    facets: {
      agents: [...new Set(cur.map((r) => r.agentName).filter(Boolean))].sort(),
      statuses: [...new Set(cur.map((r) => r.status).filter(Boolean))].sort(),
      dispositions: [...new Set(cur.map((r) => r.disposition).filter(Boolean))].sort(),
    },
  };
}

// Server-mode table — CallRecord only (the modern collection). Legacy Call
// rows are folded into the aggregates above but not the paginated table.
async function rows({ from, to, query }) {
  const CallRecord = mongoose.model('CallRecord');
  const teamNames = await teamNamesForBiz(query.businessType);
  const filter = { removed: false, created: { $gte: from, $lte: to } };
  if (teamNames) filter.team = { $in: teamNames };
  applyDrawer(filter, query, DRAWER);
  Object.assign(filter, drillToMongo(query));
  if (query.q) {
    filter.$or = [
      { contactName: { $regex: query.q, $options: 'i' } },
      { phone: { $regex: query.q, $options: 'i' } },
      { agentName: { $regex: query.q, $options: 'i' } },
    ];
  }
  const { items, skip, sort } = paginate(query);
  const [docs, count] = await Promise.all([
    CallRecord.find(filter)
      .select('contactName phone agentName direction status duration disposition team created')
      .sort(sort)
      .skip(skip)
      .limit(items)
      .lean(),
    CallRecord.countDocuments(filter),
  ]);
  return {
    rows: docs.map((d) => ({ ...d, id: String(d._id) })),
    pagination: { page: Math.floor(skip / items) + 1, pages: Math.max(1, Math.ceil(count / items)), count },
  };
}

module.exports = { summary, rows };
