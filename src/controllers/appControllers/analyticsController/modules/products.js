const { runEntity } = require('./_entityDashboard');
const { kpi, ratio, chart, R, groupBy, sumBy, bucketCounts } = require('../shared');

const SELECT = '_id name sku category type unitPrice costPrice currency stockQty reorderLevel status created';

const TABLE_COLUMNS = [
  { key: 'name', label: 'Product' },
  { key: 'sku', label: 'SKU' },
  { key: 'category', label: 'Category' },
  { key: 'type', label: 'Type' },
  { key: 'status', label: 'Status' },
  { key: 'unitPrice', label: 'Unit price' },
  { key: 'costPrice', label: 'Cost price' },
  { key: 'stockQty', label: 'Stock' },
  { key: 'reorderLevel', label: 'Reorder at' },
  {
    key: 'marginPct',
    label: 'Margin %',
    get: (r) => (r.unitPrice ? Math.round(((r.unitPrice - (r.costPrice || 0)) / r.unitPrice) * 100) : 0),
  },
];

const DRAWER = {
  category: { field: 'category', kind: 'in' },
  type: { field: 'type', kind: 'in' },
  status: { field: 'status', kind: 'in' },
};

const PRICE_BUCKETS = [
  { label: '0–1k', lo: 0, hi: 1000 },
  { label: '1k–5k', lo: 1000, hi: 5000 },
  { label: '5k–20k', lo: 5000, hi: 20000 },
  { label: '20k–1L', lo: 20000, hi: 100000 },
  { label: '1L+', lo: 100000, hi: Infinity },
];

function stats(rows) {
  const active = rows.filter((p) => p.status === 'Active');
  const dead = rows.filter((p) => p.status !== 'Active');
  const low = rows.filter((p) => (p.stockQty || 0) <= (p.reorderLevel || 0) && (p.reorderLevel || 0) > 0);
  const out = rows.filter((p) => (p.stockQty || 0) === 0);
  const prices = rows.map((p) => p.unitPrice || 0).filter((n) => n > 0);
  const margins = rows
    .filter((p) => p.unitPrice)
    .map((p) => (p.unitPrice - (p.costPrice || 0)) / p.unitPrice);
  return {
    total: rows.length,
    active: active.length,
    dead: dead.length,
    lowStock: low.length,
    outOfStock: out.length,
    avgUnitPrice: prices.length ? prices.reduce((a, b) => a + b, 0) / prices.length : 0,
    catalogValue: rows.reduce((s, p) => s + (p.unitPrice || 0) * (p.stockQty || 0), 0),
    avgMargin: margins.length ? (margins.reduce((a, b) => a + b, 0) / margins.length) * 100 : 0,
    subscription: rows.filter((p) => p.type === 'Subscription').length,
  };
}

function summary(ctx) {
  return runEntity({
    ...ctx,
    modelName: 'Product',
    dateFields: { created: 'created' },
    select: SELECT,
    tableColumns: TABLE_COLUMNS,
    drawerSpec: DRAWER,
    facetFields: { categories: 'category', types: 'type', statuses: 'status' },
    compute: ({ cur, prev, bkt, dateField }) => {
      const c = stats(cur);
      const p = stats(prev);
      const byCat = groupBy(cur, (x) => x.category || 'Uncategorised');
      const byType = groupBy(cur, (x) => x.type || 'Service', { sort: false });
      const byStatus = ['Active', 'Inactive', 'Discontinued'].map((s) => ({
        label: s,
        value: cur.filter((x) => x.status === s).length,
      }));
      const priceDist = PRICE_BUCKETS.map((b) => ({
        label: b.label,
        value: cur.filter((x) => (x.unitPrice || 0) >= b.lo && (x.unitPrice || 0) < b.hi).length,
      }));
      const marginByCat = byCat.map((cat) => {
        const rows = cur.filter((x) => (x.category || 'Uncategorised') === cat.label && x.unitPrice);
        const m = rows.length
          ? (rows.reduce((s, x) => s + (x.unitPrice - (x.costPrice || 0)) / x.unitPrice, 0) / rows.length) * 100
          : 0;
        return { label: cat.label, value: Math.round(m) };
      });

      return {
        totals: c,
        kpis: [
          kpi('total', 'Total Products', c.total, p.total, bucketCounts(cur, dateField, bkt)),
          kpi('active', 'Active', c.active, p.active, []),
          kpi('dead', 'Inactive + Discontinued', c.dead, p.dead, [], { positiveWhenDown: true }),
          kpi('lowStock', 'Low Stock', c.lowStock, p.lowStock, [], { positiveWhenDown: true }),
          kpi('outOfStock', 'Out of Stock', c.outOfStock, p.outOfStock, [], { positiveWhenDown: true }),
          kpi('avgUnitPrice', 'Avg Unit Price', c.avgUnitPrice, p.avgUnitPrice, [], { fmt: 'money' }),
          kpi('catalogValue', 'Catalog Value', c.catalogValue, p.catalogValue, [], { fmt: 'money' }),
          kpi('avgMargin', 'Avg Margin', c.avgMargin, p.avgMargin, [], { fmt: 'pct' }),
        ],
        ratios: [
          ratio('activePct', 'Active %', R(c.active, c.total), R(p.active, p.total)),
          ratio('lowStockPct', 'Low-stock %', R(c.lowStock, c.total), R(p.lowStock, p.total), { positiveWhenDown: true }),
          ratio('avgMarginPct', 'Avg margin %', { value: c.avgMargin / 100, numerator: Math.round(c.avgMargin), denominator: 100 }, null),
          ratio('subscriptionShare', 'Subscription share', R(c.subscription, c.total), null),
        ],
        charts: {
          byCategory: chart(byCat.map((x) => x.label), [{ label: 'Products', data: byCat.map((x) => x.value) }]),
          byType: chart(byType.map((x) => x.label), [{ label: 'Products', data: byType.map((x) => x.value) }]),
          byStatus: chart(byStatus.map((x) => x.label), [{ label: 'Products', data: byStatus.map((x) => x.value) }]),
          priceDistribution: chart(priceDist.map((x) => x.label), [{ label: 'Products', data: priceDist.map((x) => x.value) }]),
          marginByCategory: chart(marginByCat.map((x) => x.label), [{ label: 'Margin %', data: marginByCat.map((x) => x.value) }]),
        },
        funnel: [
          { key: 'active', label: 'Active', value: c.active },
          { key: 'inactive', label: 'Inactive', value: cur.filter((x) => x.status === 'Inactive').length },
          { key: 'discontinued', label: 'Discontinued', value: cur.filter((x) => x.status === 'Discontinued').length },
          { key: 'low', label: 'Low stock', value: c.lowStock },
        ],
      };
    },
  });
}

module.exports = { summary };
