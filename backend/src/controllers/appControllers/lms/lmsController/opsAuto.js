const mongoose = require('mongoose');
const { CRM_ADMIN_ROLES } = require('../../../../config/roles');
const audit = require('../../../../services/lms/auditLog');
const realtime = require('../../../../services/lms/realtime');
const dup = require('../../../../services/lms/duplicateClasses');
const executor = require('../../../../services/lms/approvalExecutor');

// Gap fixes on top of the Support Manager / PM boards:
//   DATA-02 duplicate classes  — detect + "Request removal" (Ops approves,
//                                the system removes it)
//   §27 step 9                 — certificate correction with a new ID
//   §13.4                      — problem records (PRB) linking tickets;
//                                resolving one resolves every linked ticket
//   §18 / §20                  — backup / restore-drill / load-test status
//                                written by deploy/vps scripts
// SM routes are behind requireManager; PM routes are scoped to the PM's
// own batches (pmBoards#myBatches).

const M = (n) => mongoose.model(n);
const ok = (res, result, message) => res.status(200).json({ success: true, result, message });
const bad = (res, code, message) => res.status(code).json({ success: false, result: null, message });
const nameOf = (a) => [a && a.name, a && a.surname].filter(Boolean).join(' ') || (a && a.email) || 'staff';
const isAdmin = (a) => CRM_ADMIN_ROLES.includes(a && a.role);

// ── DATA-02 duplicate classes ──────────────────────────────────────────────
// GET /api/lms/admin/sm/classes/duplicates?batch=
async function smDuplicates(req, res) {
  const groups = await dup.withRequests(await dup.detect({ batches: req.query.batch ? [String(req.query.batch)] : undefined }));
  return ok(res, { groups });
}

// POST /api/lms/admin/sm/classes/:id/request-removal { reason }
async function smDuplicateRequest(req, res) {
  if (!mongoose.isValidObjectId(req.params.id)) return bad(res, 404, 'Class not found.');
  const r = await dup.raiseRemoval({ sessionId: req.params.id, reason: String((req.body || {}).reason || '').trim().slice(0, 300), admin: req.admin });
  if (r.error) return bad(res, r.error, r.message);
  return ok(res, r.result, 'Removal request sent to Ops — the class is removed once approved.');
}

async function pmBatchNames(admin) {
  const { _myBatches } = require('./pmBoards');
  return (await _myBatches(admin)).map((b) => b.name);
}

// GET /api/lms/teacher/pm/classes/duplicates
async function pmDuplicates(req, res) {
  const names = await pmBatchNames(req.admin);
  if (!names.length) return ok(res, { groups: [] });
  return ok(res, { groups: await dup.withRequests(await dup.detect({ batches: names })) });
}

// POST /api/lms/teacher/pm/classes/:id/request-removal { reason }
async function pmDuplicateRequest(req, res) {
  if (!mongoose.isValidObjectId(req.params.id)) return bad(res, 404, 'Class not found.');
  const s = await M('LmsLiveSession').findOne({ _id: req.params.id, removed: false }).select('batchName').lean();
  if (!s || !(await pmBatchNames(req.admin)).includes(s.batchName)) return bad(res, 403, 'Not your batch.');
  const r = await dup.raiseRemoval({ sessionId: req.params.id, reason: String((req.body || {}).reason || '').trim().slice(0, 300), admin: req.admin });
  if (r.error) return bad(res, r.error, r.message);
  return ok(res, r.result, 'Removal request sent to Ops — the class is removed once approved.');
}

// ── §27 step 9 certificate correction ──────────────────────────────────────
// POST /api/lms/admin/sm/certificates/:id/correct { name, course, reason }
// The programme owner (CRM admin) corrects directly; Support raises an Ops
// request that the system carries out on approval.
async function smCertificateCorrect(req, res) {
  const b = req.body || {};
  const reason = String(b.reason || '').trim();
  if (reason.length < 5) return bad(res, 400, 'Say what is wrong and what supports the correction.');
  const name = String(b.name || '').trim().slice(0, 120);
  const course = String(b.course || '').trim().slice(0, 160);
  if (!name) return bad(res, 400, 'Corrected name is required.');
  if (!mongoose.isValidObjectId(req.params.id)) return bad(res, 404, 'Certificate not found.');
  const c = await M('Certificate').findOne({ _id: req.params.id, removed: false }).lean();
  if (!c) return bad(res, 404, 'Certificate not found.');
  if (!['Issued', 'Sent'].includes(c.status)) return bad(res, 409, `Only an issued certificate can be corrected (this one is ${c.status}).`);
  if (name === c.student && (!course || course === c.course)) return bad(res, 400, 'Nothing changed.');
  if (isAdmin(req.admin)) {
    try {
      const r = await executor.correctCertificate(c._id, { name, course: course || c.course, reason }, req.admin);
      return ok(res, { applied: true, ...r }, `New certificate ${r.certificateId} issued — ${r.old} now shows "Replaced".`);
    } catch (e) {
      return bad(res, 409, e.message);
    }
  }
  const ref = `certificate:${c._id}`;
  if (await M('LmsApproval').exists({ removed: false, status: 'pending', ref })) return bad(res, 409, 'A correction for this certificate is already waiting for approval.');
  const doc = await M('LmsApproval').create({
    type: 'Certificate correction',
    detail: `${c.student} → ${name}${course && course !== c.course ? ` · ${course}` : ''}`.slice(0, 200),
    learnerName: c.student,
    scope: c.batch || c.course || '',
    evidence: reason.slice(0, 1000),
    ref,
    payload: { certId: String(c._id), name, course: course || c.course },
    requestedBy: req.admin._id,
    requestedByName: nameOf(req.admin),
    requestedByRole: req.admin.role,
  });
  await audit.record({ module: 'approval', action: 'request', entityType: 'LmsApproval', entityId: doc._id, admin: req.admin, reason, after: { type: doc.type, certificate: c.certificateId } });
  return ok(res, { applied: false, approvalId: String(doc._id) }, 'Sent for approval — the corrected certificate is issued automatically once approved.');
}

// ── §13.4 problem records ──────────────────────────────────────────────────
const problemRow = (p, tickets) => ({
  id: String(p._id),
  code: p.code,
  title: p.title,
  category: p.category || '',
  status: p.status,
  rootCause: p.rootCause || '',
  workaround: p.workaround || '',
  resolution: p.resolution || '',
  ownerName: p.ownerName || '',
  createdByName: p.createdByName || '',
  created: p.created,
  resolvedAt: p.resolvedAt || null,
  tickets: (tickets || []).map((t) => ({ id: String(t._id), code: `TKT-${String(t._id).slice(-6).toUpperCase()}`, subject: t.subject, learner: t.raisedByName || t.raisedByEmail || '', status: t.status })),
});

async function nextCode() {
  const last = await M('LmsProblem').findOne({ code: /^PRB-\d+$/ }).sort({ created: -1 }).select('code').lean();
  const n = last ? Number(last.code.slice(4)) + 1 : 1;
  return `PRB-${String(n).padStart(4, '0')}`;
}

// GET /api/lms/admin/sm/problems — records + "same category, 3+ open
// tickets in 72h" suggestions (automation detects, Support decides)
async function problemList(req, res) {
  const problems = await M('LmsProblem').find({ removed: false }).sort({ status: 1, created: -1 }).limit(100).lean();
  const linked = problems.length ? await M('Ticket').find({ removed: false, problem: { $in: problems.map((p) => p._id) } }).select('subject raisedByName raisedByEmail status problem').lean() : [];
  const since = new Date(Date.now() - 72 * 3600000);
  const open = await M('Ticket').find({ removed: false, status: { $ne: 'Resolved' }, problem: null, created: { $gte: since } }).select('subject category created').lean();
  const byCat = new Map();
  open.forEach((t) => {
    const k = t.category || 'Other';
    if (!byCat.has(k)) byCat.set(k, []);
    byCat.get(k).push(t);
  });
  const suggestions = [...byCat.entries()]
    .filter(([, list]) => list.length >= 3)
    .map(([category, list]) => ({ category, count: list.length, ticketIds: list.map((t) => String(t._id)), subjects: [...new Set(list.map((t) => t.subject))].slice(0, 3) }));
  return ok(res, {
    rows: problems.map((p) => problemRow(p, linked.filter((t) => String(t.problem) === String(p._id)))),
    suggestions,
  });
}

async function linkTickets(problem, ids, admin) {
  const valid = (ids || []).filter((x) => mongoose.isValidObjectId(x));
  if (!valid.length) return 0;
  const tickets = await M('Ticket').find({ _id: { $in: valid }, removed: false });
  for (const t of tickets) {
    t.problem = problem._id;
    t.problemCode = problem.code;
    t.history = [...(t.history || []), { at: new Date(), action: 'problem', status: t.status, byName: nameOf(admin), note: `Linked to ${problem.code}` }];
    if (problem.workaround) t.internalNotes = [...(t.internalNotes || []), { at: new Date(), byName: nameOf(admin), text: `${problem.code} workaround: ${problem.workaround}`.slice(0, 1000) }];
    t.updated = new Date();
    // eslint-disable-next-line no-await-in-loop
    await t.save();
  }
  return tickets.length;
}

// POST /api/lms/admin/sm/problems { title, category, rootCause, workaround, ticketIds }
async function problemCreate(req, res) {
  const b = req.body || {};
  const title = String(b.title || '').trim();
  if (title.length < 5) return bad(res, 400, 'Describe the problem in a few words.');
  const p = await M('LmsProblem').create({
    code: await nextCode(),
    title: title.slice(0, 200),
    category: String(b.category || '').slice(0, 80),
    rootCause: String(b.rootCause || '').slice(0, 2000),
    workaround: String(b.workaround || '').slice(0, 2000),
    owner: req.admin._id,
    ownerName: nameOf(req.admin),
    createdBy: req.admin._id,
    createdByName: nameOf(req.admin),
    history: [{ at: new Date(), byName: nameOf(req.admin), note: 'Opened' }],
  });
  const n = await linkTickets(p, b.ticketIds, req.admin);
  await audit.record({ module: 'ticket', action: 'problem.create', entityType: 'LmsProblem', entityId: p._id, admin: req.admin, after: { code: p.code, title: p.title, tickets: n } });
  return ok(res, { id: String(p._id), code: p.code, linked: n }, `${p.code} opened${n ? ` · ${n} ticket${n > 1 ? 's' : ''} linked` : ''}.`);
}

// POST /api/lms/admin/sm/problems/:id
//   { linkTicket } | { unlinkTicket } | { rootCause, workaround, status: 'Known error' } | { resolve: '<answer to learners>' }
async function problemUpdate(req, res) {
  if (!mongoose.isValidObjectId(req.params.id)) return bad(res, 404, 'Problem not found.');
  const p = await M('LmsProblem').findOne({ _id: req.params.id, removed: false });
  if (!p) return bad(res, 404, 'Problem not found.');
  const b = req.body || {};
  const by = nameOf(req.admin);
  if (b.linkTicket) {
    if (p.status === 'Resolved') return bad(res, 409, `${p.code} is resolved — open a new problem record.`);
    const n = await linkTickets(p, [b.linkTicket], req.admin);
    if (!n) return bad(res, 404, 'Ticket not found.');
    return ok(res, { linked: n }, `Linked to ${p.code}.`);
  }
  if (b.unlinkTicket && mongoose.isValidObjectId(b.unlinkTicket)) {
    await M('Ticket').updateOne({ _id: b.unlinkTicket, problem: p._id }, { $unset: { problem: 1, problemCode: 1 }, $push: { history: { at: new Date(), action: 'problem', byName: by, note: `Unlinked from ${p.code}` } } });
    return ok(res, {}, 'Unlinked.');
  }
  if (b.resolve !== undefined) {
    const answer = String(b.resolve || '').trim();
    if (answer.length < 5) return bad(res, 400, 'Write the answer the learners will see.');
    if (p.status === 'Resolved') return bad(res, 409, 'Already resolved.');
    p.status = 'Resolved';
    p.resolution = answer.slice(0, 2000);
    p.resolvedAt = new Date();
    p.resolvedByName = by;
    p.history.push({ at: new Date(), byName: by, note: 'Resolved' });
    p.updated = new Date();
    await p.save();
    // every linked ticket still open gets the same answer; each learner can
    // still confirm or reopen their own ticket
    const tickets = await M('Ticket').find({ removed: false, problem: p._id, status: { $ne: 'Resolved' } });
    for (const t of tickets) {
      t.status = 'Resolved';
      t.stage = 'Resolved';
      t.waiting = undefined;
      t.resolvedAt = new Date();
      t.resolvedByName = by;
      t.resolutionNote = answer.slice(0, 2000);
      t.history = [...(t.history || []), { at: new Date(), action: 'status', status: 'Resolved', byName: by, note: `Resolved with ${p.code}` }];
      t.updated = new Date();
      // eslint-disable-next-line no-await-in-loop
      await t.save();
    }
    const learners = tickets.filter((t) => t.source === 'student' && t.createdBy).map((t) => t.createdBy);
    if (learners.length) await realtime.notify(learners, { type: 'lms.ticket.update', title: '✅ Your ticket is resolved', body: answer.slice(0, 200), link: '/learn/support', actorName: by });
    const { sendResolvedAndRecord } = require('../../../../services/support/ticketMail');
    // eslint-disable-next-line no-await-in-loop
    for (const t of tickets) await sendResolvedAndRecord(t._id).catch((e) => console.error('[tickets] resolved mail:', e.message));
    await audit.record({ module: 'ticket', action: 'problem.resolve', entityType: 'LmsProblem', entityId: p._id, admin: req.admin, reason: answer.slice(0, 300), after: { code: p.code, ticketsResolved: tickets.length } });
    return ok(res, { resolved: tickets.length }, `${p.code} resolved · ${tickets.length} linked ticket${tickets.length === 1 ? '' : 's'} answered and learners told.`);
  }
  ['title', 'rootCause', 'workaround', 'category'].forEach((k) => {
    if (b[k] !== undefined) p[k] = String(b[k]).slice(0, k === 'title' ? 200 : 2000);
  });
  if (b.status && ['Open', 'Known error'].includes(b.status)) p.status = b.status;
  p.history.push({ at: new Date(), byName: by, note: 'Updated' });
  p.updated = new Date();
  await p.save();
  return ok(res, { id: String(p._id) }, `${p.code} saved.`);
}

// ── §18 / §20 ops evidence ────────────────────────────────────────────────
// GET /api/lms/admin/sm/ops-status — last backup / restore drill / load test
// as reported by deploy/vps/backup.sh, restore-drill.sh and loadtest
async function opsStatus(req, res) {
  const rows = await M('LmsAdminConfig').find({ key: { $in: ['ops:backup', 'ops:restoreDrill', 'ops:loadTest'] } }).lean();
  const get = (k) => {
    const r = rows.find((x) => x.key === k);
    if (!r) return null;
    // every run is kept (opsReport.cjs $push, last 50) — the 10 latest go out as the run log
    const runs = (r.history || [])
      .slice(-10)
      .reverse()
      .map((h) => ({ at: (h.value && h.value.at) || h.at, ok: !!(h.value && h.value.ok), summary: (h.value && h.value.summary) || h.note || '' }));
    return { ...(r.value || {}), at: (r.value && r.value.at) || r.updated, runs };
  };
  return ok(res, { backup: get('ops:backup'), restoreDrill: get('ops:restoreDrill'), loadTest: get('ops:loadTest') });
}

// ── D-02 readiness access gate ─────────────────────────────────────────────
// GET /api/lms/admin/ops/readiness-gate — state + who it would affect today
async function readinessGateGet(req, res) {
  const settings = require('../../../../services/lms/assessmentSettingsService');
  const gate = require('../../../../services/lms/readinessGate');
  const s = await settings.get(true);
  const roster = await M('Student').find({ removed: false, status: 'Active' }).select('email').lean();
  const admins = await M('Admin').find({ email: { $in: roster.map((r) => String(r.email || '').toLowerCase()).filter(Boolean) } }).select('_id email').lean();
  let passed = 0;
  let notPassed = 0;
  let notTaken = 0;
  for (const a of admins) {
    // eslint-disable-next-line no-await-in-loop
    const r = await gate.readinessStatus(a._id, a.email);
    if (r.status === 'Passed') passed += 1;
    else if (r.status === 'Not passed') notPassed += 1;
    else notTaken += 1;
  }
  return ok(res, {
    enforced: !!s.readinessGate,
    byName: s.readinessGateByName || null,
    at: s.readinessGateAt || null,
    passPct: Math.round(s.qualifyThreshold * 100),
    canChange: isAdmin(req.admin),
    learners: { total: admins.length, passed, notPassed, notTaken },
  });
}

// POST /api/lms/admin/ops/readiness-gate { enforced } — Management only, audited
async function readinessGateSet(req, res) {
  if (!isAdmin(req.admin)) return bad(res, 403, 'Only Management can switch the readiness gate.');
  const settings = require('../../../../services/lms/assessmentSettingsService');
  const before = !!(await settings.get(true)).readinessGate;
  const enforced = !!(req.body || {}).enforced;
  await settings.update({ readinessGate: enforced, readinessGateByName: nameOf(req.admin), readinessGateAt: new Date() });
  await audit.record({ module: 'rules', action: enforced ? 'readiness-gate.on' : 'readiness-gate.off', entityType: 'RuleSet', admin: req.admin, before: { enforced: before }, after: { enforced } });
  return readinessGateGet(req, res);
}

module.exports = { smDuplicates, smDuplicateRequest, pmDuplicates, pmDuplicateRequest, smCertificateCorrect, problemList, problemCreate, problemUpdate, opsStatus, readinessGateGet, readinessGateSet };
