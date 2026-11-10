const mongoose = require('mongoose');

// DATA-02 duplicate classes: two (or more) classes of the same batch on the
// same IST day whose times overlap, or that carry the same title. One is
// kept — the one already started, else the one created first — and the
// others are offered for removal. Nothing is removed here: removal goes
// through an Ops approval (approvalExecutor → removeDuplicateClass).

const M = (n) => mongoose.model(n);
const istDay = (d) => new Date(new Date(d).getTime() + 5.5 * 3600000).toISOString().slice(0, 10);
const endOf = (s) => (s.scheduledEnd ? new Date(s.scheduledEnd) : new Date(new Date(s.scheduledStart).getTime() + 60 * 60000));
const norm = (t) => String(t || '').trim().toLowerCase();
const unstarted = (s) => ['scheduled', 'upcoming'].includes(s.status) && !s.actualStart;
const view = (s) => ({ id: String(s._id), title: s.title, batch: s.batchName || '', start: s.scheduledStart, end: s.scheduledEnd, status: s.status, created: s.created || s._id.getTimestamp() });

async function detect({ batches, from, to } = {}) {
  const start = from || (() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  })();
  const q = { removed: false, status: { $ne: 'cancelled' }, scheduledStart: { $gte: start, $lte: to || new Date(start.getTime() + 60 * 86400000) }, batch: { $ne: null } };
  if (batches) q.batchName = { $in: batches };
  const rows = await M('LmsLiveSession').find(q).select('title batch batchName scheduledStart scheduledEnd status actualStart created').sort({ scheduledStart: 1 }).lean();
  const byDay = new Map();
  rows.forEach((s) => {
    const k = `${s.batch}|${istDay(s.scheduledStart)}`;
    if (!byDay.has(k)) byDay.set(k, []);
    byDay.get(k).push(s);
  });
  const groups = [];
  for (const list of byDay.values()) {
    if (list.length < 2) continue;
    // union-find over "overlaps or same title"
    const parent = list.map((_, i) => i);
    const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
    for (let i = 0; i < list.length; i += 1) {
      for (let j = i + 1; j < list.length; j += 1) {
        const a = list[i];
        const b = list[j];
        const overlap = new Date(a.scheduledStart) < endOf(b) && new Date(b.scheduledStart) < endOf(a);
        if (overlap || norm(a.title) === norm(b.title)) parent[find(j)] = find(i);
      }
    }
    const clusters = new Map();
    list.forEach((s, i) => {
      const r = find(i);
      if (!clusters.has(r)) clusters.set(r, []);
      clusters.get(r).push(s);
    });
    for (const c of clusters.values()) {
      if (c.length < 2) continue;
      const sorted = c.slice().sort((x, y) => (unstarted(x) === unstarted(y) ? new Date(x.created || x._id.getTimestamp()) - new Date(y.created || y._id.getTimestamp()) : unstarted(x) ? 1 : -1));
      const [keep, ...rest] = sorted;
      const extras = rest.filter(unstarted);
      if (extras.length) groups.push({ batch: keep.batchName || '', day: istDay(keep.scheduledStart), keep: view(keep), extras: extras.map(view) });
    }
  }
  return groups;
}

// Every removal request lists its classes in payload.sessionIds (one class
// from the board, or every extra of a batch from the hourly job).
const REQ_TYPE = 'Duplicate class removal';

async function requestsFor(sessionIds) {
  if (!sessionIds.length) return new Map();
  const reqs = await M('LmsApproval')
    .find({ removed: false, type: REQ_TYPE, 'payload.sessionIds': { $in: sessionIds } })
    .select('status payload.sessionIds')
    .sort({ created: -1 })
    .lean();
  const by = new Map(); // sessionId -> latest request status
  reqs.forEach((r) => (r.payload.sessionIds || []).forEach((id) => {
    if (!by.has(id)) by.set(id, r.status);
  }));
  return by;
}

// attach the pending / decided removal request of every extra
async function withRequests(groups) {
  const by = await requestsFor(groups.flatMap((g) => g.extras.map((e) => e.id)));
  groups.forEach((g) => g.extras.forEach((e) => {
    e.request = by.get(e.id) || null;
  }));
  return groups;
}

const hhmm = (d) => new Date(d).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit' });
const dayTime = (d) => new Date(d).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

async function createRequest({ batch, items, reason, admin, auto }) {
  const one = items.length === 1;
  const doc = await M('LmsApproval').create({
    type: REQ_TYPE,
    detail: (one ? `${items[0].extra.title} · ${dayTime(items[0].extra.start)}` : `${items.length} duplicate classes`).slice(0, 200),
    scope: batch,
    evidence: `${reason ? `${reason} — ` : ''}${items
      .map((x) => `${x.extra.title} duplicates "${x.keep.title}" (${hhmm(x.keep.start)}) on ${x.day}`)
      .join('; ')}`.slice(0, 1000),
    // removing several classes at once is a bulk change: two approvers (D-13)
    highRisk: !one,
    ref: one ? `session:${items[0].extra.id}` : `dups:${batch}`,
    payload: { sessionIds: items.map((x) => x.extra.id), keepIds: items.map((x) => x.keep.id) },
    requestedBy: admin ? admin._id : undefined,
    requestedByName: admin ? [admin.name, admin.surname].filter(Boolean).join(' ') : 'System (auto-detected)',
    requestedByRole: admin ? admin.role : 'system',
  });
  await require('./auditLog').record({ module: 'approval', action: auto ? 'auto-request' : 'request', entityType: 'LmsApproval', entityId: doc._id, admin: admin || undefined, reason: doc.evidence.slice(0, 300), after: { type: doc.type, scope: doc.scope, sessions: doc.payload.sessionIds.length } });
  return { id: String(doc._id), status: doc.status, count: items.length };
}

const flatten = (groups) => groups.flatMap((g) => g.extras.map((extra) => ({ batch: g.batch, day: g.day, keep: g.keep, extra })));

// one class, from the board ("Request removal")
async function raiseRemoval({ sessionId, reason, admin, auto }) {
  const all = flatten(await detect({ to: new Date(Date.now() + 365 * 86400000) }));
  const item = all.find((x) => x.extra.id === String(sessionId));
  if (!item) return { error: 409, message: 'This class is not a duplicate (no other class of the batch at that time) — use Cancel instead.' };
  const st = (await requestsFor([item.extra.id])).get(item.extra.id);
  if (st === 'pending') return { error: 409, message: 'A removal request is already waiting for Ops.' };
  if (st === 'rejected' && auto) return { error: 409, message: 'Ops already rejected removing this one.' };
  if (st === 'approved') return { error: 409, message: 'Already approved for removal.' };
  return { result: await createRequest({ batch: item.batch, items: [item], reason, admin, auto }) };
}

// hourly job: every not-yet-requested extra, one request per batch; a class
// Ops kept (rejected) is never raised again
async function raiseAll({ to, batches } = {}) {
  const all = flatten(await detect({ batches, to: to || new Date(Date.now() + 45 * 86400000) }));
  const by = await requestsFor(all.map((x) => x.extra.id));
  const fresh = all.filter((x) => !by.has(x.extra.id));
  const perBatch = new Map();
  fresh.forEach((x) => {
    if (!perBatch.has(x.batch)) perBatch.set(x.batch, []);
    perBatch.get(x.batch).push(x);
  });
  const out = [];
  for (const [batch, items] of perBatch) out.push(await createRequest({ batch, items, reason: 'Auto-detected', auto: true })); // eslint-disable-line no-await-in-loop
  return out;
}

module.exports = { detect, withRequests, raiseRemoval, raiseAll, requestsFor, istDay };
