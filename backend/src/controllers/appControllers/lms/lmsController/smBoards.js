const mongoose = require('mongoose');
const { CRM_ADMIN_ROLES, LMS_FULL_ACCESS_ROLES } = require('../../../../config/roles');
const audit = require('../../../../services/lms/auditLog');
const realtime = require('../../../../services/lms/realtime');

// Support Manager boards (design canvas page 5, S1–S7 + S9). Mounted under
// /api/lms/admin/sm/* behind requireManager (LMS_FULL_ACCESS_ROLES — Support
// and the CRM admin roles). Reads reuse the existing models; writes are small
// and audited: ticket workflow fields, absence escalation emails, recording
// rename, learner status (direct for On Hold / Deferred, an Ops approval for
// the adverse ones), batch time change.

const M = (n) => mongoose.model(n);
const ok = (res, result, message) => res.status(200).json({ success: true, result, message });
const bad = (res, code, message) => res.status(code).json({ success: false, result: null, message });
const esc = (s) => String(s || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const rxEq = (s) => new RegExp(`^${esc(s)}$`, 'i');
const lc = (s) => String(s || '').trim().toLowerCase();
const DAY = 86400000;
const HOUR = 3600000;
const ENDED = ['ended', 'recording_processing', 'recording_available'];
const nameOf = (a) => [a && a.name, a && a.surname].filter(Boolean).join(' ') || (a && a.email) || 'staff';
const startOfDay = (d = new Date()) => {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
};

// ── tickets: priority → P-level and SLA (D-06 still open: these are the
// default targets, shown as such on the board) ──────────────────────────────
const PRI = { Urgent: 'P0', High: 'P1', Medium: 'P2', Low: 'P3' };
const SLA_H = { Urgent: 1, High: 4, Medium: 24, Low: 72 };
const STAGES = ['New', 'Triaged', 'Assigned', 'In progress', 'Resolved', 'Closed'];
const stageOf = (t) => t.stage || (t.status === 'Resolved' ? (t.learnerConfirmedAt ? 'Closed' : 'Resolved') : t.status === 'In Progress' ? 'In progress' : t.owner ? 'Assigned' : 'New');
function slaOf(t, now = Date.now()) {
  if (['Resolved', 'Closed'].includes(stageOf(t))) return { state: 'done', label: t.learnerConfirmedAt ? 'confirmed' : 'awaiting confirm' };
  if (t.waiting) return { state: 'paused', label: 'paused' };
  const due = t.slaDueAt ? new Date(t.slaDueAt).getTime() : new Date(t.created).getTime() + (SLA_H[t.priority] || 24) * HOUR;
  const left = due - now;
  const total = (SLA_H[t.priority] || 24) * HOUR;
  const fmt = (ms) => {
    const m = Math.round(Math.abs(ms) / 60000);
    return m >= 2880 ? `${Math.round(m / 1440)} days` : m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m} min`;
  };
  if (left < 0) return { state: 'breached', label: `Breached ${fmt(left)}`, dueAt: new Date(due) };
  return { state: left < total * 0.25 ? 'risk' : 'ok', label: `${fmt(left)} left`, dueAt: new Date(due) };
}

async function rosterMap() {
  const rows = await M('Student').find({ removed: false }).select('name email batch status').lean();
  return new Map(rows.map((r) => [lc(r.email), r]));
}

function ticketRow(t, roster) {
  const r = roster && roster.get(lc(t.raisedByEmail));
  return {
    id: String(t._id),
    code: `TKT-${String(t._id).slice(-6).toUpperCase()}`,
    subject: t.subject,
    description: t.description || '',
    category: t.category,
    priority: t.priority,
    p: PRI[t.priority] || 'P2',
    status: t.status,
    stage: stageOf(t),
    waiting: t.waiting || null,
    owner: t.ownerName || null,
    ownerId: t.owner ? String(t.owner) : null,
    escalatedTo: t.escalatedTo || null,
    nextActionAt: t.nextActionAt || null,
    learner: t.raisedByName || t.raisedByEmail || '—',
    email: t.raisedByEmail || '',
    batch: (r && r.batch) || '',
    source: t.source,
    reference: t.reference || '',
    expected: t.expected || '',
    attachments: t.attachments || [],
    internalNotes: (t.internalNotes || []).slice(-10),
    history: (t.history || []).slice(-12),
    resolutionNote: t.resolutionNote || '',
    problem: t.problem ? { id: String(t.problem), code: t.problemCode || '' } : null,
    restricted: t.category === require('../../../../config/supportTickets').RESTRICTED_TICKET_CATEGORY,
    sla: slaOf(t),
    created: t.created,
    updated: t.updated,
  };
}

// GET /api/lms/admin/sm/tickets
async function ticketList(req, res) {
  const { scopeMatch } = require('../ticketController/scope');
  const match = scopeMatch(req.admin, { removed: false });
  const since = new Date(Date.now() - 45 * DAY);
  match.$or = [{ status: { $ne: 'Resolved' } }, { updated: { $gte: since } }];
  const [rows, roster, owners] = await Promise.all([
    M('Ticket').find(match).sort({ created: -1 }).limit(300).lean(),
    rosterMap(),
    M('Admin').find({ removed: false, enabled: true, role: { $in: LMS_FULL_ACCESS_ROLES } }).select('name surname role').lean(),
  ]);
  const list = rows.map((t) => ticketRow(t, roster));
  const open = list.filter((t) => !['Resolved', 'Closed'].includes(t.stage));
  return ok(res, {
    rows: list,
    counts: {
      open: open.length,
      risk: open.filter((t) => ['risk', 'breached'].includes(t.sla.state)).length,
      unassigned: open.filter((t) => !t.owner).length,
      waiting: open.filter((t) => t.waiting).length,
      restricted: open.filter((t) => t.restricted).length,
    },
    owners: owners.map((o) => ({ id: String(o._id), name: nameOf(o), role: o.role })),
    slaHours: SLA_H,
  });
}

// POST /api/lms/admin/sm/tickets/:id { stage?, ownerId?, priority?, category?,
//   nextActionAt?, note?, escalateTo?, waiting?, reply? }
async function ticketUpdate(req, res) {
  const { canSeeRestricted } = require('../ticketController/scope');
  const { RESTRICTED_TICKET_CATEGORY } = require('../../../../config/supportTickets');
  if (!mongoose.isValidObjectId(req.params.id)) return bad(res, 404, 'Ticket not found.');
  const t = await M('Ticket').findOne({ _id: req.params.id, removed: false });
  if (!t || (t.category === RESTRICTED_TICKET_CATEGORY && !canSeeRestricted(req.admin))) return bad(res, 404, 'Ticket not found.');
  const b = req.body || {};
  const by = nameOf(req.admin);
  if (!t.history) t.history = [];
  const hist = (action, status, note) => t.history.push({ at: new Date(), action, status, byName: by, note });
  const before = { stage: stageOf(t), owner: t.ownerName, priority: t.priority };
  let resolvedNow = false;

  if (b.priority && b.priority !== t.priority) {
    if (!SLA_H[b.priority]) return bad(res, 400, 'Invalid priority.');
    t.priority = b.priority;
    t.slaDueAt = new Date(new Date(t.created).getTime() + SLA_H[b.priority] * HOUR);
  }
  if (b.category && b.category !== t.category) {
    if (b.category === RESTRICTED_TICKET_CATEGORY && !canSeeRestricted(req.admin)) return bad(res, 403, 'Only admins can file into that category.');
    t.category = String(b.category).slice(0, 80);
  }
  if (b.ownerId !== undefined) {
    if (b.ownerId) {
      const o = mongoose.isValidObjectId(b.ownerId) ? await M('Admin').findOne({ _id: b.ownerId, removed: false, role: { $in: LMS_FULL_ACCESS_ROLES } }).lean() : null;
      if (!o) return bad(res, 400, 'Pick a support owner.');
      t.owner = o._id;
      t.ownerName = nameOf(o);
      hist('assigned', t.status, `Owner: ${t.ownerName}`);
    } else {
      t.owner = undefined;
      t.ownerName = undefined;
    }
  }
  if (b.nextActionAt !== undefined) t.nextActionAt = b.nextActionAt ? new Date(b.nextActionAt) : undefined;
  if (b.waiting !== undefined) t.waiting = ['learner', 'tech'].includes(b.waiting) ? b.waiting : undefined;
  if (b.escalateTo) {
    t.escalatedTo = String(b.escalateTo).slice(0, 60);
    hist('escalated', t.status, `Escalated to ${t.escalatedTo}`);
  }
  if (b.note && String(b.note).trim()) {
    t.internalNotes = [...(t.internalNotes || []), { at: new Date(), byName: by, text: String(b.note).trim().slice(0, 1000) }];
    hist('note', t.status, 'Internal note added');
  }
  if (b.stage) {
    if (!STAGES.includes(b.stage)) return bad(res, 400, 'Invalid stage.');
    if (['Assigned', 'In progress'].includes(b.stage) && !t.owner) return bad(res, 400, 'Assign an owner first.');
    t.stage = b.stage;
    const status = ['Resolved', 'Closed'].includes(b.stage) ? 'Resolved' : b.stage === 'In progress' ? 'In Progress' : 'Open';
    if (status === 'Resolved' && t.status !== 'Resolved') {
      resolvedNow = true;
      t.resolvedAt = new Date();
      t.resolvedByName = by;
      if (b.reply) t.resolutionNote = String(b.reply).slice(0, 2000);
      t.waiting = undefined;
    }
    if (status !== t.status) hist(t.status === 'Resolved' && status !== 'Resolved' ? 'reopened' : 'status', status, b.stage);
    t.status = status;
    if (b.stage === 'Closed' && !t.closedAt) t.closedAt = new Date();
  } else if (b.reply && String(b.reply).trim()) {
    t.resolutionNote = String(b.reply).slice(0, 2000);
    hist('status', t.status, 'Reply sent to learner');
  }
  t.updated = new Date();
  await t.save();
  if ((resolvedNow || b.reply) && t.createdBy && t.source === 'student') {
    await realtime.notify([t.createdBy], {
      type: 'lms.ticket.update',
      title: resolvedNow ? `✅ Ticket resolved: ${t.subject}` : `💬 Support replied: ${t.subject}`,
      body: String(b.reply || t.resolutionNote || '').slice(0, 200),
      link: '/learn/support',
      actorName: by,
    });
  }
  if (resolvedNow) await require('../../../../services/support/ticketMail').sendResolvedAndRecord(t._id).catch((e) => console.error('[tickets] resolved mail:', e.message));
  await audit.record({ module: 'ticket', action: 'sm.update', entityType: 'Ticket', entityId: t._id, admin: req.admin, before, after: { stage: stageOf(t), owner: t.ownerName, priority: t.priority, escalatedTo: t.escalatedTo } });
  return ok(res, ticketRow(t.toObject(), await rosterMap()), 'Ticket updated.');
}

// ── S2 attendance board for one class ──────────────────────────────────────
// GET /api/lms/admin/sm/attendance?sessionId=
async function attendanceBoard(req, res) {
  const S = M('LmsLiveSession');
  let s = mongoose.isValidObjectId(req.query.sessionId) ? await S.findOne({ _id: req.query.sessionId, removed: false }).lean() : null;
  if (!s) s = await S.findOne({ removed: false, status: { $in: [...ENDED, 'live'] }, actualStart: { $ne: null } }).sort({ actualStart: -1 }).lean();
  if (!s) return ok(res, { session: null, rows: [], recent: [] });
  const [roster, recent, settings, held, cancelled] = await Promise.all([
    M('Student').find({ removed: false, batch: s.batchName }).select('name email status attendancePct').lean(),
    S.find({ removed: false, status: { $in: [...ENDED, 'live'] }, actualStart: { $ne: null } }).sort({ actualStart: -1 }).limit(40).select('title batchName actualStart').lean(),
    require('../../../../services/lms/settingsService').get().catch(() => ({})),
    S.countDocuments({ removed: false, batchName: s.batchName, status: { $in: ENDED } }),
    S.countDocuments({ removed: false, batchName: s.batchName, status: 'cancelled' }),
  ]);
  const accounts = await M('Admin').find({ removed: false, role: 'Student', email: { $in: roster.map((r) => rxEq(r.email)) } }).select('_id email').lean();
  const accBy = new Map(accounts.map((a) => [lc(a.email), String(a._id)]));
  const parts = new Map((s.participants || []).filter((p) => p.role !== 'teacher' && p.crmUser).map((p) => [String(p.crmUser), p]));
  const rows = roster.map((r) => {
    const uid = accBy.get(lc(r.email));
    const p = uid ? parts.get(uid) : null;
    if (r.status === 'Dropped') return { name: r.name, email: r.email, dropped: true, rosterStatus: r.status };
    return {
      name: r.name,
      email: r.email,
      crmUserId: uid || null,
      join: p ? p.firstJoinAt : null,
      leave: p ? p.lastLeftAt : null,
      minutes: p ? p.totalDurationMin || 0 : 0,
      reconnects: p ? Math.max(0, (p.joinCount || 1) - 1) : null,
      status: p ? p.attendanceStatus : 'ABSENT',
      excusedReason: p ? p.excusedReason || p.correctedReason || '' : '',
      corrected: !!(p && p.correctedAt),
      overall: r.attendancePct || 0,
    };
  });
  rows.sort((a, b) => (a.dropped ? 1 : 0) - (b.dropped ? 1 : 0) || a.name.localeCompare(b.name));
  return ok(res, {
    session: {
      id: String(s._id),
      title: s.title,
      batch: s.batchName,
      course: s.courseTitle,
      start: s.actualStart || s.scheduledStart,
      scheduledStart: s.scheduledStart,
      scheduledEnd: s.scheduledEnd,
      durationMin: s.scheduledDurationMin,
      status: s.status,
    },
    rule: { graceMin: settings.lateThresholdMin || 10, presentPct: settings.presentThresholdPct || 75 },
    basis: { held, cancelled, dropped: roster.filter((r) => r.status === 'Dropped').length },
    rows,
    recent: recent.map((x) => ({ id: String(x._id), title: x.title, batch: x.batchName, start: x.actualStart })),
  });
}

// ── S2 absence escalation (human sends, never automatic) ───────────────────
const LEVEL_TEXT = {
  1: { subject: 'Attendance Check-In — Recent Missed Session', body: (v) => `Dear ${v.first},\nOur attendance record shows that you missed the session held on ${v.lastMissed}. We are checking in to understand whether everything is alright.\nTotal sessions: ${v.total} · Attended: ${v.attended} · Current: ${v.pct}%` },
  2: { subject: 'Action Requested — Irregular Attendance Pattern', body: (v) => `Dear ${v.first},\nA review of your attendance shows an irregular pattern. Please reply with the reason and your plan to improve consistency.\nCurrent: ${v.pct}% · Required: ${v.threshold}% (subject to approved policy)` },
  3: { subject: 'Formal Attendance Warning — Prolonged Absence', body: (v) => `Dear ${v.first},\nAs of ${v.today}, you have been continuously absent for ${v.days} days (${v.from} – ${v.to}).\nCurrent: ${v.pct}% · Required: ${v.threshold}% · Gap: ${Math.max(0, v.threshold - v.pct)} points\nPlease reply within 48 hours and confirm whether you intend to continue.` },
};
const dmy = (d) => new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });

async function buildEscalations() {
  const S = M('LmsLiveSession');
  const roster = await M('Student').find({ removed: false, status: { $nin: ['Dropped', 'Completed', 'Deferred'] }, batch: { $nin: [null, ''] } }).select('name email batch status attendancePct').lean();
  const batches = [...new Set(roster.map((r) => r.batch))];
  const sessions = await S.find({ removed: false, batchName: { $in: batches }, status: { $in: ENDED } }).select('batchName actualStart scheduledStart participants.crmUser participants.attendanceStatus').sort({ scheduledStart: 1 }).lean();
  const byBatch = new Map();
  sessions.forEach((s) => {
    if (!byBatch.has(s.batchName)) byBatch.set(s.batchName, []);
    byBatch.get(s.batchName).push(s);
  });
  const accounts = await M('Admin').find({ removed: false, role: 'Student', email: { $in: roster.map((r) => rxEq(r.email)) } }).select('_id email').lean();
  const accBy = new Map(accounts.map((a) => [lc(a.email), String(a._id)]));
  const settings = await require('../../../../services/lms/settingsService').get().catch(() => ({}));
  const threshold = 90; // eligibility attendance requirement (EligibilityRule default)
  void settings;
  const sent = await M('AuditLog').find({ module: 'attendance', action: 'escalation.send', created: { $gte: new Date(Date.now() - 14 * DAY) } }).select('after created').lean();
  const lastSent = new Map();
  sent.forEach((a) => a.after && a.after.email && lastSent.set(lc(a.after.email), { at: a.created, level: a.after.level }));
  const out = [];
  roster.forEach((r) => {
    const uid = accBy.get(lc(r.email));
    const list = byBatch.get(r.batch) || [];
    if (!uid || !list.length) return;
    const first = list.findIndex((s) => (s.participants || []).some((p) => p.crmUser && String(p.crmUser) === uid));
    if (first < 0) return; // never joined anything — onboarding issue, not an escalation
    const mine = list.slice(first).map((s) => {
      const p = (s.participants || []).find((x) => x.crmUser && String(x.crmUser) === uid);
      return { at: s.actualStart || s.scheduledStart, st: (p && p.attendanceStatus) || 'ABSENT' };
    });
    const counted = mine.filter((m) => m.st !== 'EXCUSED');
    const attended = counted.filter((m) => ['PRESENT', 'LATE', 'PARTIAL'].includes(m.st)).length;
    let streak = 0;
    for (let i = mine.length - 1; i >= 0 && mine[i].st === 'ABSENT'; i -= 1) streak += 1;
    const streakFrom = streak ? mine[mine.length - streak].at : null;
    const streakTo = streak ? mine[mine.length - 1].at : null;
    const days = streak ? Math.round((new Date(streakTo) - new Date(streakFrom)) / DAY) + 1 : 0;
    const pct = r.attendancePct || 0;
    let level = 0;
    if (streak && days >= 10) level = 3;
    else if (pct < 80 && counted.length >= 5) level = 2;
    else if (mine.length && mine[mine.length - 1].st === 'ABSENT') level = 1;
    if (!level) return;
    const v = { first: String(r.name).split(/\s+/)[0], total: counted.length, attended, pct, threshold, days, from: streakFrom && dmy(streakFrom), to: streakTo && dmy(streakTo), today: dmy(new Date()), lastMissed: mine.length ? dmy(mine[mine.length - 1].at) : '' };
    const T = LEVEL_TEXT[level];
    out.push({
      level,
      name: r.name,
      email: r.email,
      batch: r.batch,
      stat: level === 3 ? `${days} days continuous · ${pct}%` : level === 2 ? `irregular · ${pct}%` : `missed 1 · ${pct}%`,
      subject: T.subject,
      body: T.body(v),
      lastSent: lastSent.get(lc(r.email)) || null,
    });
  });
  return out;
}

// GET /api/lms/admin/sm/escalations
async function escalationList(req, res) {
  const rows = await buildEscalations();
  const inc = await M('LmsSetting').findOne({ key: 'incident' }).lean().catch(() => null);
  return ok(res, { rows, incident: !!(inc && inc.incidentMode) });
}

// POST /api/lms/admin/sm/escalations/send { email, level }
async function escalationSend(req, res) {
  const b = req.body || {};
  const rows = await buildEscalations();
  const row = rows.find((r) => lc(r.email) === lc(b.email) && r.level === Number(b.level));
  if (!row) return bad(res, 409, 'This learner no longer needs that escalation (re-check the queue).');
  // pre-send checks, server side
  const stu = await M('Student').findOne({ removed: false, email: rxEq(row.email), batch: row.batch }).lean();
  if (!stu || ['Dropped', 'Completed', 'Deferred'].includes(stu.status)) return bad(res, 409, 'Learner is Dropped / archived — not sent.');
  const setting = await M('LmsSetting').findOne({ key: 'incident' }).lean().catch(() => null);
  if (setting && setting.incidentMode) return bad(res, 409, 'Platform incident is active — escalations are on hold.');
  if (row.lastSent && Date.now() - new Date(row.lastSent.at).getTime() < 3 * DAY && row.lastSent.level >= row.level) return bad(res, 409, `Already sent on ${dmy(row.lastSent.at)}.`);
  const mailer = require('../../../../services/lms/mailer');
  const m = require('../../../../services/mail/inlineEmails').attendanceEscalation({ subject: row.subject, body: row.body });
  let delivered = true;
  try {
    // the level's text is written by the queue (LEVEL_TEXT) — it goes in as {{bodyHtml}}
    const bodyHtml = m.html.replace(/<p>— Career Lab Support<\/p>$/, '');
    const r = await mailer.sendMail([row.email], { ...m, templateKey: 'lms-attendance-escalation', vars: { name: row.name, level: row.level, status: row.stat, bodyHtml } });
    if (r && r.ok === false) delivered = false;
  } catch (e) {
    delivered = false;
  }
  await audit.record({ module: 'attendance', action: 'escalation.send', entityType: 'Student', entityId: stu._id, admin: req.admin, after: { email: row.email, level: row.level, template: `absence-l${row.level} v2`, channel: 'email', delivered } });
  if (!delivered) return bad(res, 502, 'Email could not be sent — logged as failed.');
  return ok(res, { delivered, level: row.level }, 'Email sent and logged.');
}

// ── S1 dashboard ───────────────────────────────────────────────────────────
async function dashboard(req, res) {
  const batch = String(req.query.batch || '').trim();
  const S = M('LmsLiveSession');
  const today = startOfDay();
  const tomorrow = new Date(today.getTime() + DAY);
  const yesterday = new Date(today.getTime() - DAY);
  const rq = { removed: false, ...(batch ? { batch } : {}) };
  const sq = { removed: false, ...(batch ? { batchName: batch } : {}) };
  const [roster, todays, yClasses, tickets, policies, batches, attempts, overdueProjects, reviewProjects, blockedProjects, recordings, payments] = await Promise.all([
    M('Student').find(rq).select('name email status batch attendancePct').lean(),
    S.find({ ...sq, scheduledStart: { $gte: today, $lt: tomorrow }, status: { $ne: 'cancelled' } }).select('status').lean(),
    S.find({ ...sq, scheduledStart: { $gte: yesterday, $lt: today }, status: { $in: ENDED } }).select('participants.crmUser participants.attendanceStatus participants.role batchName').lean(),
    M('Ticket').find(require('../ticketController/scope').scopeMatch(req.admin, { removed: false, status: { $ne: 'Resolved' } })).lean(),
    M('PolicyDocument').find({ removed: false, status: 'published' }).select('_id title version audience').lean().catch(() => []),
    M('Batch').find({ removed: false }).select('name status classTime endTime').lean(),
    M('AssessmentAttempt').find({}).select('candidateEmail testType status qualified score totalCount submittedAt').lean(),
    M('Project').countDocuments({ removed: false, dueDate: { $lt: new Date() }, status: { $nin: ['approved', 'rejected'] }, ...(batch ? { batch } : {}) }),
    M('Project').countDocuments({ removed: false, status: { $in: ['submitted', 'in_review'] }, updated: { $lt: new Date(Date.now() - 3 * DAY) }, ...(batch ? { batch } : {}) }),
    M('Project').countDocuments({ removed: false, 'blocker.text': { $nin: [null, ''] }, status: { $nin: ['approved', 'rejected'] }, ...(batch ? { batch } : {}) }),
    M('LiveRecording').find({ removed: false, ...(batch ? { batchName: batch } : {}) }).select('status').lean(),
    M('PaymentRequest').find({ removed: false, status: 'paid' }).select('studentEmail').lean().catch(() => []),
  ]);
  const active = roster.filter((r) => r.status === 'Active');
  const emails = new Set(active.map((r) => lc(r.email)));
  const accounts = await M('Admin').find({ removed: false, role: 'Student', email: { $in: active.map((r) => rxEq(r.email)) } }).select('_id email').lean();
  const accIds = new Set(accounts.map((a) => String(a._id)));
  // absent yesterday: active learners of a batch that had a class yesterday, not present
  const batchByAcc = new Map(accounts.map((a) => [String(a._id), (active.find((r) => lc(r.email) === lc(a.email)) || {}).batch]));
  let absentY = 0;
  yClasses.forEach((c) => {
    accIds.forEach((uid) => {
      if (batchByAcc.get(uid) !== c.batchName) return;
      const p = (c.participants || []).find((x) => x.crmUser && String(x.crmUser) === uid);
      if (!p || p.attendanceStatus === 'ABSENT') absentY += 1;
    });
  });
  const acks = policies.length ? await M('PolicyAcknowledgement').find({ removed: false, policy: { $in: policies.map((p) => p._id) }, status: 'acknowledged' }).select('student policy').lean() : [];
  const ackBy = new Map();
  acks.forEach((a) => ackBy.set(String(a.student), (ackBy.get(String(a.student)) || 0) + 1));
  const pendingConsent = policies.length ? accounts.filter((a) => (ackBy.get(String(a._id)) || 0) < policies.length).length : 0;
  const tRows = tickets.map((t) => ({ ...t, sla: slaOf(t), stage: stageOf(t) }));
  const esc = await buildEscalations();
  const myEsc = batch ? esc.filter((e) => e.batch === batch) : esc;
  const att = attempts.filter((a) => emails.has(lc(a.candidateEmail)));
  const basic = new Map();
  att.filter((a) => a.testType === 'BASIC').forEach((a) => {
    const k = lc(a.candidateEmail);
    basic.set(k, basic.get(k) || a.qualified === true);
  });
  const lastLeft = new Map();
  att.forEach((a) => lastLeft.set(`${lc(a.candidateEmail)}:${a.testType}`, (lastLeft.get(`${lc(a.candidateEmail)}:${a.testType}`) || 0) + 1));
  const settings = await require('../../../../services/lms/assessmentSettingsService').get();
  const qualifiedKeys = new Set(att.filter((a) => a.qualified).map((a) => `${lc(a.candidateEmail)}:${a.testType}`));
  const lastAttemptLeft = [...lastLeft.entries()].filter(([k, n]) => n === settings.maxAttemptsPerType - 1 && !qualifiedKeys.has(k)).length;
  const types = [...new Set(att.map((a) => a.testType))];
  const attemptedEmails = new Set(att.map((a) => lc(a.candidateEmail)));
  const verify = await M('LmsAdminConfig').find({ key: /^pm-verify:/ }).lean();
  // weekly feedback response rate per batch, latest week with any response
  const fb = await M('WeeklyFeedback').find({ kind: { $ne: 'pm' }, created: { $gte: new Date(Date.now() - 14 * DAY) } }).select('weekKey batch student').lean();
  const latestWeek = fb.map((f) => f.weekKey).sort().pop() || null;
  const byBatch = new Map();
  fb.filter((f) => f.weekKey === latestWeek).forEach((f) => byBatch.set(f.batch, (byBatch.get(f.batch) || new Set()).add(String(f.student))));
  const fbRates = batches
    .filter((bt) => bt.status !== 'Completed' && (!batch || bt.name === batch))
    .map((bt) => {
      const n = active.filter((r) => r.batch === bt.name).length;
      return n ? { batch: bt.name, time: bt.classTime ? `${bt.classTime}${bt.endTime ? `–${bt.endTime}` : ''}` : '', pct: Math.round((((byBatch.get(bt.name) || new Set()).size) / n) * 100) } : null;
    })
    .filter(Boolean)
    .slice(0, 4);
  const health = require('./health');
  let failedJobs = 0;
  let webhookFails = 0;
  let provider = { live: false, provider: 'unknown' };
  try {
    const h = await new Promise((resolve) => health.systemHealth(req, { status: () => ({ json: resolve }) }));
    const r = (h && h.result) || {};
    failedJobs = (r.failedRecordings || 0) + (r.failedWebhooks || 0);
    webhookFails = r.failedWebhooks || 0;
    provider = r.meetingProvider || provider;
  } catch (e) {
    /* best-effort */
  }
  const mailFails = await M('EmailDeliveryLog').countDocuments({ status: 'failed', sentAt: { $gte: new Date(Date.now() - DAY) } }).catch(() => 0);
  const paidEmails = new Set(payments.map((p) => lc(p.studentEmail)).filter(Boolean));
  const allAcc = await M('Admin').find({ removed: false, role: 'Student' }).select('email').lean();
  const accEmails = new Set(allAcc.map((a) => lc(a.email)));
  const notProvisioned = [...paidEmails].filter((e) => !accEmails.has(e)).length;
  return ok(res, {
    batches: batches.filter((b) => b.status !== 'Completed').map((b) => b.name),
    batch: batch || null,
    kpis: {
      activeLearners: active.length,
      classesToday: todays.length,
      liveNow: todays.filter((c) => ['live', 'starting'].includes(c.status)).length,
      absentYesterday: absentY,
      openTickets: tRows.filter((t) => !['Resolved', 'Closed'].includes(t.stage)).length,
      slaRisk: tRows.filter((t) => ['risk', 'breached'].includes(t.sla.state)).length,
      failedJobs: failedJobs + mailFails,
      pendingConsent,
    },
    attendance: { l3: myEsc.filter((e) => e.level === 3).length, l2: myEsc.filter((e) => e.level === 2).length, l1: myEsc.filter((e) => e.level === 1).length, corrections: tRows.filter((t) => /attendance/i.test(t.category)).length, droppedToReconcile: roster.filter((r) => r.status === 'Dropped' && r.batch).length },
    readiness: { policiesPending: pendingConsent, policyLabel: policies.map((p) => `${p.title} v${p.version}`)[0] || null, readinessNotPassed: active.filter((r) => basic.has(lc(r.email)) && !basic.get(lc(r.email))).length, technical: att.filter((a) => a.status === 'SUSPENDED').length, readinessNotTaken: active.filter((r) => !basic.has(lc(r.email))).length },
    assessments: { notAttempted: active.filter((r) => !attemptedEmails.has(lc(r.email))).length, lastAttemptLeft, testTypes: types.length, verified: verify.length },
    feedback: { week: latestWeek, rates: fbRates, deliveryFailures: mailFails },
    projects: { overdue: overdueProjects, reviewsPending: reviewProjects, blocked: blockedProjects },
    recordings: { failed: recordings.filter((r) => r.status === 'FAILED').length, processing: recordings.filter((r) => ['PROCESSING', 'AWAITING_UPLOAD'].includes(r.status)).length, available: recordings.filter((r) => r.status === 'AVAILABLE').length, deleted: recordings.filter((r) => r.status === 'DELETED').length },
    system: { provider: provider.provider, providerLive: !!provider.live, webhookFails, mailFails },
    payments: { paidNotProvisioned: notProvisioned },
    tickets: { unassigned: tRows.filter((t) => !t.owner && !['Resolved', 'Closed'].includes(t.stage)).length, waiting: tRows.filter((t) => t.waiting).length },
  });
}

// ── S6 batch time change: one place, everything follows ────────────────────
// POST /api/lms/admin/sm/batches/:id/time { classTime: 'HH:MM', endTime: 'HH:MM' }
async function batchTime(req, res) {
  const b = req.body || {};
  const hhmm = /^([01]\d|2[0-3]):[0-5]\d$/;
  if (!hhmm.test(String(b.classTime || '')) || !hhmm.test(String(b.endTime || ''))) return bad(res, 400, 'Times must be HH:MM.');
  if (b.endTime <= b.classTime) return bad(res, 400, 'End time must be after start time.');
  if (!mongoose.isValidObjectId(req.params.id)) return bad(res, 404, 'Batch not found.');
  const batch = await M('Batch').findOne({ _id: req.params.id, removed: false });
  if (!batch) return bad(res, 404, 'Batch not found.');
  const before = { classTime: batch.classTime, endTime: batch.endTime };
  batch.classTime = b.classTime;
  batch.endTime = b.endTime;
  await batch.save();
  const liveClassService = require('../../../../services/lms/liveClassService');
  const regen = await liveClassService.regenerateForBatch(batch._id).catch((e) => ({ error: e.message }));
  const roster = await M('Student').find({ removed: false, batch: batch.name, status: 'Active' }).select('email').lean();
  const accounts = await M('Admin').find({ removed: false, role: 'Student', email: { $in: roster.map((r) => rxEq(r.email)) } }).select('_id').lean();
  await realtime.notify(accounts.map((a) => a._id), {
    type: 'lms.batch.time',
    title: `🕒 Class time changed: ${b.classTime}–${b.endTime}`,
    body: `${batch.name}: classes now run ${b.classTime}–${b.endTime} (was ${before.classTime || '?'}–${before.endTime || '?'}). Calendar and reminders are updated.`,
    link: '/learn/calendar',
    actorName: nameOf(req.admin),
  });
  await audit.record({ module: 'batch', action: 'time.change', entityType: 'Batch', entityId: batch._id, admin: req.admin, before, after: { classTime: b.classTime, endTime: b.endTime, regenerated: regen && !regen.error } });
  return ok(res, { notified: accounts.length, regenerated: regen }, `Time changed · ${accounts.length} learners notified.`);
}

// GET /api/lms/admin/sm/batches — batches with seats / roster counts
async function batchList(req, res) {
  const [batches, counts] = await Promise.all([
    M('Batch').find({ removed: false }).select('name code course status classTime endTime classDays seats trainer startDate endDate').sort({ startDate: -1 }).lean(),
    M('Student').aggregate([{ $match: { removed: false, status: { $ne: 'Dropped' } } }, { $group: { _id: '$batch', n: { $sum: 1 } } }]),
  ]);
  const by = new Map(counts.map((c) => [c._id, c.n]));
  const teachers = await M('Admin').find({ removed: false, role: 'Teacher' }).select('name').lean();
  return ok(res, {
    batches: batches.map((b) => ({ id: String(b._id), name: b.name, code: b.code, course: b.course, status: b.status, classTime: b.classTime, endTime: b.endTime, classDays: b.classDays, seats: b.seats || 0, learners: by.get(b.name) || 0, trainer: [].concat(b.trainer || []).join(', ') })),
    teachers: teachers.map((t) => t.name),
  });
}

// ── S7 recording inventory for a batch + range, rename with audit ──────────
// GET /api/lms/admin/sm/recordings?batch=&from=&to=
async function recordingInventory(req, res) {
  const to = req.query.to ? new Date(req.query.to) : new Date();
  const from = req.query.from ? new Date(req.query.from) : new Date(to.getTime() - 30 * DAY);
  const batches = await M('Batch').find({ removed: false }).select('name').lean();
  const batch = String(req.query.batch || '') || (batches[0] && batches[0].name);
  const sessions = await M('LmsLiveSession').find({ removed: false, batchName: batch, scheduledStart: { $gte: from, $lte: to }, status: { $ne: 'cancelled' } }).select('title sessionIndex scheduledStart actualStart status recordingEnabled recordingStatus topic').sort({ scheduledStart: 1 }).lean();
  const recs = await M('LiveRecording').find({ removed: false, liveSession: { $in: sessions.map((s) => s._id) } }).select('+backupUrl +playbackUrl liveSession status failReason views provider className').lean();
  const recBy = new Map();
  recs.forEach((r) => recBy.set(String(r.liveSession), r));
  const renames = await M('AuditLog').find({ module: 'recording', action: 'rename', entityId: { $in: sessions.map((s) => s._id) } }).select('entityId before after reason created performedByName').lean();
  const rows = sessions.map((s) => {
    const r = recBy.get(String(s._id));
    const sources = [];
    if (r && r.provider === 'bigbluebutton') sources.push({ src: 'BBB', ok: r.status !== 'FAILED' && r.status !== 'DELETED' && !!r.playbackUrl });
    else if (r && r.provider === 'external') sources.push({ src: 'Link', ok: !!r.playbackUrl });
    if (r && r.backupUrl) sources.push({ src: 'Drive', ok: true });
    let state = 'NOT_RECORDED';
    if (!s.actualStart && !ENDED.includes(s.status)) state = 'SCHEDULED';
    else if (s.recordingEnabled === false) state = 'RECORDING_OFF';
    else if (r && r.status === 'AVAILABLE') state = r.provider === 'external' || (r.backupUrl && !sources[0].ok) ? 'RECOVERED' : 'AVAILABLE';
    else if (r && ['PROCESSING', 'AWAITING_UPLOAD', 'RECORDING'].includes(r.status)) state = 'PROCESSING';
    else if (r && r.status === 'FAILED') state = r.backupUrl ? 'RECOVERED' : 'FAILED';
    else if (r && r.status === 'DELETED') state = r.backupUrl ? 'RECOVERED' : 'SOURCE_UNAVAILABLE';
    else if (ENDED.includes(s.status)) state = 'SOURCE_UNAVAILABLE';
    return {
      sessionId: String(s._id),
      recordingId: r ? String(r._id) : null,
      code: `S${s.sessionIndex || ''}`,
      date: s.actualStart || s.scheduledStart,
      title: s.title,
      sources,
      state,
      failReason: (r && r.failReason) || '',
      views: (r && r.views) || 0,
      renamed: renames.filter((x) => String(x.entityId) === String(s._id)).map((x) => ({ from: x.before && x.before.title, to: x.after && x.after.title, reason: x.reason, by: x.performedByName, at: x.created })),
    };
  });
  const count = (st) => rows.filter((r) => r.state === st).length;
  return ok(res, {
    batches: batches.map((b) => b.name),
    batch,
    from,
    to,
    rows,
    stats: { scheduled: rows.length, available: count('AVAILABLE'), recovered: count('RECOVERED'), processing: count('PROCESSING'), failed: count('FAILED'), unavailable: count('SOURCE_UNAVAILABLE') + count('RECORDING_OFF') + count('NOT_RECORDED') },
  });
}

// POST /api/lms/admin/sm/recordings/:sessionId/rename { title, reason }
async function recordingRename(req, res) {
  const b = req.body || {};
  const title = String(b.title || '').trim();
  const reason = String(b.reason || '').trim();
  if (title.length < 3) return bad(res, 400, 'Write the new title.');
  if (reason.length < 5) return bad(res, 400, 'A reason is required.');
  if (!mongoose.isValidObjectId(req.params.sessionId)) return bad(res, 404, 'Session not found.');
  const s = await M('LmsLiveSession').findOne({ _id: req.params.sessionId, removed: false });
  if (!s) return bad(res, 404, 'Session not found.');
  const old = s.title;
  s.title = title.slice(0, 200);
  s.titleCustom = true;
  await s.save();
  await M('LiveRecording').updateMany({ liveSession: s._id, removed: false }, { $set: { className: s.title, updated: new Date() } });
  await audit.record({ module: 'recording', action: 'rename', entityType: 'LmsLiveSession', entityId: s._id, admin: req.admin, reason, before: { title: old }, after: { title: s.title } });
  return ok(res, { title: s.title, previous: old }, 'Renamed — old title kept in history.');
}

// ── S9 learners & statuses ─────────────────────────────────────────────────
const DIRECT = ['Active', 'On Hold', 'Deferred'];
const VIA_APPROVAL = { Dropped: 'Mark as Dropped', Suspended: 'Status change', Withdrawn: 'Status change', Archived: 'Status change', Completed: 'Status change' };
const maskEmail = (e) => {
  const [u, d] = String(e || '').split('@');
  return u && d ? `${u[0]}••••@${d}` : '';
};

// GET /api/lms/admin/sm/learners
async function learnerList(req, res) {
  const roster = await M('Student').find({ removed: false }).select('name email phone batch course status enrollmentId created').sort({ created: -1 }).limit(2000).lean();
  const emails = roster.map((r) => lc(r.email)).filter(Boolean);
  const accounts = await M('Admin').find({ removed: false, role: 'Student', email: { $in: emails.map((e) => rxEq(e)) } }).select('_id email').lean();
  const accBy = new Map(accounts.map((a) => [lc(a.email), String(a._id)]));
  const ids = accounts.map((a) => a._id);
  const [onb, acks, policies, tickets, pending, basics] = await Promise.all([
    M('OnboardingProgress').find({ student: { $in: ids } }).lean().catch(() => []),
    M('PolicyAcknowledgement').find({ removed: false, student: { $in: ids }, status: 'acknowledged' }).select('student policyVersion policy').lean(),
    M('PolicyDocument').find({ removed: false, status: 'published' }).select('_id version').lean().catch(() => []),
    M('Ticket').aggregate([{ $match: { removed: false, status: { $ne: 'Resolved' } } }, { $group: { _id: { $toLower: '$raisedByEmail' }, n: { $sum: 1 } } }]),
    M('LmsApproval').find({ removed: false, status: 'pending', type: { $in: ['Mark as Dropped', 'Status change'] } }).select('learnerName detail type').lean(),
    M('AssessmentAttempt').find({ testType: 'BASIC', status: 'SUBMITTED', qualified: true }).select('candidateEmail').lean(),
  ]);
  const passedBasic = new Set(basics.map((x) => lc(x.candidateEmail)));
  const onbBy = new Map(onb.map((o) => [String(o.student), o]));
  const ackBy = new Map();
  acks.forEach((a) => ackBy.set(String(a.student), (ackBy.get(String(a.student)) || 0) + 1));
  const tBy = new Map(tickets.map((t) => [t._id, t.n]));
  const ver = policies.map((p) => p.version).filter(Boolean)[0];
  const rows = roster.map((r) => {
    const uid = accBy.get(lc(r.email));
    const o = uid ? onbBy.get(uid) : null;
    const consented = uid && policies.length ? (ackBy.get(uid) || 0) >= policies.length : false;
    // same 7 steps as the learner's onboarding checklist (onboarding.js#build)
    const steps = [!!uid, !policies.length || consented, !!r.batch, !!(o && o.calendarAt), !!(o && o.setupAt), !!(o && o.deviceAt && o.device && o.device.camera && o.device.microphone), passedBasic.has(lc(r.email))];
    const done = steps.filter(Boolean).length;
    const total = steps.length;
    return {
      id: String(r._id),
      name: r.name,
      email: r.email,
      emailMasked: maskEmail(r.email),
      enrollmentId: r.enrollmentId || '',
      batch: r.batch || '',
      course: r.course || '',
      status: r.status,
      hasAccount: !!uid,
      onboarding: { done, total },
      consent: !policies.length ? 'n/a' : consented ? `${ver ? `v${ver} ` : ''}✓` : 'pending',
      openTickets: tBy.get(lc(r.email)) || 0,
      pendingChange: (pending.find((p) => p.learnerName === r.name) || {}).detail || null,
    };
  });
  const counts = {};
  rows.forEach((r) => {
    counts[r.status] = (counts[r.status] || 0) + 1;
  });
  const batches = await M('Batch').find({ removed: false }).select('name').lean();
  return ok(res, { rows, counts, total: rows.length, batches: batches.map((b) => b.name) });
}

// POST /api/lms/admin/sm/learners/:id/status { status, reason }
async function learnerStatus(req, res) {
  const b = req.body || {};
  const reason = String(b.reason || '').trim();
  if (reason.length < 5) return bad(res, 400, 'Reason + evidence is required.');
  if (!mongoose.isValidObjectId(req.params.id)) return bad(res, 404, 'Learner not found.');
  const s = await M('Student').findOne({ _id: req.params.id, removed: false });
  if (!s) return bad(res, 404, 'Learner not found.');
  if (s.status === b.status) return bad(res, 400, `Already ${b.status}.`);
  if (DIRECT.includes(b.status)) {
    const before = s.status;
    s.status = b.status;
    await s.save(); // Student post-save hook syncs the login's roster hold
    await audit.record({ module: 'student', action: 'status.change', entityType: 'Student', entityId: s._id, admin: req.admin, reason, after: { from: before, to: b.status } });
    return ok(res, { applied: true, status: s.status }, `Status set to ${s.status}.`);
  }
  const type = VIA_APPROVAL[b.status];
  if (!type) return bad(res, 400, 'Unknown status.');
  const dup = await M('LmsApproval').findOne({ removed: false, status: 'pending', learnerName: s.name, type }).lean();
  if (dup) return bad(res, 409, 'A status change for this learner is already waiting for approval.');
  const doc = await M('LmsApproval').create({
    type,
    detail: `${s.status} → ${b.status}`,
    learnerName: s.name,
    scope: s.batch || '',
    evidence: reason.slice(0, 1000),
    highRisk: ['Mark as Dropped', 'Status change'].includes(type),
    requestedBy: req.admin._id,
    requestedByName: nameOf(req.admin),
    requestedByRole: req.admin.role,
    ref: `student:${s._id}`,
    payload: { studentId: String(s._id), to: b.status },
  });
  await audit.record({ module: 'approval', action: 'request', entityType: 'LmsApproval', entityId: doc._id, admin: req.admin, reason, after: { type, learner: s.name, to: b.status } });
  return ok(res, { applied: false, approvalId: String(doc._id) }, 'Sent for approval — status changes once approved.');
}

// POST /api/lms/admin/sm/learners/:id/credentials — reset + resend login
async function learnerCredentials(req, res) {
  if (!mongoose.isValidObjectId(req.params.id)) return bad(res, 404, 'Learner not found.');
  const s = await M('Student').findOne({ _id: req.params.id, removed: false }).lean();
  if (!s || !s.email) return bad(res, 404, 'Learner not found.');
  const acc = await M('Admin').findOne({ removed: false, role: 'Student', email: rxEq(s.email) });
  const svc = require('../../../../services/lms/studentAccountService');
  if (!acc) {
    await svc.provisionLogin(s);
    await audit.record({ module: 'student', action: 'invite', entityType: 'Student', entityId: s._id, admin: req.admin });
    return ok(res, { invited: true }, 'Login created and invite sent.');
  }
  await svc.resetAndResendCredentials(acc, s);
  await audit.record({ module: 'student', action: 'credentials.resend', entityType: 'Student', entityId: s._id, admin: req.admin });
  return ok(res, { resent: true }, 'New login link sent to the learner’s email. The password is never shown here.');
}

// ── S5 certificates ────────────────────────────────────────────────────────
// GET /api/lms/admin/sm/certificates
async function certificateBoard(req, res) {
  const [rules, certs, courses, ext] = await Promise.all([
    M('CertificateRule').find({}).lean().catch(() => []),
    M('Certificate').find({ removed: false }).select('certificateId title type course student status issuedOn replacedBy replaces batch').sort({ issuedOn: -1 }).lean(),
    M('Course').find({ removed: false }).select('title status').lean(),
    M('ExternalCertificate').find({ removed: { $ne: true } }).select('provider title status').lean().catch(() => []),
  ]);
  const engine = require('../../../../services/lms/eligibilityEngine');
  const queue = [];
  const roster = await M('Student').find({ removed: false, status: { $in: ['Active', 'Completed'] } }).select('name email course batch').lean();
  const accounts = await M('Admin').find({ removed: false, role: 'Student', email: { $in: roster.map((r) => rxEq(r.email)) } }).select('_id email name').lean();
  const accBy = new Map(accounts.map((a) => [lc(a.email), a]));
  const issuedKey = new Set(certs.filter((c) => c.status !== 'Revoked').map((c) => `${lc(c.student)}|${lc(c.course)}`));
  for (const r of roster) {
    const acc = accBy.get(lc(r.email));
    const course = courses.find((c) => c.title === r.course);
    if (!acc || !course || issuedKey.has(`${lc(r.name)}|${lc(r.course)}`)) continue;
    // eslint-disable-next-line no-await-in-loop
    const e = await engine.evaluate(acc._id, course._id).catch(() => null);
    if (!e) continue;
    const nameOk = lc(acc.name) === lc(r.name);
    queue.push({
      name: r.name,
      email: r.email,
      batch: r.batch,
      courseId: String(course._id),
      course: course.title,
      eligible: !!e.eligible,
      score: e.score,
      threshold: e.threshold,
      check: nameOk ? 'Name ✓ · course ✓ · date ✓' : `Name mismatch (${r.name} vs ${acc.name})`,
      evidence: (e.items || []).filter((i) => i.applicable).map((i) => `${i.label.split(' ')[0]} ${i.achieved}${['attendance', 'curriculum'].includes(i.key) ? '%' : ''}`).join(' · '),
      missing: e.missing || '',
      state: !nameOk ? 'CORRECTION' : e.eligible ? 'PENDING' : 'EVIDENCE_MISSING',
    });
  }
  queue.sort((a, b) => ({ PENDING: 0, CORRECTION: 1, EVIDENCE_MISSING: 2 }[a.state] - { PENDING: 0, CORRECTION: 1, EVIDENCE_MISSING: 2 }[b.state]) || b.score - a.score);
  const ruleBy = new Map(rules.map((r) => [String(r.course), r]));
  return ok(res, {
    stats: {
      eligibleNotIssued: queue.filter((q) => q.state === 'PENDING').length,
      evidenceMissing: queue.filter((q) => q.state === 'EVIDENCE_MISSING').length,
      pending: queue.filter((q) => q.state === 'PENDING').length,
      issued: certs.filter((c) => ['Issued', 'Sent'].includes(c.status)).length,
      correction: queue.filter((q) => q.state === 'CORRECTION').length,
      revoked: certs.filter((c) => c.status === 'Revoked').length,
      replaced: certs.filter((c) => c.status === 'Replaced').length,
      draft: certs.filter((c) => c.status === 'Draft').length,
    },
    catalogue: [
      ...courses.map((c) => {
        const r = ruleBy.get(String(c._id));
        return { type: c.title, issuer: 'Career Lab', courseId: String(c._id), rule: r ? Object.entries(r).filter(([k, v]) => /min|require|threshold/i.test(k) && v !== undefined && v !== null && v !== false).map(([k, v]) => `${k} ${v}`).slice(0, 3).join(' · ') || 'rule set' : 'no rule yet', status: r ? 'ACTIVE' : 'DRAFT' };
      }),
      ...[...new Set(ext.map((x) => x.provider || x.title).filter(Boolean))].map((p) => ({ type: p, issuer: 'External provider', rule: 'record + verify only', status: 'EXTERNAL' })),
    ],
    queue: queue.slice(0, 60),
    issued: certs.slice(0, 30).map((c) => ({ id: String(c._id), certificateId: c.certificateId, student: c.student, course: c.course, status: c.status, issuedOn: c.issuedOn, replacedBy: c.replacedBy || null, replaces: c.replaces || null })),
    canCorrectDirect: CRM_ADMIN_ROLES.includes(req.admin.role),
  });
}

// POST /api/lms/admin/sm/certificates/:id/revoke { reason } — admins only
async function certificateRevoke(req, res) {
  if (!CRM_ADMIN_ROLES.includes(req.admin.role)) return bad(res, 403, 'Only the programme owner (admin) can revoke.');
  const reason = String((req.body || {}).reason || '').trim();
  if (reason.length < 5) return bad(res, 400, 'A reason is required.');
  if (!mongoose.isValidObjectId(req.params.id)) return bad(res, 404, 'Certificate not found.');
  const c = await M('Certificate').findOne({ _id: req.params.id, removed: false });
  if (!c) return bad(res, 404, 'Certificate not found.');
  const before = c.status;
  c.status = 'Revoked';
  await c.save();
  await audit.record({ module: 'certificate', action: 'revoke', entityType: 'Certificate', entityId: c._id, admin: req.admin, reason, before: { status: before }, after: { status: 'Revoked' } });
  return ok(res, { status: 'Revoked' }, 'Certificate revoked — record kept for audit.');
}

// ── S4 communications: templates, automation, today's delivery log ─────────
async function commsBoard(req, res) {
  const automation = require('../../../../services/lms/automation');
  const [templates, logs] = await Promise.all([
    M('NotificationTemplate').find({ removed: false }).sort({ updated: -1 }).lean(),
    M('EmailDeliveryLog').find({ sentAt: { $gte: startOfDay() } }).sort({ sentAt: -1 }).limit(500).lean(),
  ]);
  const groups = new Map();
  logs.forEach((l) => {
    const subj = String(l.subject || '').replace(/[—–-]\s.*$/, '').replace(/\d[\d,₹.]*/g, '#').trim().slice(0, 60) || '(no subject)';
    const k = `${new Date(l.sentAt).getHours()}|${subj}|${l.status}`;
    if (!groups.has(k)) groups.set(k, { at: l.sentAt, template: subj, status: l.status, count: 0, sample: l.recipient, error: l.error || '' });
    groups.get(k).count += 1;
  });
  const rows = await Promise.all(
    automation.RULES.map(async (r) => {
      const automated = !!r.job; // same rule as adminOps2#automationList
      return { key: r.key, name: r.n, when: r.t, pausable: !!r.pausable, automated, running: automated && !(r.pausable && (await automation.isPaused(r.key))) };
    })
  );
  return ok(res, {
    templates: templates.map((t) => ({ id: String(t._id), name: t.name, eventKey: t.eventKey, channel: t.channel, subject: t.subject, html: t.html, variables: t.variables || [], enabled: t.enabled !== false, updated: t.updated, createdByName: t.createdByName })),
    automation: rows,
    canToggle: CRM_ADMIN_ROLES.includes(req.admin.role),
    log: [...groups.values()].slice(0, 30),
    totals: { sent: logs.filter((l) => l.status === 'sent').length, failed: logs.filter((l) => l.status === 'failed').length },
  });
}

module.exports = {
  dashboard,
  ticketList,
  ticketUpdate,
  attendanceBoard,
  escalationList,
  escalationSend,
  batchList,
  batchTime,
  recordingInventory,
  recordingRename,
  learnerList,
  learnerStatus,
  learnerCredentials,
  certificateBoard,
  certificateRevoke,
  commsBoard,
  _h: { slaOf, stageOf, buildEscalations },
};
