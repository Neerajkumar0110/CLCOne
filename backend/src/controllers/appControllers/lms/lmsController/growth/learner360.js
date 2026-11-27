const crypto = require('crypto');
const mongoose = require('mongoose');
const S = require('../../../../../services/lms/growth/score360');
const cfg = require('../../../../../services/lms/growth/config');
const A = require('../../../../../services/lms/growth/access');

// Learner 360° (Figma 1A–1F): the report, profile, remarks, scoring settings,
// leaderboard, recruiter share link and the PDF. Every number comes from
// services/lms/growth/score360.js.

const M = (n) => mongoose.model(n);
const ok = (res, result, message) => res.status(200).json({ success: true, result, message });
const bad = (res, code, message) => res.status(code).json({ success: false, result: null, message });
const ROUND = (v) => (v == null ? null : Math.round(v));

const maskPhone = (p) => {
  const d = String(p || '').replace(/\D/g, '');
  return d.length >= 6 ? `+91 ${d.slice(-10, -8)}•••• ${d.slice(-4)}` : '';
};

async function badgesFor(id, r) {
  const out = [];
  const certs = await M('Certificate')
    .find({ student: A.rxEq(id.name), status: { $in: ['Issued', 'Sent'] }, removed: { $ne: true } })
    .select('title course certificateId issuedOn')
    .lean()
    .catch(() => []);
  certs.forEach((c) => out.push({ i: 'award', label: c.title || c.course || 'Certificate', tone: 'ok', id: c.certificateId }));
  const e = r.engagement;
  if (e && e.bestStreak >= 7) out.push({ i: 'flame', label: `${e.bestStreak}-day streak`, tone: 'or' });
  if (r.lines.attendance.attPct >= 90) out.push({ i: 'checkc', label: `Attendance ${r.lines.attendance.attPct}%`, tone: 'pri' });
  (r.projects || []).filter((p) => p.qualified).forEach((p) => out.push({ i: 'trophy', label: `${p.title} · qualified`, tone: 'wa' }));
  return out;
}

// month-by-month average of the weekly snapshots (1A "Months" tab)
function monthsOf(points) {
  const by = new Map();
  for (const p of points) {
    if (p.total == null) continue;
    const k = p.week.slice(0, 7);
    if (!by.has(k)) by.set(k, []);
    by.get(k).push(p.total);
  }
  return [...by.entries()].sort().map(([k, v]) => ({ month: k, total: Math.round((v.reduce((a, b) => a + b, 0) / v.length) * 10) / 10 }));
}

async function buildReport(crmUserId, viewer, { forPublic = false } = {}) {
  const id = await S.identity(crmUserId);
  if (!id) return null;
  const c = await cfg.get();
  const r = await S.compute(crmUserId, { id });
  const snap = await S.saveSnapshot(r);
  const standing = await S.batchStanding(id.batch);
  const me = standing.rows.find((x) => x.crmUser === String(crmUserId)) || {};
  const batchAvg = Object.fromEntries([...S.COMPONENTS, 'engagement', 'total'].map((k) => [k, S.avgOf(standing.rows, k)]));

  // radar for the whole batch in one pass
  let radarBatch = S.AXES.map(() => null);
  if (standing.members.length) {
    const coded = await S.codingAnswers(
      standing.members.map((m) => m._id),
      new Date()
    );
    const per = standing.members.map((m) => S.radarFrom(coded.byUser.get(String(m._id)) || [], coded.qById));
    radarBatch = S.AXES.map((_, i) => {
      const v = per.map((p) => p[i]).filter((x) => x != null);
      return v.length ? Math.round(v.reduce((a, b) => a + b, 0) / v.length) : null;
    });
  }

  const [hist, bhist, profile, remarks, badges] = await Promise.all([
    S.history(crmUserId, id, 12),
    S.batchHistory(id.batch, 12),
    M('LmsLearnerProfile').findOne({ crmUser: crmUserId }).lean(),
    M('LmsMentorRemark')
      .find({ learner: crmUserId, removed: false, ...(String(viewer && viewer._id) === String(crmUserId) || forPublic ? { showOnReport: true } : {}) })
      .sort({ created: -1 })
      .limit(20)
      .lean(),
    badgesFor(id, r),
  ]);
  // this week's point is the live one
  if (hist.length) hist[hist.length - 1].total = r.total;
  const toJob = r.total == null ? null : Math.max(0, Math.ceil(c.levels.jobReady - r.total));
  const ins = S.insights(r, batchAvg, r.radar, radarBatch);
  const e = r.engagement;
  const roster = id.roster || {};

  return {
    learner: {
      id: String(crmUserId),
      name: id.name,
      email: id.admin.email,
      phone: roster.phone || '',
      phoneMasked: maskPhone(roster.phone),
      city: (profile && profile.city) || roster.city || '',
      course: roster.course || '',
      batch: id.batch || '',
      batchTime: (id.batchDoc && id.batchDoc.classTime) || '',
      learnerId: roster.enrollmentId || '',
      enrolledOn: roster.enrolledOn || null,
      mentor: id.mentorName || '',
      photoUrl: (profile && profile.photoUrl) || '',
      education: (profile && profile.education) || {},
      skills: (profile && profile.skills) || [],
      links: (profile && profile.links) || {},
      resume: (profile && profile.resume && profile.resume.url ? profile.resume : null) || null,
    },
    weights: r.weights,
    levels: c.levels,
    scores: r.scores,
    total: r.total,
    level: r.level,
    lines: r.lines,
    projects: r.projects,
    standing: { rank: me.rank || null, of: standing.scoredN || 0, percentile: me.percentile ?? null, toJobReady: toJob },
    batchAvg,
    history: { weeks: hist.map((h) => h.week), you: hist.map((h) => ROUND(h.total)), batch: bhist.map((h) => ROUND(h.total)) },
    months: { you: monthsOf(hist), batch: monthsOf(bhist) },
    radar: { axes: S.AXES, you: r.radar, batch: radarBatch },
    insights: ins,
    remarks: remarks.map((m) => ({ id: String(m._id), by: m.byName, tone: m.tone, text: m.text, at: m.created, showOnReport: m.showOnReport })),
    badges,
    // 3E "Show engagement in 360° report"
    engagement: e && c.engagement.showIn360 !== false
      ? { score: e.score, level: e.level, streak: e.streak, bestStreak: e.bestStreak, weekMin: e.weekMin, todayMin: e.todayMin, heat: e.heat.slice(-18 * 7), lastActive: e.lastActive }
      : null,
    live: snap && snap.lastChange && snap.lastChange.at ? snap.lastChange : null,
    computedAt: new Date(),
    realtime: c.realtime,
  };
}

// GET /api/lms/growth/360/me  ·  GET /api/lms/growth/360/:id
async function report(req, res) {
  const target = req.params.id && req.params.id !== 'me' ? req.params.id : String(req.admin._id);
  if (!mongoose.isValidObjectId(target)) return bad(res, 400, 'Bad learner id.');
  if (!(await A.canView(req.admin, target))) return bad(res, 403, 'You can only see your own report (or your assigned learners).');
  const rep = await buildReport(target, req.admin);
  if (!rep) return bad(res, 404, 'Learner not found.');
  rep.viewer = { role: A.roleKey(req.admin), self: String(req.admin._id) === target, canRemark: A.isTeacher(req.admin) || A.isAdmin(req.admin) };
  return ok(res, rep);
}

// PUT /api/lms/growth/profile/me  { city, education, skills, links }
async function saveProfile(req, res) {
  const b = req.body || {};
  const str = (v, n = 200) => String(v || '').trim().slice(0, n);
  const url = (v) => {
    const s = str(v, 300);
    return !s || /^https?:\/\//i.test(s) ? s : `https://${s}`;
  };
  const set = {
    email: req.admin.email,
    updated: new Date(),
  };
  if (b.city !== undefined) set.city = str(b.city, 80);
  if (b.education) set.education = { degree: str(b.education.degree), year: str(b.education.year, 10), institute: str(b.education.institute), grade: str(b.education.grade, 40) };
  if (Array.isArray(b.skills)) set.skills = [...new Set(b.skills.map((s) => str(s, 40)).filter(Boolean))].slice(0, 30);
  if (b.links) set.links = { github: url(b.links.github), linkedin: url(b.links.linkedin), portfolio: url(b.links.portfolio) };
  const row = await M('LmsLearnerProfile').findOneAndUpdate({ crmUser: req.admin._id }, { $set: set }, { upsert: true, new: true }).lean();
  return ok(res, row, 'Profile saved');
}

// POST /api/lms/growth/profile/me/resume  (multipart "file", PDF)
async function uploadResume(req, res) {
  if (!req.body.file) return bad(res, 400, 'No file received — upload a PDF.');
  const { lmsConfig } = require('../../../../../services/lms');
  const base = lmsConfig.meeting.crmBaseUrl.replace(/\/+$/, '');
  const f = req.files && req.files.file;
  const resume = {
    url: `${base}/${req.body.file}`,
    name: (f && f.name) || String(req.body.file).split('/').pop(),
    size: (f && f.size) || 0,
    updatedAt: new Date(),
  };
  if (!resume.size) {
    try {
      resume.size = require('fs').statSync(require('path').join(process.cwd(), 'src', req.body.file)).size;
    } catch (_) {
      resume.size = 0;
    }
  }
  await M('LmsLearnerProfile').updateOne({ crmUser: req.admin._id }, { $set: { resume, email: req.admin.email, updated: new Date() } }, { upsert: true });
  return ok(res, resume, 'Resume uploaded');
}

// POST /api/lms/growth/profile/me/photo  (multipart "file", image)
async function uploadPhoto(req, res) {
  if (!req.body.file) return bad(res, 400, 'No image received.');
  const { lmsConfig } = require('../../../../../services/lms');
  const url = `${lmsConfig.meeting.crmBaseUrl.replace(/\/+$/, '')}/${req.body.file}`;
  await M('LmsLearnerProfile').updateOne({ crmUser: req.admin._id }, { $set: { photoUrl: url, email: req.admin.email, updated: new Date() } }, { upsert: true });
  return ok(res, { photoUrl: url }, 'Photo updated');
}

// ── 1C mentor ──

// GET /api/lms/growth/mentor/learners?batch=
async function mentorLearners(req, res) {
  if (!A.isTeacher(req.admin) && !A.isManager(req.admin)) return bad(res, 403, 'Mentors only.');
  const batches = await A.mentorBatches(req.admin);
  const names = req.query.batch ? batches.filter((b) => b.name === req.query.batch).map((b) => b.name) : batches.map((b) => b.name);
  if (A.isManager(req.admin) && !req.query.batch) return ok(res, { batches: batches.map((b) => b.name), rows: [], kpis: null, needBatch: true });
  const learners = await A.learnersOf(names);
  const c = await cfg.get();
  const rows = [];
  for (const l of learners) {
    // eslint-disable-next-line no-await-in-loop
    const r = await S.compute(l._id, { light: true }).catch(() => null);
    if (!r) continue;
    // eslint-disable-next-line no-await-in-loop
    await S.saveSnapshot(r, { emit: false });
    // eslint-disable-next-line no-await-in-loop
    const e = await require('../../../../../services/lms/growth/engagement').summary({ crmUser: l._id, name: r.name, batch: r.batch }, { heatDays: 30 });
    // eslint-disable-next-line no-await-in-loop
    const last = await M('LmsMentorRemark').findOne({ learner: l._id, removed: false }).sort({ created: -1 }).select('created').lean();
    let projTotal = 0;
    try {
      // eslint-disable-next-line no-await-in-loop
      projTotal = await M('LmsProjectAllocation').countDocuments({ removed: { $ne: true }, $or: [{ learner: l._id }, { members: l._id }] });
    } catch (_) {
      projTotal = 0;
    }
    // eslint-disable-next-line no-await-in-loop
    projTotal += await M('Project').countDocuments({ student: l._id, removed: { $ne: true } }).catch(() => 0);
    rows.push({
      id: String(l._id),
      name: r.name,
      learnerId: (l.roster && l.roster.enrollmentId) || '',
      batch: r.batch,
      total: r.total,
      level: r.level,
      scores: r.scores,
      engagement: { score: e.score, level: e.level, lastActive: e.lastActive },
      projects: { reviewed: r.lines.project.reviewed, total: Math.max(projTotal, r.lines.project.reviewed) },
      lastRemark: last ? last.created : null,
    });
  }
  rows.sort((a, b) => (b.total ?? -1) - (a.total ?? -1));
  const scored = rows.filter((r) => r.total != null);
  const batchAvg = names.length === 1 ? S.avgOf((await S.batchStanding(names[0])).rows, 'total') : null;
  const near = scored.filter((r) => r.total < c.levels.jobReady && r.total >= c.levels.jobReady - 3).length;
  const kpis = {
    assigned: rows.length,
    batches: names,
    avg: scored.length ? Math.round(scored.reduce((s, r) => s + r.total, 0) / scored.length) : null,
    batchAvg,
    jobReady: scored.filter((r) => r.level.key === 'job').length,
    nearJob: near,
    attention: rows.filter((r) => (r.total != null && r.total < c.levels.almost) || (r.engagement.level && r.engagement.level.key === 'low')).length,
  };
  return ok(res, { batches: batches.map((b) => b.name), rows, kpis, mentorPdf: c.mentorPdf });
}

// GET /api/lms/growth/remarks/:id
async function listRemarks(req, res) {
  if (!(await A.canView(req.admin, req.params.id))) return bad(res, 403, 'Not your learner.');
  const own = String(req.admin._id) === String(req.params.id);
  const rows = await M('LmsMentorRemark')
    .find({ learner: req.params.id, removed: false, ...(own ? { showOnReport: true } : {}) })
    .sort({ created: -1 })
    .lean();
  return ok(res, rows.map((m) => ({ id: String(m._id), by: m.byName, tone: m.tone, text: m.text, at: m.created, showOnReport: m.showOnReport })));
}

// POST /api/lms/growth/remarks/:id  { tone, text, showOnReport, notify }
async function addRemark(req, res) {
  if (!(A.isTeacher(req.admin) || A.isAdmin(req.admin))) return bad(res, 403, 'Only a mentor or an admin can write remarks.');
  if (!(await A.canView(req.admin, req.params.id))) return bad(res, 403, 'Not your learner.');
  const text = String((req.body && req.body.text) || '').trim().slice(0, 2000);
  if (text.length < 3) return bad(res, 400, 'Write the remark first.');
  const tone = ['positive', 'action', 'neutral'].includes(req.body.tone) ? req.body.tone : 'neutral';
  const row = await M('LmsMentorRemark').create({
    learner: req.params.id,
    tone,
    text,
    showOnReport: req.body.showOnReport !== false,
    by: req.admin._id,
    byName: req.admin.name,
  });
  if (req.body.notify !== false && row.showOnReport) {
    try {
      const learner = await M('Admin').findById(req.params.id).select('name email').lean();
      await require('../../../../../services/lms/realtime').notify([req.params.id], {
        type: 'lms.remark',
        title: `New remark from ${req.admin.name}`,
        body: text,
        link: '/learn/report',
        actorName: req.admin.name,
      });
      if (learner && learner.email) {
        require('../../../../../services/lms/mailer')
          .sendMail([learner.email], {
            subject: `Your mentor ${req.admin.name} left a remark on your 360° report`,
            text: `Hi ${learner.name},\n\n${req.admin.name} wrote:\n\n"${text}"\n\nSee it on your 360° report in the LMS.\n\nCareerLab LMS`,
          })
          .catch(() => {});
      }
    } catch (e) {
      console.error('[growth] remark notify', e.message);
    }
  }
  return ok(res, { id: String(row._id), by: row.byName, tone: row.tone, text: row.text, at: row.created, showOnReport: row.showOnReport }, 'Remark posted');
}

// DELETE /api/lms/growth/remarks/item/:remarkId — its author or an admin
async function deleteRemark(req, res) {
  const row = await M('LmsMentorRemark').findById(req.params.remarkId);
  if (!row || row.removed) return bad(res, 404, 'Remark not found.');
  if (String(row.by) !== String(req.admin._id) && !A.isAdmin(req.admin)) return bad(res, 403, 'Only its author or an admin can delete it.');
  row.removed = true;
  await row.save();
  return ok(res, { id: String(row._id) }, 'Remark deleted');
}

// ── 1B admin ──

// GET /api/lms/growth/config
async function getConfig(req, res) {
  if (!A.isManager(req.admin)) return bad(res, 403, 'Admins only.');
  const c = await cfg.get();
  const batches = await M('Batch').find({ removed: { $ne: true } }).select('name status').sort({ startDate: -1 }).lean();
  // Support edits too (LMS testing report #39 — the 360 controls were dead for Support)
  return ok(res, { ...c, batches: batches.map((b) => b.name), canEdit: A.isManager(req.admin) });
}

// PUT /api/lms/growth/config  { weights, batchWeights, levels, realtime, mentorPdf, engagement }
async function saveConfig(req, res) {
  if (!A.isManager(req.admin)) return bad(res, 403, 'Only an admin or Support can change scoring settings.');
  const b = req.body || {};
  const set = { updated: new Date(), updatedBy: req.admin._id, updatedByName: req.admin.name };
  const num = (v, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, Math.round(Number(v) || 0)));
  const validW = (w) => {
    const o = { attendance: num(w.attendance), assessment: num(w.assessment), coding: num(w.coding), project: num(w.project) };
    const t = o.attendance + o.assessment + o.coding + o.project;
    return t === 100 ? o : null;
  };
  if (b.weights) {
    const w = validW(b.weights);
    if (!w) return bad(res, 400, 'Weights must total 100%.');
    set.weights = w;
  }
  if (Array.isArray(b.batchWeights)) {
    const list = [];
    for (const x of b.batchWeights) {
      if (!x || !x.batch || !x.weights) continue;
      const w = validW(x.weights);
      if (!w) return bad(res, 400, `Weights for ${x.batch} must total 100%.`);
      list.push({ batch: String(x.batch), weights: w });
    }
    set.batchWeights = list;
  }
  if (b.levels) {
    const jr = num(b.levels.jobReady, 1, 100);
    const al = num(b.levels.almost, 0, 99);
    if (al >= jr) return bad(res, 400, 'Almost Ready must start below Job Ready.');
    set.levels = { jobReady: jr, almost: al };
  }
  if (b.realtime !== undefined) set.realtime = !!b.realtime;
  if (b.mentorPdf !== undefined) set.mentorPdf = !!b.mentorPdf;
  if (b.engagement) {
    const e = b.engagement;
    const cur = (await cfg.get()).engagement;
    const ew = { ...cur.weights, ...(e.weights || {}) };
    const et = num(ew.practiceTime) + num(ew.completion) + num(ew.exercises) + num(ew.streak);
    if (et !== 100) return bad(res, 400, `Engagement weights must total 100% (now ${et}%).`);
    const lv = { ...cur.levels, ...(e.levels || {}) };
    if (num(lv.moderate) >= num(lv.high)) return bad(res, 400, 'Moderate must start below Highly Engaged.');
    const act = { ...cur.active, ...(e.active || {}) };
    const rules = JSON.parse(JSON.stringify(cur.rules));
    for (const [k, v] of Object.entries(e.rules || {})) {
      if (!rules[k] || !v) continue;
      rules[k].on = !!v.on;
      if (v.days != null) rules[k].days = num(v.days, 1, 60);
      if (v.count != null) rules[k].count = num(v.count, 1, 10);
      if (v.below != null) rules[k].below = num(v.below);
    }
    const q = { ...cur.quiet, ...(e.quiet || {}) };
    set.engagement = {
      idleTimeoutMin: num(e.idleTimeoutMin ?? cur.idleTimeoutMin, 1, 30),
      active: { editor: !!act.editor, lesson: !!act.lesson, video: !!act.video, assessment: !!act.assessment, live: !!act.live, hiddenTab: !!act.hiddenTab },
      weights: { practiceTime: num(ew.practiceTime), completion: num(ew.completion), exercises: num(ew.exercises), streak: num(ew.streak) },
      levels: { high: num(lv.high), moderate: num(lv.moderate) },
      dailyGoalMin: num(e.dailyGoalMin ?? cur.dailyGoalMin, 10, 600),
      reminderHour: num(e.reminderHour ?? cur.reminderHour, 0, 23),
      quiet: { from: num(q.from, 0, 23), to: num(q.to, 0, 23) },
      streakRisk: e.streakRisk === undefined ? cur.streakRisk : !!e.streakRisk,
      weeklyEmail: e.weeklyEmail === undefined ? cur.weeklyEmail : !!e.weeklyEmail,
      showIn360: e.showIn360 === undefined ? cur.showIn360 : !!e.showIn360,
      rules,
    };
  }
  await M('LmsGrowthConfig').updateOne({ key: 'live' }, { $set: set }, { upsert: true });
  cfg.bust();
  await M('AuditLog')
    .create({ module: 'lms-growth', action: 'config.update', performedBy: req.admin._id, performedByName: req.admin.name, after: set })
    .catch(() => {});
  return ok(res, await cfg.get(), 'Saved — every report recalculates with the new settings');
}

// GET /api/lms/growth/leaderboard?batch=&recalc=1
async function leaderboard(req, res) {
  if (!A.isManager(req.admin) && !A.isTeacher(req.admin)) return bad(res, 403, 'Not allowed.');
  const batches = await A.mentorBatches(req.admin);
  const names = batches.map((b) => b.name);
  const batch = req.query.batch && names.includes(req.query.batch) ? req.query.batch : null;
  const c = await cfg.get();
  // KPIs across the chosen batch (or every batch's current snapshots)
  let rows = [];
  if (batch) {
    const st = await S.batchStanding(batch, { force: req.query.recalc === '1' });
    rows = st.rows;
  }
  const week = S.weekOf();
  const all = await M('LmsScoreSnapshot')
    .find({ week, total: { $ne: null }, ...(A.isManager(req.admin) ? {} : { batch: { $in: names } }) })
    .select('total batch')
    .lean();
  const lastMonthWeek = require('../../../../../services/lms/growth/engagement').addDays(week, -28);
  const prev = await M('LmsScoreSnapshot')
    .find({ week: lastMonthWeek, total: { $ne: null }, ...(A.isManager(req.admin) ? {} : { batch: { $in: names } }) })
    .select('total')
    .lean();
  const pool = batch ? rows.filter((r) => r.total != null) : all;
  const avg = (a) => (a.length ? Math.round(a.reduce((s, x) => s + x.total, 0) / a.length) : null);
  const cnt = (f) => pool.filter(f).length;
  const n = pool.length || 0;
  const kpis = {
    avg: avg(pool),
    delta: avg(pool) != null && avg(prev) != null ? avg(pool) - avg(prev) : null,
    jobReady: cnt((x) => x.total >= c.levels.jobReady),
    almost: cnt((x) => x.total >= c.levels.almost && x.total < c.levels.jobReady),
    needs: cnt((x) => x.total < c.levels.almost),
    n,
  };
  return ok(res, {
    batches: names,
    batch,
    kpis,
    levels: c.levels,
    rows: rows.map((r) => ({
      crmUser: r.crmUser,
      name: r.name,
      rank: r.rank || null,
      percentile: r.percentile ?? null,
      attendance: r.attendance ?? null,
      assessment: r.assessment ?? null,
      coding: r.coding ?? null,
      project: r.project ?? null,
      total: r.total ?? null,
      level: cfg.levelOf(r.total, c.levels),
    })),
  });
}

// ── 1D share link ──
const newToken = () => crypto.randomBytes(9).toString('base64url');

// GET /api/lms/growth/share/me
async function getShare(req, res) {
  const row = await M('LmsShareLink').findOne({ crmUser: req.admin._id, revoked: false }).sort({ created: -1 }).lean();
  return ok(res, row ? { ...row, url: publicUrl(row.token) } : null);
}

function publicUrl(token) {
  const { lmsConfig } = require('../../../../../services/lms');
  const base = (process.env.LMS_PUBLIC_BASE_URL || lmsConfig.meeting.crmBaseUrl || '').replace(/\/+$/, '');
  return `${base}/p/${token}`;
}

// PUT /api/lms/growth/share/me  { show, expiresDays }
async function saveShare(req, res) {
  const fl = await require('../../../../../services/lms/growth/flags').forUser(req.admin);
  if (fl.recruiter_share_link === false) return bad(res, 403, 'Recruiter links are not switched on for you yet.');
  const b = req.body || {};
  const days = b.expiresDays === null || b.expiresDays === 0 ? null : Math.max(1, Math.min(365, Number(b.expiresDays) || 30));
  const show = {
    scores: !!(b.show ? b.show.scores : true),
    projects: !!(b.show ? b.show.projects : true),
    resume: !!(b.show ? b.show.resume : true),
    mentor: !!(b.show && b.show.mentor),
    contact: !!(b.show && b.show.contact),
  };
  let row = await M('LmsShareLink').findOne({ crmUser: req.admin._id, revoked: false }).sort({ created: -1 });
  if (!row) {
    const ShareLink = M('LmsShareLink');
    row = new ShareLink({ crmUser: req.admin._id, token: newToken() });
  }
  row.show = show;
  row.expiresAt = days ? new Date(Date.now() + days * 86400000) : null;
  row.updated = new Date();
  await row.save();
  const o = row.toObject();
  return ok(res, { ...o, url: publicUrl(o.token) }, 'Link saved');
}

// DELETE /api/lms/growth/share/me — revoke
async function revokeShare(req, res) {
  await M('LmsShareLink').updateMany({ crmUser: req.admin._id, revoked: false }, { $set: { revoked: true, updated: new Date() } });
  return ok(res, null, 'Link revoked — it no longer opens');
}

// PUBLIC GET /api/lms-public/profile/:token
async function publicProfile(req, res) {
  const row = await M('LmsShareLink').findOne({ token: String(req.params.token || '') });
  if (!row || row.revoked) return bad(res, 404, 'This profile link is no longer active.');
  if (row.expiresAt && row.expiresAt < new Date()) return bad(res, 410, 'This profile link has expired.');
  const rep = await buildReport(row.crmUser, null, { forPublic: true });
  if (!rep) return bad(res, 404, 'Profile not found.');
  row.views += 1;
  row.lastViewedAt = new Date();
  await row.save();
  const sh = row.show || {};
  const L = rep.learner;
  const mentorRemark = rep.remarks.find((m) => m.tone === 'positive') || rep.remarks[0];
  return ok(res, {
    learner: {
      name: L.name,
      photoUrl: L.photoUrl || null,
      course: L.course,
      city: L.city,
      skills: L.skills,
      links: L.links,
      email: sh.contact ? L.email : null,
      phone: sh.contact ? L.phone : null,
      resume: sh.resume && L.resume ? L.resume : null,
    },
    scores: sh.scores ? rep.scores : null,
    total: sh.scores ? rep.total : null,
    level: sh.scores ? rep.level : null,
    standing: sh.scores ? rep.standing : null,
    radar: sh.scores ? { axes: rep.radar.axes, you: rep.radar.you } : null,
    projects: sh.projects ? rep.projects : null,
    badges: rep.badges,
    mentor: sh.mentor && mentorRemark ? { text: mentorRemark.text, by: mentorRemark.by } : null,
    expiresAt: row.expiresAt,
    token: row.token,
    show: sh,
  });
}

// ── 1F PDF ──
const SECRET = () => process.env.JWT_SECRET || 'lms-360';
const sign = (s) => crypto.createHmac('sha256', SECRET()).update(s).digest('base64url').slice(0, 16);
function verifyCode(crmUserId, total, at) {
  const body = Buffer.from(`${crmUserId}.${total == null ? 'x' : Math.round(total)}.${at.getTime()}`).toString('base64url');
  return `${body}.${sign(body)}`;
}

// GET /api/lms/growth/360/:id/pdf
async function pdf(req, res) {
  const target = req.params.id && req.params.id !== 'me' ? req.params.id : String(req.admin._id);
  if (!mongoose.isValidObjectId(target)) return bad(res, 400, 'Bad learner id.');
  if (!(await A.canView(req.admin, target))) return bad(res, 403, 'Not allowed.');
  const c = await cfg.get();
  if (A.isTeacher(req.admin) && String(req.admin._id) !== target && !c.mentorPdf) return bad(res, 403, 'Mentor PDF downloads are turned off by the admin.');
  const rep = await buildReport(target, req.admin);
  if (!rep) return bad(res, 404, 'Learner not found.');
  const at = new Date();
  const code = verifyCode(target, rep.total, at);
  const { lmsConfig } = require('../../../../../services/lms');
  const base = (process.env.LMS_PUBLIC_BASE_URL || lmsConfig.meeting.crmBaseUrl || '').replace(/\/+$/, '');
  const buf = await require('../../../../../services/lms/growth/pdf360').render(rep, { at, verifyUrl: `${base}/verify-360/${code}` });
  const name = `${String(rep.learner.name || 'learner').replace(/[^\w\- ]+/g, '').trim()} - 360 report.pdf`;
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
  return res.status(200).send(buf);
}

// PUBLIC GET /api/lms-public/verify-360/:code
async function verify360(req, res) {
  const [body, sig] = String(req.params.code || '').split('.');
  if (!body || !sig || sign(body) !== sig) return bad(res, 404, 'This report could not be verified.');
  const [id, total, ts] = Buffer.from(body, 'base64url').toString().split('.');
  const learner = mongoose.isValidObjectId(id) ? await M('Admin').findById(id).select('name').lean() : null;
  if (!learner) return bad(res, 404, 'This report could not be verified.');
  return ok(res, { name: learner.name, total: total === 'x' ? null : Number(total), generatedAt: new Date(Number(ts)) });
}

module.exports = {
  buildReport,
  report,
  saveProfile,
  uploadResume,
  uploadPhoto,
  mentorLearners,
  listRemarks,
  addRemark,
  deleteRemark,
  getConfig,
  saveConfig,
  leaderboard,
  getShare,
  saveShare,
  revokeShare,
  publicProfile,
  pdf,
  verify360,
};
