const mongoose = require('mongoose');
const { resolveScope: resolveIdentityScope } = require('../../../../services/access/salesScope');

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

// ── Row-level identity scoping for every analytics dashboard ────────────────
// Same rule as every Sales module list endpoint (services/access/
// salesScope.js): FULL_ACCESS_ROLES (owner/Super Admin/Admin/Sales Manager/
// Team Manager) see company-wide figures and may optionally narrow to one
// team or one person via ?team=/?agent=; everyone else is force-scoped
// server-side to their own team (or just themselves, if not on one) — their
// own query string can never widen that.
async function resolveDashboardScope(req) {
  const admin = req && req.admin;
  const base = await resolveIdentityScope(admin);
  if (base.isFullAccess) {
    const agentRaw = (req.query && req.query.agent) || null;
    // "View as <name>" — a full-access caller picking one individual sees
    // that person's own sales-hierarchy scope (self + everyone reporting up
    // to them, see services/access/salesHierarchy.js), not just their single
    // row. A leaf (no reports) naturally resolves to just themselves.
    const agentNames = agentRaw
      ? await require('../../../../services/access/salesHierarchy').namesForAgent(agentRaw)
      : null;
    return {
      isFullAccess: true,
      team: (req.query && req.query.team) || null,
      agent: agentRaw,
      agentNames,
      teamMemberNames: null,
    };
  }
  return {
    isFullAccess: false,
    team: base.teamName,
    agent: base.teamName ? null : admin.name,
    agentNames: null,
    teamMemberNames: base.teamMemberNames,
  };
}

// Team/agent option lists for a dashboard's "Team"/"Person" filter, derived
// from the real Team roster rather than from whatever rows happen to be in
// the current result window — a scoped-and-windowed fetch can easily come
// back empty (no data in range), which would otherwise make the filter
// dropdown render with zero options and look broken/missing even though
// scoping itself is working correctly.
//
// `orgTree` is the same nested shape as performanceController/orgTree.js's
// endpoint (built from Admin.reportsTo, see services/access/
// salesHierarchy.js's buildOrgTree) — every dashboard's Person/Owner/Agent
// filter renders it as an expandable TreeSelect instead of a flat list, so
// e.g. picking "Team Manager" expands to the Team Leaders under them. A
// non-full-access caller's query string can't widen their own forced scope
// anyway (see mergeScope's comment), so their tree is just their own
// allowed names, flattened (no real sub-tree to browse outside their chain).
async function scopeFacets(scope) {
  const Team = mongoose.model('Team');
  const allTeams = await Team.find({ removed: false }).select('name members').lean();
  if (scope.isFullAccess) {
    const { buildOrgTree } = require('../../../../services/access/salesHierarchy');
    return {
      teams: allTeams.map((t) => t.name).sort(),
      names: [...new Set(allTeams.flatMap((t) => t.members || []))].filter(Boolean).sort(),
      orgTree: await buildOrgTree(),
    };
  }
  const names = scope.teamMemberNames && scope.teamMemberNames.length
    ? scope.teamMemberNames
    : scope.agent
    ? [scope.agent]
    : [];
  const uniqNames = [...new Set(names)].filter(Boolean).sort();
  return {
    teams: scope.team ? [scope.team] : [],
    names: uniqNames,
    orgTree: uniqNames.map((n) => ({ id: n, name: n, role: null, children: [] })),
  };
}

// For a model whose individual-owner field is a plain name string matched
// against Admin.name (SalesDeal/SalesOrder/SalesQuote/Student's owner /
// counselor fields) — no `team` field of its own to filter on directly.
function ownerScopeFilter(scope, field) {
  if (scope.isFullAccess) {
    // scope.agentNames (hierarchy-resolved "view as" set) takes priority
    // over the raw scope.agent literal — see resolveDashboardScope's comment.
    if (scope.agentNames) return { [field]: { $in: scope.agentNames } };
    return scope.agent ? { [field]: scope.agent } : {};
  }
  if (scope.team && scope.teamMemberNames) return { [field]: { $in: scope.teamMemberNames } };
  return { [field]: scope.agent };
}

// For a model that carries its own denormalized `team` string (Lead/Call/
// CallRecord) plus, optionally, an individual-owner field.
function teamFieldScopeFilter(scope, teamField, ownerField) {
  if (scope.isFullAccess) {
    const f = {};
    if (scope.team) f[teamField] = scope.team;
    // scope.agentNames (hierarchy-resolved "view as" set) takes priority
    // over the raw scope.agent literal — see resolveDashboardScope's comment.
    if (scope.agentNames && ownerField) f[ownerField] = { $in: scope.agentNames };
    else if (scope.agent && ownerField) f[ownerField] = scope.agent;
    return f;
  }
  // Prefer matching the individual-owner field against the real team
  // roster (teamMemberNames) over the model's own `team` string. CallRecord
  // (and the legacy Call model) never actually get `team` written at call
  // time — no controller in services/calling/ or callingController/ sets
  // it — so a non-full-access caller on a team fell through to `{team:
  // scope.team}` and matched zero documents, showing an all-zero Calls
  // Analytics dashboard despite real calls existing. Matching on the owner
  // field is also strictly more correct even where `team` IS reliably
  // populated (Lead), since a lead assigned directly to a teammate without
  // going through the team pool never gets `team` set either.
  if (scope.team && ownerField && scope.teamMemberNames && scope.teamMemberNames.length) {
    return { [ownerField]: { $in: scope.teamMemberNames } };
  }
  if (scope.team) return { [teamField]: scope.team };
  return ownerField ? { [ownerField]: scope.agent } : { [teamField]: '__none__' };
}

// Merges an identity-scope fragment (from ownerScopeFilter/teamFieldScopeFilter)
// into an existing Mongo filter via $and rather than a flat Object.assign.
// Several of these modules already have their own unrelated "team"/"owner"/
// "agent" drawer filters (a management-only multi-select browse filter, an
// entirely different feature from the ?team=/?agent= narrowing above) that
// write to the exact same filter keys — a flat merge would let one silently
// clobber the other depending on call order. $and keeps both conditions
// intact and, critically, means a non-full-access caller's forced scope can
// never be widened by anything the drawer/query string also sets on the
// same key.
function mergeScope(filter, scopeFragment) {
  if (!scopeFragment || Object.keys(scopeFragment).length === 0) return filter;
  if (!filter.$and) filter.$and = [];
  filter.$and.push(scopeFragment);
  return filter;
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
  resolveDashboardScope,
  scopeFacets,
  ownerScopeFilter,
  teamFieldScopeFilter,
  mergeScope,
};
