const { runEntity } = require('./_entityDashboard');
const { kpi, ratio, chart, R, groupBy, sumBy, bucketCounts } = require('../shared');

const STATUSES = ['Draft', 'Pending Approval', 'Sent', 'Accepted', 'Rejected', 'Expired'];
const FUNNEL = ['Draft', 'Pending Approval', 'Sent', 'Accepted'];

const SELECT = '_id number title account status currency subtotal discount total issueDate validTill owner created';

const TABLE_COLUMNS = [
  { key: 'number', label: 'Quote #' },
  { key: 'account', label: 'Account' },
  { key: 'status', label: 'Status' },
  { key: 'total', label: 'Total' },
  { key: 'discount', label: 'Discount' },
  { key: 'owner', label: 'Owner' },
  { key: 'issueDate', label: 'Issued' },
  { key: 'validTill', label: 'Valid till' },
];

const DRAWER = {
  status: { field: 'status', kind: 'in' },
  owner: { field: 'owner', kind: 'in' },
  account: { field: 'account', kind: 'regex' },
};

function stats(rows) {
  const by = (s) => rows.filter((q) => q.status === s);
  const sum = (a) => a.reduce((x, q) => x + (q.total || 0), 0);
  const accepted = by('Accepted');
  const decided = accepted.length + by('Rejected').length + by('Expired').length;
  return {
    total: rows.length,
    sent: by('Sent').length,
    accepted: accepted.length,
    rejected: by('Rejected').length,
    expired: by('Expired').length,
    pending: by('Pending Approval').length,
    quotedValue: sum(rows),
    acceptedValue: sum(accepted),
    avgValue: rows.length ? sum(rows) / rows.length : 0,
    acceptanceRate: R(accepted.length, decided),
    rejectionRate: R(by('Rejected').length, decided),
    decided,
  };
}

function summary(ctx) {
  return runEntity({
    ...ctx,
    modelName: 'SalesQuote',
    dateFields: { created: 'created', issueDate: 'issueDate' },
    select: SELECT,
    tableColumns: TABLE_COLUMNS,
    ownerField: 'owner',
    drawerSpec: DRAWER,
    facetFields: { owners: 'owner', statuses: 'status' },
    compute: ({ cur, prev, bkt, dateField }) => {
      const c = stats(cur);
      const p = stats(prev);
      const byStatus = STATUSES.map((s) => ({ label: s, value: cur.filter((q) => q.status === s).length }));
      const valueByStatus = STATUSES.map((s) => ({
        label: s,
        value: Math.round(cur.filter((q) => q.status === s).reduce((x, q) => x + (q.total || 0), 0)),
      }));
      const byOwner = groupBy(cur, (q) => q.owner || '—');
      const acceptedSeries = bucketCounts(cur.filter((q) => q.status === 'Accepted'), dateField, bkt);

      return {
        totals: c,
        kpis: [
          kpi('total', 'Total Quotes', c.total, p.total, bucketCounts(cur, dateField, bkt)),
          kpi('sent', 'Sent', c.sent, p.sent, []),
          kpi('accepted', 'Accepted', c.accepted, p.accepted, acceptedSeries),
          kpi('rejected', 'Rejected', c.rejected, p.rejected, [], { positiveWhenDown: true }),
          kpi('expired', 'Expired', c.expired, p.expired, [], { positiveWhenDown: true }),
          kpi('pending', 'Pending Approval', c.pending, p.pending, []),
          kpi('quotedValue', 'Total Quoted Value', c.quotedValue, p.quotedValue, [], { fmt: 'money' }),
          kpi('acceptedValue', 'Accepted Value', c.acceptedValue, p.acceptedValue, [], { fmt: 'money' }),
        ],
        ratios: [
          ratio('acceptanceRate', 'Acceptance rate', c.acceptanceRate, p.acceptanceRate),
          ratio('rejectionRate', 'Rejection rate', c.rejectionRate, p.rejectionRate, { positiveWhenDown: true }),
          ratio('avgValue', 'Avg quote value', { value: c.avgValue, numerator: Math.round(c.avgValue), denominator: c.total }, null),
        ],
        charts: {
          trend: chart(bkt.labels, [
            { label: 'Quotes', data: bucketCounts(cur, dateField, bkt) },
            { label: 'Accepted', data: acceptedSeries },
          ]),
          byStatus: chart(byStatus.map((x) => x.label), [{ label: 'Quotes', data: byStatus.map((x) => x.value) }]),
          valueByStatus: chart(valueByStatus.map((x) => x.label), [{ label: 'Value', data: valueByStatus.map((x) => x.value) }]),
          byOwner: chart(byOwner.map((x) => x.label), [{ label: 'Quotes', data: byOwner.map((x) => x.value) }]),
        },
        funnel: FUNNEL.map((s) => ({ key: s, label: s, value: cur.filter((q) => q.status === s).length })),
      };
    },
  });
}

module.exports = { summary };
