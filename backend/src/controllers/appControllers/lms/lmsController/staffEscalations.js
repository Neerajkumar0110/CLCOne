const mongoose = require('mongoose');
const { CRM_ADMIN_ROLES } = require('../../../../config/roles');

// Staff escalations (LMS testing report #01): Support raises a ticket against
// the office staff member responsible for an internal task that is incomplete,
// overdue or breached. It is a Ticket (category "Internal escalation") so it
// sits in management's ticket views, gets the 48 h timer + overdue email, and
// keeps a timestamped history. The task's owner is never changed — the ticket
// only records who is accountable.

const M = (n) => mongoose.model(n);
const ok = (res, result, message) => res.status(200).json({ success: true, result, message });
const bad = (res, code, message) => res.status(code).json({ success: false, result: null, message });
const nameOf = (a) => [a && a.name, a && a.surname].filter(Boolean).join(' ') || (a && a.email) || 'staff';
const CATEGORY = 'Internal escalation';
const H = 3600000;

const row = (t, now = Date.now()) => {
  const end = t.resolvedAt ? new Date(t.resolvedAt).getTime() : now;
  const taskDue = t.escalation && t.escalation.taskDueAt ? new Date(t.escalation.taskDueAt) : null;
  return {
    id: String(t._id),
    code: require('../../../../config/supportTickets').ticketNo(t),
    task: (t.escalation && t.escalation.task) || t.subject,
    details: t.description || '',
    against: (t.escalation && t.escalation.againstName) || '—',
    againstId: t.escalation && t.escalation.against ? String(t.escalation.against) : null,
    taskDueAt: taskDue,
    taskOverdue: !!(taskDue && taskDue.getTime() < end && !t.resolvedAt),
    priority: t.priority,
    status: t.status,
    raisedBy: t.raisedByName || '—',
    raisedAt: t.created,
    slaDueAt: t.slaDueAt || null,
    breached: !t.resolvedAt && t.slaDueAt && new Date(t.slaDueAt).getTime() < now,
    resolvedAt: t.resolvedAt || null,
    resolvedBy: t.resolvedByName || null,
    resolution: t.resolutionNote || '',
    elapsedHours: Math.round(((end - new Date(t.created).getTime()) / H) * 10) / 10,
    history: (t.history || []).map((h) => ({ at: h.at, action: h.action, by: h.byName, note: h.note })),
  };
};

// GET /api/lms/admin/sm/escalations?status=open|resolved|all
async function list(req, res) {
  const q = { removed: false, category: CATEGORY };
  if (req.query.status === 'open') q.status = { $ne: 'Resolved' };
  if (req.query.status === 'resolved') q.status = 'Resolved';
  const [rows, staff] = await Promise.all([
    M('Ticket').find(q).sort({ created: -1 }).limit(300).lean(),
    M('Admin').find({ removed: false, enabled: true, role: { $ne: 'Student' } }).select('name surname role').sort({ name: 1 }).lean(),
  ]);
  const now = Date.now();
  const out = rows.map((t) => row(t, now));
  const byStaff = {};
  out.filter((r) => r.status !== 'Resolved').forEach((r) => {
    byStaff[r.against] = byStaff[r.against] || { name: r.against, open: 0, overdue: 0, breached: 0 };
    byStaff[r.against].open += 1;
    if (r.taskOverdue) byStaff[r.against].overdue += 1;
    if (r.breached) byStaff[r.against].breached += 1;
  });
  return ok(res, {
    rows: out,
    staff: staff.map((a) => ({ id: String(a._id), name: nameOf(a), role: a.role })),
    byStaff: Object.values(byStaff).sort((a, b) => b.open - a.open),
    kpis: { open: out.filter((r) => r.status !== 'Resolved').length, overdue: out.filter((r) => r.taskOverdue).length, breached: out.filter((r) => r.breached).length, resolved: out.filter((r) => r.status === 'Resolved').length },
  });
}

// POST /api/lms/admin/sm/escalations { againstId, task, details, taskDueAt, priority }
async function create(req, res) {
  const b = req.body || {};
  if (!mongoose.isValidObjectId(b.againstId)) return bad(res, 400, 'Pick the responsible staff member.');
  const task = String(b.task || '').trim();
  if (task.length < 3) return bad(res, 400, 'Describe the pending task.');
  const who = await M('Admin').findOne({ _id: b.againstId, removed: false }).select('name surname email role').lean();
  if (!who || who.role === 'Student') return bad(res, 400, 'Pick an office staff member.');
  const by = nameOf(req.admin);
  const now = new Date();
  const priority = ['Low', 'Medium', 'High', 'Urgent'].includes(b.priority) ? b.priority : 'High';
  const t = await M('Ticket').create({
    subject: `Escalation: ${task}`.slice(0, 200),
    description: String(b.details || '').slice(0, 3000),
    category: CATEGORY,
    priority,
    status: 'Open',
    source: 'crm',
    createdBy: req.admin._id,
    raisedByName: by,
    raisedByEmail: req.admin.email,
    escalation: { against: who._id, againstName: nameOf(who), task: task.slice(0, 300), taskDueAt: b.taskDueAt ? new Date(b.taskDueAt) : undefined },
    history: [{ at: now, action: 'created', status: 'Open', byName: by, note: `Raised against ${nameOf(who)}${b.taskDueAt ? ` · task was due ${new Date(b.taskDueAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}` : ''}` }],
  });
  const notify = require('../../../../notify');
  // management sees it at once; the staff member is told it was raised
  notify.notify({ audience: 'admins', actorId: req.admin._id, actorName: by, module: 'Support', type: 'ticket.escalation', title: `Escalation against ${nameOf(who)}`, body: task, link: '/support-mgr/tickets' });
  notify.notifyUser({ recipient: who._id, actorName: by, module: 'Support', type: 'ticket.escalation', title: 'A task of yours was escalated', body: task, link: '/support' });
  if (who.email) {
    require('../../../../services/lms/mailer')
      .sendMail([who.email], { subject: `Task escalated to management: ${task}`.slice(0, 150), html: `<p>Hi ${who.name || ''},</p><p>${by} raised an escalation for this pending task:</p><p><b>${task.replace(/</g, '&lt;')}</b></p>${b.details ? `<p>${String(b.details).replace(/</g, '&lt;')}</p>` : ''}<p>Management can see it. Please finish the task and update Support.</p>`, templateKey: 'staff-escalation' })
      .catch(() => {});
  }
  return ok(res, row(t.toObject()), `Escalation raised against ${nameOf(who)} — management notified.`);
}

// POST /api/lms/admin/sm/escalations/:id { resolve?, note? }
async function update(req, res) {
  const t = await M('Ticket').findOne({ _id: req.params.id, removed: false, category: CATEGORY });
  if (!t) return bad(res, 404, 'Escalation not found.');
  const b = req.body || {};
  const by = nameOf(req.admin);
  const now = new Date();
  t.history = t.history || [];
  if (b.note && String(b.note).trim()) t.history.push({ at: now, action: 'note', status: t.status, byName: by, note: String(b.note).trim().slice(0, 1000) });
  if (b.resolve && t.status !== 'Resolved') {
    t.status = 'Resolved';
    t.stage = 'Resolved';
    t.resolvedAt = now;
    t.resolvedByName = by;
    t.resolutionNote = String(b.note || 'Task completed').slice(0, 2000);
    t.history.push({ at: now, action: 'status', status: 'Resolved', byName: by, note: 'Resolved' });
  }
  if (b.reopen && t.status === 'Resolved') {
    t.status = 'Open';
    t.stage = 'New';
    t.resolvedAt = undefined;
    t.history.push({ at: now, action: 'reopened', status: 'Open', byName: by, note: String(b.note || '').slice(0, 500) });
  }
  t.updated = now;
  await t.save();
  return ok(res, row(t.toObject()), b.resolve ? 'Escalation resolved.' : b.reopen ? 'Escalation reopened.' : 'Note added.');
}

module.exports = { escalationList: list, escalationCreate: create, escalationUpdate: update, CATEGORY, isMgmt: (a) => CRM_ADMIN_ROLES.includes(a && a.role) };
