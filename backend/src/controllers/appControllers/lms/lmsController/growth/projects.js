const mongoose = require('mongoose');
const A = require('../../../../../services/lms/growth/access');
const P = require('../../../../../services/lms/growth/projects');
const S = require('../../../../../services/lms/growth/score360');

// Project Allocation & Tracking (Figma 2A–2G).
//   admin / mentor  : briefs (2A), allocate (2B), dashboard (2D), review / override / re-allocate (2E)
//   learner         : my projects, live timer, draft, submit, extension request (2C)
//   support         : extension & notification desk — nudge mentor, notify, request re-allocation (2F)
//   everyone        : 2G automation stats

const M = (n) => mongoose.model(n);
const ok = (res, result, message) => res.status(200).json({ success: true, result, message });
const bad = (res, code, message) => res.status(code).json({ success: false, result: null, message });
const H = 3600 * 1000;
const str = (v, n = 500) => String(v == null ? '' : v).trim().slice(0, n);
const url = (v) => {
  const s = str(v, 400);
  return !s || /^https?:\/\//i.test(s) ? s : `https://${s}`;
};
const canAuthor = (a) => A.isAdmin(a) || A.isTeacher(a);
const crmBase = () => require('../../../../../services/lms').lmsConfig.meeting.crmBaseUrl.replace(/\/+$/, '');

// ── shaping ──
function pub(a, now = new Date()) {
  return {
    id: String(a._id),
    brief: String(a.brief),
    title: a.briefTitle,
    stack: a.stack,
    difficulty: a.difficulty,
    mode: a.mode,
    learner: a.learner ? String(a.learner) : null,
    learnerName: a.learnerName,
    members: (a.members || []).map(String),
    memberNames: a.memberNames || [],
    groupName: a.groupName,
    batch: a.batch,
    mentor: a.mentor ? String(a.mentor) : null,
    mentorName: a.mentorName,
    allocatedByName: a.allocatedByName,
    status: a.status,
    allocatedAt: a.allocatedAt,
    startAt: a.startAt,
    startedAt: a.startedAt,
    deadline: a.deadline,
    originalDeadline: a.originalDeadline,
    submittedAt: a.submittedAt,
    timeTakenMs: a.timeTakenMs,
    locked: isLocked(a, now),
    deliverablesDone: a.deliverablesDone || [],
    draft: a.draft || null,
    submission: a.submission && a.submission.at ? a.submission : null,
    submissions: a.submissions || [],
    extension: a.extension || { status: 'none' },
    review: a.review && (a.review.score != null || a.review.feedback) ? a.review : null,
    resubmit: a.resubmit || null,
    reallocation: a.reallocation || { status: 'none' },
    remindersSent: a.remindersSent || {},
    timeline: (a.timeline || []).slice(-30),
    audit: (a.audit || []).slice(-20),
    notices: (a.notices || []).slice(-20),
  };
}

function isLocked(a, now = new Date()) {
  if (['submitted', 'under_review', 'qualified', 'disqualified'].includes(a.status)) return true;
  if (a.status === 'not_qualified') return !(a.resubmit && a.resubmit.allowed && a.resubmit.deadline && new Date(a.resubmit.deadline) > now);
  if (a.allowLate) return false; // brief rule: late submissions accepted (marked late)
  return !!(a.deadline && new Date(a.deadline) <= now);
}

async function mineFilter(admin) {
  if (A.isManager(admin)) return {};
  if (A.isTeacher(admin)) {
    const batches = (await A.mentorBatches(admin)).map((b) => b.name);
    return { $or: [{ mentor: admin._id }, { allocatedBy: admin._id }, { batch: { $in: batches } }] };
  }
  return { $or: [{ learner: admin._id }, { members: admin._id }] };
}

async function loadAlloc(req, res, { manage = false, learnerOk = true } = {}) {
  if (!mongoose.isValidObjectId(req.params.id)) {
    bad(res, 400, 'Bad id.');
    return null;
  }
  const a = await M('LmsProjectAllocation').findOne({ _id: req.params.id, removed: false });
  if (!a) {
    bad(res, 404, 'Project allocation not found.');
    return null;
  }
  const me = String(req.admin._id);
  const isMember = String(a.learner) === me || (a.members || []).map(String).includes(me);
  let allowed = false;
  if (A.isAdmin(req.admin)) allowed = true;
  else if (A.isSupport(req.admin)) allowed = !manage;
  else if (A.isTeacher(req.admin)) {
    const batches = (await A.mentorBatches(req.admin)).map((b) => b.name);
    allowed = String(a.mentor) === me || String(a.allocatedBy) === me || batches.includes(a.batch);
  } else allowed = learnerOk && isMember && !manage;
  if (!allowed) {
    bad(res, 403, 'Not your project.');
    return null;
  }
  return { a, isMember };
}

const pushScore = async (a) => {
  for (const id of P.recipientsOf(a)) {
    // eslint-disable-next-line no-await-in-loop
    const r = await S.compute(id).catch(() => null);
    // eslint-disable-next-line no-await-in-loop
    if (r) await S.saveSnapshot(r).catch(() => {});
  }
};

// ── 2A briefs ──
function briefFromBody(b) {
  const lv = (v, d) => (P.LEVELS.includes(v) ? v : d);
  const rubric = Array.isArray(b.rubric)
    ? b.rubric
        .map((r) => ({ criterion: str(r.criterion, 120), lookFor: str(r.lookFor, 240), max: Math.max(0, Math.round(Number(r.max) || 0)) }))
        .filter((r) => r.criterion && r.max > 0)
    : undefined;
  const out = {
    title: str(b.title, 160),
    description: str(b.description, 6000),
    difficulty: lv(b.difficulty, 'intermediate'),
    track: str(b.track, 200),
    skillLevel: lv(b.skillLevel, 'intermediate'),
    stack: Array.isArray(b.stack) ? [...new Set(b.stack.map((s) => str(s, 40)).filter(Boolean))].slice(0, 20) : [],
    deliverables: Array.isArray(b.deliverables) ? b.deliverables.map((s) => str(s, 200)).filter(Boolean).slice(0, 20) : [],
    passScore: Math.max(0, Math.min(100, Math.round(Number(b.passScore) || 60))),
    resubmissions: { allowed: Math.max(0, Math.min(5, Math.round(Number(b.resubmissions && b.resubmissions.allowed) || 0))), withinDays: Math.max(1, Math.min(30, Math.round(Number(b.resubmissions && b.resubmissions.withinDays) || 3))) },
    timerStart: b.timerStart === 'startDate' ? 'startDate' : 'allocation',
    startDate: b.startDate ? new Date(b.startDate) : null,
    deadline: b.deadline ? new Date(b.deadline) : null,
    durationDays: b.durationDays ? Math.max(1, Math.min(180, Math.round(Number(b.durationDays)))) : null,
    reminders: { h48: b.reminders ? b.reminders.h48 !== false : true, h24: b.reminders ? b.reminders.h24 !== false : true, h1: b.reminders ? b.reminders.h1 !== false : true, customH: b.reminders && Number(b.reminders.customH) > 0 ? Math.round(Number(b.reminders.customH)) : null },
    channels: { email: b.channels ? b.channels.email !== false : true, inApp: b.channels ? b.channels.inApp !== false : true, whatsapp: !!(b.channels && b.channels.whatsapp) },
    rules: {
      lockAfterDeadline: b.rules ? b.rules.lockAfterDeadline !== false : true,
      autoDisqualify: b.rules ? b.rules.autoDisqualify !== false : true,
      allowExtension: b.rules ? b.rules.allowExtension !== false : true,
      allowGroups: !!(b.rules && b.rules.allowGroups),
    },
  };
  if (rubric) out.rubric = rubric;
  if (Array.isArray(b.resources)) out.resources = b.resources.filter((r) => r && r.url).map((r) => ({ name: str(r.name, 160), url: url(r.url), size: Number(r.size) || 0, kind: str(r.kind, 20) }));
  return out;
}

function checkBrief(x, publishing) {
  if (!x.title) return 'Give the project a title.';
  if (!publishing) return null;
  if (!x.description) return 'Add a description.';
  if (!x.rubric || !x.rubric.length) return 'Add at least one rubric criterion.';
  const tot = x.rubric.reduce((s, r) => s + r.max, 0);
  if (tot !== 100) return `Rubric points must total 100 (now ${tot}).`;
  if (!x.deadline && !x.durationDays) return 'Set a deadline (date & time) or a number of days.';
  if (x.deadline && x.deadline < new Date() && !x.durationDays) return 'The deadline is in the past.';
  if (x.timerStart === 'startDate' && !x.startDate) return 'Pick the start date, or start the timer on allocation.';
  return null;
}

// GET /projects/briefs
async function listBriefs(req, res) {
  if (!A.isManager(req.admin) && !A.isTeacher(req.admin)) return bad(res, 403, 'Not allowed.');
  const rows = await M('LmsProjectBrief').find({ removed: false }).sort({ updated: -1 }).limit(300).lean();
  const counts = await M('LmsProjectAllocation').aggregate([{ $match: { removed: false } }, { $group: { _id: '$brief', n: { $sum: 1 } } }]);
  const by = new Map(counts.map((c) => [String(c._id), c.n]));
  return ok(res, rows.map((b) => ({ ...b, id: String(b._id), allocations: by.get(String(b._id)) || 0 })));
}

// GET /projects/briefs/:id
async function getBrief(req, res) {
  if (!A.isManager(req.admin) && !A.isTeacher(req.admin)) return bad(res, 403, 'Not allowed.');
  const b = await M('LmsProjectBrief').findOne({ _id: req.params.id, removed: false }).lean();
  if (!b) return bad(res, 404, 'Project not found.');
  return ok(res, { ...b, id: String(b._id) });
}

// POST /projects/briefs  ·  PUT /projects/briefs/:id   { …, publish }
async function saveBrief(req, res) {
  if (!canAuthor(req.admin)) return bad(res, 403, 'Only an admin or a mentor can create projects.');
  const x = briefFromBody(req.body || {});
  const publishing = !!(req.body && req.body.publish);
  const err = checkBrief(x, publishing);
  if (err) return bad(res, 400, err);
  if (publishing) x.status = 'published';
  x.updated = new Date();
  let row;
  if (req.params.id) {
    row = await M('LmsProjectBrief').findOneAndUpdate({ _id: req.params.id, removed: false }, { $set: x }, { new: true }).lean();
    if (!row) return bad(res, 404, 'Project not found.');
  } else {
    row = (await M('LmsProjectBrief').create({ ...x, status: publishing ? 'published' : 'draft', createdBy: req.admin._id, createdByName: req.admin.name })).toObject();
  }
  return ok(res, { ...row, id: String(row._id) }, publishing ? 'Saved — now allocate it' : 'Draft saved');
}

// DELETE /projects/briefs/:id  (archive)
async function archiveBrief(req, res) {
  if (!canAuthor(req.admin)) return bad(res, 403, 'Not allowed.');
  await M('LmsProjectBrief').updateOne({ _id: req.params.id }, { $set: { status: 'archived', updated: new Date() } });
  return ok(res, null, 'Archived');
}

// POST /projects/upload  (multipart "file") — resources & submission files
async function uploadFile(req, res) {
  if (!req.body.file) return bad(res, 400, 'No file received.');
  const f = req.files && req.files.file;
  let size = (f && f.size) || 0;
  if (!size) {
    try {
      size = require('fs').statSync(require('path').join(process.cwd(), 'src', req.body.file)).size;
    } catch (_) {
      size = 0;
    }
  }
  if (size > 50 * 1024 * 1024) return bad(res, 400, 'Max 50 MB per file.');
  const name = (f && f.name) || String(req.body.file).split('/').pop();
  return ok(res, { name, url: `${crmBase()}/${req.body.file}`, size, kind: (name.split('.').pop() || '').toLowerCase() });
}

// ── 2B allocate ──

// GET /projects/allocate/:briefId/candidates?batch=&minSkill=
async function candidates(req, res) {
  if (!canAuthor(req.admin) && !A.isSupport(req.admin)) return bad(res, 403, 'Not allowed.');
  const batches = await A.mentorBatches(req.admin);
  const names = batches.map((b) => b.name);
  const batch = req.query.batch && names.includes(req.query.batch) ? req.query.batch : names[0];
  const learners = batch ? await A.learnersOf([batch]) : [];
  const ids = learners.map((l) => l._id);
  const [lv, active, roster] = await Promise.all([
    P.skillLevels(ids),
    M('LmsProjectAllocation').aggregate([
      { $match: { removed: false, status: { $in: ['allocated', 'in_progress', 'submitted', 'under_review'] }, $or: [{ learner: { $in: ids } }, { members: { $in: ids } }] } },
      { $project: { who: { $setUnion: [['$learner'], { $ifNull: ['$members', []] }] } } },
      { $unwind: '$who' },
      { $group: { _id: '$who', n: { $sum: 1 } } },
    ]),
    M('Student').find({ removed: { $ne: true }, batch: A.rxEq(batch || '-') }).select('email course').lean(),
  ]);
  const act = new Map(active.map((x) => [String(x._id), x.n]));
  const courseOf = new Map(roster.map((r) => [String(r.email).toLowerCase(), r.course]));
  // learners with no score yet get one calculated now (light) so the skill column is real
  const missing = learners.filter((l) => !lv.get(String(l._id)));
  for (const l of missing.slice(0, 60)) {
    // eslint-disable-next-line no-await-in-loop
    const r = await S.compute(l._id, { light: true }).catch(() => null);
    // eslint-disable-next-line no-await-in-loop
    if (r) await S.saveSnapshot(r, { emit: false });
  }
  const lv2 = missing.length ? await P.skillLevels(ids) : lv;
  const already = req.params.briefId && mongoose.isValidObjectId(req.params.briefId) ? await M('LmsProjectAllocation').find({ brief: req.params.briefId, removed: false }).select('learner members status').lean() : [];
  const got = new Set(already.flatMap((a) => [a.learner, ...(a.members || [])].map(String)));
  return ok(res, {
    batches: names,
    batch,
    rows: learners.map((l) => {
      const s = lv2.get(String(l._id)) || {};
      return {
        id: String(l._id),
        name: l.name,
        track: courseOf.get(String(l.email).toLowerCase()) || '',
        skill: s.level || null,
        skillScore: s.score ?? null,
        active: act.get(String(l._id)) || 0,
        allocated: got.has(String(l._id)),
      };
    }),
  });
}

// POST /projects/allocate/:briefId
//  { mode:'individual'|'group'|'auto'|'bulk', learnerIds, groups:[{name, members}], batch,
//    rule:{ track, minSkill, on }, notify:{ email, inApp, copyMentor } }
async function allocateNow(req, res) {
  if (!canAuthor(req.admin)) return bad(res, 403, 'Only an admin or a mentor can allocate.');
  const brief = await M('LmsProjectBrief').findOne({ _id: req.params.briefId, removed: false });
  if (!brief) return bad(res, 404, 'Project not found.');
  const err = checkBrief(brief.toObject(), true);
  if (err) return bad(res, 400, `Finish the project first: ${err}`);
  const b = req.body || {};
  const mode = ['individual', 'group', 'auto', 'bulk'].includes(b.mode) ? b.mode : 'individual';
  const mine = (await A.mentorBatches(req.admin)).map((x) => x.name);
  if (b.batch && !mine.includes(b.batch)) return bad(res, 403, 'Not your batch.');
  let units = [];
  if (mode === 'individual') units = (b.learnerIds || []).filter(mongoose.isValidObjectId).map((id) => ({ members: [id] }));
  if (mode === 'group') {
    if (!brief.rules.allowGroups) return bad(res, 400, 'This project does not allow group submissions — turn it on in the project rules.');
    units = (b.groups || []).map((g, i) => ({ groupName: str(g.name, 40) || `Group ${String.fromCharCode(65 + i)}`, members: (g.members || []).filter(mongoose.isValidObjectId) })).filter((g) => g.members.length);
  }
  if (mode === 'bulk') {
    if (!b.batch) return bad(res, 400, 'Pick the batch.');
    units = (await A.learnersOf([b.batch])).map((l) => ({ members: [l._id] }));
  }
  if (mode === 'auto') {
    const rule = { batch: b.batch || '', track: str(b.rule && b.rule.track, 200), minSkill: P.LEVELS.includes(b.rule && b.rule.minSkill) ? b.rule.minSkill : 'beginner' };
    units = (await P.matchRule(rule)).map((l) => ({ members: [l._id] }));
    brief.autoRule = { on: !!(b.rule && b.rule.on !== false), ...rule };
  }
  if (!units.length) return bad(res, 400, 'Nobody to allocate — pick learners first.');
  if (brief.status !== 'published') brief.status = 'published';
  brief.updated = new Date();
  await brief.save();
  const created = await P.allocate(brief.toObject(), units, { by: req.admin, mode, batch: b.batch, notify: b.notify || { email: true, inApp: true, copyMentor: true } });
  const skipped = units.length - created.length;
  return ok(res, { created: created.length, skipped }, `Allocated to ${created.length} ${mode === 'group' ? 'group' : 'learner'}${created.length === 1 ? '' : 's'}${skipped ? ` · ${skipped} already had it` : ''} — notified`);
}

// ── 2D dashboard ──
// GET /projects/dashboard?batch=&brief=&status=&due=7
async function dashboard(req, res) {
  if (!A.isManager(req.admin) && !A.isTeacher(req.admin)) return bad(res, 403, 'Not allowed.');
  const base = { removed: false, ...(await mineFilter(req.admin)) };
  const q = { ...base };
  if (req.query.batch) q.batch = req.query.batch;
  if (req.query.brief && mongoose.isValidObjectId(req.query.brief)) q.brief = req.query.brief;
  if (req.query.status === 'extension') q['extension.status'] = 'pending';
  else if (req.query.status) q.status = req.query.status;
  if (req.query.due) q.deadline = { $gte: new Date(), $lte: new Date(Date.now() + Number(req.query.due) * 24 * H) };
  const AL = M('LmsProjectAllocation');
  const [rows, all, briefs, batches] = await Promise.all([
    AL.find(q).sort({ deadline: 1 }).limit(500).lean(),
    AL.find(base).select('status deadline submittedAt review extension brief batch created').lean(),
    M('LmsProjectBrief').find({ removed: false }).select('title status').lean(),
    A.mentorBatches(req.admin),
  ]);
  const now = Date.now();
  const cnt = (f) => all.filter(f).length;
  const decided = all.filter((a) => ['qualified', 'not_qualified', 'disqualified'].includes(a.status));
  const qual = decided.length ? Math.round((decided.filter((a) => a.status === 'qualified').length / decided.length) * 100) : null;
  const waiting = all.filter((a) => a.status === 'submitted' || a.status === 'under_review');
  const oldest = waiting.reduce((m, a) => (a.submittedAt && (!m || a.submittedAt < m) ? a.submittedAt : m), null);
  const mix = {};
  for (const a of all) mix[a.status] = (mix[a.status] || 0) + 1;
  mix.extension = cnt((a) => a.extension && a.extension.status === 'pending');
  const ext = rows.filter((a) => a.extension && a.extension.status === 'pending');
  const extAll = ext.length ? ext : await AL.find({ ...base, 'extension.status': 'pending' }).limit(20).lean();
  return ok(res, {
    serverNow: new Date(),
    kpis: {
      activeProjects: new Set(all.filter((a) => !['qualified', 'disqualified'].includes(a.status)).map((a) => String(a.brief))).size,
      allocations: all.length,
      awaitingReview: waiting.length,
      oldestDays: oldest ? Math.floor((now - new Date(oldest).getTime()) / (24 * H)) : null,
      due24: cnt((a) => P.OPEN.includes(a.status) && a.deadline && new Date(a.deadline) - now > 0 && new Date(a.deadline) - now <= 24 * H),
      disqualified: cnt((a) => a.status === 'disqualified'),
      qualificationRate: qual,
    },
    mix,
    rows: rows.map((a) => pub(a)),
    extensions: extAll.map((a) => pub(a)),
    briefs: briefs.map((b) => ({ id: String(b._id), title: b.title, status: b.status })),
    batches: batches.map((b) => b.name),
  });
}

// GET /projects/alloc/:id
async function getAlloc(req, res) {
  const ctx = await loadAlloc(req, res);
  if (!ctx) return;
  const brief = await M('LmsProjectBrief').findById(ctx.a.brief).lean();
  // the learner's first open moves Allocated → In Progress (2G)
  if (ctx.isMember && ctx.a.status === 'allocated' && (!ctx.a.startAt || ctx.a.startAt <= new Date())) {
    ctx.a.status = 'in_progress';
    ctx.a.startedAt = new Date();
    ctx.a.timeline.push(P.tl('You opened the project · status In Progress', 'sky', 'started'));
    await ctx.a.save();
  }
  return ok(res, { ...pub(ctx.a), brief: brief ? { ...brief, id: String(brief._id) } : null, serverNow: new Date() });
}

// ── 2C learner ──
// GET /projects/my
async function myProjects(req, res) {
  const rows = await M('LmsProjectAllocation')
    .find({ removed: false, $or: [{ learner: req.admin._id }, { members: req.admin._id }] })
    .sort({ deadline: -1 })
    .lean();
  return ok(res, { serverNow: new Date(), rows: rows.map((a) => pub(a)) });
}

// PUT /projects/my/:id/draft  { githubUrl, demoUrl, note, files, deliverablesDone }
async function saveDraft(req, res) {
  const ctx = await loadAlloc(req, res);
  if (!ctx) return;
  if (!ctx.isMember) return bad(res, 403, 'Only the learner can edit this.');
  const a = ctx.a;
  const b = req.body || {};
  if (Array.isArray(b.deliverablesDone)) a.deliverablesDone = b.deliverablesDone.map(Boolean);
  if (!isLocked(a)) {
    a.draft = {
      githubUrl: url(b.githubUrl),
      demoUrl: url(b.demoUrl),
      note: str(b.note, 2000),
      files: Array.isArray(b.files) ? b.files.filter((f) => f && f.url).map((f) => ({ name: str(f.name, 160), url: f.url, size: Number(f.size) || 0 })) : (a.draft && a.draft.files) || [],
      savedAt: new Date(),
    };
    const last = a.timeline[a.timeline.length - 1];
    if (!last || last.kind !== 'draft') a.timeline.push(P.tl('Draft saved (not submitted)', 'ind', 'draft'));
    else last.at = new Date();
  } else if (!Array.isArray(b.deliverablesDone)) return bad(res, 409, 'The submission is locked.');
  a.updated = new Date();
  await a.save();
  return ok(res, pub(a), 'Draft saved');
}

// POST /projects/my/:id/submit  { githubUrl, demoUrl, note, files }
async function submit(req, res) {
  const ctx = await loadAlloc(req, res);
  if (!ctx) return;
  if (!ctx.isMember) return bad(res, 403, 'Only the learner can submit.');
  const a = ctx.a;
  const now = new Date();
  if (a.startAt && a.startAt > now) return bad(res, 409, `The project starts ${P.fmt(a.startAt)}.`);
  const resubmitting = a.status === 'not_qualified' && a.resubmit && a.resubmit.allowed && a.resubmit.deadline && new Date(a.resubmit.deadline) > now;
  if (isLocked(a, now) && !resubmitting) return bad(res, 409, a.deadline && a.deadline <= now ? 'The deadline has passed — submission is locked.' : 'Already submitted.');
  const b = req.body || {};
  const sub = {
    githubUrl: url(b.githubUrl),
    demoUrl: url(b.demoUrl),
    note: str(b.note, 2000),
    files: Array.isArray(b.files) ? b.files.filter((f) => f && f.url).map((f) => ({ name: str(f.name, 160), url: f.url, size: Number(f.size) || 0 })) : [],
  };
  if (!sub.githubUrl && !sub.demoUrl && !sub.files.length) return bad(res, 400, 'Add your GitHub link, demo URL or a file.');
  const version = (a.submissions || []).length + 1;
  a.submissions.push({ version, ...sub, at: now, by: req.admin._id, byName: req.admin.name });
  a.submission = { version, githubUrl: sub.githubUrl, demoUrl: sub.demoUrl, files: sub.files, at: now };
  a.submittedAt = now;
  a.timeTakenMs = now - new Date(a.startAt || a.allocatedAt);
  a.status = 'submitted';
  a.lockedAt = now;
  if (resubmitting) a.resubmit = { ...a.resubmit, allowed: false, left: Math.max(0, (a.resubmit.left || 1) - 1) };
  a.draft = undefined;
  const late = a.deadline && now > a.deadline;
  a.timeline.push(P.tl(`Submitted v${version}${late ? ' (late)' : ''} · timer stopped`, late ? 'or' : 'ind', 'submitted'));
  a.updated = now;
  await a.save();
  await require('../../../../../services/lms/realtime').notify([a.mentor], {
    type: 'lms.project.submitted',
    title: `Submitted: ${a.briefTitle}`,
    body: `${a.groupName || a.learnerName} submitted v${version} — ready for review.`,
    link: '/teacher/project-dashboard',
  });
  return ok(res, pub(a), 'Submitted — your timer has stopped');
}

// POST /projects/my/:id/extension  { days, reason }
async function requestExtension(req, res) {
  const ctx = await loadAlloc(req, res);
  if (!ctx) return;
  if (!ctx.isMember) return bad(res, 403, 'Only the learner can ask.');
  const a = ctx.a;
  const brief = await M('LmsProjectBrief').findById(a.brief).select('rules').lean();
  if (brief && brief.rules && brief.rules.allowExtension === false) return bad(res, 400, 'Extensions are not allowed on this project.');
  if (!P.OPEN.includes(a.status)) return bad(res, 409, 'Extensions are only for projects still in progress.');
  if (a.extension && a.extension.status === 'pending') return bad(res, 409, 'You already have a request waiting for your mentor.');
  const days = Math.max(1, Math.min(14, Math.round(Number(req.body.days) || 0)));
  const reason = str(req.body.reason, 1000);
  if (reason.length < 5) return bad(res, 400, 'Write the reason.');
  a.extension = { status: 'pending', days, reason, requestedAt: new Date(), requestedBy: req.admin._id, nudges: [] };
  a.timeline.push(P.tl(`Extension requested · +${days} day${days === 1 ? '' : 's'}`, 'pk', 'extension'));
  a.updated = new Date();
  await a.save();
  await require('../../../../../services/lms/realtime').notify([a.mentor], {
    type: 'lms.project.extension',
    title: `Extension request: ${a.briefTitle}`,
    body: `${req.admin.name} asks for +${days} day(s): ${reason}`,
    link: '/teacher/project-dashboard',
  });
  return ok(res, pub(a), 'Request sent — your mentor decides');
}

// ── 2E mentor actions ──
// POST /projects/alloc/:id/extension  { decision:'approve'|'reject', days }
async function decideExtension(req, res) {
  const ctx = await loadAlloc(req, res, { manage: true, learnerOk: false });
  if (!ctx) return;
  if (!(A.isTeacher(req.admin) || A.isAdmin(req.admin))) return bad(res, 403, 'The mentor decides extensions (support can only nudge).');
  const a = ctx.a;
  if (!a.extension || a.extension.status !== 'pending') return bad(res, 409, 'No pending request.');
  const approve = req.body.decision === 'approve';
  const days = Math.max(1, Math.min(30, Math.round(Number(req.body.days) || a.extension.days || 1)));
  a.extension.status = approve ? 'approved' : 'rejected';
  a.extension.decidedAt = new Date();
  a.extension.decidedBy = req.admin._id;
  a.extension.decidedByName = req.admin.name;
  if (approve) {
    a.extension.grantedDays = days;
    const base = a.deadline && a.deadline > new Date() ? a.deadline : new Date();
    a.deadline = new Date(base.getTime() + days * 24 * H);
    // reminders for the new deadline
    a.remindersSent = {};
    a.disqualifiedAt = undefined;
    a.lockedAt = undefined;
    if (a.status === 'disqualified') a.status = 'in_progress';
    a.timeline.push(P.tl(`Extension approved by ${req.admin.name} · new deadline ${P.fmt(a.deadline)}`, 'ok', 'extension'));
  } else a.timeline.push(P.tl(`Extension rejected by ${req.admin.name}`, 'er', 'extension'));
  a.updated = new Date();
  await a.save();
  await P.notice(a, {
    kind: `extension-${approve ? 'approved' : 'rejected'}`,
    title: approve ? `Extension approved: ${a.briefTitle}` : `Extension not approved: ${a.briefTitle}`,
    body: approve ? `Your mentor approved +${days} day(s). New deadline ${P.fmt(a.deadline)} IST — your timer has resumed.` : `Your mentor did not approve the extension. The deadline stays ${P.fmt(a.deadline)} IST.`,
    toSupport: approve,
  });
  return ok(res, pub(a), approve ? 'Approved — deadline moved, learner notified' : 'Rejected — learner notified');
}

// POST /projects/alloc/:id/review  { scores:[{criterion, score}], feedback, publish, version }
async function review(req, res) {
  const ctx = await loadAlloc(req, res, { manage: true, learnerOk: false });
  if (!ctx) return;
  if (!(A.isTeacher(req.admin) || A.isAdmin(req.admin))) return bad(res, 403, 'Mentors and admins review.');
  const a = ctx.a;
  if (!a.submission || !a.submission.at) return bad(res, 409, 'Nothing submitted yet.');
  const brief = await M('LmsProjectBrief').findById(a.brief).lean();
  const rubric = (brief && brief.rubric) || [];
  const given = new Map((req.body.scores || []).map((s) => [s.criterion, Number(s.score)]));
  const scores = rubric.map((r) => ({ criterion: r.criterion, max: r.max, score: Math.max(0, Math.min(r.max, Math.round(given.get(r.criterion) || 0))) }));
  const max = scores.reduce((s, x) => s + x.max, 0) || 100;
  const score = Math.round((scores.reduce((s, x) => s + x.score, 0) / max) * 100);
  const pass = (brief && brief.passScore) || 60;
  const decision = score >= pass ? 'qualified' : 'not_qualified';
  const publish = !!req.body.publish;
  const now = new Date();
  a.review = { scores, score, decision, feedback: str(req.body.feedback, 4000), published: publish, at: now, by: req.admin._id, byName: req.admin.name, version: a.submission.version };
  if (!publish) {
    if (a.status === 'submitted') {
      a.status = 'under_review';
      a.timeline.push(P.tl(`Under review by ${req.admin.name}`, 'pu', 'review'));
    }
  } else {
    const from = a.status;
    a.status = decision;
    if (decision === 'not_qualified' && brief && brief.resubmissions && (a.resubmit ? a.resubmit.left : brief.resubmissions.allowed) > 0) {
      a.resubmit = { allowed: true, left: a.resubmit && a.resubmit.left != null ? a.resubmit.left : brief.resubmissions.allowed, deadline: new Date(now.getTime() + (brief.resubmissions.withinDays || 3) * 24 * H) };
    }
    a.timeline.push(P.tl(`Result published · ${score} / 100 → ${decision === 'qualified' ? 'Qualified' : 'Not Qualified'}`, decision === 'qualified' ? 'ok' : 'or', 'result'));
    a.audit.push({ at: now, byName: req.admin.name, from, to: decision, reason: `rubric ${score} / ${pass} pass` });
  }
  a.updated = now;
  await a.save();
  if (publish) {
    await P.notice(a, {
      kind: 'result',
      title: `Result: ${a.briefTitle} — ${decision === 'qualified' ? 'Qualified' : 'Not Qualified'} (${score}/100)`,
      body: `${req.admin.name} reviewed your project: ${score} / 100 (passing ${pass}).${a.review.feedback ? `\n\nFeedback: ${a.review.feedback}` : ''}${a.resubmit && a.resubmit.allowed ? `\n\nYou can resubmit until ${P.fmt(a.resubmit.deadline)} IST.` : ''}`,
    });
    await pushScore(a);
  }
  return ok(res, pub(a), publish ? 'Result published — Learner 360° project score updated' : 'Draft saved');
}

// POST /projects/alloc/:id/override  { status, reason }
async function override(req, res) {
  const ctx = await loadAlloc(req, res, { manage: true, learnerOk: false });
  if (!ctx) return;
  if (!(A.isTeacher(req.admin) || A.isAdmin(req.admin))) return bad(res, 403, 'Mentors and admins override.');
  const a = ctx.a;
  const to = String(req.body.status || '');
  if (!M('LmsProjectAllocation').STATUSES.includes(to)) return bad(res, 400, 'Pick a status.');
  const reason = str(req.body.reason, 1000);
  if (reason.length < 5) return bad(res, 400, 'A reason is required for every override.');
  const from = a.status;
  if (from === to) return bad(res, 400, 'It already has that status.');
  a.status = to;
  if (['allocated', 'in_progress'].includes(to)) {
    a.lockedAt = undefined;
    a.disqualifiedAt = undefined;
  }
  if (a.review && ['qualified', 'not_qualified'].includes(to)) {
    a.review.decision = to;
    a.review.published = true;
  }
  a.audit.push({ at: new Date(), byName: req.admin.name, from, to, reason });
  a.timeline.push(P.tl(`Status overridden by ${req.admin.name}: ${from} → ${to}`, 'ind', 'override'));
  a.updated = new Date();
  await a.save();
  await P.notice(a, { kind: 'override', title: `Project status changed: ${a.briefTitle}`, body: `${req.admin.name} changed the status to ${to.replace('_', ' ')}. Reason: ${reason}` });
  await pushScore(a);
  return ok(res, pub(a), 'Override applied and logged');
}

// POST /projects/alloc/:id/resubmit  { allow, deadline }
async function setResubmit(req, res) {
  const ctx = await loadAlloc(req, res, { manage: true, learnerOk: false });
  if (!ctx) return;
  if (!(A.isTeacher(req.admin) || A.isAdmin(req.admin))) return bad(res, 403, 'Mentors and admins only.');
  const a = ctx.a;
  if (a.status !== 'not_qualified') return bad(res, 409, 'Resubmission is for Not Qualified projects.');
  const allow = !!req.body.allow;
  const dl = req.body.deadline ? new Date(req.body.deadline) : new Date(Date.now() + 3 * 24 * H);
  if (allow && dl <= new Date()) return bad(res, 400, 'Pick a future deadline.');
  a.resubmit = { allowed: allow, left: Math.max(allow ? 1 : 0, (a.resubmit && a.resubmit.left) || 0), deadline: allow ? dl : null };
  a.timeline.push(P.tl(allow ? `Resubmission allowed until ${P.fmt(dl)}` : 'Resubmission turned off', allow ? 'wa' : 'mut', 'resubmit'));
  a.audit.push({ at: new Date(), byName: req.admin.name, from: 'not_qualified', to: allow ? 'resubmit allowed' : 'resubmit off', reason: 'mentor decision' });
  await a.save();
  if (allow) await P.notice(a, { kind: 'resubmit', title: `You can resubmit: ${a.briefTitle}`, body: `Your mentor allowed a resubmission until ${P.fmt(dl)} IST.` });
  return ok(res, pub(a), allow ? 'Resubmission allowed — learner notified' : 'Saved');
}

// POST /projects/alloc/:id/reallocate  { deadline }
async function reallocate(req, res) {
  const ctx = await loadAlloc(req, res, { manage: true, learnerOk: false });
  if (!ctx) return;
  if (!(A.isTeacher(req.admin) || A.isAdmin(req.admin))) return bad(res, 403, 'Mentors and admins re-allocate (support can request it).');
  const a = ctx.a;
  if (!['disqualified', 'not_qualified'].includes(a.status)) return bad(res, 409, 'Only disqualified or not-qualified projects can be re-allocated.');
  const dl = req.body.deadline ? new Date(req.body.deadline) : null;
  if (!dl || dl <= new Date()) return bad(res, 400, 'Pick the new deadline.');
  const now = new Date();
  const from = a.status;
  Object.assign(a, {
    status: 'allocated',
    startAt: now,
    allocatedAt: now,
    deadline: dl,
    startedAt: undefined,
    submittedAt: undefined,
    timeTakenMs: undefined,
    lockedAt: undefined,
    disqualifiedAt: undefined,
    remindersSent: {},
    review: undefined,
    resubmit: { allowed: false, left: 0 },
    extension: { status: 'none' },
  });
  a.reallocation = { ...(a.reallocation || {}), status: 'done', doneAt: now, count: ((a.reallocation && a.reallocation.count) || 0) + 1 };
  a.audit.push({ at: now, byName: req.admin.name, from, to: 'allocated', reason: `re-allocated, new deadline ${P.fmt(dl)}` });
  a.timeline.push(P.tl(`Re-allocated by ${req.admin.name} · timer restarted · deadline ${P.fmt(dl)}`, 'sky', 'reallocated'));
  a.updated = now;
  await a.save();
  await P.notice(a, { kind: 'reallocated', title: `Project re-allocated: ${a.briefTitle}`, body: `You have another chance. Your timer has restarted — new deadline ${P.fmt(dl)} IST.`, toSupport: true });
  return ok(res, pub(a), 'Re-allocated — timer restarted, learner notified');
}

// POST /projects/alloc/:id/remind — mentor / support manual reminder
async function remind(req, res) {
  const ctx = await loadAlloc(req, res, { learnerOk: false });
  if (!ctx) return;
  const a = ctx.a;
  if (!P.OPEN.includes(a.status)) return bad(res, 409, 'Only open projects get reminders.');
  a.timeline.push(P.tl(`Reminder sent by ${req.admin.name}`, 'wa', 'reminder'));
  await a.save();
  await P.notice(a, { kind: 'reminder-manual', title: `Reminder: ${a.briefTitle}`, body: `${req.admin.name} reminds you — "${a.briefTitle}" is due ${P.fmt(a.deadline)} IST.` });
  return ok(res, pub(a), 'Reminder sent');
}

// ── 2F support ──
// POST /projects/alloc/:id/nudge — support reminds the mentor about a pending extension
async function nudge(req, res) {
  const ctx = await loadAlloc(req, res, { learnerOk: false });
  if (!ctx) return;
  const a = ctx.a;
  if (!a.extension || a.extension.status !== 'pending') return bad(res, 409, 'No pending extension request.');
  a.extension.nudges = [...(a.extension.nudges || []), { by: req.admin.name, at: new Date() }];
  a.timeline.push(P.tl(`Support (${req.admin.name}) nudged the mentor`, 'pu', 'nudge'));
  await a.save();
  await require('../../../../../services/lms/realtime').notify([a.mentor], {
    type: 'lms.project.nudge',
    title: `Waiting for you: extension request (${a.briefTitle})`,
    body: `${a.learnerName} asked for +${a.extension.days} day(s): ${a.extension.reason}`,
    link: '/teacher/project-dashboard',
  });
  return ok(res, pub(a), 'Mentor nudged');
}

// POST /projects/alloc/:id/notify-decision — support tells the learner the mentor's decision
async function notifyDecision(req, res) {
  const ctx = await loadAlloc(req, res, { learnerOk: false });
  if (!ctx) return;
  const a = ctx.a;
  const e = a.extension || {};
  if (!['approved', 'rejected'].includes(e.status)) return bad(res, 409, 'No decision to send yet.');
  a.extension.notifiedAt = new Date();
  await a.save();
  await P.notice(a, {
    kind: 'extension-notice',
    title: e.status === 'approved' ? `Extension approved: ${a.briefTitle}` : `Extension not approved: ${a.briefTitle}`,
    body: e.status === 'approved' ? `Your new deadline is ${P.fmt(a.deadline)} IST.` : `Your mentor did not approve the extension. Deadline ${P.fmt(a.deadline)} IST. Reply to support if you need help.`,
  });
  return ok(res, pub(a), 'Learner notified');
}

// POST /projects/alloc/:id/realloc-request  { note }
async function reallocRequest(req, res) {
  const ctx = await loadAlloc(req, res, { learnerOk: false });
  if (!ctx) return;
  const a = ctx.a;
  if (a.status !== 'disqualified') return bad(res, 409, 'Only disqualified projects.');
  a.reallocation = { ...(a.reallocation || {}), status: 'requested', requestedAt: new Date(), requestedByName: req.admin.name, note: str(req.body.note, 500) };
  a.timeline.push(P.tl(`Re-allocation requested by ${req.admin.name}`, 'ind', 'realloc-request'));
  await a.save();
  await require('../../../../../services/lms/realtime').notify([a.mentor], {
    type: 'lms.project.realloc',
    title: `Re-allocation request: ${a.learnerName} · ${a.briefTitle}`,
    body: `${req.admin.name} (support) asks to re-allocate this disqualified project.${a.reallocation.note ? ` ${a.reallocation.note}` : ''}`,
    link: '/teacher/project-dashboard',
  });
  return ok(res, pub(a), 'Request sent to the mentor');
}

// GET /projects/desk — support's extension & notification desk
async function desk(req, res) {
  if (!A.isManager(req.admin)) return bad(res, 403, 'Support / admin only.');
  const AL = M('LmsProjectAllocation');
  const day = new Date(Date.now() - 24 * H);
  const [ext, dq, recent] = await Promise.all([
    AL.find({ removed: false, 'extension.status': { $in: ['pending', 'approved', 'rejected'] }, 'extension.requestedAt': { $gte: new Date(Date.now() - 30 * 24 * H) } }).sort({ 'extension.requestedAt': -1 }).limit(100).lean(),
    AL.find({ removed: false, status: 'disqualified' }).sort({ disqualifiedAt: -1 }).limit(100).lean(),
    AL.find({ removed: false, 'notices.at': { $gte: new Date(Date.now() - 7 * 24 * H) } }).select('briefTitle learnerName groupName notices').lean(),
  ]);
  // notification log: grouped by (project, kind) for the last 7 days
  const groups = new Map();
  let today = { email: 0, inApp: 0, failed: 0 };
  for (const a of recent) {
    for (const n of a.notices || []) {
      if (new Date(n.at) < new Date(Date.now() - 7 * 24 * H)) continue;
      const key = `${a.briefTitle}|${n.kind}`;
      if (!groups.has(key)) groups.set(key, { title: a.briefTitle, kind: n.kind, at: n.at, email: 0, emailOk: 0, inApp: 0, failed: [], who: new Set() });
      const g = groups.get(key);
      if (new Date(n.at) > new Date(g.at)) g.at = n.at;
      g.who.add(a.groupName || a.learnerName);
      if (n.channel === 'email') {
        g.email += 1;
        if (n.ok) g.emailOk += 1;
        else g.failed.push(`${a.learnerName}: ${n.note}`);
      } else g.inApp += 1;
      if (new Date(n.at) >= day) {
        if (n.channel === 'email') today.email += 1;
        else today.inApp += 1;
        if (!n.ok) today.failed += 1;
      }
    }
  }
  const failedMail = await M('EmailDeliveryLog')
    .countDocuments({ status: 'failed', sentAt: { $gte: day } })
    .catch(() => 0);
  today = { ...today, failed: Math.max(today.failed, failedMail) };
  const log = [...groups.values()]
    .sort((a, b) => new Date(b.at) - new Date(a.at))
    .slice(0, 30)
    .map((g) => ({ ...g, who: [...g.who].slice(0, 4), whoN: g.who.size }));
  return ok(res, {
    kpis: {
      extensions: ext.length,
      waitingMentor: ext.filter((a) => a.extension.status === 'pending').length,
      sentToday: today.email + today.inApp,
      emailToday: today.email,
      inAppToday: today.inApp,
      failures: today.failed,
      reallocRequests: dq.filter((a) => a.reallocation && a.reallocation.status === 'requested').length,
    },
    extensions: ext.map((a) => pub(a)),
    disqualified: dq.map((a) => pub(a)),
    log,
  });
}

// GET /projects/automation — 2G: how often each rule ran (30 days)
async function automation(req, res) {
  if (!A.isManager(req.admin) && !A.isTeacher(req.admin)) return bad(res, 403, 'Not allowed.');
  const since = new Date(Date.now() - 30 * 24 * H);
  const rows = await M('LmsProjectAllocation').aggregate([
    { $match: { removed: false } },
    { $unwind: '$timeline' },
    { $match: { 'timeline.at': { $gte: since } } },
    { $group: { _id: '$timeline.kind', n: { $sum: 1 }, last: { $max: '$timeline.at' } } },
  ]);
  const by = Object.fromEntries(rows.map((r) => [r._id || 'other', { n: r.n, last: r.last }]));
  return ok(res, { since, counts: by });
}

// GET /projects/meta — tracks (courses) + my batches for the forms
async function meta(req, res) {
  if (!A.isManager(req.admin) && !A.isTeacher(req.admin)) return bad(res, 403, 'Not allowed.');
  const [courses, batches] = await Promise.all([M('Course').find({ removed: false }).select('title').lean().catch(() => []), A.mentorBatches(req.admin)]);
  const tracks = [...new Set([...courses.map((c) => c.title), ...batches.map((b) => b.course)].filter(Boolean))].sort();
  return ok(res, { tracks, batches: batches.map((b) => b.name), role: A.roleKey(req.admin) });
}

module.exports = {
  meta,
  listBriefs,
  getBrief,
  saveBrief,
  archiveBrief,
  uploadFile,
  candidates,
  allocateNow,
  dashboard,
  getAlloc,
  myProjects,
  saveDraft,
  submit,
  requestExtension,
  decideExtension,
  review,
  override,
  setResubmit,
  reallocate,
  remind,
  nudge,
  notifyDecision,
  reallocRequest,
  desk,
  automation,
};
