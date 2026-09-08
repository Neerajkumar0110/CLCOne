const { runEntity } = require('./_entityDashboard');
const { kpi, ratio, chart, R, groupBy, bucketCounts } = require('../shared');

const STATUSES = ['Draft', 'Confirmed', 'Processing', 'Fulfilled', 'Partially Fulfilled', 'Invoiced', 'Cancelled'];
const FULFILLED = ['Fulfilled', 'Partially Fulfilled', 'Invoiced'];
const FUNNEL = ['Draft', 'Confirmed', 'Processing', 'Fulfilled', 'Invoiced'];
const PAY = ['Unpaid', 'Partial', 'Paid'];

const SELECT =
  '_id number account status currency subtotal tax shipping total paymentStatus orderDate expectedDelivery deliveredDate owner created';

const TABLE_COLUMNS = [
  { key: 'number', label: 'Order #' },
  { key: 'account', label: 'Account' },
  { key: 'status', label: 'Status' },
  { key: 'total', label: 'Total' },
  { key: 'paymentStatus', label: 'Payment' },
  { key: 'orderDate', label: 'Ordered' },
  { key: 'expectedDelivery', label: 'Expected' },
  { key: 'deliveredDate', label: 'Delivered' },
  { key: 'owner', label: 'Owner' },
];

const DRAWER = {
  status: { field: 'status', kind: 'in' },
  paymentStatus: { field: 'paymentStatus', kind: 'in' },
  owner: { field: 'owner', kind: 'in' },
  account: { field: 'account', kind: 'regex' },
};

function stats(rows) {
  const by = (s) => rows.filter((o) => o.status === s);
  const sum = (a) => a.reduce((x, o) => x + (o.total || 0), 0);
  const paid = rows.filter((o) => o.paymentStatus === 'Paid');
  const unpaid = rows.filter((o) => o.paymentStatus !== 'Paid');
  const delivered = rows.filter((o) => o.deliveredDate);
  const onTime = delivered.filter(
    (o) => o.expectedDelivery && new Date(o.deliveredDate) <= new Date(o.expectedDelivery)
  );
  const fulfilled = rows.filter((o) => FULFILLED.includes(o.status));
  return {
    total: rows.length,
    orderValue: sum(rows),
    confirmedProcessing: by('Confirmed').length + by('Processing').length,
    fulfilled: fulfilled.length,
    cancelled: by('Cancelled').length,
    unpaidValue: sum(unpaid),
    paidValue: sum(paid),
    avgOrderValue: rows.length ? sum(rows) / rows.length : 0,
    fulfilmentRate: R(fulfilled.length, rows.length),
    cancellationRate: R(by('Cancelled').length, rows.length),
    paymentRealisation: R(sum(paid), sum(rows)),
    onTimeRate: R(onTime.length, delivered.length),
  };
}

function summary(ctx) {
  return runEntity({
    ...ctx,
    modelName: 'SalesOrder',
    dateFields: { created: 'created', orderDate: 'orderDate' },
    select: SELECT,
    tableColumns: TABLE_COLUMNS,
    ownerField: 'owner',
    drawerSpec: DRAWER,
    facetFields: { owners: 'owner', statuses: 'status' },
    compute: ({ cur, prev, bkt, dateField }) => {
      const c = stats(cur);
      const p = stats(prev);
      const byStatus = STATUSES.map((s) => ({ label: s, value: cur.filter((o) => o.status === s).length }));
      const byPay = PAY.map((s) => ({ label: s, value: cur.filter((o) => o.paymentStatus === s).length }));
      const byOwner = groupBy(cur, (o) => o.owner || '—');
      const valSeries = bucketCounts(cur, dateField, bkt, (o) => o.total || 0);

      return {
        totals: c,
        kpis: [
          kpi('total', 'Total Orders', c.total, p.total, bucketCounts(cur, dateField, bkt)),
          kpi('orderValue', 'Order Value', c.orderValue, p.orderValue, valSeries, { fmt: 'money' }),
          kpi('confirmedProcessing', 'Confirmed + Processing', c.confirmedProcessing, p.confirmedProcessing, []),
          kpi('fulfilled', 'Fulfilled + Invoiced', c.fulfilled, p.fulfilled, []),
          kpi('cancelled', 'Cancelled', c.cancelled, p.cancelled, [], { positiveWhenDown: true }),
          kpi('unpaidValue', 'Unpaid Value', c.unpaidValue, p.unpaidValue, [], { fmt: 'money', positiveWhenDown: true }),
          kpi('paidValue', 'Paid Value', c.paidValue, p.paidValue, [], { fmt: 'money' }),
          kpi('avgOrderValue', 'Avg Order Value', c.avgOrderValue, p.avgOrderValue, [], { fmt: 'money' }),
        ],
        ratios: [
          ratio('fulfilmentRate', 'Fulfilment rate', c.fulfilmentRate, p.fulfilmentRate),
          ratio('cancellationRate', 'Cancellation rate', c.cancellationRate, p.cancellationRate, { positiveWhenDown: true }),
          ratio('paymentRealisation', 'Payment realisation', c.paymentRealisation, p.paymentRealisation),
          ratio('onTimeRate', 'On-time delivery', c.onTimeRate, null),
        ],
        charts: {
          trend: chart(bkt.labels, [
            { label: 'Orders', data: bucketCounts(cur, dateField, bkt) },
            { label: 'Value', data: valSeries },
          ]),
          byStatus: chart(byStatus.map((x) => x.label), [{ label: 'Orders', data: byStatus.map((x) => x.value) }]),
          byPaymentStatus: chart(byPay.map((x) => x.label), [{ label: 'Orders', data: byPay.map((x) => x.value) }]),
          valueByMonth: chart(bkt.labels, [{ label: 'Value', data: valSeries }]),
          byOwner: chart(byOwner.map((x) => x.label), [{ label: 'Orders', data: byOwner.map((x) => x.value) }]),
        },
        funnel: FUNNEL.map((s) => ({ key: s, label: s, value: cur.filter((o) => o.status === s).length })),
      };
    },
  });
}

module.exports = { summary };
