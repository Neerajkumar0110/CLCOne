const mongoose = require('mongoose');
const { FULL_ACCESS_ROLES } = require('../access/salesScope');
const { resolveHierarchyScope } = require('../access/salesHierarchy');
const { LMS_PANEL_ROLES } = require('../../config/roles');
const { callReachedCustomer } = require('../calling/callingShared');
const { fixMojibake } = require('../../utils/fixMojibake');

// Everything one user did in a date range — or a summary row for every user
// the requester can see. Powers Advanced Reporting → "User Activity" (screen
// + PDF, controllers/appControllers/core/userActivityReport.js).
//
// Sources: LoginActivity (app sessions), AgentActivity (pool ON/OFF +
// breaks — logged from 2026-10-22), CallRecord (calls, responses, notes),
// Lead.stageHistory (stage moves), CallCallback, DemoBooking,
// PaymentRequest, FinanceApplication, Ticket, Permission (access).

const IST = 330 * 60000;
const DAY = 86400000;
const dayKey = (d) => new Date(new Date(d).getTime() + IST).toISOString().slice(0, 10);
const hourOf = (d) => new Date(new Date(d).getTime() + IST).getUTCHours();
const fullName = (a) => (a ? `${a.name || ''} ${a.surname || ''}`.trim() : '');
const ACTIVITY_TRACKED_FROM = new Date('2026-10-22T00:00:00+05:30');
// The dialer stamps its own line on every pool call's notes — keep only
// what the agent wrote.
const cleanNotes = (n) => {
  const t = String(n || '')
    .replace(/Instant Lead Pool\s*[—-]\s*agent assigned on answer\.?/gi, '')
    .replace(/^[A-Z_]{3,}\s*[—-]\s*/, '') // "LANG_BARRIER — " (disposition has its own column)
    .replace(/\s*[—-]\s*(\n|$)/g, '$1')
    .replace(/^\s*[—-]\s*/, '')
    .trim();
  return t ? t.slice(0, 300) : null;
};

// IST calendar range → [from, to) instants. Defaults: last 7 days.
function parseRange(q = {}) {
  const ok = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s || '');
  const today = dayKey(Date.now());
  const toKey = ok(q.to) ? q.to : today;
  const fromKey = ok(q.from) ? q.from : dayKey(new Date(`${toKey}T12:00:00+05:30`).getTime() - 6 * DAY);
  const from = new Date(`${fromKey}T00:00:00+05:30`);
  let to = new Date(new Date(`${toKey}T00:00:00+05:30`).getTime() + DAY);
  if (to - from > 366 * DAY) to = new Date(from.getTime() + 366 * DAY);
  if (to < from) return parseRange({});
  return { from, to, fromKey, toKey };
}
function daysOf(from, to) {
  const out = [];
  for (let t = from.getTime(); t < to.getTime() && out.length < 400; t += DAY) out.push(dayKey(t + 12 * 3600000));
  return out;
}

// Who the requester may report on: management → every staff account
// (deleted ones too — their past work still counts; they're flagged and
// only listed when they did something in the range); a lead → themselves +
// their reporting line; everyone else → themselves.
async function visibleUsers(requester) {
  const Admin = mongoose.model('Admin');
  const base = { role: { $nin: [...LMS_PANEL_ROLES, 'owner'] } };
  const sel = 'name surname email phone role subRole reportsTo businessName businessSegment enabled removed created lastSeenAt';
  if (FULL_ACCESS_ROLES.includes(requester.role)) return Admin.find(base).select(sel).sort({ name: 1 }).lean();
  const scope = await resolveHierarchyScope(requester);
  const or = [{ _id: requester._id }];
  if (scope.ids && scope.ids.length) or.push({ _id: { $in: scope.ids } });
  if (scope.names && scope.names.length) or.push({ name: { $in: scope.names } });
  return Admin.find({ ...base, $or: or }).select(sel).sort({ name: 1 }).lean();
}

// ── sessions (LoginActivity) ──────────────────────────────────────────────
function clip(start, end, from, to) {
  const s = Math.max(new Date(start).getTime(), from.getTime());
  const e = Math.min(new Date(end).getTime(), to.getTime());
  return e > s ? [s, e] : null;
}
// Socket reconnects split one sitting into many tiny sessions — merge any
// that overlap or sit within 2 minutes of each other.
function mergeSessions(rows) {
  const now = Date.now();
  const iv = rows
    .map((r) => ({ s: new Date(r.loginAt).getTime(), e: r.logoutAt ? new Date(r.logoutAt).getTime() : now, open: !r.logoutAt }))
    .sort((a, b) => a.s - b.s);
  const out = [];
  for (const x of iv) {
    const last = out[out.length - 1];
    if (last && x.s <= last.e + 120000) {
      if (x.e > last.e) last.e = x.e;
      last.open = last.open || x.open;
    } else out.push({ ...x });
  }
  return out.map((x) => ({ loginAt: new Date(x.s), logoutAt: x.open ? null : new Date(x.e) }));
}
function sessionStats(rows, from, to) {
  const now = Date.now();
  const byDay = {};
  let seconds = 0;
  const list = [];
  for (const r of mergeSessions(rows)) {
    const c = clip(r.loginAt, r.logoutAt || now, from, to);
    if (!c) continue;
    const sec = Math.round((c[1] - c[0]) / 1000);
    seconds += sec;
    // A sitting that runs past midnight counts towards each IST day it spans.
    for (let s = c[0]; s < c[1]; ) {
      const nextMidnight = (Math.floor((s + IST) / DAY) + 1) * DAY - IST;
      const e = Math.min(c[1], nextMidnight);
      const k = dayKey(s);
      const d = (byDay[k] = byDay[k] || { seconds: 0, sessions: 0, first: null, last: null });
      d.seconds += Math.round((e - s) / 1000);
      d.sessions += 1;
      if (!d.first || s < d.first) d.first = s;
      if (!d.last || e > d.last) d.last = e;
      s = e;
    }
    list.push({ start: new Date(c[0]), end: r.logoutAt ? new Date(c[1]) : null, seconds: sec });
  }
  list.sort((a, b) => a.start - b.start);
  return { seconds, count: list.length, byDay, list };
}

// ── pool / breaks (AgentActivity) ─────────────────────────────────────────
function poolStats(events, before, from, to) {
  const now = Date.now();
  let on = before && before.kind === 'pool_on' ? from.getTime() : null;
  let minutes = 0;
  let ons = 0;
  let offs = 0;
  let breaks = 0;
  const byDay = {};
  const add = (s, e) => {
    const c = clip(s, e, from, to);
    if (!c) return;
    const m = (c[1] - c[0]) / 60000;
    minutes += m;
    const k = dayKey(c[0]);
    byDay[k] = (byDay[k] || 0) + m;
  };
  for (const ev of events) {
    const t = new Date(ev.at).getTime();
    if (ev.kind === 'pool_on') {
      ons += 1;
      if (on == null) on = t;
    } else if (ev.kind === 'pool_off') {
      offs += 1;
      if (on != null) add(on, t);
      on = null;
    } else if (ev.kind === 'break_start') breaks += 1;
  }
  if (on != null) add(on, Math.min(to.getTime(), now));
  return { minutes: Math.round(minutes), ons, offs, breaks, byDay: Object.fromEntries(Object.entries(byDay).map(([k, v]) => [k, Math.round(v)])) };
}

// ── calls (CallRecord) ────────────────────────────────────────────────────
const typeOf = (r, poolId) =>
  r.instantLead ? 'Facebook lead' : r.direction === 'Inbound' ? 'Inbound' : poolId && String(r.campaign) === String(poolId) ? 'Lead pool' : 'Dialer';
function callStats(rows, poolId) {
  const s = { total: 0, connected: 0, notPicked: 0, missed: 0, talkSeconds: 0, longest: 0, byType: {}, byDisposition: {}, byHour: Array(24).fill(0), byDay: {} };
  for (const r of rows) {
    s.total += 1;
    const out = r.missedByAgent ? 'missed' : callReachedCustomer(r) ? 'connected' : 'notPicked';
    s[out] += 1;
    s.talkSeconds += r.duration || 0;
    s.longest = Math.max(s.longest, r.duration || 0);
    const t = typeOf(r, poolId);
    s.byType[t] = (s.byType[t] || 0) + 1;
    const d = r.disposition || 'No disposition';
    s.byDisposition[d] = (s.byDisposition[d] || 0) + 1;
    s.byHour[hourOf(r.created)] += 1;
    const k = dayKey(r.created);
    const day = (s.byDay[k] = s.byDay[k] || { calls: 0, connected: 0, talkSeconds: 0 });
    day.calls += 1;
    if (out === 'connected') day.connected += 1;
    day.talkSeconds += r.duration || 0;
  }
  s.connectRate = s.total ? Math.round((s.connected / s.total) * 100) : 0;
  s.avgTalk = s.connected ? Math.round(s.talkSeconds / s.connected) : 0;
  return s;
}

const sum = (o) => Object.values(o || {}).reduce((a, b) => a + b, 0);

// Shared fetch for one or many users over a range.
async function fetchAll(userIds, from, to) {
  const ids = userIds.map((i) => new mongoose.Types.ObjectId(String(i)));
  const range = { $gte: from, $lt: to };
  const pool = await mongoose.model('CallCampaign').findOne({ isLeadPool: true, removed: false }).select('_id').lean();
  const [sessions, activity, before, calls, stageMoves, callbacks, demos, payments, finance, tickets] = await Promise.all([
    mongoose
      .model('LoginActivity')
      .find({ admin: { $in: ids }, removed: { $ne: true }, loginAt: { $lt: to }, $or: [{ logoutAt: null }, { logoutAt: { $gt: from } }] })
      .select('admin loginAt logoutAt')
      .lean(),
    mongoose.model('AgentActivity').find({ agent: { $in: ids }, at: range }).sort({ at: 1 }).lean(),
    mongoose
      .model('AgentActivity')
      .aggregate([
        { $match: { agent: { $in: ids }, at: { $lt: from }, kind: { $in: ['pool_on', 'pool_off'] } } },
        { $sort: { at: -1 } },
        { $group: { _id: '$agent', kind: { $first: '$kind' } } },
      ]),
    mongoose
      .model('CallRecord')
      .find({ agent: { $in: ids }, removed: false, created: range, status: { $nin: ['queued', 'dialing', 'ringing'] } })
      .select('agent contactName phone status disposition notes duration missedByAgent agentLegAnswered created endedAt campaign instantLead direction connectMode')
      .sort({ created: 1 })
      .lean(),
    mongoose
      .model('Lead')
      .aggregate([
        { $match: { 'stageHistory.changedBy': { $in: ids }, 'stageHistory.at': range } },
        { $unwind: '$stageHistory' },
        { $match: { 'stageHistory.changedBy': { $in: ids }, 'stageHistory.at': range } },
        { $project: { name: 1, phone: 1, h: '$stageHistory' } },
        { $sort: { 'h.at': 1 } },
      ]),
    mongoose.model('CallCallback').find({ assignedAgent: { $in: ids }, removed: false, created: range }).select('assignedAgent status scheduledAt contactName phone').lean(),
    mongoose.model('DemoBooking').find({ agent: { $in: ids }, removed: false, created: range }).select('agent status date name phone').lean(),
    mongoose.model('PaymentRequest').find({ createdBy: { $in: ids }, removed: false, created: range }).select('createdBy studentName amount status paidAt course created').lean(),
    mongoose.model('FinanceApplication').find({ createdBy: { $in: ids }, removed: false, created: range }).select('createdBy studentName status financeAmount created').lean(),
    mongoose.model('Ticket').find({ createdBy: { $in: ids }, removed: { $ne: true }, created: range }).select('createdBy subject status created').lean(),
  ]);
  const group = (rows, key) => {
    const m = new Map();
    for (const r of rows) {
      const k = String(typeof key === 'function' ? key(r) : r[key]);
      if (!m.has(k)) m.set(k, []);
      m.get(k).push(r);
    }
    return m;
  };
  return {
    poolId: pool ? pool._id : null,
    sessions: group(sessions, 'admin'),
    activity: group(activity, 'agent'),
    before: new Map(before.map((b) => [String(b._id), b])),
    calls: group(calls, 'agent'),
    stageMoves: group(stageMoves, (r) => r.h.changedBy),
    callbacks: group(callbacks, 'assignedAgent'),
    demos: group(demos, 'agent'),
    payments: group(payments, 'createdBy'),
    finance: group(finance, 'createdBy'),
    tickets: group(tickets, 'createdBy'),
  };
}

function summarize(u, f, from, to) {
  const id = String(u._id);
  const sess = sessionStats(f.sessions.get(id) || [], from, to);
  const pool = poolStats(f.activity.get(id) || [], f.before.get(id), from, to);
  const calls = callStats(f.calls.get(id) || [], f.poolId);
  const moves = f.stageMoves.get(id) || [];
  const demos = f.demos.get(id) || [];
  const pays = f.payments.get(id) || [];
  const paid = pays.filter((p) => p.status === 'paid');
  return {
    sess,
    pool,
    calls,
    moves,
    callbacks: f.callbacks.get(id) || [],
    demos,
    pays,
    finance: f.finance.get(id) || [],
    tickets: f.tickets.get(id) || [],
    row: {
      id,
      name: fullName(u),
      role: u.role,
      enabled: u.enabled !== false,
      deleted: !!u.removed,
      onlineSeconds: sess.seconds,
      sessions: sess.count,
      poolMinutes: pool.minutes,
      poolOns: pool.ons,
      calls: calls.total,
      connected: calls.connected,
      connectRate: calls.connectRate,
      talkSeconds: calls.talkSeconds,
      missed: calls.missed,
      stageMoves: moves.length,
      demosBooked: demos.length,
      paidCount: paid.length,
      paidAmount: paid.reduce((a, p) => a + (p.amount || 0), 0),
      lastSeenAt: u.lastSeenAt || null,
    },
  };
}

// Team view: one row per visible user + totals.
async function buildAll(requester, q) {
  const { from, to, fromKey, toKey } = parseRange(q);
  let users = await visibleUsers(requester);
  if (q.role) users = users.filter((u) => u.role === q.role);
  const f = await fetchAll(users.map((u) => u._id), from, to);
  const rows = users
    .map((u) => summarize(u, f, from, to).row)
    .filter((r) => !r.deleted || r.onlineSeconds || r.calls || r.stageMoves || r.poolOns || r.paidCount);
  const active = rows.filter((r) => r.onlineSeconds || r.calls || r.stageMoves || r.poolOns);
  const totals = rows.reduce(
    (t, r) => {
      for (const k of ['onlineSeconds', 'sessions', 'poolMinutes', 'poolOns', 'calls', 'connected', 'talkSeconds', 'missed', 'stageMoves', 'demosBooked', 'paidCount', 'paidAmount']) t[k] += r[k];
      return t;
    },
    { onlineSeconds: 0, sessions: 0, poolMinutes: 0, poolOns: 0, calls: 0, connected: 0, talkSeconds: 0, missed: 0, stageMoves: 0, demosBooked: 0, paidCount: 0, paidAmount: 0 }
  );
  totals.connectRate = totals.calls ? Math.round((totals.connected / totals.calls) * 100) : 0;
  totals.users = rows.length;
  totals.activeUsers = active.length;
  // Team-wide daily calls for the trend chart.
  const days = daysOf(from, to);
  const allCalls = [].concat(...[...f.calls.values()]);
  const daily = callStats(allCalls, f.poolId).byDay;
  return {
    range: { from: fromKey, to: toKey },
    totals,
    rows: rows.sort((a, b) => b.calls - a.calls || b.onlineSeconds - a.onlineSeconds),
    daily: days.map((d) => ({ day: d, ...(daily[d] || { calls: 0, connected: 0, talkSeconds: 0 }) })),
    activityTrackedFrom: ACTIVITY_TRACKED_FROM,
    generatedAt: new Date(),
  };
}

// Everything about one user.
async function buildOne(requester, userId, q) {
  const { from, to, fromKey, toKey } = parseRange(q);
  const users = await visibleUsers(requester);
  const u = users.find((x) => String(x._id) === String(userId));
  if (!u) return null;
  const f = await fetchAll([u._id], from, to);
  const s = summarize(u, f, from, to);

  const Admin = mongoose.model('Admin');
  const [manager, team, permUser, permRole, demoAttended] = await Promise.all([
    u.reportsTo ? Admin.findById(u.reportsTo).select('name surname role').lean() : null,
    mongoose.model('Team').findOne({ removed: false, $or: [{ lead: u.name }, { members: u.name }] }).select('name lead').lean(),
    mongoose.model('Permission').findOne({ scope: 'user', key: u.email }).lean(),
    mongoose.model('Permission').findOne({ scope: 'role', key: u.role }).lean(),
    s.demos.filter((d) => d.status === 'attended').length,
  ]);
  const matrix = (permUser && permUser.matrix) || (permRole && permRole.matrix) || null;
  const access = matrix
    ? Object.entries(matrix)
        .filter(([, p]) => p && (p.view || p.edit || p.delete))
        .map(([module, p]) => ({ module, view: !!p.view, edit: !!p.edit, delete: !!p.delete }))
    : null;

  // Day-by-day timeline: sessions, pool/breaks, calls, stage moves.
  const days = daysOf(from, to);
  // Each event carries a plain `text` (PDF) plus structured fields the
  // screen's timeline renders as chips.
  const plain = (n) => (fixMojibake(n) || '').normalize('NFKC').trim();
  const events = [];
  for (const x of s.sess.list) {
    events.push({ at: x.start, kind: 'login', text: 'Opened the CRM' });
    if (x.end) events.push({ at: x.end, kind: 'logout', text: `Closed the CRM (${Math.round(x.seconds / 60)} min)`, durationSec: x.seconds });
  }
  for (const a of f.activity.get(String(u._id)) || []) {
    const label = { pool_on: 'Joined the lead pool', pool_off: 'Left the lead pool', break_start: 'Started a break', break_end: 'Break ended' }[a.kind];
    const by = a.detail === 'by manager' ? a.byName : null;
    const note = a.kind.startsWith('break') ? a.detail || null : null;
    events.push({ at: a.at, kind: a.kind, text: `${label}${note ? ` (${note})` : by ? ` — by ${by}` : ''}`, by, note });
  }
  for (const c of f.calls.get(String(u._id)) || []) {
    const out = c.missedByAgent ? 'Missed by agent' : callReachedCustomer(c) ? 'Connected' : 'Not picked up';
    const name = plain(c.contactName) || c.phone;
    events.push({
      at: c.created,
      kind: 'call',
      text: `Call ${name} — ${out.toLowerCase()}${c.duration ? `, ${c.duration}s` : ''}${c.disposition ? ` · ${c.disposition}` : ''}`,
      name,
      phone: c.phone,
      outcome: out,
      durationSec: c.duration || 0,
      disposition: c.disposition || null,
      callType: typeOf(c, f.poolId),
    });
  }
  for (const m of s.moves) {
    const name = plain(m.name) || m.phone;
    events.push({
      at: m.h.at,
      kind: 'stage',
      text: `${name}: ${m.h.fromStage || '—'} → ${m.h.toStage}${m.h.toSubStatus ? ` / ${m.h.toSubStatus}` : ''}`,
      name,
      phone: m.phone,
      from: m.h.fromStage || null,
      to: m.h.toStage,
      sub: m.h.toSubStatus || null,
    });
  }
  events.sort((a, b) => new Date(a.at) - new Date(b.at));

  const timeline = days.map((d) => {
    const ses = s.sess.byDay[d];
    const cd = s.calls.byDay[d] || { calls: 0, connected: 0, talkSeconds: 0 };
    return {
      day: d,
      onlineSeconds: ses ? ses.seconds : 0,
      sessions: ses ? ses.sessions : 0,
      firstLogin: ses ? new Date(ses.first) : null,
      lastLogout: ses ? new Date(ses.last) : null,
      poolMinutes: s.pool.byDay[d] || 0,
      ...cd,
      stageMoves: s.moves.filter((m) => dayKey(m.h.at) === d).length,
    };
  });

  return {
    range: { from: fromKey, to: toKey },
    generatedAt: new Date(),
    activityTrackedFrom: ACTIVITY_TRACKED_FROM,
    profile: {
      id: String(u._id),
      name: fullName(u),
      email: u.email,
      phone: u.phone || null,
      role: u.role,
      subRole: u.subRole || null,
      team: team ? team.name : null,
      teamLead: team ? team.lead : null,
      manager: manager ? `${fullName(manager)} (${manager.role})` : null,
      business: [u.businessName, u.businessSegment].filter(Boolean).join(' · ') || null,
      enabled: u.enabled !== false,
      deleted: !!u.removed,
      joined: u.created,
      lastSeenAt: u.lastSeenAt || null,
    },
    access,
    summary: { ...s.row, avgTalk: s.calls.avgTalk, longestCall: s.calls.longest, notPicked: s.calls.notPicked, poolOffs: s.pool.offs, breaks: s.pool.breaks, demosAttended: demoAttended },
    calls: {
      byType: s.calls.byType,
      byDisposition: Object.entries(s.calls.byDisposition).sort((a, b) => b[1] - a[1]).map(([k, n]) => ({ disposition: k, count: n })),
      byHour: s.calls.byHour,
      list: (f.calls.get(String(u._id)) || [])
        .slice()
        .reverse()
        .slice(0, 500)
        .map((c) => ({
          at: c.created,
          name: fixMojibake(c.contactName),
          phone: c.phone,
          type: typeOf(c, f.poolId),
          outcome: c.missedByAgent ? 'Missed by agent' : callReachedCustomer(c) ? 'Connected' : 'Not picked up',
          durationSec: c.duration || 0,
          disposition: c.disposition || null,
          notes: cleanNotes(c.notes),
        })),
    },
    stageMoves: s.moves
      .slice()
      .reverse()
      .slice(0, 300)
      .map((m) => ({ at: m.h.at, name: fixMojibake(m.name), phone: m.phone, from: m.h.fromStage || null, to: m.h.toStage, sub: m.h.toSubStatus || null, remarks: m.h.remarks || null })),
    callbacks: { total: s.callbacks.length, byStatus: s.callbacks.reduce((o, c) => ((o[c.status] = (o[c.status] || 0) + 1), o), {}) },
    demos: { booked: s.demos.length, attended: demoAttended, missed: s.demos.filter((d) => d.status === 'missed').length },
    payments: {
      created: s.pays.length,
      paid: s.pays.filter((p) => p.status === 'paid').length,
      paidAmount: s.row.paidAmount,
      list: s.pays.slice(-50).reverse().map((p) => ({ at: p.created, name: p.studentName, course: p.course, amount: p.amount, status: p.status })),
    },
    finance: { created: s.finance.length, submitted: s.finance.filter((x) => x.status === 'submitted').length },
    tickets: { raised: s.tickets.length, open: s.tickets.filter((t) => !['Resolved', 'Closed'].includes(t.status)).length },
    timeline,
    events: events.slice(-1500),
  };
}

module.exports = { buildAll, buildOne, visibleUsers, parseRange, sum };
