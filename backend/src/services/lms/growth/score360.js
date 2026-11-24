const mongoose = require('mongoose');
const cfg = require('./config');
const eng = require('./engagement');

// Learner 360° scores (Figma 1A / 1B) — every number from real LMS data:
//   attendance  attended 70 · on-time 20 · live participation 10  (AttendanceRecord, live sessions)
//   assessment  average of tests · micro tests · unit assessments (QuizAttempt, AssessmentAttempt)
//   coding      solved 40 · test cases 30 · quality 20 · tries 10 (PROGRAMMING / OUTPUT_BASED answers)
//   project     mentor rubric scores (Project reviews + project allocations, 2E)
//   hire-readiness = Σ weight × score over the components that have data (weights from 1B)
// `asOf` lets the weekly history be computed from the data as it stood then.

const M = (n) => mongoose.model(n);
const rxEq = (s) => new RegExp(`^${String(s || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i');
const clamp = (v) => Math.max(0, Math.min(100, v));
const r1 = (v) => (v == null ? null : Math.round(v * 10) / 10);
const avg = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null);
const COMPONENTS = ['attendance', 'assessment', 'coding', 'project'];
const MICRO = ['MICRO', 'NLP_MICRO'];
const UNIT = ['MAJOR', 'NLP_MAJOR', 'LLM_MAJOR'];

// Radar axes (1A "Skill strengths") — question topics mapped by keyword
const AXES = [
  ['Python', /python|pandas|numpy|function|loop|list|dict|oop|class|string|file handling/i],
  ['SQL', /sql|database|query|join|mysql|postgres/i],
  ['ML', /machine learning|\bml\b|regression|classif|cluster|scikit|sklearn|model|feature|tree|svm|neural|deep learning/i],
  ['AI Agents', /agent|langchain|langgraph|llm|prompt|rag|crew|autogen|tool call/i],
  ['Statistics', /stat|probab|distribution|hypothesis|mean|variance|correlation/i],
  ['APIs', /api|fastapi|flask|rest|http|request|endpoint|json/i],
  ['Git', /git|github|version control|commit|branch/i],
];
const axisOf = (topic) => {
  const hit = AXES.find(([, re]) => re.test(String(topic || '')));
  return hit ? hit[0] : null;
};

// ── who is this learner ──
async function identity(crmUserId) {
  const admin = await M('Admin').findOne({ _id: crmUserId, removed: { $ne: true } }).select('name email role photo').lean();
  if (!admin) return null;
  const roster = await M('Student')
    .findOne({ email: rxEq(admin.email), removed: { $ne: true } })
    .sort({ enrolledOn: -1, created: -1 })
    .lean();
  const batchDoc = roster && roster.batch ? await M('Batch').findOne({ name: rxEq(roster.batch), removed: { $ne: true } }).lean() : null;
  const mentorName = batchDoc && Array.isArray(batchDoc.trainer) && batchDoc.trainer.length ? batchDoc.trainer.join(', ') : null;
  return { admin, roster, batchDoc, batch: roster ? roster.batch : null, name: (roster && roster.name) || admin.name, mentorName };
}

// ── attendance ──
async function attendance(id, asOf) {
  const name = id.name;
  const recs = await M('AttendanceRecord')
    .find({ removed: { $ne: true }, student: rxEq(name), date: { $lte: asOf } })
    .select('status durationMin markedBy date batch')
    .lean();
  const rows = recs.filter((r) => r.status !== 'Excused');
  const attendedRows = rows.filter((r) => ['Present', 'Late', 'Left Early'].includes(r.status));
  // classes held = the batch's ended live classes since enrolment (absences
  // often have no record at all), never fewer than the records we have
  let held = rows.length;
  if (id.batch) {
    const since = id.roster && id.roster.enrolledOn ? new Date(id.roster.enrolledOn) : new Date(0);
    const n = await M('LmsLiveSession')
      .countDocuments({ removed: { $ne: true }, batchName: rxEq(id.batch), status: { $in: ['ended', 'recording_processing', 'recording_available'] }, scheduledStart: { $gte: since, $lte: asOf } })
      .catch(() => 0);
    held = Math.max(held, n);
  }
  if (!held) return { score: null, lines: { attended: 0, held: 0, late: 0, livePct: null } };
  const attended = attendedRows.length;
  const late = attendedRows.filter((r) => r.status === 'Late').length;
  const full = (id.batchDoc && id.batchDoc.classDurationMin) || 90;
  // stayed ≥ 75% of the class (a manual mark has no duration → counts)
  const live = attendedRows.filter((r) => r.status !== 'Left Early' && (r.markedBy === 'Manual' || !r.durationMin || r.durationMin >= full * 0.75)).length;
  const attPct = (attended / held) * 100;
  const onTimePct = attended ? ((attended - late) / attended) * 100 : 0;
  const livePct = attended ? (live / attended) * 100 : 0;
  return {
    score: clamp(Math.round(attPct * 0.7 + onTimePct * 0.2 + livePct * 0.1)),
    lines: { attended, held, late, livePct: Math.round(livePct), attPct: Math.round(attPct) },
  };
}

// ── assessments ──
async function assessment(crmUser, asOf) {
  const [quizzes, attempts] = await Promise.all([
    M('QuizAttempt').find({ student: crmUser, status: 'evaluated', submittedAt: { $lte: asOf } }).select('percent submittedAt').lean(),
    M('AssessmentAttempt').find({ candidate: crmUser, status: 'SUBMITTED', totalCount: { $gt: 0 }, submittedAt: { $lte: asOf } }).select('testType score totalCount submittedAt').lean(),
  ]);
  const pct = (a) => (a.score / a.totalCount) * 100;
  const tests = quizzes.map((q) => q.percent || 0);
  const micro = attempts.filter((a) => MICRO.includes(a.testType)).map(pct);
  const unit = attempts.filter((a) => UNIT.includes(a.testType));
  const groups = [avg(tests), avg(micro), avg(unit.map(pct))].filter((v) => v != null);
  const lastUnit = unit.sort((a, b) => new Date(b.submittedAt) - new Date(a.submittedAt))[0];
  return {
    score: groups.length ? clamp(Math.round(avg(groups))) : null,
    lines: {
      tests: tests.length ? Math.round(avg(tests)) : null,
      testsN: tests.length,
      micro: micro.length ? Math.round(avg(micro)) : null,
      microN: micro.length,
      unit: unit.length ? Math.round(avg(unit.map(pct))) : null,
      unitN: unit.length,
      lastUnit: lastUnit ? { pct: Math.round(pct(lastUnit)), type: lastUnit.testType, at: lastUnit.submittedAt } : null,
    },
  };
}

// answers of programming / output questions for a set of learners (one pass)
async function codingAnswers(crmUsers, asOf) {
  const attempts = await M('AssessmentAttempt')
    .find({ candidate: { $in: crmUsers }, status: 'SUBMITTED', submittedAt: { $lte: asOf } })
    .select('_id candidate')
    .lean();
  if (!attempts.length) return { byUser: new Map(), qById: new Map() };
  const owner = new Map(attempts.map((a) => [String(a._id), String(a.candidate)]));
  const answers = await M('AssessmentAttemptQuestion')
    .find({ attemptId: { $in: attempts.map((a) => String(a._id)) } })
    .select('attemptId questionId isCorrect order')
    .lean();
  const qIds = [...new Set(answers.map((a) => a.questionId))];
  const qs = await M('AssessmentQuestion').find({ _id: { $in: qIds } }).select('questionType topic').lean();
  const qById = new Map(qs.map((q) => [String(q._id), q]));
  const byUser = new Map();
  for (const a of answers) {
    const u = owner.get(String(a.attemptId));
    if (!byUser.has(u)) byUser.set(u, []);
    byUser.get(u).push(a);
  }
  return { byUser, qById };
}

function codingFrom(answers, qById) {
  const code = (answers || []).filter((a) => {
    const q = qById.get(String(a.questionId));
    return q && (q.questionType === 'PROGRAMMING' || q.questionType === 'OUTPUT_BASED') && a.isCorrect != null;
  });
  if (!code.length) return { score: null, lines: { solved: 0, attempted: 0, testsPct: null, quality: null, avgTries: null } };
  const byQ = new Map();
  for (const a of code) {
    if (!byQ.has(a.questionId)) byQ.set(a.questionId, []);
    byQ.get(a.questionId).push(a);
  }
  const attempted = byQ.size;
  const solved = [...byQ.values()].filter((l) => l.some((a) => a.isCorrect)).length;
  const firstTry = [...byQ.values()].filter((l) => l[0].isCorrect).length;
  const testsPct = (code.filter((a) => a.isCorrect).length / code.length) * 100;
  const avgTries = code.length / attempted;
  const solvedPct = (solved / attempted) * 100;
  const qualityPct = (firstTry / attempted) * 100;
  const triesScore = clamp(100 - (avgTries - 1) * 50);
  const grade = qualityPct >= 90 ? 'A' : qualityPct >= 80 ? 'A-' : qualityPct >= 70 ? 'B+' : qualityPct >= 60 ? 'B' : qualityPct >= 50 ? 'C' : 'D';
  return {
    score: clamp(Math.round(solvedPct * 0.4 + testsPct * 0.3 + qualityPct * 0.2 + triesScore * 0.1)),
    lines: { solved, attempted, testsPct: Math.round(testsPct), quality: grade, avgTries: Math.round(avgTries * 10) / 10 },
  };
}

function radarFrom(answers, qById) {
  const acc = Object.fromEntries(AXES.map(([a]) => [a, [0, 0]]));
  for (const a of answers || []) {
    const q = qById.get(String(a.questionId));
    if (!q || a.isCorrect == null) continue;
    const ax = axisOf(q.topic);
    if (!ax) continue;
    acc[ax][1] += 1;
    if (a.isCorrect) acc[ax][0] += 1;
  }
  return AXES.map(([a]) => (acc[a][1] ? Math.round((acc[a][0] / acc[a][1]) * 100) : null));
}

// ── projects (mentor rubric) ──
async function projects(crmUser, asOf) {
  const out = [];
  const legacy = await M('Project').find({ student: crmUser, removed: { $ne: true } }).select('title submissions status techStack githubUrl deploymentUrl').lean().catch(() => []);
  for (const p of legacy) {
    const reviewed = (p.submissions || []).filter((s) => s.review && s.review.totalScore != null && s.review.at && new Date(s.review.at) <= asOf);
    const last = reviewed[reviewed.length - 1];
    if (last) {
      out.push({
        title: p.title,
        score: Math.round(last.review.totalScore),
        at: last.review.at,
        qualified: last.review.decision === 'approved',
        stack: Array.isArray(p.techStack) ? p.techStack.join(' · ') : p.techStack || '',
        github: last.githubUrl || p.githubUrl,
        demo: last.deploymentUrl || last.demoUrl || p.deploymentUrl,
      });
    }
  }
  let allocs = [];
  try {
    allocs = await M('LmsProjectAllocation')
      .find({ removed: { $ne: true }, $or: [{ learner: crmUser }, { members: crmUser }], 'review.published': true, 'review.score': { $ne: null }, 'review.at': { $lte: asOf } })
      .select('briefTitle review stack submission')
      .lean();
  } catch (e) {
    allocs = [];
  }
  for (const a of allocs) {
    out.push({
      title: a.briefTitle,
      score: Math.round(a.review.score),
      at: a.review.at,
      qualified: a.review.decision === 'qualified',
      stack: a.stack || '',
      github: a.submission && a.submission.githubUrl,
      demo: a.submission && a.submission.demoUrl,
    });
  }
  out.sort((a, b) => new Date(a.at) - new Date(b.at));
  const latest = out[out.length - 1];
  return {
    score: out.length ? clamp(Math.round(avg(out.map((p) => p.score)))) : null,
    lines: { reviewed: out.length, avg: out.length ? Math.round(avg(out.map((p) => p.score))) : null, latest: latest ? { title: latest.title, score: latest.score } : null },
    list: out,
  };
}

function combine(scores, weights) {
  let wsum = 0;
  let acc = 0;
  for (const k of COMPONENTS) {
    if (scores[k] == null) continue;
    wsum += weights[k];
    acc += scores[k] * weights[k];
  }
  return wsum ? r1(acc / wsum) : null;
}

// Monday of the IST week, 'YYYY-MM-DD'
function weekOf(d = new Date()) {
  const ymd = eng.istDate(d);
  const dow = (new Date(`${ymd}T00:00:00Z`).getUTCDay() + 6) % 7;
  return eng.addDays(ymd, -dow);
}

// Scores of one learner. `light` skips radar / engagement detail (rank pass).
async function compute(crmUserId, { asOf = new Date(), id: idIn, light = false } = {}) {
  const id = idIn || (await identity(crmUserId));
  if (!id) return null;
  const crmUser = id.admin._id;
  const c = await cfg.get();
  const weights = await cfg.weightsFor(id.batch);
  const [att, asm, prj, coded] = await Promise.all([attendance(id, asOf), assessment(crmUser, asOf), projects(crmUser, asOf), codingAnswers([crmUser], asOf)]);
  const mine = coded.byUser.get(String(crmUser)) || [];
  const cod = codingFrom(mine, coded.qById);
  const scores = { attendance: att.score, assessment: asm.score, coding: cod.score, project: prj.score };
  const total = combine(scores, weights);
  const out = {
    crmUser: String(crmUser),
    name: id.name,
    batch: id.batch,
    weights,
    scores,
    total,
    level: cfg.levelOf(total, c.levels),
    lines: { attendance: att.lines, assessment: asm.lines, coding: cod.lines, project: prj.lines },
    projects: prj.list,
  };
  if (!light) {
    out.radar = radarFrom(mine, coded.qById);
    out.engagement = await eng.summary({ crmUser, name: id.name, batch: id.batch }, { asOf });
  }
  return out;
}

// roster of a batch → learner logins
async function batchMembers(batch) {
  if (!batch) return [];
  const roster = await M('Student')
    .find({ batch: rxEq(batch), removed: { $ne: true }, status: { $nin: ['Dropped', 'Withdrawn', 'Archived'] } })
    .select('email name')
    .lean();
  const emails = [...new Set(roster.map((r) => String(r.email || '').toLowerCase()).filter(Boolean))];
  if (!emails.length) return [];
  const admins = await M('Admin').find({ email: { $in: emails.map(rxEq) }, removed: { $ne: true } }).select('_id name email').lean();
  return admins;
}

// Save this week's snapshot; remember which component changed (1A live note)
async function saveSnapshot(r, { emit = true } = {}) {
  if (!r) return null;
  const S = M('LmsScoreSnapshot');
  const week = weekOf();
  const prev = await S.findOne({ crmUser: r.crmUser, week }).lean();
  const eScore = r.engagement ? r.engagement.score : prev ? prev.engagement : null;
  let lastChange = prev ? prev.lastChange : undefined;
  if (prev) {
    for (const k of COMPONENTS) {
      const a = prev[k];
      const b = r.scores[k];
      if (a != null && b != null && Math.round(a) !== Math.round(b)) {
        lastChange = { component: k, from: Math.round(a), to: Math.round(b), at: new Date() };
      }
    }
  }
  const doc = {
    batch: r.batch,
    total: r.total,
    ...r.scores,
    engagement: eScore,
    lastChange,
    computedAt: new Date(),
  };
  await S.updateOne({ crmUser: r.crmUser, week }, { $set: doc }, { upsert: true });
  const changed = !prev || prev.total !== r.total;
  if (emit && changed) {
    try {
      require('../../../socket').emitLmsToUsers([r.crmUser], 'lms:score', { crmUser: r.crmUser, total: r.total });
    } catch (_) {
      /* no socket */
    }
  }
  return { ...doc, week };
}

const FRESH_MS = 15 * 60 * 1000;

// Rank + percentile in the batch, from this week's snapshots (stale or
// missing ones are recalculated first, in a light pass).
async function batchStanding(batch, { force = false } = {}) {
  const members = await batchMembers(batch);
  if (!members.length) return { members: [], rows: [] };
  const S = M('LmsScoreSnapshot');
  const week = weekOf();
  const snaps = await S.find({ crmUser: { $in: members.map((m) => m._id) }, week }).lean();
  const byUser = new Map(snaps.map((s) => [String(s.crmUser), s]));
  const stale = members.filter((m) => {
    const s = byUser.get(String(m._id));
    return force || !s || Date.now() - new Date(s.computedAt).getTime() > FRESH_MS;
  });
  for (const m of stale) {
    // eslint-disable-next-line no-await-in-loop
    const r = await compute(m._id, { light: true }).catch(() => null);
    // eslint-disable-next-line no-await-in-loop
    if (r) byUser.set(String(m._id), { ...(await saveSnapshot(r, { emit: false })), crmUser: m._id });
  }
  const rows = members
    .map((m) => ({ ...(byUser.get(String(m._id)) || {}), crmUser: String(m._id), name: m.name, email: m.email }))
    .sort((a, b) => (b.total ?? -1) - (a.total ?? -1));
  const scored = rows.filter((r) => r.total != null);
  rows.forEach((r) => {
    if (r.total == null) return;
    r.rank = scored.findIndex((x) => x.crmUser === r.crmUser) + 1;
    const below = scored.filter((x) => x.total < r.total).length;
    r.percentile = scored.length > 1 ? Math.round((below / (scored.length - 1)) * 100) : 100;
  });
  return { members, rows, scoredN: scored.length };
}

const avgOf = (rows, k) => {
  const v = rows.map((r) => r[k]).filter((x) => x != null);
  return v.length ? Math.round(avg(v)) : null;
};

// History: weekly snapshots for the last N weeks — missing past weeks are
// computed from the data as it stood at that week's end.
async function history(crmUserId, id, weeks = 12) {
  const S = M('LmsScoreSnapshot');
  const cur = weekOf();
  const list = Array.from({ length: weeks }, (_, i) => eng.addDays(cur, -7 * (weeks - 1 - i)));
  const have = new Map((await S.find({ crmUser: crmUserId, week: { $in: list } }).lean()).map((s) => [s.week, s]));
  for (const w of list) {
    if (have.has(w) || w === cur) continue;
    const end = new Date(`${eng.addDays(w, 7)}T00:00:00+05:30`);
    // eslint-disable-next-line no-await-in-loop
    const r = await compute(crmUserId, { asOf: end, id, light: true }).catch(() => null);
    if (!r) continue;
    const doc = { batch: r.batch, total: r.total, ...r.scores, computedAt: new Date() };
    // eslint-disable-next-line no-await-in-loop
    await S.updateOne({ crmUser: crmUserId, week: w }, { $setOnInsert: doc }, { upsert: true });
    have.set(w, doc);
  }
  return list.map((w) => ({ week: w, total: have.has(w) ? have.get(w).total : null }));
}

// batch average per week from whatever snapshots exist; fills the gaps in the background
const backfilling = new Set();
async function batchHistory(batch, weeks = 12) {
  const S = M('LmsScoreSnapshot');
  const cur = weekOf();
  const list = Array.from({ length: weeks }, (_, i) => eng.addDays(cur, -7 * (weeks - 1 - i)));
  const rows = await S.aggregate([{ $match: { batch, week: { $in: list }, total: { $ne: null } } }, { $group: { _id: '$week', v: { $avg: '$total' }, n: { $sum: 1 } } }]);
  const by = new Map(rows.map((r) => [r._id, r]));
  if (batch && !backfilling.has(batch)) {
    const members = await batchMembers(batch);
    const thin = list.some((w) => w !== cur && (!by.get(w) || by.get(w).n < members.length * 0.6));
    if (thin) {
      backfilling.add(batch);
      setImmediate(async () => {
        try {
          for (const m of members) {
            // eslint-disable-next-line no-await-in-loop
            const id = await identity(m._id);
            // eslint-disable-next-line no-await-in-loop
            if (id) await history(m._id, id, weeks);
          }
        } catch (e) {
          console.error('[score360] batch history', e.message);
        } finally {
          setTimeout(() => backfilling.delete(batch), 60 * 60 * 1000);
        }
      });
    }
  }
  return list.map((w) => ({ week: w, total: by.has(w) ? Math.round(by.get(w).v * 10) / 10 : null }));
}

// Strengths & areas to improve (1A) — rules over the real numbers
function insights(r, batchAvg, radar, radarBatch) {
  const s = [];
  const imp = [];
  const L = r.lines;
  const ax = AXES.map(([a]) => a);
  const strongAxes = ax.filter((a, i) => radar && radar[i] != null && radar[i] >= 80).sort((a, b) => radar[ax.indexOf(b)] - radar[ax.indexOf(a)]);
  if (strongAxes.length) {
    const better = strongAxes.filter((a) => {
      const i = ax.indexOf(a);
      return radarBatch && radarBatch[i] != null && radar[i] > radarBatch[i];
    });
    const top = strongAxes.slice(0, 2);
    s.push(`${top.join(' & ')} at ${Math.min(...top.map((a) => radar[ax.indexOf(a)]))}+${better.length ? ' — above batch average' : ''}`);
  }
  if (r.scores.attendance != null && r.scores.attendance >= 80) s.push(`Attendance ${L.attendance.attPct}% with ${L.attendance.late} late join${L.attendance.late === 1 ? '' : 's'}`);
  if (L.project.avg != null && L.project.avg >= 75) s.push(`Project rubric average ${L.project.avg} / 100`);
  for (const k of COMPONENTS) {
    if (s.length >= 3) break;
    if (r.scores[k] != null && batchAvg[k] != null && r.scores[k] - batchAvg[k] >= 8) s.push(`${k[0].toUpperCase()}${k.slice(1)} ${r.scores[k]} — ${r.scores[k] - batchAvg[k]} pts above batch`);
  }
  const weakAxes = ax.map((a, i) => [a, radar ? radar[i] : null]).filter(([, v]) => v != null && v < 70).sort((a, b) => a[1] - b[1]);
  if (weakAxes.length) imp.push(`${weakAxes[0][0]} (${weakAxes[0][1]}) — practise more questions on this topic`);
  if (L.coding.attempted && L.coding.solved < L.coding.attempted) imp.push(`Coding: ${L.coding.attempted - L.coding.solved} exercise${L.coding.attempted - L.coding.solved === 1 ? '' : 's'} not solved yet`);
  if (L.assessment.lastUnit && L.assessment.lastUnit.pct < 65) imp.push(`Last unit assessment scored ${L.assessment.lastUnit.pct}% — revise and retake if open`);
  if (L.attendance.late >= 3) imp.push(`${L.attendance.late} late joins — join on time to lift the attendance score`);
  if (r.engagement && r.engagement.level.key === 'low') imp.push(`Engagement is low — aim for ${r.engagement.dailyGoalMin} active minutes a day`);
  for (const k of COMPONENTS) {
    if (imp.length >= 3) break;
    if (r.scores[k] == null) imp.push(`No ${k} score yet — it counts once there is data`);
  }
  return { strengths: s.slice(0, 3), improve: imp.slice(0, 3) };
}

module.exports = {
  AXES: AXES.map(([a]) => a),
  COMPONENTS,
  identity,
  compute,
  saveSnapshot,
  batchStanding,
  batchMembers,
  history,
  batchHistory,
  insights,
  codingAnswers,
  radarFrom,
  weekOf,
  avgOf,
  combine,
};
