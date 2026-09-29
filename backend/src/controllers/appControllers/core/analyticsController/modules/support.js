const { runEntity } = require('./_entityDashboard');
const { kpi, ratio, chart, R, groupBy, bucketCounts } = require('../shared');

// Ticket has no team/owner field of its own (see models/appModels/lms/
// Ticket.js) and the Support role already has full cross-company visibility
// into every ticket (ticketController/scope.js's TICKET_FULL_ACCESS_ROLES) —
// so, unlike every other analytics module, this one is deliberately NOT
// scoped down per-caller (no `ownerField` passed to runEntity): a Support
// agent's dashboard should show the whole queue, not just their own rows.
const SELECT = '_id subject category priority status raisedByName created';

const TABLE_COLUMNS = [
  { key: 'subject', label: 'Subject' },
  { key: 'category', label: 'Category' },
  { key: 'priority', label: 'Priority' },
  { key: 'status', label: 'Status' },
  { key: 'raisedByName', label: 'Raised by' },
  { key: 'created', label: 'Raised' },
];

const DRAWER = {
  category: { field: 'category', kind: 'in' },
  priority: { field: 'priority', kind: 'in' },
  status: { field: 'status', kind: 'in' },
};

const STATUSES = ['Open', 'In Progress', 'Resolved'];
const PRIORITIES = ['Low', 'Medium', 'High', 'Urgent'];

function stats(rows) {
  const open = rows.filter((r) => r.status === 'Open').length;
  const inProgress = rows.filter((r) => r.status === 'In Progress').length;
  const resolved = rows.filter((r) => r.status === 'Resolved').length;
  const urgent = rows.filter((r) => r.priority === 'Urgent' && r.status !== 'Resolved').length;
  const high = rows.filter((r) => r.priority === 'High' && r.status !== 'Resolved').length;
  return {
    total: rows.length,
    open,
    inProgress,
    resolved,
    unresolved: open + inProgress,
    urgent,
    high,
    resolvedPct: R(resolved, rows.length),
  };
}

function summary(ctx) {
  return runEntity({
    ...ctx,
    modelName: 'Ticket',
    dateFields: { created: 'created' },
    select: SELECT,
    tableColumns: TABLE_COLUMNS,
    drawerSpec: DRAWER,
    facetFields: { categories: 'category', priorities: 'priority', statuses: 'status' },
    compute: ({ cur, prev, bkt, dateField }) => {
      const c = stats(cur);
      const p = stats(prev);
      const byStatus = STATUSES.map((s) => ({ label: s, value: cur.filter((x) => x.status === s).length }));
      const byPriority = PRIORITIES.map((pr) => ({ label: pr, value: cur.filter((x) => x.priority === pr).length }));
      const byCategory = groupBy(cur, (x) => x.category || 'Other');

      return {
        totals: c,
        kpis: [
          kpi('total', 'Total Tickets', c.total, p.total, bucketCounts(cur, dateField, bkt)),
          kpi('open', 'Open', c.open, p.open, [], { positiveWhenDown: true }),
          kpi('inProgress', 'In Progress', c.inProgress, p.inProgress, []),
          kpi('resolved', 'Resolved', c.resolved, p.resolved, []),
          kpi('unresolved', 'Unresolved (Open + In Progress)', c.unresolved, p.unresolved, [], { positiveWhenDown: true }),
          kpi('urgent', 'Urgent — still open', c.urgent, p.urgent, [], { positiveWhenDown: true }),
          kpi('high', 'High priority — still open', c.high, p.high, [], { positiveWhenDown: true }),
        ],
        ratios: [ratio('resolvedPct', 'Resolved %', c.resolvedPct, p.resolvedPct)],
        charts: {
          trend: chart(bkt.labels, [{ label: 'Tickets raised', data: bucketCounts(cur, dateField, bkt) }]),
          byStatus: chart(byStatus.map((x) => x.label), [{ label: 'Tickets', data: byStatus.map((x) => x.value) }]),
          byPriority: chart(byPriority.map((x) => x.label), [{ label: 'Tickets', data: byPriority.map((x) => x.value) }]),
          byCategory: chart(byCategory.map((x) => x.label), [{ label: 'Tickets', data: byCategory.map((x) => x.value) }]),
        },
        funnel: [
          { key: 'raised', label: 'Raised', value: c.total, drill: { field: 'status', op: 'in', value: STATUSES } },
          { key: 'beingWorked', label: 'In Progress', value: c.inProgress + c.resolved, drill: { field: 'status', op: 'in', value: ['In Progress', 'Resolved'] } },
          { key: 'resolved', label: 'Resolved', value: c.resolved, drill: { field: 'status', op: 'eq', value: 'Resolved' } },
        ],
      };
    },
  });
}

module.exports = { summary };
