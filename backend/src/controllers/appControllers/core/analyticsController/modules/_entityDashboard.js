const mongoose = require('mongoose');
const { bucketConfig, bucketCounts, ownerBizFilter } = require('../shared');
const { applyDrawer } = require('./_util');

// Scaffolding shared by the "small collection, load-and-reduce" dashboards
// (deals / quotes / orders / products / customers / interns). Handles the
// window fetch (current + previous), optional owner→businessType post-filter,
// drawer filters, bucketing, table rows, facets and the response envelope.
// The module supplies `compute({ cur, prev, bkt, dateField })`.
async function runEntity(opts) {
  const {
    modelName,
    dateFields = { created: 'created' },
    select,
    tableColumns,
    ownerField, // set for 'derived' businessType modules
    drawerSpec = {},
    facetFields = {},
    from,
    to,
    prevFrom,
    prevTo,
    query,
    compute,
  } = opts;

  const Model = mongoose.model(modelName);
  const dateField = dateFields[query.dateBasis] || dateFields.created || 'created';

  const filter = { removed: false };
  applyDrawer(filter, query, drawerSpec);

  let [cur, prev] = await Promise.all([
    Model.find({ ...filter, [dateField]: { $gte: from, $lte: to } })
      .select(select)
      .limit(60000)
      .lean(),
    Model.find({ ...filter, [dateField]: { $gte: prevFrom, $lte: prevTo } })
      .select(select)
      .limit(60000)
      .lean(),
  ]);

  // Derived B2B/B2C: keep rows whose owner belongs to a matching team.
  let effectiveBiz = 'all';
  if (ownerField) {
    const pred = await ownerBizFilter(query.businessType);
    if (pred) {
      cur = cur.filter((r) => pred(r[ownerField]));
      prev = prev.filter((r) => pred(r[ownerField]));
      effectiveBiz = query.businessType;
    }
  }

  const bkt = bucketConfig(from, to);
  const trendSeries = bucketCounts(cur, dateField, bkt);

  const computed = compute({ cur, prev, bkt, dateField, trendSeries });

  const facets = {};
  for (const [name, field] of Object.entries(facetFields)) {
    facets[name] = [...new Set(cur.map((r) => r[field]).filter(Boolean))].sort();
  }

  const rows = cur
    .slice()
    .sort((a, b) => new Date(b[dateField] || 0) - new Date(a[dateField] || 0))
    .slice(0, 1000)
    .map((r) => {
      const o = { id: String(r._id) };
      for (const c of tableColumns) o[c.key] = typeof c.get === 'function' ? c.get(r) : r[c.key];
      return o;
    });

  return {
    range: { from, to, prevFrom, prevTo, bucket: bkt.unit },
    businessType: effectiveBiz,
    totals: computed.totals || {},
    kpis: computed.kpis || [],
    ratios: computed.ratios || [],
    charts: computed.charts || {},
    funnel: computed.funnel || [],
    table: { mode: 'client', rows, meta: { total: cur.length, capped: cur.length > 1000 } },
    facets,
  };
}

module.exports = { runEntity };
