const mongoose = require('mongoose');
const wd = require('../../../services/hr/workday');
const sales360 = require('./sales360');
const { eventsFor } = require('../../../services/sales/overdueTasks');
const { notifyUser } = require('../../../notify');

// CLC-POL-001 sections 6.1, 10, 13 and 14 on the Sales 360° page: overdue
// tasks, disputes / reviews / conduct issues, and the outage log. Each list
// follows the page's filters; workdayController decides who may call what.
const ok = (res, result, message = 'ok') => res.status(200).json({ success: true, result, message });
const fail = (res, message, code = 400) => res.status(code).json({ success: false, result: null, message });
const isId = (x) => mongoose.isValidObjectId(x);
const isDay = (x) => /^\d{4}-\d{2}-\d{2}$/.test(String(x || ''));
const text = (x, max = 1000) => String(x || '').trim().slice(0, max);
const me = (req) => wd.fullName(req.admin) || req.admin.email;

// GET /workday/admin/360/overdue?from=&to=&adminId=&team=&role=&overdue=&q=
async function overdueList(req, res) {
  const q = req.query;
  const { dayKeys } = sales360.parseRange(q);
  const { users } = await sales360.salesUsers(q);
  const filter = { admin: { $in: users.map((u) => u._id) }, dayKey: { $in: dayKeys } };
  if (['open', 'explained', 'excluded', 'recorded'].includes(q.overdue)) filter.status = q.overdue;
  const search = text(q.q, 80);
  if (search) {
    const rx = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    filter.$or = [{ leadName: rx }, { phone: rx }, { explanation: rx }, { adminName: rx }];
  }
  const rows = await mongoose.model('OverdueTask').find(filter).sort({ dueAt: -1 }).limit(500).lean();
  // Per user × day: how many count, and what that means.
  const days = new Map();
  for (const t of rows) {
    if (t.status === 'excluded') continue;
    const k = `${t.admin}|${t.dayKey}`;
    if (!days.has(k)) days.set(k, { adminId: String(t.admin), name: t.adminName, dayKey: t.dayKey, count: 0, recorded: 0 });
    const d = days.get(k);
    d.count += 1;
    if (t.status === 'recorded') d.recorded += 1;
  }
  const summary = [...days.values()].map((d) => ({ ...d, events: eventsFor(d.count) })).sort((a, b) => (a.dayKey < b.dayKey ? 1 : -1));
  // Section 10: a repeated pattern goes to formal review.
  const eventDays = new Map();
  for (const d of summary) if (d.events) eventDays.set(d.adminId, (eventDays.get(d.adminId) || 0) + 1);
  const repeated = [...eventDays].filter(([, n]) => n >= 3).map(([adminId, n]) => ({ adminId, name: summary.find((s) => s.adminId === adminId).name, days: n }));
  return ok(res, { rows, summary, repeated });
}

// POST /workday/admin/360/overdue/:id/explain { explanation } — the user's own task
async function overdueExplain(req, res) {
  if (!isId(req.params.id)) return fail(res, 'Task not found.', 404);
  const explanation = text(req.body && req.body.explanation);
  if (explanation.length < 5) return fail(res, 'Write the reason.');
  const r = await mongoose.model('OverdueTask').updateOne({ _id: req.params.id, admin: req.admin._id, status: { $in: ['open', 'explained'] } }, { $set: { explanation, status: 'explained' } });
  return r.matchedCount ? ok(res, null, 'Reason saved.') : fail(res, 'You can only explain your own open task.', 404);
}

// POST /workday/admin/360/overdue/:id/exclude { note } — outside their control
async function overdueExclude(req, res) {
  if (!isId(req.params.id)) return fail(res, 'Task not found.', 404);
  const note = text(req.body && req.body.note);
  if (note.length < 5) return fail(res, 'Write why it is excluded.');
  await mongoose.model('OverdueTask').updateOne({ _id: req.params.id }, { $set: { status: 'excluded', reviewNote: note, reviewedByName: me(req) } });
  return ok(res, null, 'Task excluded.');
}

// POST /workday/admin/360/overdue/record { adminId, dayKey, note } — after review
async function overdueRecord(req, res) {
  const b = req.body || {};
  if (!isId(b.adminId) || !isDay(b.dayKey)) return fail(res, 'Pick a user and a day.');
  const note = text(b.note, 500);
  if (note.length < 5) return fail(res, 'Write the review note.');
  const Task = mongoose.model('OverdueTask');
  const tasks = await Task.find({ admin: b.adminId, dayKey: b.dayKey, status: { $in: ['open', 'explained'] } }).lean();
  const events = eventsFor(tasks.length);
  if (!events) return fail(res, tasks.length ? 'One overdue task is only a reminder.' : 'Nothing left to record on that day.');
  const admin = await mongoose.model('Admin').findOne({ _id: b.adminId, removed: false }).select('name surname email role').lean();
  if (!admin) return fail(res, 'User not found.');
  const { start, end } = wd.dayBounds(b.dayKey);
  const before = (await sales360.attendance([admin], [b.dayKey], start, end)).get(String(admin._id))[0];
  await mongoose.model('AttendanceCorrection').create({
    admin: admin._id,
    adminName: wd.fullName(admin) || admin.email,
    dayKey: b.dayKey,
    originalStatus: before.status,
    originalShortLeave: before.shortLeave,
    revisedShortLeave: before.shortLeave + events,
    reason: `${tasks.length} overdue tasks reviewed: ${note}`,
    requestedBy: me(req),
    approvedBy: req.admin._id,
    approvedByName: me(req),
  });
  await Task.updateMany({ _id: { $in: tasks.map((t) => t._id) } }, { $set: { status: 'recorded', reviewedByName: me(req), reviewNote: note } });
  notifyUser({ recipient: admin._id, actorId: req.admin._id, actorName: me(req), module: 'HRMS', type: 'attendance.short-leave', title: `${events} short-leave event${events === 1 ? '' : 's'} recorded`, body: `${b.dayKey}: ${tasks.length} overdue tasks. ${note.slice(0, 120)}`, link: '/sales' });
  return ok(res, { events }, `${events} short-leave event${events === 1 ? '' : 's'} recorded.`);
}

// GET /workday/admin/360/cases?caseType=&caseStatus=&adminId=&team=&role=&from=&to=&q=
async function caseList(req, res) {
  const q = req.query;
  const { from, to } = sales360.parseRange(q);
  const { users } = await sales360.salesUsers(q);
  const filter = { admin: { $in: users.map((u) => u._id) }, created: { $gte: from, $lte: to } };
  if (['dispute', 'review', 'conduct'].includes(q.caseType)) filter.type = q.caseType;
  if (['open', 'accepted', 'rejected', 'closed'].includes(q.caseStatus)) filter.status = q.caseStatus;
  const rows = await mongoose.model('PolicyCase').find(filter).sort({ created: -1 }).limit(300).lean();
  const search = text(q.q, 80).toLowerCase();
  return ok(res, search ? rows.filter((r) => `${r.adminName} ${r.message} ${r.decision || ''}`.toLowerCase().includes(search)) : rows);
}

// POST /workday/admin/360/cases { type, adminId?, dayKey?, topic, message }
// Anyone raises their own dispute; a review or conduct issue is the manager's.
async function caseCreate(req, res, canManage) {
  const b = req.body || {};
  const type = ['dispute', 'review', 'conduct'].includes(b.type) ? b.type : 'dispute';
  const message = text(b.message);
  if (message.length < 5) return fail(res, 'Write what this is about.');
  if (type !== 'dispute' && !canManage) return fail(res, 'Only the Sales Manager can do this.', 403);
  const adminId = canManage && isId(b.adminId) ? b.adminId : req.admin._id;
  const admin = await mongoose.model('Admin').findOne({ _id: adminId, removed: false }).select('name surname email').lean();
  if (!admin) return fail(res, 'User not found.');
  const doc = await mongoose.model('PolicyCase').create({
    type,
    admin: admin._id,
    adminName: wd.fullName(admin) || admin.email,
    dayKey: isDay(b.dayKey) ? b.dayKey : undefined,
    topic: ['attendance', 'dialer', 'task', 'prospect', 'performance', 'conduct'].includes(b.topic) ? b.topic : type === 'review' ? 'performance' : type === 'conduct' ? 'conduct' : 'other',
    message,
    raisedBy: req.admin._id,
    raisedByName: me(req),
  });
  if (type !== 'dispute') notifyUser({ recipient: admin._id, actorId: req.admin._id, actorName: me(req), module: 'HRMS', type: `case.${type}`, title: type === 'review' ? 'A performance review was opened' : 'A conduct issue was recorded', body: message.slice(0, 160), link: '/sales' });
  return ok(res, doc, type === 'dispute' ? 'Sent to your manager.' : 'Saved.');
}

// POST /workday/admin/360/cases/:id/decide { status: accepted|rejected|closed, decision }
async function caseDecide(req, res) {
  if (!isId(req.params.id)) return fail(res, 'Not found.', 404);
  const b = req.body || {};
  if (!['accepted', 'rejected', 'closed'].includes(b.status)) return fail(res, 'Choose a decision.');
  const decision = text(b.decision);
  if (decision.length < 5) return fail(res, 'Write the reason for the decision.');
  const doc = await mongoose.model('PolicyCase').findOneAndUpdate({ _id: req.params.id, status: 'open' }, { $set: { status: b.status, decision, decidedByName: me(req), decidedAt: new Date() } }, { new: true }).lean();
  if (!doc) return fail(res, 'Already decided.', 409);
  notifyUser({ recipient: doc.admin, actorId: req.admin._id, actorName: me(req), module: 'HRMS', type: 'case.decided', title: `Your ${doc.type} was ${b.status}`, body: decision.slice(0, 160), link: '/sales' });
  return ok(res, doc, 'Decision saved.');
}

// GET /workday/admin/360/outages?from=&to=&outageKind=
async function outageList(req, res) {
  const { from, to } = sales360.parseRange(req.query);
  const filter = { removed: false, from: { $lte: to }, to: { $gte: from } };
  if (['outage', 'training', 'meeting', 'emergency'].includes(req.query.outageKind)) filter.kind = req.query.outageKind;
  return ok(res, await mongoose.model('OutageLog').find(filter).sort({ from: -1 }).limit(200).lean());
}

// POST /workday/admin/360/outages { kind, from, to, adminIds?, reason }
async function outageCreate(req, res) {
  const b = req.body || {};
  const from = new Date(b.from);
  const to = new Date(b.to);
  if (!['outage', 'training', 'meeting', 'emergency'].includes(b.kind)) return fail(res, 'Pick the kind.');
  if (isNaN(from) || isNaN(to) || to <= from) return fail(res, 'Pick a start and a later end.');
  if (to - from > 3 * 864e5) return fail(res, 'At most 3 days at once.');
  const reason = text(b.reason, 500);
  if (reason.length < 5) return fail(res, 'Write the reason.');
  const ids = (Array.isArray(b.adminIds) ? b.adminIds : []).filter(isId);
  const people = ids.length ? await mongoose.model('Admin').find({ _id: { $in: ids } }).select('name surname email').lean() : [];
  const doc = await mongoose.model('OutageLog').create({ kind: b.kind, from, to, admins: people.map((a) => a._id), adminNames: people.map((a) => wd.fullName(a) || a.email), reason, byName: me(req) });
  return ok(res, doc, 'Logged. Attendance now accounts for it.');
}

// POST /workday/admin/360/outages/:id/remove
async function outageRemove(req, res) {
  if (!isId(req.params.id)) return fail(res, 'Not found.', 404);
  await mongoose.model('OutageLog').updateOne({ _id: req.params.id }, { $set: { removed: true } });
  return ok(res, null, 'Removed.');
}

module.exports = { overdueList, overdueExplain, overdueExclude, overdueRecord, caseList, caseCreate, caseDecide, outageList, outageCreate, outageRemove };
