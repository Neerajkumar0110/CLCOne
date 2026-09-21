// Shared plumbing for the analytics module files: drawer-filter → Mongo,
// drill params → Mongo, and pagination parsing for the /rows endpoints.

function parseList(v) {
  if (v == null || v === '') return [];
  return String(v)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

// Apply the config-driven Filter Drawer params onto a Mongo filter object.
// `spec` = { queryParam: { field, kind } } where kind ∈
//   'in' (comma list → $in), 'regex' (case-insensitive contains),
//   'bool' ('1' → field exists / truthy), 'gte'/'lte' (number).
function applyDrawer(filter, query, spec) {
  for (const [param, def] of Object.entries(spec)) {
    const raw = query[param];
    if (raw == null || raw === '') continue;
    const field = def.field || param;
    if (def.kind === 'in') {
      const list = parseList(raw);
      if (list.length) filter[field] = { $in: list };
    } else if (def.kind === 'regex') {
      filter[field] = { $regex: String(raw).trim(), $options: 'i' };
    } else if (def.kind === 'bool') {
      if (raw === '1' || raw === 'true') filter[field] = { $nin: [null, ''] };
    } else if (def.kind === 'gte') {
      filter[field] = { ...(filter[field] || {}), $gte: Number(raw) };
    } else if (def.kind === 'lte') {
      filter[field] = { ...(filter[field] || {}), $lte: Number(raw) };
    } else if (def.kind === 'eq') {
      filter[field] = raw;
    }
  }
  return filter;
}

// Drill-down params (KPI / chart / funnel click) → a Mongo fragment merged
// into the /rows filter. field/op/value come straight from the config.
function drillToMongo(query) {
  const field = query.drillField;
  const op = query.drillOp;
  const rawValue = query.drillValue;
  if (!field || !op) return {};
  const values = parseList(rawValue);
  switch (op) {
    case 'eq':
      return { [field]: values.length === 1 ? coerce(values[0]) : { $in: values.map(coerce) } };
    case 'in':
      return { [field]: { $in: values.map(coerce) } };
    case 'gte':
      return { [field]: { $gte: Number(rawValue) } };
    case 'lte':
      return { [field]: { $lte: Number(rawValue) } };
    case 'truthy':
      return { [field]: { $nin: [null, '', false, 0] } };
    case 'falsy':
      return { [field]: { $in: [null, '', false, 0] } };
    default:
      return {};
  }
}

function coerce(v) {
  if (v === 'true') return true;
  if (v === 'false') return false;
  return v;
}

function paginate(query) {
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const items = Math.min(10000, Math.max(1, parseInt(query.items, 10) || 25));
  const sortBy = query.sortBy || 'created';
  const sortValue = String(query.sortValue) === '1' ? 1 : -1;
  return { page, items, skip: (page - 1) * items, sort: { [sortBy]: sortValue } };
}

module.exports = { parseList, applyDrawer, drillToMongo, paginate };
