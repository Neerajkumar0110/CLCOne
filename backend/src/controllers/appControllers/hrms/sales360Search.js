const mongoose = require('mongoose');
const sales360 = require('./sales360');
const { agentNotes, shownCallStatus, CALL_RESULT_FIELDS } = require('../../../services/calling/callingShared');
const { ACTIVE_DISPOSITIONS } = require('../../../services/calling/dispositions');

// GET /workday/admin/360/search?q=&dated=&group=&skip=&…360 filters…
// The search box on Sales 360°: one word or number looked up across the whole
// Sales side. Every word has to match somewhere in a row. All dates unless
// dated=1. A user who isn't management (workdayController forces adminId) only
// finds their own records. A section that takes too long is reported as such,
// so one slow collection never costs the rest of the results.
const PAGE = 20;
const TIME_LIMIT_MS = 8000;
const escapeRx = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const asRx = (w) => new RegExp(escapeRx(w), 'i');
const joined = (...parts) => parts.filter(Boolean).join(' · ');
const inr = (v) => `₹${Number(v || 0).toLocaleString('en-IN')}`;
const clockLength = (sec) => (sec >= 60 ? `${Math.floor(sec / 60)}m ${sec % 60}s` : `${sec || 0}s`);
const labelOf = new Map(ACTIVE_DISPOSITIONS.map((d) => [d.code, d.label]));

// "+91 98765-43210" is one number, not three words.
function wordsOf(raw) {
  const text = String(raw || '').trim().slice(0, 80);
  if (/^[\d\s+()-]+$/.test(text)) {
    const digits = text.replace(/\D/g, '');
    return digits ? [digits.slice(-10)] : [];
  }
  return text.split(/\s+/).filter(Boolean).slice(0, 5);
}

// Where the word was found, when that isn't already on the row.
function foundIn(words, pairs) {
  for (const [label, value] of pairs) {
    const s = String(value || '');
    const low = s.toLowerCase();
    const i = words.map((w) => low.indexOf(w.toLowerCase())).find((x) => x >= 0);
    if (i !== undefined) return `${label}: ${i > 40 ? '…' : ''}${s.slice(Math.max(0, i - 40), i + 60)}${s.length > i + 60 ? '…' : ''}`;
  }
  return null;
}
const inRange = (c, field) => (c.dated ? { [field]: { $gte: c.from, $lte: c.to } } : {});
const oneOf = (c, ...fields) => (c.restricted ? { $or: fields.map((f) => ({ [f]: { $in: c.ids } })) } : {});
const ownerIs = (c) => (c.restricted ? { owner: { $in: c.names } } : {});

const GROUPS = [
  {
    key: 'leads',
    label: 'Leads',
    model: 'Lead',
    fields: ['name', 'phone', 'phoneNormalized', 'alternatePhone', 'email', 'source', 'stage', 'subStatus', 'city', 'state', 'persona', 'education', 'team', 'remarks', 'assignedUserName', 'metaFormName', 'stageHistory.remarks', 'stageHistory.changedByName', 'callHistory.notes', 'prospectVerification.notes', 'prospectHandoffs.note', 'prospectHandoffs.toName'],
    sort: { stageUpdatedAt: -1 },
    select: 'name phone email source stage subStatus city state persona education team remarks assignedUserName metaFormName stageUpdatedAt alternatePhone stageHistory.remarks stageHistory.changedByName callHistory.notes prospectVerification.notes prospectHandoffs.note prospectHandoffs.toName',
    where: (c) => {
      const and = [{ removed: false }];
      if (c.restricted) and.push({ $or: [{ assignedUser: { $in: c.ids } }, { 'stageHistory.changedBy': { $in: c.ids } }, { 'stageHistory.onCallOf': { $in: c.names } }, { 'prospectHandoffs.to': { $in: c.ids } }] });
      if (c.dated) and.push({ $or: [inRange(c, 'created'), inRange(c, 'stageHistory.at')] });
      const lm = sales360.leadMatch(c.q);
      if (lm) and.push(lm);
      return { $and: and };
    },
    row: (l, c) => ({
      id: l._id,
      title: l.name || l.phone,
      sub: joined(l.phone, l.email, l.source, l.city, l.assignedUserName),
      pill: l.stage,
      pill2: l.subStatus && l.subStatus !== l.stage ? l.subStatus : null,
      at: l.stageUpdatedAt,
      match: foundIn(c.words, [
        ['Remarks', l.remarks],
        ['Alternate phone', l.alternatePhone],
        ['State', l.state],
        ['Persona', l.persona],
        ['Education', l.education],
        ['Team', l.team],
        ['Form', l.metaFormName],
        ...(l.stageHistory || []).flatMap((h) => [['Remarks', h.remarks], ['Changed by', h.changedByName]]),
        ...(l.callHistory || []).map((h) => ['Call note', h.notes]),
        ['Verification', l.prospectVerification && l.prospectVerification.notes],
        ...(l.prospectHandoffs || []).flatMap((h) => [['Sent to', h.toName], ['Note', h.note]]),
      ]),
      action: { type: 'lead', phone: l.phone, name: l.name },
    }),
  },
  {
    key: 'calls',
    label: 'Calls',
    model: 'CallRecord',
    fields: ['contactName', 'phone', 'agentName', 'disposition', 'notes'],
    also: (w) => {
      const rx = asRx(w);
      const codes = ACTIVE_DISPOSITIONS.filter((d) => rx.test(d.label)).map((d) => d.code);
      return codes.length ? [{ disposition: { $in: codes } }] : [];
    },
    sort: { created: -1 },
    select: `contactName phone agentName disposition notes status direction duration created ${CALL_RESULT_FIELDS}`,
    where: async (c) => {
      const { q: _q, ...rest } = c.q;
      const and = await sales360.callFilter(rest, c.ids, c.dated ? c.from : new Date(0), c.dated ? c.to : new Date());
      return { removed: false, ...(c.restricted ? { agent: { $in: c.ids } } : {}), ...inRange(c, 'created'), $and: and };
    },
    row: (r, c) => ({
      id: r._id,
      title: r.contactName || r.phone,
      sub: joined(r.phone, r.direction, r.agentName, r.duration ? clockLength(r.duration) : null),
      pill: labelOf.get(r.disposition) || r.disposition || shownCallStatus(r),
      at: r.created,
      match: foundIn(c.words, [['Note', agentNotes(r.notes)]]),
      action: { type: 'lead', phone: r.phone, name: r.contactName },
    }),
  },
  {
    key: 'demos',
    label: 'Demos',
    model: 'DemoBooking',
    fields: ['name', 'email', 'phone', 'agentName', 'teamLeaderName', 'status', 'date'],
    sort: { created: -1 },
    select: 'name email phone agentName teamLeaderName status date created',
    where: (c) => ({ removed: false, ...oneOf(c, 'agent', 'teamLeader'), ...inRange(c, 'created') }),
    row: (d) => ({ id: d._id, title: d.name || d.phone, sub: joined(d.phone, d.date, d.agentName, d.teamLeaderName), pill: d.status, at: d.created, action: { type: 'lead', phone: d.phone, name: d.name } }),
  },
  {
    key: 'payments',
    label: 'Payments',
    model: 'PaymentRequest',
    fields: ['studentName', 'studentEmail', 'studentPhone', 'course', 'status', 'notes', 'createdByName'],
    sort: { created: -1 },
    select: 'studentName studentEmail studentPhone course status notes createdByName amount paidAt created',
    where: (c) => ({ removed: false, ...oneOf(c, 'createdBy'), ...inRange(c, 'created'), ...(c.q.payStatus ? { status: c.q.payStatus } : {}) }),
    row: (p, c) => ({ id: p._id, title: p.studentName, sub: joined(p.studentPhone, p.course, inr(p.amount), p.createdByName), pill: p.status, at: p.paidAt || p.created, match: foundIn(c.words, [['Email', p.studentEmail], ['Note', p.notes]]), action: { type: 'lead', phone: p.studentPhone, name: p.studentName } }),
  },
  {
    key: 'deals',
    label: 'Deals',
    model: 'SalesDeal',
    fields: ['title', 'account', 'contactName', 'contactEmail', 'contactPhone', 'stage', 'owner', 'tags', 'description', 'nextStep', 'competitors', 'source'],
    sort: { created: -1 },
    select: 'title account contactName contactEmail contactPhone stage owner tags description nextStep competitors source amount created',
    where: (c) => ({ removed: false, ...ownerIs(c), ...inRange(c, 'created'), ...(c.q.dealStage ? { stage: c.q.dealStage } : {}) }),
    row: (d, c) => ({ id: d._id, title: d.title, sub: joined(d.account, d.contactName, d.contactPhone, inr(d.amount), d.owner), pill: d.stage, at: d.created, match: foundIn(c.words, [['Email', d.contactEmail], ['Tags', d.tags], ['Next step', d.nextStep], ['Competitors', d.competitors], ['Source', d.source], ['Description', d.description]]), action: { type: 'go', to: '/sales/deals' } }),
  },
  {
    key: 'quotes',
    label: 'Quotes',
    model: 'SalesQuote',
    fields: ['number', 'title', 'account', 'contactName', 'contactEmail', 'deal', 'status', 'owner', 'terms', 'notes'],
    sort: { created: -1 },
    select: 'number title account contactName contactEmail deal status owner terms notes total created',
    where: (c) => ({ removed: false, ...ownerIs(c), ...inRange(c, 'created'), ...(c.q.quoteStatus ? { status: c.q.quoteStatus } : {}) }),
    row: (d, c) => ({ id: d._id, title: joined(d.number, d.title), sub: joined(d.account, d.contactName, inr(d.total), d.owner), pill: d.status, at: d.created, match: foundIn(c.words, [['Email', d.contactEmail], ['Deal', d.deal], ['Terms', d.terms], ['Note', d.notes]]), action: { type: 'go', to: '/sales/quotes' } }),
  },
  {
    key: 'orders',
    label: 'Orders',
    model: 'SalesOrder',
    fields: ['number', 'account', 'quoteRef', 'status', 'paymentStatus', 'invoiceRef', 'owner', 'billingAddress', 'shippingAddress', 'notes'],
    sort: { created: -1 },
    select: 'number account quoteRef status paymentStatus invoiceRef owner billingAddress shippingAddress notes total created',
    where: (c) => ({ removed: false, ...ownerIs(c), ...inRange(c, 'created'), ...(c.q.orderStatus ? { status: c.q.orderStatus } : {}), ...(c.q.orderPayment ? { paymentStatus: c.q.orderPayment } : {}) }),
    row: (d, c) => ({ id: d._id, title: d.number, sub: joined(d.account, inr(d.total), d.paymentStatus, d.owner), pill: d.status, at: d.created, match: foundIn(c.words, [['Quote', d.quoteRef], ['Invoice', d.invoiceRef], ['Billing address', d.billingAddress], ['Shipping address', d.shippingAddress], ['Note', d.notes]]), action: { type: 'go', to: '/sales/orders' } }),
  },
  {
    key: 'clients',
    label: 'Clients',
    model: 'Client',
    fields: ['name', 'phone', 'email', 'country', 'address'],
    sort: { created: -1 },
    select: 'name phone email country address created',
    where: (c) => ({ removed: false, ...oneOf(c, 'assigned', 'createdBy'), ...inRange(c, 'created') }),
    row: (d) => ({ id: d._id, title: d.name, sub: joined(d.phone, d.email, d.country, d.address), at: d.created, action: { type: 'go', to: '/customer' } }),
  },
  {
    key: 'products',
    label: 'Products',
    model: 'Product',
    fields: ['name', 'sku', 'category', 'hsnCode', 'status', 'description'],
    sort: { name: 1 },
    select: 'name sku category hsnCode status description unitPrice',
    where: () => ({ removed: false }),
    row: (d, c) => ({ id: d._id, title: d.name, sub: joined(d.sku, d.category, inr(d.unitPrice)), pill: d.status, match: foundIn(c.words, [['HSN', d.hsnCode], ['Description', d.description]]), action: { type: 'go', to: '/sales/products' } }),
  },
  {
    key: 'overdue',
    label: 'Overdue tasks',
    model: 'OverdueTask',
    fields: ['leadName', 'phone', 'adminName', 'kind', 'status', 'explanation', 'reviewNote', 'reviewedByName'],
    sort: { dueAt: -1 },
    select: 'lead leadName phone adminName kind status explanation reviewNote dueAt',
    where: (c) => ({ ...oneOf(c, 'admin'), ...inRange(c, 'dueAt'), ...(c.q.overdue ? { status: c.q.overdue } : {}) }),
    row: (d, c) => ({ id: d._id, title: d.leadName || d.phone, sub: joined(d.phone, d.kind, d.adminName), pill: d.status, at: d.dueAt, match: foundIn(c.words, [['Explanation', d.explanation], ['Review', d.reviewNote]]), action: { type: 'lead', phone: d.phone, name: d.leadName } }),
  },
  {
    key: 'cases',
    label: 'Disputes & reviews',
    model: 'PolicyCase',
    fields: ['adminName', 'type', 'topic', 'status', 'message', 'decision', 'raisedByName', 'decidedByName'],
    sort: { created: -1 },
    select: 'adminName type topic status message decision raisedByName created',
    where: (c) => ({ ...oneOf(c, 'admin'), ...inRange(c, 'created'), ...(c.q.caseType ? { type: c.q.caseType } : {}), ...(c.q.caseStatus ? { status: c.q.caseStatus } : {}) }),
    row: (d, c) => ({ id: d._id, title: d.adminName, sub: joined(d.type, d.topic, d.raisedByName), pill: d.status, at: d.created, match: foundIn(c.words, [['Message', d.message], ['Decision', d.decision]]) }),
  },
  {
    key: 'outages',
    label: 'Outage log',
    model: 'OutageLog',
    fields: ['kind', 'reason', 'adminNames', 'byName'],
    sort: { from: -1 },
    select: 'kind reason adminNames byName from',
    where: (c) => ({ removed: false, ...oneOf(c, 'admins'), ...inRange(c, 'from'), ...(c.q.outageKind ? { kind: c.q.outageKind } : {}) }),
    row: (d) => ({ id: d._id, title: d.kind, sub: joined(d.reason, d.byName), at: d.from }),
  },
  {
    key: 'activity',
    label: 'Activity',
    model: 'UserEvent',
    fields: ['adminName', 'kind', 'label', 'path'],
    sort: { at: -1 },
    select: 'adminName kind label path at',
    where: (c) => ({ ...oneOf(c, 'admin'), ...inRange(c, 'at'), ...(c.q.path ? { path: c.q.path } : {}) }),
    row: (d) => ({ id: d._id, title: d.label || d.path, sub: joined(d.adminName, d.path), pill: d.kind, at: d.at }),
  },
];

async function runGroup(g, c, skip) {
  try {
    const where = await g.where(c);
    const words = c.words.map((w) => ({ $or: [...g.fields.map((f) => ({ [f]: asRx(w) })), ...(g.also ? g.also(w) : [])] }));
    const docs = await mongoose.model(g.model).find({ $and: [where, ...words] }).select(g.select).sort(g.sort).skip(skip).limit(PAGE + 1).maxTimeMS(TIME_LIMIT_MS).lean();
    return { key: g.key, label: g.label, rows: docs.slice(0, PAGE).map((d) => g.row(d, c)), more: docs.length > PAGE };
  } catch (err) {
    console.error(`[sales360Search] ${g.key}:`, err.message);
    return { key: g.key, label: g.label, rows: [], more: false, failed: true };
  }
}

// Sales users are searched from the list already in hand; only management sees it.
function usersGroup(users, c, skip) {
  const rows = users
    .map((u) => ({ adminId: String(u._id), name: [u.name, u.surname].filter(Boolean).join(' ') || u.email, role: u.role, team: u.team, email: u.email }))
    .filter((u) => c.words.every((w) => asRx(w).test(`${u.name} ${u.email} ${u.role} ${u.team || ''}`)));
  return {
    key: 'users',
    label: 'Sales users',
    rows: rows.slice(skip, skip + PAGE).map((u) => ({ id: u.adminId, title: u.name, sub: joined(u.role, u.team, u.email), action: { type: 'user', adminId: u.adminId } })),
    more: rows.length > skip + PAGE,
  };
}

async function search(req, res) {
  const q = req.query;
  const words = wordsOf(q.q);
  if (!words.length || words.join('').length < 2) return res.status(200).json({ success: true, message: 'ok', result: { groups: [] } });
  const { from, to } = sales360.parseRange(q);
  const { users } = await sales360.salesUsers(q);
  const c = {
    q,
    words,
    from,
    to,
    dated: q.dated === '1',
    restricted: !!(q.adminId || q.team || q.role),
    ids: users.map((u) => u._id),
    names: users.flatMap((u) => [u.name, [u.name, u.surname].filter(Boolean).join(' ')]).filter(Boolean),
  };
  const skip = Math.max(0, parseInt(q.skip, 10) || 0);
  const canSeeUsers = !q.self;
  const groups = q.group
    ? q.group === 'users'
      ? [canSeeUsers ? usersGroup(users, c, skip) : { key: 'users', rows: [], more: false }]
      : await Promise.all(GROUPS.filter((g) => g.key === q.group).map((g) => runGroup(g, c, skip)))
    : [...(canSeeUsers ? [usersGroup(users, c, 0)] : []), ...(await Promise.all(GROUPS.map((g) => runGroup(g, c, 0))))];
  return res.status(200).json({ success: true, message: 'ok', result: { groups: groups.filter((g) => g.rows.length || g.failed) } });
}

module.exports = { search, wordsOf, foundIn };
