const mongoose = require('mongoose');
const { CRM_ADMIN_ROLES } = require('../../../../config/roles');
const audit = require('../../../../services/lms/auditLog');

// LMS → Admin & Ops (design page 6, boards A1–A5). Every route here is
// behind requireManager; approve/publish-type actions additionally need a
// CRM admin (owner / Super Admin / Admin) via isMgmt(). Reads use the real
// LMS collections — nothing on these screens is sample data.

const M = (n) => mongoose.model(n);
const ok = (res, result) => res.status(200).json({ success: true, result });
const bad = (res, code, message) => res.status(code).json({ success: false, message });
const isMgmt = (a) => CRM_ADMIN_ROLES.includes(a && a.role);
const nameOf = (a) => (a && (a.name || a.email)) || 'unknown';
const same = (a, b) => a && b && String(a) === String(b);
const pct = (n, d) => (d > 0 ? Math.round((n / d) * 1000) / 10 : null);

async function getCfg(key, dflt) {
  const row = await M('LmsAdminConfig').findOne({ key }).lean();
  return row ? { ...dflt, ...(row.value || {}) } : { ...dflt };
}

async function setCfg(key, value, admin, note) {
  return M('LmsAdminConfig')
    .findOneAndUpdate(
      { key },
      {
        $set: { value, updatedBy: admin._id, updatedByName: nameOf(admin), updated: new Date() },
        $push: { history: { $each: [{ at: new Date(), byName: nameOf(admin), note, value }], $slice: -50 } },
      },
      { new: true, upsert: true }
    )
    .lean();
}

function monthRange(q) {
  const m = /^(\d{4})-(\d{2})$/.exec(String(q || ''));
  const now = new Date();
  const y = m ? Number(m[1]) : now.getFullYear();
  const mo = m ? Number(m[2]) - 1 : now.getMonth();
  return { from: new Date(y, mo, 1), to: new Date(y, mo + 1, 1), label: new Date(y, mo, 1).toLocaleString('en-IN', { month: 'long', year: 'numeric' }) };
}

// ── A1 · exception approvals + decision register ─────────────────────────

const DECISIONS = [
  ['D-01', '90% attendance & denominator'],
  ['D-02', 'Readiness threshold'],
  ['D-03', '50 / 45 / 3 attempts / 7 days'],
  ['D-04', 'Weekly feedback cadence'],
  ['D-05', 'PM feedback categories'],
  ['D-06', 'Ticket SLAs'],
  ['D-07', 'Absence wording (HR / legal)'],
  ['D-08', 'Recording / transcript notice'],
  ['D-09', 'Login / IP monitoring'],
  ['D-10', 'Eligibility weights'],
  ['D-11', 'Policy effective date'],
  ['D-12', 'Zoom / Meet / captions licence'],
  ['D-13', 'Support Manager permissions'],
  ['D-14', 'Recording recovery disposition'],
  ['D-15', 'Retention & backups'],
];
const DECISION_STATUSES = ['PENDING', 'APPROVED', 'VALIDATING', 'OPEN'];
const HIGH_RISK_TYPES = ['Mass message', 'Status change', 'Mark as Dropped'];

async function decisionsList() {
  const cfg = await getCfg('decisions', {});
  return DECISIONS.map(([code, title]) => ({ code, title, status: (cfg[code] && cfg[code].status) || 'PENDING', note: (cfg[code] && cfg[code].note) || '', by: cfg[code] && cfg[code].byName, at: cfg[code] && cfg[code].at }));
}

const approvalRow = (r) => ({
  id: String(r._id),
  type: r.type,
  detail: r.detail,
  learnerName: r.learnerName,
  scope: r.scope,
  evidence: r.evidence,
  highRisk: r.highRisk,
  requestedBy: r.requestedBy && String(r.requestedBy),
  requestedByName: r.requestedByName,
  requestedByRole: r.requestedByRole,
  status: r.status,
  approvals: (r.approvals || []).map((a) => ({ byName: a.byName, at: a.at })),
  decidedByName: r.decidedByName,
  decidedAt: r.decidedAt,
  decisionReason: r.decisionReason,
  execution: r.execution && r.execution.status ? { status: r.execution.status, note: r.execution.note, at: r.execution.at } : null,
  created: r.created,
});

// GET /api/lms/admin/ops/approvals
async function approvalsList(req, res) {
  const LmsApproval = M('LmsApproval');
  const [pending, decided, decisions] = await Promise.all([
    LmsApproval.find({ removed: false, status: 'pending' }).sort({ created: 1 }).lean(),
    LmsApproval.find({ removed: false, status: { $ne: 'pending' } }).sort({ decidedAt: -1 }).limit(30).lean(),
    decisionsList(),
  ]);
  const { TYPES } = require('../../../../models/appModels/lms/LmsApproval');
  return ok(res, { rows: [...pending, ...decided].map(approvalRow), pending: pending.length, decisions, types: TYPES, canDecide: isMgmt(req.admin) || req.admin.role === 'Support', me: String(req.admin._id) });
}

// POST /api/lms/admin/ops/approvals { type, detail, learnerName, scope, evidence }
async function approvalCreate(req, res) {
  const b = req.body || {};
  const { TYPES } = require('../../../../models/appModels/lms/LmsApproval');
  if (!TYPES.includes(b.type)) return bad(res, 400, 'Pick a request type.');
  const evidence = String(b.evidence || '').trim();
  if (evidence.length < 5) return bad(res, 400, 'Evidence is mandatory — say what supports this request.');
  if (!String(b.learnerName || '').trim() && !String(b.scope || '').trim()) return bad(res, 400, 'Name the learner or the scope.');
  const doc = await M('LmsApproval').create({
    type: b.type,
    detail: String(b.detail || '').trim().slice(0, 200),
    learnerName: String(b.learnerName || '').trim().slice(0, 120),
    scope: String(b.scope || '').trim().slice(0, 120),
    evidence: evidence.slice(0, 1000),
    highRisk: HIGH_RISK_TYPES.includes(b.type),
    requestedBy: req.admin._id,
    requestedByName: nameOf(req.admin),
    requestedByRole: req.admin.role,
  });
  await audit.record({ module: 'approval', action: 'request', entityType: 'LmsApproval', entityId: doc._id, admin: req.admin, reason: evidence, after: { type: doc.type, learner: doc.learnerName, scope: doc.scope } });
  return ok(res, approvalRow(doc.toObject()));
}

// POST /api/lms/admin/ops/approvals/:id/decide { decision: 'approved'|'rejected', reason }
async function approvalDecide(req, res) {
  const b = req.body || {};
  if (!['approved', 'rejected'].includes(b.decision)) return bad(res, 400, 'decision must be approved or rejected.');
  const reason = String(b.reason || '').trim();
  if (reason.length < 3) return bad(res, 400, 'A reason is required for every decision.');
  if (!mongoose.isValidObjectId(req.params.id)) return bad(res, 404, 'Request not found.');
  const doc = await M('LmsApproval').findOne({ _id: req.params.id, removed: false });
  if (!doc) return bad(res, 404, 'Request not found.');
  if (doc.status !== 'pending') return bad(res, 409, `Already ${doc.status}.`);
  if (same(doc.requestedBy, req.admin._id)) return bad(res, 403, 'You raised this request — someone else has to decide it.');
  if (!isMgmt(req.admin) && req.admin.role !== 'Support') return bad(res, 403, 'Only Operations / Management can decide.');
  // D-13: a bulk / high-risk approval needs two different approvers.
  if (b.decision === 'approved' && doc.highRisk && (doc.approvals || []).length === 0) {
    doc.approvals.push({ by: req.admin._id, byName: nameOf(req.admin), at: new Date() });
    await doc.save();
    await audit.record({ module: 'approval', action: 'first-approval', entityType: 'LmsApproval', entityId: doc._id, admin: req.admin, reason });
    return ok(res, { ...approvalRow(doc.toObject()), message: 'First approval recorded — a second approver is needed.' });
  }
  if (b.decision === 'approved' && doc.highRisk && (doc.approvals || []).some((a) => same(a.by, req.admin._id))) {
    return bad(res, 403, 'The second approval must come from a different person.');
  }
  const before = doc.status;
  doc.status = b.decision;
  doc.decidedBy = req.admin._id;
  doc.decidedByName = nameOf(req.admin);
  doc.decidedAt = new Date();
  doc.decisionReason = reason;
  await doc.save();
  await audit.record({ module: 'approval', action: b.decision === 'approved' ? 'approve' : 'reject', entityType: 'LmsApproval', entityId: doc._id, admin: req.admin, reason, before: { status: before }, after: { status: doc.status }, meta: { type: doc.type, learner: doc.learnerName } });
  // the system carries the decision out (status, message, extension, ...)
  const execution = await require('../../../../services/lms/approvalExecutor')
    .onDecided(doc, req.admin, reason)
    .catch((e) => ({ status: 'failed', note: e.message }));
  return ok(res, { ...approvalRow(doc.toObject()), execution: execution || null, message: execution ? execution.note : undefined });
}

// POST /api/lms/admin/ops/decisions/:code { status, note } — management only.
async function decisionSet(req, res) {
  if (!isMgmt(req.admin)) return bad(res, 403, 'Only Management can change the decision register.');
  const code = String(req.params.code || '');
  if (!DECISIONS.some(([c]) => c === code)) return bad(res, 404, 'Unknown decision.');
  const status = String((req.body || {}).status || '');
  if (!DECISION_STATUSES.includes(status)) return bad(res, 400, 'Invalid status.');
  const cfg = await getCfg('decisions', {});
  const before = cfg[code] && cfg[code].status;
  cfg[code] = { status, note: String((req.body || {}).note || '').slice(0, 300), byName: nameOf(req.admin), at: new Date() };
  await setCfg('decisions', cfg, req.admin, `${code} → ${status}`);
  await audit.record({ module: 'decision-register', action: 'set', entityType: 'Decision', admin: req.admin, reason: cfg[code].note, before: { status: before || 'PENDING' }, after: { status }, meta: { code } });
  return ok(res, await decisionsList());
}

// ── A2 · management KPIs + audit ─────────────────────────────────────────

const NOISY_AUDIT = ['device-check', 'Code Editor'];

async function attendanceByBatch(from, to) {
  const rows = await M('LmsLiveSession').aggregate([
    { $match: { removed: { $ne: true }, scheduledStart: { $gte: from, $lt: to }, status: { $in: ['live', 'ending', 'ended', 'recording_processing', 'recording_available'] } } },
    { $unwind: '$participants' },
    { $match: { 'participants.role': 'student' } },
    { $group: { _id: '$batchName', total: { $sum: 1 }, present: { $sum: { $cond: [{ $in: ['$participants.attendanceStatus', ['PRESENT', 'LATE']] }, 1, 0] } } } },
    { $sort: { _id: 1 } },
  ]);
  return rows.filter((r) => r._id).map((r) => ({ batch: r._id, present: r.present, total: r.total, pct: pct(r.present, r.total) }));
}

async function securitySignals() {
  const since = new Date(Date.now() - 12 * 3600 * 1000);
  const open = await M('LoginActivity').aggregate([
    { $match: { removed: false, logoutAt: null, loginAt: { $gte: since } } },
    { $group: { _id: '$admin', name: { $first: '$adminName' }, n: { $sum: 1 } } },
    { $match: { n: { $gt: 1 } } },
    { $limit: 10 },
  ]);
  return open.map((o) => ({ kind: 'concurrent', text: `Concurrent sessions · ${o.name || 'user'} (${o.n} open)`, label: 'REVIEW' }));
}

const auditRow = (r) => ({
  id: String(r._id),
  eventId: `ev_${String(r._id).slice(-6)}`,
  at: r.created,
  actor: r.performedByName ? `${r.performedByName}${r.performedByRole ? ` · ${r.performedByRole}` : ''}` : 'system',
  module: r.module,
  action: r.action,
  object: (r.meta && (r.meta.code || r.meta.learner || r.meta.report || r.meta.batch)) || r.entityType || '',
  change: r.before || r.after ? `${summarise(r.before)} → ${summarise(r.after)}` : '—',
  reason: r.reason || '',
  source: (r.meta && r.meta.source) || (r.performedBy ? 'UI' : 'job'),
});

function summarise(v) {
  if (v === undefined || v === null) return '—';
  if (typeof v !== 'object') return String(v).slice(0, 40);
  const vals = Object.values(v).filter((x) => x !== undefined && x !== null && typeof x !== 'object');
  return vals.length ? vals.join(', ').slice(0, 40) : '—';
}

async function kpiBlock(from, to) {
  const Student = M('Student');
  const activeStudents = await Student.find({ removed: false, status: 'Active' }, { email: 1 }).lean();
  const active = activeStudents.length;
  const activeEmails = activeStudents.map((s) => String(s.email || '').toLowerCase());
  const learnerAccounts = await M('Admin').find({ removed: false, role: 'Student', email: { $in: activeEmails.map((e) => new RegExp(`^${e.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i')) } }, { _id: 1 }).lean();
  const learnerIds = learnerAccounts.map((a) => a._id);

  const onboarded = await M('OnboardingProgress').countDocuments({ admin: { $in: learnerIds }, calendarAt: { $ne: null }, setupAt: { $ne: null }, deviceAt: { $ne: null } }).catch(() => 0);

  const livePolicies = await M('PolicyDocument').find({ removed: false, status: 'published', mandatory: true }, { _id: 1 }).lean();
  let consent = null;
  if (livePolicies.length) {
    const pendingStudents = await M('PolicyAcknowledgement').distinct('studentEmail', { removed: false, status: 'pending', policy: { $in: livePolicies.map((p) => p._id) } });
    const pendingActive = pendingStudents.filter((e) => activeEmails.includes(String(e || '').toLowerCase())).length;
    consent = pct(active - pendingActive, active);
  }

  const basic = await M('AssessmentAttempt').aggregate([
    { $match: { testType: 'BASIC', status: 'SUBMITTED' } },
    { $group: { _id: '$candidate', passed: { $max: { $cond: [{ $eq: ['$qualified', true] }, 1, 0] } } } },
  ]);
  const readiness = basic.length ? pct(basic.filter((b) => b.passed).length, basic.length) : null;

  const endedSessions = await M('LmsLiveSession').countDocuments({ removed: { $ne: true }, scheduledStart: { $gte: from, $lt: to }, status: { $in: ['ended', 'recording_processing', 'recording_available'] } }).catch(() => 0);
  const availableRec = await M('LiveRecording').countDocuments({ removed: false, status: 'AVAILABLE', startedAt: { $gte: from, $lt: to } });
  const recordings = endedSessions ? Math.min(100, pct(availableRec, endedSessions)) : null;

  const feedbackRows = await M('WeeklyFeedback').countDocuments({ created: { $gte: from, $lt: to } }).catch(() => 0);

  const resolved = await M('Ticket').find({ removed: false, resolvedAt: { $gte: from, $lt: to } }, { created: 1, resolvedAt: 1 }).lean();
  const withinSla = resolved.filter((t) => new Date(t.resolvedAt) - new Date(t.created) <= 48 * 3600 * 1000).length;

  const jobs = await M('LmsSyncJob').aggregate([{ $match: { created: { $gte: from, $lt: to } } }, { $group: { _id: '$status', n: { $sum: 1 } } }]);
  const mails = await M('EmailDeliveryLog').aggregate([{ $match: { sentAt: { $gte: from, $lt: to } } }, { $group: { _id: '$status', n: { $sum: 1 } } }]);
  const cnt = (rows, k) => (rows.find((r) => r._id === k) || {}).n || 0;
  const autoOk = cnt(jobs, 'done') + cnt(mails, 'sent');
  const autoAll = autoOk + cnt(jobs, 'failed') + cnt(jobs, 'dead') + cnt(mails, 'failed');

  const actions = await M('FeedbackAction').aggregate([{ $group: { _id: '$status', n: { $sum: 1 } } }]).catch(() => []);
  const actionsAll = actions.reduce((s, r) => s + r.n, 0);

  const projects = await M('Project').find({ removed: { $ne: true } }, { milestones: 1 }).lean().catch(() => []);
  let msDue = 0;
  let msOnTime = 0;
  for (const p of projects) {
    for (const m of p.milestones || []) {
      if (!m.dueDate || new Date(m.dueDate) > new Date()) continue;
      msDue += 1;
      if (m.status === 'done' && m.completedAt && new Date(m.completedAt) <= new Date(m.dueDate)) msOnTime += 1;
    }
  }

  const f = (v, suffix = '%') => (v === null || v === undefined ? null : `${v}${suffix}`);
  return {
    active,
    kpis: [
      { label: 'Onboarding completion', value: active ? f(pct(onboarded, active)) : null, note: `${onboarded} / ${active} learners` },
      { label: 'Consent completion', value: f(consent), note: livePolicies.length ? `${livePolicies.length} mandatory polic${livePolicies.length === 1 ? 'y' : 'ies'} live` : 'no mandatory policy published' },
      { label: 'Readiness pass rate', value: f(readiness), note: `${basic.length} learner(s) attempted` },
      { label: 'Recording availability', value: f(recordings), note: `${availableRec} / ${endedSessions} classes` },
      { label: 'Weekly feedback response', value: feedbackRows ? String(feedbackRows) : null, note: feedbackRows ? 'responses this month' : 'first window opens 6 Nov' },
      { label: 'Ticket SLA compliance', value: resolved.length ? f(pct(withinSla, resolved.length)) : null, note: `${resolved.length} resolved · 48h until D-06` },
      { label: 'Milestones on time', value: msDue ? f(pct(msOnTime, msDue)) : null, note: `${msDue} milestone(s) due` },
      { label: 'Automation success', value: autoAll ? f(pct(autoOk, autoAll)) : null, note: `${autoOk} / ${autoAll} jobs + emails` },
      { label: 'Captions available', value: null, note: 'no transcription service' },
      { label: 'Repeat incidents', value: null, note: 'incident log not set up' },
      { label: 'Support satisfaction', value: null, note: 'no rating collected yet' },
      { label: 'Corrective actions closed', value: actionsAll ? `${cnt(actions, 'Done')}/${actionsAll}` : null, note: 'from feedback actions' },
    ],
  };
}

// GET /api/lms/admin/ops/kpis?month=YYYY-MM
async function kpis(req, res) {
  const { from, to, label } = monthRange(req.query.month);
  const [block, batches, signals, auditRows] = await Promise.all([
    kpiBlock(from, to),
    attendanceByBatch(from, to),
    securitySignals(),
    M('AuditLog').find({ module: { $nin: NOISY_AUDIT } }).sort({ created: -1 }).limit(12).lean(),
  ]);
  const live = await require('../../../../services/lms/settingsService').get().catch(() => ({}));
  return ok(res, { month: label, ...block, threshold: live.presentThresholdPct || 90, batches, signals, audit: auditRows.map(auditRow) });
}

// GET /api/lms/admin/ops/kpis/export?month=&format=xlsx|csv
async function kpisExport(req, res) {
  const { from, to, label } = monthRange(req.query.month);
  const block = await kpiBlock(from, to);
  const batches = await attendanceByBatch(from, to);
  const auditRows = (await M('AuditLog').find({ module: { $nin: NOISY_AUDIT } }).sort({ created: -1 }).limit(500).lean()).map(auditRow);
  const sheets = {
    KPIs: block.kpis.map((k) => ({ KPI: k.label, Value: k.value || '—', Note: k.note })),
    Attendance: batches.map((b) => ({ Batch: b.batch, Present: b.present, Total: b.total, 'Percent': b.pct })),
    Audit: auditRows.map((a) => ({ Time: new Date(a.at).toISOString(), Actor: a.actor, Action: `${a.module} · ${a.action}`, Object: a.object, Change: a.change, Reason: a.reason })),
  };
  await audit.record({ module: 'export', action: 'download', entityType: 'Report', admin: req.admin, meta: { report: `Management KPIs · ${label}`, rows: auditRows.length, sensitive: true } });
  return sendSheets(res, sheets, `management-${label.replace(/\s+/g, '-')}`, req.query.format);
}

function sendSheets(res, sheets, base, format) {
  const XLSX = require('xlsx');
  if (format === 'csv') {
    const first = Object.keys(sheets)[0];
    const csv = XLSX.utils.sheet_to_csv(XLSX.utils.json_to_sheet(sheets[first]));
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${base}.csv"`);
    return res.status(200).send(csv);
  }
  const wb = XLSX.utils.book_new();
  for (const [name, rows] of Object.entries(sheets)) XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows.length ? rows : [{ Note: 'No rows' }]), name.slice(0, 31));
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${base}.xlsx"`);
  return res.status(200).send(buf);
}

// ── A3 · finance — payments & provisioning ───────────────────────────────

function provisionState(r) {
  if (r.status !== 'paid') return { key: 'WAITING', text: r.status === 'created' ? 'WAITING' : String(r.status || '').toUpperCase() };
  if (r.studentProvisionError) return { key: 'FAILED', text: `FAILED · ${r.studentProvisionError}`.slice(0, 60) };
  if (!r.student) return { key: 'PENDING', text: 'NOT PROVISIONED' };
  return { key: 'DONE', text: 'DONE' };
}

const paymentRow = (r) => ({
  id: String(r._id),
  order: r.razorpayPaymentLinkId || String(r._id).slice(-8),
  reference: r.razorpayPaymentId || '',
  learner: r.studentName,
  email: r.studentEmail,
  course: r.course,
  amount: r.amount,
  installment: r.installmentCount > 1 ? `EMI ${r.installmentNo}/${r.installmentCount}` : '',
  gateway: r.status === 'paid' ? 'VERIFIED' : r.status === 'created' ? 'PENDING' : String(r.status || '').toUpperCase(),
  amountMismatch: !!r.amountMismatch,
  webhooks: (r.handledWebhookEventIds || []).length,
  provisioning: provisionState(r),
  paidAt: r.paidAt,
  created: r.created,
});

// GET /api/lms/admin/ops/payments?q=
async function payments(req, res) {
  const PaymentRequest = M('PaymentRequest');
  const { from, to } = monthRange();
  const q = { removed: false };
  const term = String(req.query.q || '').trim();
  if (term) {
    const rx = new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    q.$or = [{ razorpayPaymentLinkId: rx }, { razorpayPaymentId: rx }, { studentName: rx }, { studentEmail: rx }];
  }
  const weekAhead = new Date(Date.now() + 7 * 24 * 3600 * 1000);
  const [rows, paidMonth, notProvisioned, dupRows, emiDue, refunds] = await Promise.all([
    PaymentRequest.find(q).sort({ created: -1 }).limit(60).lean(),
    PaymentRequest.find({ removed: false, status: 'paid', paidAt: { $gte: from, $lt: to } }, { amount: 1 }).lean(),
    PaymentRequest.countDocuments({ removed: false, status: 'paid', $or: [{ studentProvisionError: { $nin: ['', null] } }, { student: null }] }),
    PaymentRequest.find({ removed: false, 'handledWebhookEventIds.1': { $exists: true } }, { handledWebhookEventIds: 1 }).lean(),
    PaymentRequest.countDocuments({ removed: false, status: 'paid', nextInstallmentDueAt: { $gte: new Date(), $lte: weekAhead } }),
    M('Ticket').countDocuments({ removed: false, status: { $nin: ['Resolved', 'Closed'] }, $or: [{ subject: /refund/i }, { description: /refund/i }] }),
  ]);
  return ok(res, {
    kpis: {
      collected: paidMonth.reduce((s, r) => s + (Number(r.amount) || 0), 0),
      verified: paidMonth.length,
      notProvisioned,
      duplicateWebhooks: dupRows.reduce((s, r) => s + (r.handledWebhookEventIds.length - 1), 0),
      emiDueWeek: emiDue,
      refunds,
    },
    rows: rows.map(paymentRow),
  });
}

// GET /api/lms/admin/ops/payments/:id — provisioning chain for the fix panel.
async function paymentDetail(req, res) {
  if (!mongoose.isValidObjectId(req.params.id)) return bad(res, 404, 'Not found.');
  const r = await M('PaymentRequest').findOne({ _id: req.params.id, removed: false }).lean();
  if (!r) return bad(res, 404, 'Not found.');
  const student = r.student ? await M('Student').findById(r.student, { name: 1, enrollmentId: 1, batch: 1, course: 1, status: 1, email: 1 }).lean() : null;
  const account = student ? await M('Admin').findOne({ removed: false, email: new RegExp(`^${String(student.email || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') }, { enabled: 1 }).lean() : null;
  const batches = await M('Batch').find({ removed: false }, { name: 1, capacity: 1, maxStudents: 1 }).lean().catch(() => []);
  const counts = await M('Student').aggregate([{ $match: { removed: false, status: 'Active' } }, { $group: { _id: '$batch', n: { $sum: 1 } } }]);
  const chain = [
    { step: 'Payment', ok: r.status === 'paid', text: r.status === 'paid' ? `verified ${r.paidAt ? new Date(r.paidAt).toLocaleString('en-IN') : ''}` : `gateway: ${r.status}` },
    { step: 'Learner', ok: !!student, text: student ? student.enrollmentId || student.name : 'not created yet' },
    { step: 'Plan / course', ok: !!(student && student.course), text: (student && student.course) || r.course || '—' },
    { step: 'Batch', ok: !!(student && student.batch), text: (student && student.batch) || 'no batch' },
    { step: 'Access + welcome', ok: !!(account && account.enabled), text: account ? (account.enabled ? 'login active' : 'login disabled') : 'waiting' },
  ];
  return ok(res, {
    row: paymentRow(r),
    error: r.studentProvisionError || '',
    chain,
    batches: batches.map((b) => ({ name: b.name, size: (counts.find((c) => c._id === b.name) || {}).n || 0, cap: b.capacity || b.maxStudents || null })),
  });
}

// POST /api/lms/admin/ops/payments/:id/recheck — asks Razorpay (read-only).
async function paymentRecheck(req, res) {
  if (!mongoose.isValidObjectId(req.params.id)) return bad(res, 404, 'Not found.');
  const r = await M('PaymentRequest').findOne({ _id: req.params.id, removed: false }).lean();
  if (!r) return bad(res, 404, 'Not found.');
  if (!r.razorpayPaymentLinkId) return bad(res, 400, 'No gateway order on this request.');
  const link = await require('../../../../services/payments/razorpayService').fetchPaymentLink(r.razorpayPaymentLinkId).catch((e) => ({ error: e.message }));
  if (link.error) return bad(res, 502, `Gateway check failed: ${link.error}`);
  return ok(res, { gatewayStatus: link.status, amountPaid: link.amount_paid != null ? link.amount_paid / 100 : null, crmStatus: r.status, note: link.status === 'paid' && r.status !== 'paid' ? 'Gateway says paid but the webhook has not landed — the next webhook retry will provision it.' : 'CRM matches the gateway.' });
}

// POST /api/lms/admin/ops/payments/:id/provision { batch, reason }
async function paymentProvision(req, res) {
  const b = req.body || {};
  const reason = String(b.reason || '').trim();
  if (reason.length < 3) return bad(res, 400, 'Reason is required (audit).');
  if (!mongoose.isValidObjectId(req.params.id)) return bad(res, 404, 'Not found.');
  const pr = await M('PaymentRequest').findOne({ _id: req.params.id, removed: false });
  if (!pr) return bad(res, 404, 'Not found.');
  if (pr.status !== 'paid') return bad(res, 409, 'Only a verified payment can be provisioned.');
  let student = pr.student ? await M('Student').findById(pr.student) : null;
  if (!student) {
    const kyc = await M('PaymentKyc').findOne({ paymentRequest: pr._id }).lean();
    if (!kyc) return bad(res, 409, 'No KYC on file for this payment — the learner has to submit the KYC form first.');
    await require('../../../../services/payments/studentProvision').createOrSyncStudentFromKyc(pr, kyc);
    const fresh = await M('PaymentRequest').findById(pr._id).lean();
    student = fresh.student ? await M('Student').findById(fresh.student) : null;
    if (!student) return bad(res, 500, fresh.studentProvisionError || 'Provisioning failed again.');
  }
  const before = { batch: student.batch };
  if (b.batch && b.batch !== student.batch) {
    const exists = await M('Batch').exists({ removed: false, name: b.batch });
    if (!exists) return bad(res, 400, 'Unknown batch.');
    student.batch = b.batch;
    await student.save();
  }
  if (pr.studentProvisionError) {
    pr.studentProvisionError = '';
    await pr.save();
  }
  await audit.record({ module: 'finance', action: 'provision-retry', entityType: 'PaymentRequest', entityId: pr._id, admin: req.admin, reason, before, after: { batch: student.batch, student: String(student._id) }, meta: { learner: pr.studentName } });
  return ok(res, { student: String(student._id), batch: student.batch });
}

// ── A4 · roles & permissions (LMS view) ──────────────────────────────────

const LMS_ROLES = [
  { key: 'Learner', roles: ['Student'] },
  { key: 'Project Manager', roles: ['Teacher'] },
  { key: 'Support Manager', roles: ['Support'] },
  { key: 'Asst. Support Mgr', roles: [] },
  { key: 'Operations Manager', roles: [] },
  { key: 'Finance', roles: ['Finance'] },
  { key: 'LMS Admin', roles: ['Admin'] },
  { key: 'Management', roles: ['owner', 'Super Admin'] },
];
const PERM_MODULES = ['Learners', 'Batches & classes', 'Attendance correction', 'Recordings', 'Assessments & results', 'Tickets', 'Mass communication', 'Certificates', 'Payment status', 'Content delete'];
const DEFAULT_MATRIX = {
  'Support Manager': { Learners: [1, 1, 1, 0], 'Batches & classes': [1, 1, 0, 1], 'Attendance correction': [1, 1, 1, 0], Recordings: [1, 1, 0, 0], 'Assessments & results': [1, 0, 1, 0], Tickets: [1, 1, 1, 0], 'Mass communication': [1, 1, 0, 1], Certificates: [1, 0, 1, 0], 'Payment status': [1, 0, 0, 0], 'Content delete': [0, 0, 0, 1] },
};
function defaultMatrix(role) {
  if (DEFAULT_MATRIX[role]) return DEFAULT_MATRIX[role];
  const full = role === 'LMS Admin' || role === 'Management';
  const none = role === 'Learner';
  return Object.fromEntries(PERM_MODULES.map((m) => [m, none ? [0, 0, 0, 0] : full ? [1, 1, 1, m === 'Content delete' || m === 'Mass communication' ? 1 : 0] : [1, 0, 0, 0]]));
}
function cleanMatrix(m) {
  return Object.fromEntries(PERM_MODULES.map((k) => [k, [0, 1, 2, 3].map((i) => (m && Array.isArray(m[k]) && m[k][i] ? 1 : 0))]));
}

// GET /api/lms/admin/ops/roles?role=
async function roles(req, res) {
  const pick = LMS_ROLES.find((r) => r.key === req.query.role) || LMS_ROLES[2];
  const counts = await M('Admin').aggregate([{ $match: { removed: false, enabled: true } }, { $group: { _id: '$role', n: { $sum: 1 } } }]);
  const users = pick.roles.length ? await M('Admin').find({ removed: false, role: { $in: pick.roles } }, { name: 1, surname: 1, email: 1, enabled: 1, lastSeenAt: 1, role: 1 }).sort({ name: 1 }).limit(60).lean() : [];
  const backup = await M('Admin').find({ removed: false, role: { $in: ['owner', 'Super Admin'] } }, { name: 1, email: 1, enabled: 1, role: 1 }).lean();
  const cfg = await getCfg(`roles:${pick.key}`, {});
  const changes = await M('AuditLog').find({ module: { $in: ['user-management', 'lms-roles'] } }).sort({ created: -1 }).limit(6).lean();
  const incident = await M('LmsSetting').findOne({ key: 'incident' }).lean();
  return ok(res, {
    roles: LMS_ROLES.map((r) => ({ key: r.key, crmRoles: r.roles, count: r.roles.reduce((s, x) => s + ((counts.find((c) => c._id === x) || {}).n || 0), 0) })),
    role: pick.key,
    modules: PERM_MODULES,
    approved: cfg.approved ? cleanMatrix(cfg.approved) : defaultMatrix(pick.key),
    draft: cfg.draft ? cleanMatrix(cfg.draft) : null,
    draftByName: cfg.draftByName || null,
    draftAt: cfg.draftAt || null,
    approvedByName: cfg.approvedByName || null,
    approvedAt: cfg.approvedAt || null,
    users: users.map((u) => ({ id: String(u._id), name: [u.name, u.surname].filter(Boolean).join(' ') || u.email, email: u.email, enabled: u.enabled !== false, lastSeenAt: u.lastSeenAt })),
    backupAdmins: backup.map((u) => ({ name: u.name || u.email, role: u.role, enabled: u.enabled !== false })),
    incidentModeTestedAt: incident && incident.incidentSetAt,
    recentChanges: changes.map((c) => ({ at: c.created, text: `${c.action}${c.meta && c.meta.role ? ` · ${c.meta.role}` : ''}${c.after ? ` → ${summarise(c.after)}` : ''}`, by: c.performedByName || 'system', reason: c.reason || '' })),
    canApprove: isMgmt(req.admin),
  });
}

// POST /api/lms/admin/ops/roles/:role/draft { matrix }
async function roleDraft(req, res) {
  const role = LMS_ROLES.find((r) => r.key === req.params.role);
  if (!role) return bad(res, 404, 'Unknown role.');
  if (role.roles.some((r) => r === req.admin.role) && !isMgmt(req.admin)) return bad(res, 403, 'You cannot change the permissions of your own role.');
  const cfg = await getCfg(`roles:${role.key}`, {});
  const draft = cleanMatrix((req.body || {}).matrix);
  await setCfg(`roles:${role.key}`, { ...cfg, draft, draftBy: String(req.admin._id), draftByName: nameOf(req.admin), draftAt: new Date() }, req.admin, 'draft submitted for approval');
  await audit.record({ module: 'lms-roles', action: 'draft', entityType: 'Role', admin: req.admin, reason: 'submitted for approval', after: draft, meta: { role: role.key } });
  return ok(res, { submitted: true });
}

// POST /api/lms/admin/ops/roles/:role/approve — management, not the drafter.
async function roleApprove(req, res) {
  if (!isMgmt(req.admin)) return bad(res, 403, 'Only Management can approve a permission change.');
  const role = LMS_ROLES.find((r) => r.key === req.params.role);
  if (!role) return bad(res, 404, 'Unknown role.');
  const cfg = await getCfg(`roles:${role.key}`, {});
  if (!cfg.draft) return bad(res, 409, 'Nothing waiting for approval.');
  if (cfg.draftBy === String(req.admin._id)) return bad(res, 403, 'You drafted this change — another manager has to approve it.');
  const before = cfg.approved || defaultMatrix(role.key);
  await setCfg(`roles:${role.key}`, { approved: cfg.draft, approvedByName: nameOf(req.admin), approvedAt: new Date(), draft: null, draftBy: null, draftByName: null, draftAt: null }, req.admin, 'approved');
  await audit.record({ module: 'lms-roles', action: 'approve', entityType: 'Role', admin: req.admin, before, after: cfg.draft, meta: { role: role.key } });
  return ok(res, { approved: true });
}

// ── A5 · policy centre (admin) ───────────────────────────────────────────

// GET /api/lms/admin/ops/policies?id=
async function policies(req, res) {
  const PolicyDocument = M('PolicyDocument');
  const docs = await PolicyDocument.find({ removed: false, status: { $ne: 'archived' } }).sort({ updated: -1 }).lean();
  const bySlug = new Map();
  for (const d of docs) {
    const g = bySlug.get(d.slug) || { slug: d.slug, title: d.title, live: null, draft: null };
    if (d.status === 'published' && (!g.live || d.version > g.live.version)) g.live = d;
    if (d.status === 'draft' && (!g.draft || d.version > g.draft.version)) g.draft = d;
    bySlug.set(d.slug, g);
  }
  const list = [...bySlug.values()].map((g) => ({
    slug: g.slug,
    title: g.title,
    liveId: g.live && String(g.live._id),
    liveVersion: g.live && g.live.version,
    draftId: g.draft && String(g.draft._id),
    draftVersion: g.draft && g.draft.version,
  }));
  const selectedId = mongoose.isValidObjectId(req.query.id) ? req.query.id : (list[0] && (list[0].draftId || list[0].liveId)) || null;
  const selected = selectedId ? docs.find((d) => String(d._id) === String(selectedId)) : null;
  let acks = null;
  const live = selected && (selected.status === 'published' ? selected : (bySlug.get(selected.slug) || {}).live);
  if (live) {
    const rows = await M('PolicyAcknowledgement').find({ removed: false, policy: live._id }, { studentEmail: 1, studentName: 1, status: 1 }).lean();
    const students = await M('Student').find({ removed: false, email: { $in: rows.map((r) => r.studentEmail) } }, { email: 1, batch: 1, status: 1 }).lean();
    const batchOf = new Map(students.map((s) => [String(s.email).toLowerCase(), s]));
    const byBatch = new Map();
    const pending = [];
    for (const r of rows) {
      const s = batchOf.get(String(r.studentEmail || '').toLowerCase());
      if (s && s.status === 'Dropped') continue;
      const key = (s && s.batch) || 'No batch';
      const g = byBatch.get(key) || { batch: key, done: 0, total: 0 };
      g.total += 1;
      if (r.status === 'acknowledged') g.done += 1;
      else pending.push(r.studentName || r.studentEmail);
      byBatch.set(key, g);
    }
    acks = { policyId: String(live._id), version: live.version, batches: [...byBatch.values()], pending };
  }
  return ok(res, {
    list,
    selected: selected && {
      id: String(selected._id),
      title: selected.title,
      version: selected.version,
      status: selected.status,
      category: selected.category,
      content: selected.content,
      createdByName: selected.createdByName,
      created: selected.created,
      effectiveDate: selected.effectiveDate,
      changeSummary: selected.changeSummary || '',
      materialChange: selected.materialChange !== false,
      approverName: selected.approverName || '',
      approvalRequestedAt: selected.approvalRequestedAt,
      approvalRequestedByName: selected.approvalRequestedByName,
    },
    acks,
    approvers: (await M('Admin').find({ removed: false, enabled: true, role: { $in: CRM_ADMIN_ROLES } }, { name: 1, role: 1 }).lean()).map((a) => `${a.name} (${a.role === 'Admin' ? 'Admin' : 'Management'})`),
    canPublish: isMgmt(req.admin),
  });
}

// POST /api/lms/admin/ops/policies/:id/send-for-approval
async function policySendForApproval(req, res) {
  const b = req.body || {};
  if (!mongoose.isValidObjectId(req.params.id)) return bad(res, 404, 'Policy not found.');
  const doc = await M('PolicyDocument').findOne({ _id: req.params.id, removed: false });
  if (!doc) return bad(res, 404, 'Policy not found.');
  if (doc.status !== 'draft') return bad(res, 409, 'Only a draft can be sent for approval.');
  const summary = String(b.changeSummary || '').trim();
  if (summary.length < 5) return bad(res, 400, 'Write a change summary.');
  doc.changeSummary = summary.slice(0, 2000);
  doc.materialChange = b.materialChange !== false;
  doc.approverName = String(b.approverName || '').slice(0, 120);
  if (b.effectiveDate && !Number.isNaN(new Date(b.effectiveDate).getTime())) doc.effectiveDate = new Date(b.effectiveDate);
  doc.approvalRequestedAt = new Date();
  doc.approvalRequestedByName = nameOf(req.admin);
  doc.updated = new Date();
  await doc.save();
  await audit.record({ module: 'policy', action: 'send-for-approval', entityType: 'PolicyDocument', entityId: doc._id, admin: req.admin, reason: summary, meta: { approver: doc.approverName, material: doc.materialChange } });
  return ok(res, { sent: true });
}

module.exports = {
  approvalsList,
  approvalCreate,
  approvalDecide,
  decisionSet,
  kpis,
  kpisExport,
  payments,
  paymentDetail,
  paymentRecheck,
  paymentProvision,
  roles,
  roleDraft,
  roleApprove,
  policies,
  policySendForApproval,
  // shared with adminOps2.js
  _h: { M, ok, bad, isMgmt, nameOf, getCfg, setCfg, auditRow, sendSheets, monthRange, pct, NOISY_AUDIT, summarise },
};
