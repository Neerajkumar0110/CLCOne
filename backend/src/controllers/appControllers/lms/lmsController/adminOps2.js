const mongoose = require('mongoose');
const audit = require('../../../../services/lms/auditLog');
const automation = require('../../../../services/lms/automation');
const assessmentSettings = require('../../../../services/lms/assessmentSettingsService');
const liveSettings = require('../../../../services/lms/settingsService');
const { _h } = require('./adminOps');

// LMS → Admin & Ops, boards A6–A11 (system health extras, reports, automation,
// security, evidence, assessment rules). Same guards as adminOps.js.
const { M, ok, bad, isMgmt, nameOf, getCfg, setCfg, auditRow, sendSheets, pct, NOISY_AUDIT, lmsUserIds, LMS_AUDIT_SCOPE } = _h;

const esc = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const maskEmail = (e) => {
  const [u, d] = String(e || '').split('@');
  return d ? `${u.slice(0, 2)}***@${d}` : '';
};

// ── A6 · system health extras (base health stays in health.js) ─────────

const JOBS = [
  { name: 'lmsLiveTick', label: 'lmsLiveTick · lifecycle + reminders', every: '30 s', maxAgeMs: 5 * 60 * 1000 },
  { name: 'lmsSyncTick', label: 'lmsSyncTick · enrol sync', every: '1 min', maxAgeMs: 5 * 60 * 1000 },
  { name: 'lmsPolicyReminderTick', label: 'policyReminder', every: 'hourly', maxAgeMs: 24 * 3600 * 1000, rule: 'policy-reminder' },
  { name: 'lmsDailySummaryTick', label: 'dailySummary', every: 'daily 9 AM', maxAgeMs: 2 * 3600 * 1000, rule: 'daily-report' },
  { name: 'financeEmiTick', label: 'financeEmi · EMI reminders', every: 'hourly', maxAgeMs: 2 * 3600 * 1000 },
  { name: 'lmsUnassignedBatchTick', label: 'unassignedBatch', every: 'hourly', maxAgeMs: 3 * 3600 * 1000 },
];

// GET /api/lms/admin/ops/health
async function healthExtras(req, res) {
  const snap = require('../../../../services/lms/health').snapshot();
  const paused = await automation.pausedMap().catch(() => ({}));
  const day = new Date(Date.now() - 24 * 3600 * 1000);
  const [liveRooms, drive, bounces, failedSync, failedRec, failedWebhooks] = await Promise.all([
    M('LmsLiveSession').countDocuments({ status: 'live' }),
    M('LmsDriveConnection').findOne({}).sort({ _id: -1 }).lean().catch(() => null),
    M('EmailDeliveryLog').countDocuments({ status: 'failed', sentAt: { $gte: day } }),
    M('LmsSyncJob').find({ status: { $in: ['failed', 'dead'] } }).sort({ updated: -1 }).limit(5).lean().catch(() => []),
    M('LiveRecording').countDocuments({ removed: false, status: 'FAILED' }),
    M('LmsWebhookEvent').countDocuments({ status: { $in: ['failed', 'dead'] } }).catch(() => 0),
  ]);
  const days = drive && drive.tokenExpiresAt ? Math.round((new Date(drive.tokenExpiresAt) - Date.now()) / (24 * 3600 * 1000)) : null;
  const t0 = Date.now();
  await mongoose.connection.db.admin().ping().catch(() => null);
  const dbMs = Date.now() - t0;
  return ok(res, {
    services: [
      { name: 'CRM API', state: 'ok', note: `up ${Math.round(process.uptime() / 3600)} h` },
      { name: 'BigBlueButton', state: 'ok', note: `${liveRooms} live room${liveRooms === 1 ? '' : 's'}` },
      { name: 'MongoDB', state: mongoose.connection.readyState === 1 ? 'ok' : 'down', note: `ping ${dbMs} ms` },
      { name: 'Google Drive', state: !drive ? 'off' : days !== null && days <= 3 ? 'warn' : 'ok', note: !drive ? 'not connected' : days !== null ? `token ${days < 0 ? 'expired' : `expires ${days}d`}` : 'connected' },
      { name: 'Email SMTP', state: bounces > 10 ? 'warn' : 'ok', note: `${bounces} bounce${bounces === 1 ? '' : 's'} (24h)` },
      { name: 'WhatsApp API', state: 'off', note: 'not set up' },
      { name: 'Transcription', state: 'off', note: 'not set up' },
    ],
    jobs: JOBS.map((j) => {
      const last = snap[j.name];
      const fresh = last && Date.now() - new Date(last).getTime() < j.maxAgeMs;
      return { name: j.name, label: j.label, every: j.every, lastRun: last || null, state: j.rule && paused[j.rule] ? 'PAUSED' : !last ? 'NOT RUN' : fresh ? 'OK' : 'STALE' };
    }),
    failedSync: failedSync.map((j) => ({ id: String(j._id), type: j.type, error: j.lastError || j.error || '', attempts: j.attempts || 0 })),
    failedRecordings: failedRec,
    failedWebhooks,
  });
}

// ── A7 · reports & exports ───────────────────────────────────────────────

const REPORTS = [
  { key: 'learner-360', name: 'Learner 360', desc: 'attendance, tests, projects, consent, eligibility', formats: ['csv', 'xlsx', 'pdf'], sensitive: true },
  { key: 'batch-attendance', name: 'Batch attendance', desc: 'daily / monthly / overall + exclusions', formats: ['csv', 'xlsx'] },
  { key: 'assessment-attempts', name: 'Assessment attempts & results', desc: 'qualified / technical review', formats: ['csv', 'xlsx'] },
  { key: 'project-progress', name: 'Project progress', desc: 'milestones, reviews, rubric', formats: ['xlsx', 'pdf'] },
  { key: 'policy-ack', name: 'Policy acknowledgement', desc: 'by version & batch', formats: ['csv'] },
  { key: 'communication', name: 'Communication delivery', desc: 'sent / failed', formats: ['csv'] },
  { key: 'class-incidents', name: 'Class incidents & provider reconcile', desc: '', formats: ['csv'] },
  { key: 'recording-inventory', name: 'Recording inventory', desc: 'scheduled vs available', formats: ['xlsx'] },
  { key: 'tickets', name: 'Support tickets & SLA', desc: '', formats: ['csv', 'xlsx'] },
  { key: 'system-health', name: 'System health', desc: 'jobs, webhooks, incidents', formats: ['csv'] },
  { key: 'pm-feedback', name: 'PM feedback & corrective actions', desc: '', formats: ['pdf'] },
  { key: 'audit', name: 'Audit / security', desc: '', formats: ['csv'], restricted: true, sensitive: true },
];

function rangeOf(q) {
  const from = q.from && !Number.isNaN(new Date(q.from).getTime()) ? new Date(q.from) : new Date(Date.now() - 30 * 24 * 3600 * 1000);
  const to = q.to && !Number.isNaN(new Date(q.to).getTime()) ? new Date(new Date(q.to).getTime() + 24 * 3600 * 1000) : new Date();
  return { from, to };
}

const d = (x) => (x ? new Date(x).toISOString().slice(0, 16).replace('T', ' ') : '');

async function buildReport(key, q, admin) {
  const { from, to } = rangeOf(q);
  const batch = q.batch && q.batch !== 'all' ? String(q.batch) : null;
  const full = isMgmt(admin);
  const email = (e) => (full ? e : maskEmail(e));
  switch (key) {
    case 'learner-360': {
      const students = await M('Student').find({ removed: false, ...(batch ? { batch } : {}) }, { name: 1, email: 1, batch: 1, status: 1, course: 1 }).lean();
      const attempts = await M('AssessmentAttempt').find({ status: 'SUBMITTED' }, { candidateEmail: 1, testType: 1, qualified: 1 }).lean();
      const pending = await M('PolicyAcknowledgement').find({ removed: false, status: 'pending' }, { studentEmail: 1 }).lean();
      const att = await M('LmsLiveSession').aggregate([
        { $match: { scheduledStart: { $gte: from, $lt: to }, status: { $in: ['ended', 'recording_processing', 'recording_available'] } } },
        { $unwind: '$participants' },
        { $match: { 'participants.role': 'student' } },
        { $group: { _id: { $toLower: '$participants.email' }, total: { $sum: 1 }, present: { $sum: { $cond: [{ $in: ['$participants.attendanceStatus', ['PRESENT', 'LATE']] }, 1, 0] } } } },
      ]);
      return students.map((s) => {
        const e = String(s.email || '').toLowerCase();
        const a = att.find((x) => x._id === e) || { present: 0, total: 0 };
        const mine = attempts.filter((x) => String(x.candidateEmail || '').toLowerCase() === e);
        return { Name: s.name, Email: email(s.email), Batch: s.batch || '', Status: s.status, Course: s.course || '', 'Attendance %': pct(a.present, a.total) ?? '', 'Tests qualified': mine.filter((x) => x.qualified).length, 'Tests attempted': mine.length, 'Pending policies': pending.filter((p) => String(p.studentEmail || '').toLowerCase() === e).length };
      });
    }
    case 'batch-attendance': {
      const rows = await M('LmsLiveSession').aggregate([
        { $match: { scheduledStart: { $gte: from, $lt: to }, ...(batch ? { batchName: batch } : {}), status: { $in: ['ended', 'recording_processing', 'recording_available'] } } },
        { $unwind: '$participants' },
        { $match: { 'participants.role': 'student' } },
        { $project: { batchName: 1, title: 1, scheduledStart: 1, p: '$participants' } },
        { $sort: { scheduledStart: -1 } },
        { $limit: 5000 },
      ]);
      return rows.map((r) => ({ Date: d(r.scheduledStart), Batch: r.batchName || '', Class: r.title || '', Learner: r.p.name || '', Email: email(r.p.email), Status: r.p.attendanceStatus, 'Minutes': r.p.totalDurationMin || 0, Corrected: r.p.correctedByName ? `by ${r.p.correctedByName}` : '' }));
    }
    case 'assessment-attempts': {
      const rows = await M('AssessmentAttempt').find({ startedAt: { $gte: from, $lt: to }, ...(batch ? { candidateBatch: batch } : {}) }).sort({ startedAt: -1 }).limit(5000).lean();
      return rows.map((r) => ({ Started: d(r.startedAt), Learner: r.candidateName || '', Email: email(r.candidateEmail), Batch: r.candidateBatch || '', Test: r.testType, Status: r.status, Score: r.score ?? '', Out_of: r.totalCount ?? '', Qualified: r.qualified === true ? 'yes' : r.qualified === false ? 'no' : '', Warnings: r.warningCount || 0 }));
    }
    case 'project-progress': {
      const rows = await M('Project').find({ removed: { $ne: true } }).lean();
      return rows.map((p) => ({ Project: p.title, Learner: p.studentName || p.assigneeName || '', Status: p.status || '', Milestones: (p.milestones || []).map((m) => `${m.title}:${m.status}`).join(' | '), Versions: (p.submissions || []).length, 'Last review': (p.submissions || []).filter((s) => s.review).map((s) => `v${s.version} ${s.review.decision} ${s.review.totalScore ?? ''}%`).pop() || '' }));
    }
    case 'policy-ack': {
      const rows = await M('PolicyAcknowledgement').find({ removed: false }).sort({ created: -1 }).limit(5000).lean();
      return rows.map((r) => ({ Policy: r.policyTitle, Version: r.policyVersion, Learner: r.studentName, Email: email(r.studentEmail), Status: r.status, Acknowledged: d(r.acknowledgedAt), Reminders: r.remindedCount || 0 }));
    }
    case 'communication': {
      const rows = await M('EmailDeliveryLog').find({ sentAt: { $gte: from, $lt: to } }).sort({ sentAt: -1 }).limit(5000).lean();
      return rows.map((r) => ({ Sent: d(r.sentAt), To: email(r.recipient), Subject: r.subject || '', Kind: r.kind || r.template || '', Status: r.status, Error: r.error || '' }));
    }
    case 'class-incidents': {
      const rows = await M('AuditLog').find({ module: 'liveclass', created: { $gte: from, $lt: to } }).sort({ created: -1 }).lean();
      const cancelled = await M('LmsLiveSession').find({ status: 'cancelled', scheduledStart: { $gte: from, $lt: to } }, { title: 1, batchName: 1, scheduledStart: 1 }).lean();
      return [...rows.map((r) => ({ When: d(r.created), Kind: r.action, Class: (r.meta && r.meta.title) || '', Batch: (r.meta && r.meta.batch) || '', By: r.performedByName || 'system', Reason: r.reason || '' })), ...cancelled.map((c) => ({ When: d(c.scheduledStart), Kind: 'cancelled', Class: c.title || '', Batch: c.batchName || '', By: '', Reason: '' }))];
    }
    case 'recording-inventory': {
      const rows = await M('LiveRecording').find({ removed: false, ...(batch ? { batchName: batch } : {}), startedAt: { $gte: from, $lt: to } }).sort({ startedAt: -1 }).lean();
      return rows.map((r) => ({ Class: r.className || '', Batch: r.batchName || '', Teacher: r.teacherName || '', Started: d(r.startedAt), Minutes: r.durationMin || 0, Status: r.status, Published: d(r.publishedAt), Failure: r.failReason || '' }));
    }
    case 'tickets': {
      const rows = await M('Ticket').find({ removed: false, created: { $gte: from, $lt: to } }).sort({ created: -1 }).lean();
      return rows.map((t) => ({ Raised: d(t.created), Subject: t.subject, Category: t.category || '', Priority: t.priority || '', Status: t.status, By: t.raisedByName || '', Resolved: d(t.resolvedAt), 'Hours to resolve': t.resolvedAt ? Math.round((new Date(t.resolvedAt) - new Date(t.created)) / 36e5) : '' }));
    }
    case 'system-health': {
      const snap = require('../../../../services/lms/health').snapshot();
      return JOBS.map((j) => ({ Job: j.name, Every: j.every, 'Last run': d(snap[j.name]) }));
    }
    case 'pm-feedback': {
      const rows = await M('FeedbackAction').find({}).sort({ created: -1 }).lean().catch(() => []);
      return rows.map((r) => ({ Action: r.title || r.action || '', Category: r.category || '', Owner: r.ownerName || '', Due: d(r.dueDate), Status: r.status }));
    }
    case 'audit': {
      const rows = await M('AuditLog').find({ created: { $gte: from, $lt: to }, module: { $nin: NOISY_AUDIT }, ...LMS_AUDIT_SCOPE }).sort({ created: -1 }).limit(5000).lean();
      return rows.map(auditRow).map((a) => ({ Event: a.eventId, Time: d(a.at), Actor: a.actor, Action: `${a.module} · ${a.action}`, Object: a.object, Change: a.change, Reason: a.reason }));
    }
    default:
      return null;
  }
}

function sendPdf(res, title, rows, base) {
  const PDFDocument = require('pdfkit');
  const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 32 });
  const chunks = [];
  doc.on('data', (c) => chunks.push(c));
  doc.on('end', () => {
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${base}.pdf"`);
    res.status(200).send(Buffer.concat(chunks));
  });
  doc.fontSize(16).text(title);
  doc.fontSize(9).fillColor('#475569').text(`Generated ${new Date().toLocaleString('en-IN')} · ${rows.length} rows`);
  doc.moveDown();
  const cols = rows.length ? Object.keys(rows[0]) : ['Note'];
  doc.fillColor('#0f172a').fontSize(8).text(cols.join('  |  '));
  doc.moveDown(0.3);
  for (const r of rows.length ? rows : [{ Note: 'No rows' }]) doc.text(cols.map((c) => String(r[c] ?? '')).join('  |  '));
  doc.end();
}

// GET /api/lms/admin/ops/reports
async function reportsOverview(req, res) {
  const snap = require('../../../../services/lms/health').snapshot();
  const paused = await automation.pausedMap().catch(() => ({}));
  const exports = await M('AuditLog').find({ module: 'export' }).sort({ created: -1 }).limit(10).lean();
  const batches = await M('Batch').find({ removed: false }, { name: 1 }).sort({ name: 1 }).lean().catch(() => []);
  return ok(res, {
    reports: REPORTS.filter((r) => !r.restricted || isMgmt(req.admin)).map(({ key, name, desc, formats, restricted }) => ({ key, name, desc, formats, restricted: !!restricted })),
    batches: batches.map((b) => b.name),
    piiMinimised: !isMgmt(req.admin),
    scheduled: [
      { name: 'Daily operations summary', when: '9:00 AM · Support Manager, Ops', state: paused['daily-report'] ? 'PAUSED' : 'ON', lastRun: snap.lmsDailySummaryTick || null },
      { name: 'Weekly batch report', when: 'Mon 10 AM · PMs', state: 'NOT SET UP' },
      { name: 'Monthly management pack', when: '1st · Management', state: 'NOT SET UP' },
    ],
    log: exports.map((e) => ({ at: e.created, by: `${e.performedByName || 'system'}${e.performedByRole ? ` · ${e.performedByRole}` : ''}`, report: (e.meta && e.meta.report) || '', rows: (e.meta && e.meta.rows) || 0, sensitive: !!(e.meta && e.meta.sensitive) })),
  });
}

// GET /api/lms/admin/ops/reports/:key?format=csv|xlsx|pdf&batch=&from=&to=
async function reportDownload(req, res) {
  const def = REPORTS.find((r) => r.key === req.params.key);
  if (!def) return bad(res, 404, 'Unknown report.');
  if (def.restricted && !isMgmt(req.admin)) return bad(res, 403, 'Restricted report.');
  const format = def.formats.includes(req.query.format) ? req.query.format : def.formats[0];
  const rows = (await buildReport(def.key, req.query, req.admin)) || [];
  const sensitive = !!def.sensitive && isMgmt(req.admin);
  await audit.record({ module: 'export', action: 'download', entityType: 'Report', admin: req.admin, meta: { report: `${def.name}${req.query.batch && req.query.batch !== 'all' ? ` · ${req.query.batch}` : ''}`, rows: rows.length, sensitive, format, filters: { batch: req.query.batch || 'all', from: req.query.from || '', to: req.query.to || '' } } });
  const base = `${def.key}-${new Date().toISOString().slice(0, 10)}`;
  if (format === 'pdf') return sendPdf(res, def.name, rows, base);
  return sendSheets(res, { [def.name]: rows }, base, format);
}

// ── A8 · automation catalogue ────────────────────────────────────────────

// GET /api/lms/admin/ops/automation
async function automationList(req, res) {
  const paused = await automation.pausedMap();
  const snap = require('../../../../services/lms/health').snapshot();
  // what each rule of jobs/lmsAutomationTick.js last did (kept across restarts)
  const runs = ((await M('LmsAdminConfig').findOne({ key: 'automation:runs' }).lean()) || {}).value || {};
  const schedules = require('../../../../services/lms/automationRules').RUNNERS;
  const rows = automation.RULES.map((r) => ({
    ...r,
    automated: !!r.job,
    running: !!r.job && !paused[r.key],
    lastRun: r.job ? snap[r.job] || (runs[r.key] && runs[r.key].at) || null : null,
    lastResult: runs[r.key] || null,
    schedule: (schedules[r.key] && schedules[r.key].schedule) || null,
  }));
  return ok(res, { rows, running: rows.filter((r) => r.running).length, total: rows.length, canToggle: isMgmt(req.admin) });
}

// POST /api/lms/admin/ops/automation/:key { running }
async function automationToggle(req, res) {
  if (!isMgmt(req.admin)) return bad(res, 403, 'Only an LMS admin can pause or resume an automation.');
  const rule = automation.RULES.find((r) => r.key === req.params.key);
  if (!rule) return bad(res, 404, 'Unknown rule.');
  if (!rule.pausable) return bad(res, 409, rule.job ? 'This rule is part of the live-class job and cannot be paused on its own.' : 'This workflow is not automated yet.');
  const running = !!(req.body || {}).running;
  const cfg = await getCfg('automation', { paused: {} });
  const pausedNow = { ...(cfg.paused || {}) };
  if (running) delete pausedNow[rule.key];
  else pausedNow[rule.key] = true;
  await setCfg('automation', { paused: pausedNow }, req.admin, `${rule.key} → ${running ? 'running' : 'paused'}`);
  automation.invalidate();
  await audit.record({ module: 'automation', action: running ? 'resume' : 'pause', entityType: 'AutomationRule', admin: req.admin, before: { running: !running }, after: { running }, meta: { code: rule.key } });
  return automationList(req, res);
}

// ── A9 · login monitoring, alerts, audit viewer ──────────────────────────

// GET /api/lms/admin/ops/security?q=&module=
async function security(req, res) {
  const lmsUsers = await lmsUserIds();
  const logins = await M('LoginActivity').find({ removed: false, admin: { $in: lmsUsers } }).sort({ loginAt: -1 }).limit(25).lean();
  const admins = await M('Admin').find({ _id: { $in: logins.map((l) => l.admin) } }, { role: 1 }).lean();
  const roleOf = new Map(admins.map((a) => [String(a._id), a.role]));
  const since = new Date(Date.now() - 12 * 3600 * 1000);
  const concurrent = await M('LoginActivity').aggregate([
    { $match: { removed: false, logoutAt: null, loginAt: { $gte: since }, admin: { $in: lmsUsers } } },
    { $group: { _id: '$admin', name: { $first: '$adminName' }, n: { $sum: 1 } } },
    { $match: { n: { $gt: 1 } } },
    { $limit: 10 },
  ]);
  const aq = { module: { $nin: NOISY_AUDIT }, ...LMS_AUDIT_SCOPE };
  if (req.query.module && req.query.module !== 'all') aq.module = String(req.query.module);
  const term = String(req.query.q || '').trim().replace(/^ev_/, '');
  if (term) aq.$expr = { $regexMatch: { input: { $toString: '$_id' }, regex: `${esc(term)}$`, options: 'i' } };
  const [auditRows, modules] = await Promise.all([M('AuditLog').find(aq).sort({ created: -1 }).limit(12).lean(), M('AuditLog').distinct('module')]);
  const live = await liveSettings.get().catch(() => ({}));
  return ok(res, {
    logins: logins.map((l) => ({ at: l.loginAt, user: l.adminName || 'user', role: roleOf.get(String(l.admin)) || '', open: !l.logoutAt, minutes: l.durationSeconds ? Math.round(l.durationSeconds / 60) : null, ip: l.ip || null, device: l.device || null, newDevice: !!l.newDevice, newIp: !!l.newIp })),
    alerts: [
      ...concurrent.map((c) => ({ kind: 'Concurrent sessions', text: `${c.name || 'user'} (${c.n} open sessions)` })),
      // D-09: a login from a device / IP this user has not used in 30 days (services/security/loginDevice.js)
      ...logins.filter((l) => l.newDevice || l.newIp).slice(0, 10).map((l) => ({ kind: l.newDevice ? 'New device' : 'New IP', text: `${l.adminName || 'user'} · ${l.device || ''}${l.ip ? ` · ${l.ip}` : ''}` })),
    ],
    audit: auditRows.map(auditRow),
    modules: modules.filter((m) => !NOISY_AUDIT.includes(m)).sort(),
    retention: [
      { label: 'Login sessions', value: 'kept (no purge job yet)' },
      { label: 'Audit events', value: 'append-only, never deleted' },
      { label: 'Recordings', value: live.recordingRetentionDays ? `${live.recordingRetentionDays} days` : 'not set' },
      { label: 'Proctor signals', value: 'kept with the attempt' },
    ],
  });
}

// ── A10 · central evidence repository ────────────────────────────────────

const EV_TYPES = ['All', 'Policy', 'Attendance', 'Assessment', 'Feedback', 'Project', 'Ticket', 'Communication', 'Certificate', 'Security'];

// GET /api/lms/admin/ops/evidence?type=
async function evidence(req, res) {
  const type = EV_TYPES.includes(req.query.type) ? req.query.type : 'All';
  const want = (t) => type === 'All' || type === t;
  const N = type === 'All' ? 6 : 40;
  const out = [];
  const id = (p, x) => `EV-${p}-${String(x).slice(-5).toUpperCase()}`;
  const full = isMgmt(req.admin);
  if (want('Policy')) {
    const r = await M('PolicyAcknowledgement').find({ removed: false, status: 'acknowledged' }).sort({ acknowledgedAt: -1 }).limit(N).lean();
    r.forEach((x) => out.push({ id: id('POL', x._id), type: 'Policy', who: x.studentName, obj: `${x.policyTitle} v${x.policyVersion}`, v: String(x.policyVersion || 1), src: 'learner UI', t: x.acknowledgedAt, scope: 'Learner + SM', ret: '3 yrs', detail: [['Learner', x.studentName], ['Policy', x.policyTitle], ['Version', `v${x.policyVersion}`], ['Accepted', x.acknowledgedAt]] }));
  }
  if (want('Attendance')) {
    const r = await M('AuditLog').find({ module: 'attendance', action: 'correct' }).sort({ created: -1 }).limit(N).lean();
    r.forEach((x) => out.push({ id: id('ATT', x._id), type: 'Attendance', who: (x.meta && (x.meta.studentName || x.meta.learner)) || '—', obj: 'correction', v: '—', src: `${x.performedByName || 'staff'} correction`, t: x.created, scope: 'Learner + SM + PM', ret: '3 yrs', detail: [['Change', `${_h.summarise(x.before)} → ${_h.summarise(x.after)}`], ['Reason', x.reason || '—'], ['By', x.performedByName || '—']] }));
  }
  if (want('Assessment')) {
    const r = await M('AssessmentAttempt').find({ status: 'SUBMITTED' }).sort({ submittedAt: -1 }).limit(N).lean();
    r.forEach((x) => out.push({ id: id('ASM', x._id), type: 'Assessment', who: x.candidateName || '—', obj: `${x.testType} · ${x.score ?? '?'}/${x.totalCount ?? '?'}`, v: '1', src: (x.warningCount || 0) > 0 ? `proctor (${x.warningCount} warnings)` : 'test engine', t: x.submittedAt, scope: 'PM + SM', ret: '2 yrs', detail: [['Test', x.testType], ['Score', `${x.score ?? '?'} / ${x.totalCount ?? '?'}`], ['Qualified', x.qualified ? 'yes' : 'no'], ['Proctor warnings', x.warningCount || 0]] }));
  }
  if (want('Feedback')) {
    const r = await M('WeeklyFeedback').find({}).sort({ created: -1 }).limit(N).lean().catch(() => []);
    r.forEach((x) => out.push({ id: id('FB', x._id), type: 'Feedback', who: '—', obj: `${x.week || ''} · ${x.batch || ''}`, v: x.formVersion || '1.2', src: 'form', t: x.created, scope: 'Mgmt (anon.)', ret: '2 yrs', detail: [['Week', x.week || '—'], ['Batch', x.batch || '—']] }));
  }
  if (want('Project')) {
    const r = await M('Project').find({ removed: { $ne: true }, 'submissions.0': { $exists: true } }).lean();
    r.forEach((p) => {
      const last = p.submissions[p.submissions.length - 1];
      out.push({ id: id('PRJ', p._id), type: 'Project', who: p.studentName || p.assigneeName || '—', obj: p.title, v: String(last.version), src: 'learner upload', t: last.submittedAt, scope: 'Learner + PM', ret: 'batch + 1 yr', detail: [['Project', p.title], ['Repo', last.githubUrl || '—'], ['Demo', last.demoUrl || '—'], ['Versions', p.submissions.map((s) => `v${s.version} · ${new Date(s.submittedAt).toLocaleDateString('en-IN')}`).join(', ')]] });
    });
  }
  if (want('Ticket')) {
    const r = await M('Ticket').find({ removed: false }).sort({ created: -1 }).limit(N).lean();
    r.forEach((x) => out.push({ id: id('TKT', x._id), type: 'Ticket', who: x.raisedByName || '—', obj: x.subject, v: '—', src: x.source || 'learner', t: x.created, scope: 'SM', ret: '2 yrs', detail: [['Subject', x.subject], ['Status', x.status], ['History', `${(x.history || []).length} change(s)`]] }));
  }
  if (want('Communication')) {
    const r = await M('EmailDeliveryLog').find({}).sort({ sentAt: -1 }).limit(N).lean();
    r.forEach((x) => out.push({ id: id('COM', x._id), type: 'Communication', who: full ? x.recipient : maskEmail(x.recipient), obj: x.subject || x.kind || 'email', v: '—', src: 'mailer', t: x.sentAt, scope: 'SM', ret: '2 yrs', detail: [['Subject', x.subject || '—'], ['Status', x.status], ['Error', x.error || '—']] }));
  }
  if (want('Certificate')) {
    const r = await M('Certificate').find({}).sort({ created: -1 }).limit(N).lean().catch(() => []);
    r.forEach((x) => out.push({ id: id('CRT', x._id), type: 'Certificate', who: x.studentName || '—', obj: x.certificateId || x.title || '', v: '1', src: 'approver', t: x.issuedAt || x.created, scope: 'Learner + SM', ret: 'permanent', detail: [['Certificate', x.certificateId || '—'], ['Status', x.status || '—']] }));
  }
  if (want('Security') && full) {
    const r = await M('LoginActivity').aggregate([{ $match: { removed: false, logoutAt: null, loginAt: { $gte: new Date(Date.now() - 7 * 24 * 3600 * 1000) }, admin: { $in: await lmsUserIds() } } }, { $group: { _id: '$admin', name: { $first: '$adminName' }, n: { $sum: 1 }, t: { $max: '$loginAt' } } }, { $match: { n: { $gt: 1 } } }, { $limit: N }]);
    r.forEach((x) => out.push({ id: id('SEC', x._id), type: 'Security', who: x.name || '—', obj: 'Concurrent login', v: '—', src: 'monitor', t: x.t, scope: 'Admin only', ret: '180 days', detail: [['Open sessions', x.n]] }));
  }
  out.sort((a, b) => new Date(b.t || 0) - new Date(a.t || 0));
  return ok(res, { types: EV_TYPES, type, rows: out.slice(0, 60) });
}

// ── A11 · readiness, assessment & attendance rules ───────────────────────

async function currentRules() {
  const a = await assessmentSettings.get(true);
  const l = await liveSettings.get();
  return {
    readiness: { passPct: Math.round(a.qualifyThreshold * 100), attempts: a.maxAttemptsPerType, cooldownDays: a.cooldownDays },
    assessment: { totalMarks: 50, passMark: Math.round(a.qualifyThreshold * 50), attempts: a.maxAttemptsPerType, cooldownDays: a.cooldownDays },
    attendance: { graceMin: l.lateThresholdMin, presentPct: l.presentThresholdPct, overallPct: 90 },
  };
}

// GET /api/lms/admin/ops/rules
async function rules(req, res) {
  const proposal = await getCfg('rules-proposal', {});
  return ok(res, { current: await currentRules(), proposal: proposal.values || null, proposedByName: proposal.byName || null, proposedAt: proposal.at || null, version: proposal.version || 1, canApprove: isMgmt(req.admin) });
}

const num = (v, lo, hi) => {
  const n = Number(v);
  return Number.isFinite(n) && n >= lo && n <= hi ? n : null;
};

// POST /api/lms/admin/ops/rules/proposal { values }
async function rulesPropose(req, res) {
  const v = (req.body || {}).values || {};
  const values = {
    assessment: { passMark: num(v.assessment && v.assessment.passMark, 1, 50), attempts: num(v.assessment && v.assessment.attempts, 1, 10), cooldownDays: num(v.assessment && v.assessment.cooldownDays, 0, 60) },
    attendance: { graceMin: num(v.attendance && v.attendance.graceMin, 0, 60), presentPct: num(v.attendance && v.attendance.presentPct, 1, 100) },
  };
  if (Object.values(values).some((g) => Object.values(g).some((x) => x === null))) return bad(res, 400, 'Every value must be a number in range.');
  const prev = await getCfg('rules-proposal', {});
  await setCfg('rules-proposal', { values, byName: nameOf(req.admin), by: String(req.admin._id), at: new Date(), version: prev.version || 1 }, req.admin, 'proposed');
  await audit.record({ module: 'rules', action: 'propose', entityType: 'RuleSet', admin: req.admin, after: values });
  return rules(req, res);
}

// POST /api/lms/admin/ops/rules/approve — management; applies the proposal.
async function rulesApprove(req, res) {
  if (!isMgmt(req.admin)) return bad(res, 403, 'Only Management can approve rule changes.');
  const p = await getCfg('rules-proposal', {});
  if (!p.values) return bad(res, 409, 'No proposal waiting.');
  if (p.by === String(req.admin._id)) return bad(res, 403, 'You proposed these values — another manager has to approve them.');
  const before = await currentRules();
  await assessmentSettings.update({ qualifyThreshold: Math.round((p.values.assessment.passMark / 50) * 1000) / 1000, maxAttemptsPerType: p.values.assessment.attempts, cooldownDays: p.values.assessment.cooldownDays });
  await liveSettings.update({ lateThresholdMin: p.values.attendance.graceMin, presentThresholdPct: p.values.attendance.presentPct });
  await setCfg('rules-proposal', { values: null, version: (p.version || 1) + 1, lastApprovedAt: new Date(), lastApprovedByName: nameOf(req.admin) }, req.admin, 'approved + enforced');
  await audit.record({ module: 'rules', action: 'approve', entityType: 'RuleSet', admin: req.admin, before, after: p.values, meta: { code: `v${(p.version || 1) + 1}` } });
  return rules(req, res);
}

// POST /api/lms/admin/ops/rules/discard — drop the proposal (drafter or mgmt).
async function rulesDiscard(req, res) {
  const p = await getCfg('rules-proposal', {});
  if (!p.values) return bad(res, 409, 'No proposal waiting.');
  if (p.by !== String(req.admin._id) && !isMgmt(req.admin)) return bad(res, 403, 'Not your proposal.');
  await setCfg('rules-proposal', { ...p, values: null }, req.admin, 'discarded');
  return rules(req, res);
}

module.exports = { healthExtras, reportsOverview, reportDownload, automationList, automationToggle, security, evidence, rules, rulesPropose, rulesApprove, rulesDiscard };
