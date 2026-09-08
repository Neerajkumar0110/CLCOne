const mongoose = require('mongoose');

// ─────────────────────────────────────────────────────────────────────────────
// Shared helpers for every analytics module. Deliberately dependency-free
// (native Date math) so it runs the same on Node and the Vercel bundle.
// ─────────────────────────────────────────────────────────────────────────────

const DAY = 86400000;

// [from, to] from the query + the immediately-preceding equal-length window.
function windowFromQuery(q = {}) {
  const to = q.to ? new Date(q.to) : new Date();
  const from = q.from ? new Date(q.from) : new Date(to.getTime() - 30 * DAY);
  const len = Math.max(DAY, to.getTime() - from.getTime());
  const prevTo = new Date(from.getTime());
  const prevFrom = new Date(from.getTime() - len);
  return { from, to, prevFrom, prevTo, len };
}

function startOfDay(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}
// Monday-based week start.
function startOfWeek(d) {
  const x = startOfDay(d);
  const day = (x.getDay() + 6) % 7;
  x.setDate(x.getDate() - day);
  return x;
}
function startOfMonth(d) {
  const x = new Date(d);
  x.setDate(1);
  x.setHours(0, 0, 0, 0);
  return x;
}

// Bucketing for trend charts + KPI sparklines. Returns the ordered bucket
// keys, a label formatter and a keyOf(date) mapper.
function bucketConfig(from, to) {
  const days = Math.round((to.getTime() - from.getTime()) / DAY);
  const unit = days <= 31 ? 'day' : days <= 180 ? 'week' : 'month';

  const step = (d) => {
    const x = new Date(d);
    if (unit === 'day') x.setDate(x.getDate() + 1);
    else if (unit === 'week') x.setDate(x.getDate() + 7);
    else x.setMonth(x.getMonth() + 1);
    return x;
  };
  const norm =
    unit === 'day' ? startOfDay : unit === 'week' ? startOfWeek : startOfMonth;
  const keyStr = (d) => {
    const x = norm(d);
    return unit === 'month'
      ? `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}`
      : x.toISOString().slice(0, 10);
  };

  const keys = [];
  const labels = [];
  let cur = norm(from);
  const end = norm(to);
  let guard = 0;
  while (cur <= end && guard++ < 400) {
    keys.push(keyStr(cur));
    labels.push(
      unit === 'month'
        ? cur.toLocaleString('en', { month: 'short', year: '2-digit' })
        : cur.toLocaleString('en', { month: 'short', day: 'numeric' })
    );
    cur = step(cur);
  }
  return { unit, keys, labels, keyOf: keyStr };
}

// Count rows into the given buckets by a date field → number[] aligned to keys.
function bucketCounts(rows, dateField, bkt, weight) {
  const idx = new Map(bkt.keys.map((k, i) => [k, i]));
  const out = new Array(bkt.keys.length).fill(0);
  for (const r of rows) {
    const raw = r[dateField];
    if (!raw) continue;
    const i = idx.get(bkt.keyOf(new Date(raw)));
    if (i == null) continue;
    out[i] += weight ? weight(r) : 1;
  }
  return out;
}

// Ratio object matching salesDashboardController's R().
function R(num, den) {
  return {
    value: den ? num / den : 0,
    numerator: Math.round((num || 0) * 100) / 100,
    denominator: Math.round((den || 0) * 100) / 100,
  };
}

function pctDelta(cur, prev) {
  if (!prev) return cur ? 100 : 0;
  return Math.round(((cur - prev) / prev) * 1000) / 10;
}

// Build one KPI entry. `series` is a number[] for the sparkline.
function kpi(key, label, value, prev, series, opts = {}) {
  return {
    key,
    label,
    value: Math.round((value || 0) * 100) / 100,
    prev: Math.round((prev || 0) * 100) / 100,
    deltaPct: pctDelta(value || 0, prev || 0),
    series: series || [],
    positiveWhenDown: !!opts.positiveWhenDown,
    fmt: opts.fmt || 'int',
  };
}

function ratio(key, label, r, prevR, opts = {}) {
  return {
    key,
    label,
    value: r.value,
    numerator: r.numerator,
    denominator: r.denominator,
    prev: prevR ? prevR.value : undefined,
    positiveWhenDown: !!opts.positiveWhenDown,
  };
}

// { labels, datasets:[{label,data,backgroundColor?}] }
function chart(labels, datasets) {
  return { labels, datasets };
}

// Count rows by a key function → ordered [{ label, value }] desc, capped.
function groupBy(rows, keyFn, { limit = 12, sort = true } = {}) {
  const m = new Map();
  for (const r of rows) {
    const k = keyFn(r);
    if (k == null || k === '') continue;
    m.set(k, (m.get(k) || 0) + 1);
  }
  let arr = [...m.entries()].map(([label, value]) => ({ label, value }));
  if (sort) arr.sort((a, b) => b.value - a.value);
  return arr.slice(0, limit);
}

function sumBy(rows, keyFn, valFn) {
  const m = new Map();
  for (const r of rows) {
    const k = keyFn(r);
    if (k == null || k === '') continue;
    m.set(k, (m.get(k) || 0) + (valFn(r) || 0));
  }
  return [...m.entries()]
    .map(([label, value]) => ({ label, value: Math.round(value) }))
    .sort((a, b) => b.value - a.value);
}

// ── Team ⇄ business-type resolution ──────────────────────────────────────────
const BIZ_MAP = { b2b: 'B2B', b2c: 'B2C', B2B: 'B2B', B2C: 'B2C' };
function normBiz(v) {
  return BIZ_MAP[v] || null;
}

let _teamCache = { at: 0, byName: new Map(), byMember: new Map() };
async function teamContext() {
  const now = Date.now();
  if (now - _teamCache.at < 60000 && _teamCache.byName.size) return _teamCache;
  const Team = mongoose.model('Team');
  const teams = await Team.find({ removed: false })
    .select('name businessType region systemType members')
    .lean();
  const byName = new Map();
  const byMember = new Map();
  for (const t of teams) {
    byName.set(t.name, t);
    for (const m of t.members || []) {
      if (m && !byMember.has(m.toLowerCase())) byMember.set(m.toLowerCase(), t.businessType || null);
    }
  }
  _teamCache = { at: now, teams, byName, byMember };
  return _teamCache;
}

// Team names whose businessType matches, or null = "no team constraint".
async function teamNamesForBiz(bizRaw) {
  const biz = normBiz(bizRaw);
  if (!biz) return null;
  const ctx = await teamContext();
  return (ctx.teams || []).filter((t) => t.businessType === biz).map((t) => t.name);
}

// For "derived" modules: does this owner string belong to a B2B/B2C team?
async function ownerBizFilter(bizRaw) {
  const biz = normBiz(bizRaw);
  if (!biz) return null;
  const ctx = await teamContext();
  return (ownerStr) => ctx.byMember.get(String(ownerStr || '').toLowerCase()) === biz;
}

module.exports = {
  DAY,
  windowFromQuery,
  bucketConfig,
  bucketCounts,
  R,
  pctDelta,
  kpi,
  ratio,
  chart,
  groupBy,
  sumBy,
  normBiz,
  teamContext,
  teamNamesForBiz,
  ownerBizFilter,
};
