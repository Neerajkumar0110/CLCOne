const mongoose = require('mongoose');
const dns = require('dns');
const net = require('net');
const http = require('http');
const https = require('https');
const { LMS_FULL_ACCESS_ROLES, LMS_TEACHER_ROLES } = require('../../../../config/roles');
const { trainerIncludes } = require('../../../../services/lms/teacherCourseAccess');
const audit = require('../../../../services/lms/auditLog');
const realtime = require('../../../../services/lms/realtime');
const assessmentSettings = require('../../../../services/lms/assessmentSettingsService');

// Project Manager boards (design canvas page 4, P1–P10). Every read here is
// scoped to the batches the signed-in Project Manager trains (Batch.trainer,
// same rule as projects.js#assign / panel.js#teacherStudents); management
// roles see every batch. Writes are small and additive: a recording toggle,
// a delivery record, PM notes, a report sign-off and "send to Ops".

const M = (n) => mongoose.model(n);
const ok = (res, result, message) => res.status(200).json({ success: true, result, message });
const bad = (res, code, message) => res.status(code).json({ success: false, result: null, message });
const isManager = (a) => !!(a && LMS_FULL_ACCESS_ROLES.includes(a.role));
const isTeacher = (a) => !!(a && LMS_TEACHER_ROLES.includes(a.role));
const esc = (s) => String(s || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const rxEq = (s) => new RegExp(`^${esc(s)}$`, 'i');
const lc = (s) => String(s || '').trim().toLowerCase();
const DAY = 86400000;
const ENDED = ['ended', 'recording_processing', 'recording_available'];

async function myBatches(admin) {
  const Batch = M('Batch');
  const sel = 'name code course status trainer classTime endTime startDate endDate';
  if (isManager(admin)) return Batch.find({ removed: false }).select(sel).lean();
  if (!isTeacher(admin) || !admin.name) return [];
  const rows = await Batch.find({ removed: false, trainer: new RegExp(esc(admin.name), 'i') }).select(sel).lean();
  return rows.filter((b) => trainerIncludes(b.trainer, admin.name));
}

// the asked-for batch if it is mine, else my batch with the most learners
async function pickBatch(batches, name) {
  const hit = batches.find((b) => b.name === name);
  if (hit || !batches.length) return hit || null;
  const counts = await M('Student').aggregate([{ $match: { removed: false, batch: { $in: batches.map((b) => b.name) }, status: { $ne: 'Dropped' } } }, { $group: { _id: '$batch', n: { $sum: 1 } } }]);
  const best = counts.sort((a, b) => b.n - a.n)[0];
  return (best && batches.find((b) => b.name === best._id)) || batches[0];
}

// the roster row of one learner, only if they sit in one of my batches
async function rosterRowFor(admin, email) {
  const batches = await myBatches(admin);
  const names = batches.map((b) => b.name);
  if (!email || !names.length) return null;
  const row = await M('Student').findOne({ removed: false, email: rxEq(email), batch: { $in: names } }).sort({ created: -1 }).lean();
  return row ? { row, batch: batches.find((b) => b.name === row.batch) } : null;
}

const maskEmail = (e) => {
  const [u, d] = String(e || '').split('@');
  return u && d ? `${u[0]}••••@${d}` : '';
};
const maskPhone = (p) => {
  const digits = String(p || '').replace(/\D/g, '');
  return digits.length >= 4 ? `+91 ••••• ${digits.slice(-4)}` : '';
};

// ── P2: recording on/off before the class (OPS-02) ─────────────────────────
// POST /api/lms/liveclasses/:id/recording { enabled }
async function recordingToggle(req, res) {
  const liveClassService = require('../../../../services/lms/liveClassService');
  if (!mongoose.isValidObjectId(req.params.id)) return bad(res, 404, 'Live class not found.');
  const s = await M('LmsLiveSession').findOne({ _id: req.params.id, removed: false });
  if (!s) return bad(res, 404, 'Live class not found.');
  if ((await liveClassService.resolveRole(s, req.admin)) !== 'teacher') return bad(res, 403, 'Project Managers only.');
  if (['ended', 'cancelled', 'recording_processing', 'recording_available'].includes(s.status)) return bad(res, 400, 'This class is over — recording can no longer change.');
  const enabled = !!(req.body && req.body.enabled);
  const before = s.recordingEnabled !== false;
  s.recordingEnabled = enabled;
  await s.save();
  await audit.record({ module: 'liveclass', action: enabled ? 'recording.on' : 'recording.off', entityType: 'LmsLiveSession', entityId: s._id, admin: req.admin, before: { enabled: before }, after: { enabled } });
  if (!enabled && before) {
    // "Support Manager ko alert gaya" — every LMS management/support account
    const staff = await M('Admin').find({ removed: false, enabled: true, role: { $in: LMS_FULL_ACCESS_ROLES } }).select('_id').lean();
    await realtime.notify(staff.map((a) => a._id), {
      type: 'lms.recording.off',
      title: `⚠️ Recording turned OFF: ${s.title}`,
      body: `${req.admin.name} turned recording off for ${s.batchName || 'a batch'} — this class will not be recoverable.`,
      link: '/lms/live-classes',
      actorName: req.admin.name,
    });
  }
  const live = ['live', 'starting', 'ending'].includes(s.status);
  return ok(res, { enabled, appliesNow: !live }, live ? 'Saved — applies when the room is next created.' : enabled ? 'Recording ON.' : 'Recording OFF — support was alerted.');
}

// ── P2: the host board for one class ───────────────────────────────────────
// GET /api/lms/teacher/pm/class/:id → planned curriculum session, nearby
// sessions to pick the delivered topic from, and the saved delivery record.
async function classBoard(req, res) {
  const liveClassService = require('../../../../services/lms/liveClassService');
  if (!mongoose.isValidObjectId(req.params.id)) return bad(res, 404, 'Live class not found.');
  const s = await M('LmsLiveSession').findOne({ _id: req.params.id, removed: false }).lean();
  if (!s) return bad(res, 404, 'Live class not found.');
  if ((await liveClassService.resolveRole(s, req.admin)) !== 'teacher') return bad(res, 403, 'Project Managers only.');
  const out = { classId: String(s._id), batch: s.batchName || '', recordingEnabled: s.recordingEnabled !== false, planned: null, options: [], record: null, media: null };
  // FUNC-04: while the class is live, ask BBB who has a camera / mic shared,
  // so "learner ka camera nahi dikhta" is answered from the room itself
  if (['live', 'starting', 'ending'].includes(s.status) && s.meetingProvider === 'bigbluebutton' && s.meetingId) {
    const full = await M('LmsLiveSession').findById(s._id).select('+moderatorPW meetingId').lean();
    const people = await require('../../../../services/lms/meeting').getMeetingProvider().getParticipants(full).catch(() => null);
    if (Array.isArray(people)) out.media = people.map((p) => ({ userId: p.userId, name: p.name, role: p.role, video: !!p.hasVideo, voice: !!p.hasVoice, listenOnly: !!p.listenOnly }));
  }
  if (!s.batchName) return ok(res, out);
  const { sessions } = await sessionsForBatch(s.batchName);
  const recs = sessions.filter((x) => x.record);
  const mine = recs.find((x) => x.record.liveClass === String(s._id));
  const firstPending = sessions.find((x) => x.status !== 'DELIVERED' && x.status !== 'SKIPPED');
  const planned = mine || firstPending || null;
  out.planned = planned ? pickSession(planned) : null;
  out.record = mine ? { coverage: mine.record.coverage || 'full', deliveredTopic: mine.record.deliveredTopic || '', recordingTitle: mine.record.recordingTitle || '', by: mine.record.recordedByName || '', at: mine.record.updatedAt } : null;
  const idx = planned ? sessions.indexOf(planned) : -1;
  out.options = sessions.slice(Math.max(0, idx - 3), idx + 6).map(pickSession);
  return ok(res, out);
}
const pickSession = (x) => ({ sessionId: x.sessionId, code: x.code, title: x.title, status: x.status });

async function sessionsForBatch(batchName) {
  const curriculumTracker = require('../../../../services/lms/curriculumTracker');
  const batchDoc = await M('Batch').findOne({ name: batchName, removed: false }).select('_id course').lean();
  let track = null;
  if (batchDoc) track = await curriculumTracker.trackForBatch(batchDoc).catch(() => null);
  const sessions = await M('AssessmentCurriculumSession').find(track ? { track } : {}).sort({ order: 1 }).lean();
  const records = await M('AssessmentDeliveryRecord').find({ batch: batchName, sessionId: { $in: sessions.map((x) => x._id) } }).lean();
  const byId = new Map(records.map((r) => [String(r.sessionId), r]));
  return {
    track,
    sessions: sessions.map((x) => {
      const r = byId.get(String(x._id)) || null;
      return { sessionId: x._id, code: x.code, title: x.title, unit: x.unit, order: x.order, status: (r && r.status) || 'PENDING', record: r };
    }),
  };
}

// POST /api/lms/teacher/pm/delivery { liveClassId, sessionId, coverage, deliveredTopic, recordingTitle }
// "What was taught today" (DATA-03): the curriculum status follows the topic
// actually delivered, not the calendar date. Fully covered → DELIVERED;
// partial / different topic → stays PENDING (carried to the next class) with
// what was really taught written down.
async function saveDelivery(req, res) {
  const liveClassService = require('../../../../services/lms/liveClassService');
  const b = req.body || {};
  if (!mongoose.isValidObjectId(b.liveClassId)) return bad(res, 400, 'Pick the class.');
  const s = await M('LmsLiveSession').findOne({ _id: b.liveClassId, removed: false });
  if (!s) return bad(res, 404, 'Live class not found.');
  if ((await liveClassService.resolveRole(s, req.admin)) !== 'teacher') return bad(res, 403, 'Project Managers only.');
  if (!s.batchName) return bad(res, 400, 'This class has no batch.');
  const coverage = ['full', 'partial', 'different'].includes(b.coverage) ? b.coverage : 'full';
  const session = await M('AssessmentCurriculumSession').findById(String(b.sessionId || '')).lean();
  if (!session) return bad(res, 400, 'Pick the curriculum session.');
  const deliveredTopic = String(b.deliveredTopic || '').trim().slice(0, 200);
  if (coverage === 'different' && !deliveredTopic) return bad(res, 400, 'Write the topic that was actually taught.');
  const status = coverage === 'full' ? 'DELIVERED' : 'PENDING';
  const set = {
    status,
    auto: false,
    coverage,
    deliveredTopic: deliveredTopic || (coverage === 'different' ? '' : session.title),
    liveClass: String(s._id),
    recordingTitle: String(b.recordingTitle || '').trim().slice(0, 200),
    recordedBy: String(req.admin._id),
    recordedByName: req.admin.name,
    updatedAt: new Date(),
  };
  if (status === 'DELIVERED') set.actualDate = s.actualStart || s.scheduledStart || new Date();
  const record = await M('AssessmentDeliveryRecord').findOneAndUpdate(
    { sessionId: String(session._id), batch: s.batchName },
    { $set: set, $setOnInsert: { _id: new mongoose.Types.ObjectId().toString(), sessionId: String(session._id), batch: s.batchName } },
    { upsert: true, new: true }
  );
  await audit.record({ module: 'curriculum', action: 'delivery.record', entityType: 'LmsLiveSession', entityId: s._id, admin: req.admin, after: { session: session.code, coverage, deliveredTopic: set.deliveredTopic } });
  return ok(res, { status: record.status, coverage }, 'Delivery record saved.');
}

// GET /api/lms/teacher/pm/curriculum?batch= — planned vs delivered (P6)
async function curriculumBoard(req, res) {
  const batches = await myBatches(req.admin);
  const batch = await pickBatch(batches, req.query.batch);
  if (!batch) return ok(res, { batches: [], batch: null, rows: [], delivered: 0, total: 0 });
  const { sessions } = await sessionsForBatch(batch.name);
  // recordings / class of each delivered row, from the delivery record's class
  const classIds = sessions.map((x) => x.record && x.record.liveClass).filter((id) => mongoose.isValidObjectId(id));
  const classes = classIds.length ? await M('LmsLiveSession').find({ _id: { $in: classIds } }).select('status recordingEnabled recordingStatus scheduledStart actualStart').lean() : [];
  const cById = new Map(classes.map((c) => [String(c._id), c]));
  const rows = sessions.map((x) => {
    const r = x.record;
    const c = r && r.liveClass ? cById.get(r.liveClass) : null;
    let state = x.status;
    if (r && r.coverage === 'partial') state = 'CARRY_OVER';
    if (r && r.coverage === 'different') state = 'DIFFERENT_TOPIC';
    return {
      sessionId: x.sessionId,
      code: x.code,
      title: x.title,
      unit: x.unit,
      date: (r && (r.actualDate || r.plannedDate)) || (c && (c.actualStart || c.scheduledStart)) || null,
      deliveredTopic: (r && r.deliveredTopic) || (x.status === 'DELIVERED' ? x.title : ''),
      state,
      auto: !!(r && r.auto),
      recording: c ? { enabled: c.recordingEnabled !== false, status: c.recordingStatus || null, classStatus: c.status } : null,
    };
  });
  const delivered = rows.filter((r) => r.state === 'DELIVERED').length;
  return ok(res, { batches: batches.map((b) => ({ name: b.name, course: b.course })), batch: batch.name, rows, delivered, total: rows.length });
}

// ── P3: is the repo / deployment reachable? ────────────────────────────────
// GET /api/lms/teacher/pm/projects/:id/link-check
// Only http(s) to a public address (every resolved IP is checked inside the
// socket's own lookup, so a DNS answer can't swap to a private host after
// the check). HEAD, 6 s timeout, redirects reported — never followed — and
// no body is read. Nothing the learner submitted is ever executed.
function isPrivateIp(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  const v = ip.toLowerCase();
  if (v.startsWith('::ffff:')) return isPrivateIp(v.slice(7));
  return v === '::1' || v === '::' || v.startsWith('fc') || v.startsWith('fd') || v.startsWith('fe80');
}
function safeLookup(host, opts, cb) {
  dns.lookup(host, { all: true }, (err, addrs) => {
    if (err) return cb(err);
    const list = addrs || [];
    if (!list.length || list.some((a) => isPrivateIp(a.address))) return cb(new Error('blocked address'));
    const first = list[0];
    if (opts && opts.all) return cb(null, list);
    return cb(null, first.address, first.family);
  });
}
function checkUrl(raw) {
  return new Promise((resolve) => {
    let u;
    try {
      u = new URL(String(raw || '').trim());
    } catch (e) {
      return resolve({ ok: false, label: 'invalid link' });
    }
    if (!['http:', 'https:'].includes(u.protocol) || (u.port && !['80', '443'].includes(u.port)) || u.username || u.password) return resolve({ ok: false, label: 'link not allowed' });
    // an IP literal never goes through `lookup`, so check it here
    const bare = u.hostname.replace(/^\[|\]$/g, '');
    if (net.isIP(bare) && isPrivateIp(bare)) return resolve({ ok: false, label: 'link not allowed' });
    if (/^(localhost|.*\.local|.*\.internal)$/i.test(bare)) return resolve({ ok: false, label: 'link not allowed' });
    const lib = u.protocol === 'https:' ? https : http;
    const reqOut = lib.request(u, { method: 'HEAD', timeout: 6000, lookup: safeLookup, headers: { 'User-Agent': 'CareerLab-LMS-link-check' } }, (r) => {
      r.resume();
      const code = r.statusCode || 0;
      resolve({ ok: code >= 200 && code < 400, status: code, label: code >= 300 && code < 400 ? `${code} redirect` : code === 200 ? '200 OK' : String(code) });
    });
    reqOut.on('timeout', () => reqOut.destroy(new Error('timeout')));
    reqOut.on('error', (e) => resolve({ ok: false, label: /blocked/.test(e.message) ? 'link not allowed' : /timeout/.test(e.message) ? 'timed out' : 'unreachable' }));
    reqOut.end();
  });
}
async function linkCheck(req, res) {
  if (!mongoose.isValidObjectId(req.params.id)) return bad(res, 404, 'Not found.');
  const p = await M('Project').findOne({ _id: req.params.id, removed: false }).lean();
  if (!p) return bad(res, 404, 'Not found.');
  if (!isManager(req.admin) && !(p.mentor && String(p.mentor) === String(req.admin._id))) return bad(res, 403, 'Not allowed.');
  const last = (p.submissions || [])[p.submissions.length - 1] || {};
  const [repo, deploy] = await Promise.all([
    last.githubUrl || p.githubUrl ? checkUrl(last.githubUrl || p.githubUrl) : null,
    last.deploymentUrl || p.deploymentUrl ? checkUrl(last.deploymentUrl || p.deploymentUrl) : null,
  ]);
  return ok(res, { repo, deploy, checkedAt: new Date() });
}

// ── P4: assessments & results for my batches ───────────────────────────────
const TEST_LABEL = { BASIC: 'Readiness Test', MAJOR: 'Major test', MICRO: 'Micro test', NLP_MICRO: 'NLP micro test', NLP_MAJOR: 'NLP major test', LLM_MAJOR: 'LLM major test' };
async function assessBoard(req, res) {
  return ok(res, await buildAssess(req.admin, req.query.batch));
}
async function buildAssess(admin, batchName) {
  const batches = await myBatches(admin);
  const batch = await pickBatch(batches, batchName);
  if (!batch) return { batches: [], batch: null, tests: [], settings: null };
  const roster = await M('Student').find({ removed: false, batch: batch.name }).select('name email status').lean();
  const active = roster.filter((r) => r.status !== 'Dropped');
  const emails = active.map((r) => lc(r.email)).filter(Boolean);
  const attempts = emails.length
    ? await M('AssessmentAttempt').find({ candidateEmail: { $in: emails.map((e) => rxEq(e)) } }).sort({ startedAt: 1 }).lean()
    : [];
  const settings = await assessmentSettings.get();
  const events = attempts.length
    ? await M('AssessmentProctorEvent').aggregate([{ $match: { attemptId: { $in: attempts.map((a) => String(a._id)) } } }, { $group: { _id: { a: '$attemptId', t: '$type' }, n: { $sum: 1 }, last: { $max: '$timestamp' } } }])
    : [];
  const sig = new Map();
  events.forEach((e) => {
    const k = e._id.a;
    if (!sig.has(k)) sig.set(k, []);
    sig.get(k).push({ type: e._id.t, n: e.n, last: e.last });
  });
  const verifyRows = await M('LmsAdminConfig').find({ key: new RegExp(`^pm-verify:${esc(batch.name)}:`) }).lean();
  const verified = new Map(verifyRows.map((v) => [v.key.split(':').pop(), v.value]));

  const types = [...new Set(attempts.map((a) => a.testType))];
  const tests = types.map((t) => {
    const mine = attempts.filter((a) => a.testType === t);
    const byLearner = new Map();
    mine.forEach((a) => {
      const k = lc(a.candidateEmail);
      if (!byLearner.has(k)) byLearner.set(k, []);
      byLearner.get(k).push(a);
    });
    const rows = active.map((r) => {
      const list = byLearner.get(lc(r.email)) || [];
      const last = list[list.length - 1];
      if (!last) return { name: r.name, email: r.email, attempts: 0, result: 'NOT_STARTED' };
      const qualified = list.some((a) => a.qualified === true || (a.qualified == null && a.status === 'SUBMITTED' && a.totalCount && a.score / a.totalCount >= settings.qualifyThreshold));
      const signals = (sig.get(String(last._id)) || []).map((s) => ({ type: s.type, n: s.n, last: s.last }));
      let result = qualified ? 'QUALIFIED' : last.status === 'SUBMITTED' ? 'NOT_PASSED' : last.status === 'SUSPENDED' ? 'TECHNICAL_REVIEW' : 'IN_PROGRESS';
      if (!qualified && last.status === 'IN_PROGRESS' && Date.now() - new Date(last.startedAt) > 6 * 3600000) result = 'TECHNICAL_REVIEW';
      const canRetry = !qualified && list.length < settings.maxAttemptsPerType && last.status === 'SUBMITTED';
      return {
        name: r.name,
        email: r.email,
        attempts: list.length,
        attemptId: String(last._id),
        score: last.status === 'SUBMITTED' ? last.score : null,
        total: last.totalCount || null,
        result,
        warningCount: last.warningCount || 0,
        signals,
        nextEligible: canRetry && last.submittedAt ? new Date(new Date(last.submittedAt).getTime() + settings.cooldownDays * DAY) : null,
        corrected: !!last.correctedAt,
      };
    });
    const attempted = rows.filter((r) => r.attempts > 0).length;
    const lastAt = mine.reduce((m, a) => Math.max(m, new Date(a.submittedAt || a.startedAt).getTime()), 0);
    return {
      testType: t,
      label: TEST_LABEL[t] || t,
      attempted,
      roster: active.length,
      qualified: rows.filter((r) => r.result === 'QUALIFIED').length,
      technical: rows.filter((r) => r.result === 'TECHNICAL_REVIEW').length,
      notPassed: rows.filter((r) => r.result === 'NOT_PASSED').length,
      lastActivity: lastAt ? new Date(lastAt) : null,
      verified: verified.get(t) || null,
      rows,
    };
  });
  tests.sort((a, b) => new Date(b.lastActivity || 0) - new Date(a.lastActivity || 0));
  const bank = await M('AssessmentQuestion').countDocuments({}).catch(() => null);
  return {
    batches: batches.map((b) => b.name),
    batch: batch.name,
    tests,
    settings: { maxAttempts: settings.maxAttemptsPerType, cooldownDays: settings.cooldownDays, qualifyPct: Math.round(settings.qualifyThreshold * 100) },
    questionBank: bank,
  };
}

// POST /api/lms/teacher/pm/assess/verify { batch, testType, counts }
// "Verify before publish" — the responsible person signs the draft report
// off; who, when and the counts they saw are kept (LmsAdminConfig history).
async function assessVerify(req, res) {
  const b = req.body || {};
  const batches = await myBatches(req.admin);
  if (!batches.some((x) => x.name === b.batch)) return bad(res, 403, 'Not your batch.');
  if (!/^[A-Z_]{3,20}$/.test(String(b.testType || ''))) return bad(res, 400, 'Pick the test.');
  const key = `pm-verify:${b.batch}:${b.testType}`;
  const value = { by: String(req.admin._id), byName: req.admin.name, at: new Date(), counts: b.counts && typeof b.counts === 'object' ? { attempted: Number(b.counts.attempted) || 0, qualified: Number(b.counts.qualified) || 0, technical: Number(b.counts.technical) || 0 } : null };
  const prev = await M('LmsAdminConfig').findOne({ key });
  if (prev) {
    prev.history = [...(prev.history || []), { value: prev.value, at: new Date(), by: req.admin._id, byName: req.admin.name }].slice(-20);
    prev.value = value;
    prev.markModified('value');
    await prev.save();
  } else {
    await M('LmsAdminConfig').create({ key, value, history: [] });
  }
  await audit.record({ module: 'assessment', action: 'report.verify', entityType: 'Batch', admin: req.admin, after: { batch: b.batch, testType: b.testType, counts: value.counts } });
  return ok(res, value, 'Report verified.');
}

// GET /api/lms/teacher/pm/assess/export?batch=&testType= (xlsx)
async function assessExport(req, res) {
  const data = await buildAssess(req.admin, req.query.batch);
  if (!data.batch || data.batch !== req.query.batch) return bad(res, 403, 'Not your batch.');
  const t = (data.tests || []).find((x) => x.testType === req.query.testType);
  if (!t) return bad(res, 404, 'No attempts for that test.');
  const XLSX = require('xlsx');
  const rows = t.rows.map((r) => ({
    Learner: r.name,
    Email: r.email,
    Attempts: r.attempts,
    Score: r.score == null ? '' : r.score,
    Total: r.total || '',
    'Draft result': r.result.replace('_', ' '),
    'Proctor signals': (r.signals || []).map((s) => `${s.n} ${s.type.toLowerCase().replace(/_/g, ' ')}`).join('; '),
    'Next eligible': r.nextEligible ? new Date(r.nextEligible).toISOString().slice(0, 10) : '',
  }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), 'Draft report');
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${data.batch}-${t.testType}-draft.xlsx"`);
  return res.status(200).send(buf);
}

// ── P5: one learner, PM view ───────────────────────────────────────────────
// GET /api/lms/teacher/pm/learner?email=
async function learnerBoard(req, res) {
  const email = String(req.query.email || '').trim();
  const found = await rosterRowFor(req.admin, email);
  if (!found) return bad(res, 404, 'This learner is not in your batches.');
  const { row, batch } = found;
  const account = await M('Admin').findOne({ removed: false, email: rxEq(row.email), role: 'Student' }).select('_id name email').lean();
  const course = row.course ? await M('Course').findOne({ removed: false, title: row.course }).select('_id title').lean() : null;
  const engine = require('../../../../services/lms/eligibilityEngine');
  const elig = account && course ? await engine.evaluate(account._id, course._id).catch(() => null) : null;

  const [attendance, attempts, projects, acks, feedback, doubts, notes] = await Promise.all([
    M('LmsLiveSession').find({ removed: false, batchName: row.batch, status: { $in: ENDED } }).select('title actualStart scheduledStart participants.crmUser participants.attendanceStatus participants.totalDurationMin').sort({ scheduledStart: -1 }).limit(60).lean(),
    M('AssessmentAttempt').find({ candidateEmail: rxEq(row.email) }).select('testType status score totalCount qualified startedAt submittedAt warningCount').sort({ startedAt: -1 }).limit(30).lean(),
    account ? M('Project').find({ removed: false, student: account._id }).select('title submissions status dueDate milestones').lean() : [],
    account ? M('PolicyAcknowledgement').find({ removed: false, student: account._id }).select('policyTitle policyVersion status acknowledgedAt').lean() : [],
    account ? M('WeeklyFeedback').find({ student: account._id }).select('kind weekKey created late').sort({ created: -1 }).limit(20).lean() : [],
    account ? M('Doubt').find({ removed: { $ne: true }, student: account._id }).sort({ created: -1 }).limit(20).lean() : [],
    M('LmsLearnerNote').find({ removed: false, email: lc(row.email) }).sort({ created: -1 }).limit(20).lean(),
  ]);

  const events = [];
  attendance.forEach((sn) => {
    const p = account ? (sn.participants || []).find((x) => x.crmUser && String(x.crmUser) === String(account._id)) : null;
    const st = (p && p.attendanceStatus) || 'ABSENT';
    events.push({ at: sn.actualStart || sn.scheduledStart, kind: 'attendance', title: `${st.charAt(0) + st.slice(1).toLowerCase()} · ${sn.title}${p && p.totalDurationMin ? ` · ${p.totalDurationMin} min` : ''}`, src: 'live class', tone: st === 'ABSENT' ? 'red' : st === 'PRESENT' ? 'green' : 'amber' });
  });
  attempts.forEach((a) => events.push({ at: a.submittedAt || a.startedAt, kind: 'assessment', title: `${TEST_LABEL[a.testType] || a.testType} · ${a.status === 'SUBMITTED' ? `${a.score}/${a.totalCount}${a.qualified ? ' qualified' : ''}` : a.status.toLowerCase().replace('_', ' ')}`, src: 'assessment', tone: 'indigo' }));
  projects.forEach((p) =>
    (p.submissions || []).forEach((s) => {
      events.push({ at: s.submittedAt, kind: 'project', title: `${p.title} · v${s.version} submitted`, src: 'project', tone: 'orange' });
      if (s.review && s.review.at) events.push({ at: s.review.at, kind: 'project', title: `${p.title} · ${String(s.review.decision || '').replace('_', ' ')}`, src: `review by ${s.review.byName || 'PM'}`, tone: 'orange' });
    })
  );
  acks.forEach((a) => a.acknowledgedAt && events.push({ at: a.acknowledgedAt, kind: 'policy', title: `${a.policyTitle} v${a.policyVersion} accepted`, src: 'policy', tone: 'green' }));
  feedback.forEach((f) => events.push({ at: f.created, kind: 'feedback', title: `${f.kind === 'pm' ? 'PM' : 'Weekly'} feedback ${f.weekKey}${f.late ? ' (late)' : ''}`, src: 'feedback · content private', tone: 'slate' }));
  doubts.forEach((d) => events.push({ at: d.created, kind: 'doubt', title: `Doubt: ${d.title}`, src: d.status, tone: 'cyan' }));
  events.sort((a, b) => new Date(b.at) - new Date(a.at));

  const openProject = projects.find((p) => !['approved', 'rejected'].includes(p.status));
  const overdueMs = openProject && openProject.dueDate ? Date.now() - new Date(openProject.dueDate).getTime() : 0;
  return ok(res, {
    learner: {
      name: row.name,
      enrollmentId: row.enrollmentId || '',
      batch: row.batch,
      course: row.course,
      status: row.status,
      pm: batch && batch.trainer,
      email: row.email,
      contact: [maskEmail(row.email), maskPhone(row.phone)].filter(Boolean).join(' · '),
      attendancePct: row.attendancePct || 0,
    },
    eligibility: elig ? { score: elig.score, threshold: elig.threshold, eligible: elig.eligible, state: elig.state, items: elig.items || [], missing: elig.missing, calculatedAt: new Date() } : null,
    project: openProject ? { title: openProject.title, status: openProject.status, overdueDays: overdueMs > 0 ? Math.floor(overdueMs / DAY) : 0 } : null,
    events: events.slice(0, 120),
    doubts: doubts.map((d) => ({ id: String(d._id), title: d.title, status: d.status, created: d.created, replyCount: (d.replies || []).length })),
    notes: notes.map((n) => ({ id: String(n._id), text: n.text, byName: n.byName, created: n.created })),
  });
}

// POST /api/lms/teacher/pm/learner/notes { email, text }
async function learnerNoteAdd(req, res) {
  const b = req.body || {};
  const text = String(b.text || '').trim();
  if (text.length < 2) return bad(res, 400, 'Write the note.');
  const found = await rosterRowFor(req.admin, b.email);
  if (!found) return bad(res, 404, 'This learner is not in your batches.');
  const doc = await M('LmsLearnerNote').create({ email: lc(found.row.email), batch: found.row.batch, text: text.slice(0, 2000), by: req.admin._id, byName: req.admin.name });
  return ok(res, { id: String(doc._id), text: doc.text, byName: doc.byName, created: doc.created }, 'Note saved.');
}

// POST /api/lms/teacher/pm/learner/attendance-review { email, note }
// "Support Manager ko attendance review request" — an Attendance dispute in
// the Ops approvals queue; the PM never edits attendance directly.
async function attendanceReviewRequest(req, res) {
  const b = req.body || {};
  const note = String(b.note || '').trim();
  if (note.length < 5) return bad(res, 400, 'Say which classes and why.');
  const found = await rosterRowFor(req.admin, b.email);
  if (!found) return bad(res, 404, 'This learner is not in your batches.');
  const dup = await M('LmsApproval').findOne({ removed: false, type: 'Attendance dispute', status: 'pending', learnerName: found.row.name, scope: found.row.batch }).lean();
  if (dup) return bad(res, 409, 'A review request for this learner is already pending.');
  const doc = await M('LmsApproval').create({
    type: 'Attendance dispute',
    detail: `attendance ${found.row.attendancePct || 0}%`,
    learnerName: found.row.name,
    scope: found.row.batch,
    evidence: `PM ${req.admin.name}: ${note.slice(0, 900)}`,
    requestedBy: req.admin._id,
    requestedByName: req.admin.name,
    requestedByRole: req.admin.role,
  });
  await audit.record({ module: 'approval', action: 'request', entityType: 'LmsApproval', entityId: doc._id, admin: req.admin, reason: note.slice(0, 300), after: { type: doc.type, learner: doc.learnerName } });
  return ok(res, { id: String(doc._id), status: doc.status }, 'Sent to Support / Ops for review.');
}

// ── P8: extension requests the learners raised (Support → Project) ─────────
// GET /api/lms/teacher/pm/extensions
async function extensionList(req, res) {
  const batches = await myBatches(req.admin);
  const roster = batches.length ? await M('Student').find({ removed: false, batch: { $in: batches.map((b) => b.name) } }).select('email batch name').lean() : [];
  const emails = roster.map((r) => lc(r.email)).filter(Boolean);
  if (!emails.length) return ok(res, []);
  const tickets = await M('Ticket').find({ removed: false, subject: /^Project extension request/i, raisedByEmail: { $in: emails.map((e) => rxEq(e)) } }).sort({ created: -1 }).limit(50).lean();
  const sent = await M('LmsApproval').find({ removed: false, ref: { $in: tickets.map((t) => String(t._id)) } }).select('ref status').lean();
  const sentBy = new Map(sent.map((s) => [s.ref, s.status]));
  return ok(
    res,
    tickets.map((t) => ({
      id: String(t._id),
      learner: t.raisedByName || t.raisedByEmail,
      batch: (roster.find((r) => lc(r.email) === lc(t.raisedByEmail)) || {}).batch || '',
      subject: t.subject,
      reference: t.reference || '',
      description: t.description || '',
      status: t.status,
      created: t.created,
      sentToOps: sentBy.get(String(t._id)) || null,
    }))
  );
}

// POST /api/lms/teacher/pm/extensions/:id/send — "Send to Ops": a Deadline
// extension request in the Operations approvals queue (A1). The PM never
// decides it; Ops does.
async function extensionSend(req, res) {
  if (!mongoose.isValidObjectId(req.params.id)) return bad(res, 404, 'Request not found.');
  const t = await M('Ticket').findOne({ _id: req.params.id, removed: false }).lean();
  if (!t || !/^Project extension request/i.test(t.subject || '')) return bad(res, 404, 'Request not found.');
  const found = await rosterRowFor(req.admin, t.raisedByEmail);
  if (!found) return bad(res, 403, 'This learner is not in your batches.');
  const dup = await M('LmsApproval').findOne({ removed: false, ref: String(t._id) }).lean();
  if (dup) return bad(res, 409, 'Already sent to Ops.');
  const evidence = `${t.description || ''}`.trim() || t.subject;
  const doc = await M('LmsApproval').create({
    type: 'Deadline extension',
    detail: String(t.reference || t.subject.replace(/^Project extension request\s*·\s*/i, '')).slice(0, 200),
    learnerName: String(t.raisedByName || found.row.name || '').slice(0, 120),
    scope: found.row.batch,
    evidence: `${evidence.slice(0, 900)} (learner ticket, forwarded by PM ${req.admin.name})`,
    requestedBy: req.admin._id,
    requestedByName: req.admin.name,
    requestedByRole: req.admin.role,
    ref: String(t._id),
  });
  await audit.record({ module: 'approval', action: 'request', entityType: 'LmsApproval', entityId: doc._id, admin: req.admin, reason: 'extension forwarded from learner ticket', after: { type: doc.type, learner: doc.learnerName, ticket: String(t._id) } });
  return ok(res, { id: String(doc._id), status: doc.status }, 'Sent to Ops for a decision.');
}

// ── P9: candidates with the numbers explained ──────────────────────────────
// GET /api/lms/teacher/pm/candidates?batch=
async function candidatesBoard(req, res) {
  const batches = await myBatches(req.admin);
  const batch = await pickBatch(batches, req.query.batch);
  if (!batch) return ok(res, { batches: [], batch: null, rows: [], kpis: null });
  const roster = await M('Student').find({ removed: false, batch: batch.name }).select('name email enrollmentId status attendancePct progress').lean();
  const emails = roster.map((r) => lc(r.email)).filter(Boolean);
  const accounts = emails.length ? await M('Admin').find({ removed: false, role: 'Student', email: { $in: emails.map((e) => rxEq(e)) } }).select('_id email').lean() : [];
  const accByEmail = new Map(accounts.map((a) => [lc(a.email), a]));
  const now = new Date();
  const dayStart = new Date(now);
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(dayStart.getTime() + DAY);

  const [att, attempts, projects, feedback, todays, lastClass] = await Promise.all([
    // the live-class engine is the attendance source of truth (it also
    // writes Student.attendancePct from these same participant rows)
    M('LmsLiveSession').find({ removed: false, batchName: batch.name, status: { $in: ENDED } }).select('scheduledStart participants.crmUser participants.attendanceStatus participants.role').sort({ scheduledStart: 1 }).lean(),
    emails.length ? M('AssessmentAttempt').find({ candidateEmail: { $in: emails.map((e) => rxEq(e)) } }).select('candidateEmail testType status score totalCount qualified startedAt').lean() : [],
    accounts.length ? M('Project').find({ removed: false, student: { $in: accounts.map((a) => a._id) } }).select('student title status dueDate milestones currentVersion').lean() : [],
    accounts.length ? M('WeeklyFeedback').find({ student: { $in: accounts.map((a) => a._id) }, kind: { $ne: 'pm' } }).select('student weekKey').lean() : [],
    M('LmsLiveSession').find({ removed: false, batchName: batch.name, scheduledStart: { $gte: dayStart, $lt: dayEnd }, status: { $ne: 'cancelled' } }).select('status actualStart').lean(),
    M('LmsLiveSession').findOne({ removed: false, batchName: batch.name, actualStart: { $ne: null } }).sort({ actualStart: -1 }).select('title participants sessionIndex').lean(),
  ]);
  const settings = await assessmentSettings.get();
  const attBy = new Map();
  accounts.forEach((acc) => {
    const uid = String(acc._id);
    let total = 0;
    let attended = 0;
    // count from the learner's first class in this batch (mid-batch joiners
    // aren't charged for classes held before they were enrolled)
    const first = att.findIndex((sn) => (sn.participants || []).some((x) => x.crmUser && String(x.crmUser) === uid));
    if (first < 0) return attBy.set(lc(acc.email), { total: 0, attended: 0 });
    att.slice(first).forEach((sn) => {
      const p = (sn.participants || []).find((x) => x.crmUser && String(x.crmUser) === uid);
      if (p && p.attendanceStatus === 'EXCUSED') return;
      total += 1;
      if (p && ['PRESENT', 'LATE', 'PARTIAL'].includes(p.attendanceStatus)) attended += 1;
    });
    attBy.set(lc(acc.email), { total, attended });
  });
  const typesHeld = [...new Set(attempts.map((a) => a.testType))];
  const weeks = [...new Set(feedback.map((f) => f.weekKey))].sort();
  const latestWeek = weeks[weeks.length - 1] || null;

  const rows = roster.map((r) => {
    const acc = accByEmail.get(lc(r.email));
    const a = attBy.get(lc(r.email)) || { total: 0, attended: 0 };
    const mine = attempts.filter((x) => lc(x.candidateEmail) === lc(r.email));
    const qualifiedTypes = new Set(mine.filter((x) => x.qualified === true || (x.qualified == null && x.status === 'SUBMITTED' && x.totalCount && x.score / x.totalCount >= settings.qualifyThreshold)).map((x) => x.testType));
    const p = acc ? projects.find((x) => String(x.student) === String(acc._id)) : null;
    let project = '—';
    if (p) {
      const ms = (p.milestones || []).findIndex((m) => m.status !== 'done');
      const label = ms >= 0 ? `M${ms + 1}` : p.title;
      const late = p.dueDate && new Date(p.dueDate) < now && !['approved', 'rejected'].includes(p.status);
      project = `${label} ${late ? 'overdue' : p.status === 'submitted' || p.status === 'in_review' ? 'in review' : p.status.replace('_', ' ')}`;
    }
    const fWeeks = acc ? new Set(feedback.filter((f) => String(f.student) === String(acc._id)).map((f) => f.weekKey)) : new Set();
    const missing = weeks.filter((w) => !fWeeks.has(w)).length;
    const pct = r.attendancePct || 0; // duration-weighted average, same number the rest of the LMS gates on
    return {
      name: r.name,
      email: r.email,
      enrollmentId: r.enrollmentId || '',
      status: r.status,
      classes: { attended: a.attended, scheduled: a.total },
      attendancePct: pct,
      tests: { qualified: qualifiedTypes.size, of: typesHeld.length },
      project,
      projectOverdue: /overdue/.test(project),
      feedback: !weeks.length ? '—' : missing === 0 ? 'current' : missing === 1 && !fWeeks.has(latestWeek) ? `${latestWeek} pending` : `${missing} missing`,
    };
  });
  const enrolled = roster.filter((r) => r.status !== 'Dropped');
  const joined = lastClass ? (lastClass.participants || []).filter((x) => x.role === 'student' && x.present).length : null;
  const latestType = attempts.slice().sort((x, y) => new Date(y.startedAt) - new Date(x.startedAt))[0];
  const latestTypeAttempted = latestType ? new Set(attempts.filter((x) => x.testType === latestType.testType).map((x) => lc(x.candidateEmail))).size : 0;
  return ok(res, {
    batches: batches.map((b) => b.name),
    batch: batch.name,
    rows,
    kpis: {
      today: { held: todays.filter((c) => c.actualStart).length, scheduled: todays.length },
      lastClass: lastClass ? { title: lastClass.title, joined, enrolled: enrolled.length } : null,
      test: latestType ? { label: TEST_LABEL[latestType.testType] || latestType.testType, pct: enrolled.length ? Math.round((latestTypeAttempted / enrolled.length) * 100) : 0 } : null,
      atRisk: rows.filter((r) => r.status !== 'Dropped' && (r.attendancePct < 80 || r.projectOverdue)).length,
    },
  });
}

// POST /api/lms/teacher/pm/announce { batch, text } — "Quick announcement".
// Announcements are management-only (engagement.js#createAnnouncement), so a
// PM's quick announcement goes to Ops as a "Mass message" request (two-person
// rule, A1) instead of being sent directly.
async function announceRequest(req, res) {
  const b = req.body || {};
  const text = String(b.text || '').trim();
  if (text.length < 5) return bad(res, 400, 'Write the announcement.');
  const batches = await myBatches(req.admin);
  const scope = b.batch ? batches.find((x) => x.name === b.batch) : null;
  if (b.batch && !scope) return bad(res, 403, 'Not your batch.');
  if (!batches.length) return bad(res, 403, 'You have no batches.');
  const doc = await M('LmsApproval').create({
    type: 'Mass message',
    detail: text.slice(0, 200),
    scope: scope ? scope.name : batches.map((x) => x.name).join(', ').slice(0, 120),
    evidence: `Announcement requested by PM ${req.admin.name}: ${text.slice(0, 900)}`,
    payload: { text: text.slice(0, 4000), batches: scope ? [scope.name] : batches.map((x) => x.name) },
    highRisk: true,
    requestedBy: req.admin._id,
    requestedByName: req.admin.name,
    requestedByRole: req.admin.role,
  });
  await audit.record({ module: 'approval', action: 'request', entityType: 'LmsApproval', entityId: doc._id, admin: req.admin, reason: 'PM quick announcement', after: { type: doc.type, scope: doc.scope } });
  return ok(res, { id: String(doc._id), status: doc.status }, 'Sent to Ops — it goes out once approved.');
}

module.exports = {
  _myBatches: myBatches,
  announceRequest,
  recordingToggle,
  classBoard,
  saveDelivery,
  curriculumBoard,
  linkCheck,
  assessBoard,
  assessVerify,
  assessExport,
  learnerBoard,
  learnerNoteAdd,
  attendanceReviewRequest,
  extensionList,
  extensionSend,
  candidatesBoard,
  _h: { isPrivateIp, checkUrl, myBatches },
};
