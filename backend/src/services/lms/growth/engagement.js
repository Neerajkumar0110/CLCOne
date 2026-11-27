const mongoose = require('mongoose');
const cfg = require('./config');

// Learning & engagement score (Figma 3A / 3C / 3E), from real activity.
// Weights + levels come from the 3E settings:
//   practiceTime — avg ACTIVE minutes / day over 14 days vs the default daily goal
//   completion   — avg reading / watch completion of the items opened (30 days)
//   exercises    — coding & output exercises: volume (10 in 14 days = full) 60% + success rate 40%
//   streak       — consecutive days with ≥ 10 active minutes (14 days = full)
// Live-class participation (attended / held) is reported alongside (3C).

const M = (n) => mongoose.model(n);
const rxEq = (s) => new RegExp(`^${String(s || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i');
const STREAK_MIN_SEC = 10 * 60;
const DAY = 86400000;

function istDate(d = new Date()) {
  return new Date(new Date(d).getTime() + 330 * 60000).toISOString().slice(0, 10);
}
function addDays(ymd, n) {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
const istStart = (ymd) => new Date(`${ymd}T00:00:00+05:30`);
const clamp = (v) => Math.max(0, Math.min(100, v));

function streakOf(byDate, today) {
  let d = (byDate[today] || 0) >= STREAK_MIN_SEC ? today : addDays(today, -1);
  let n = 0;
  while ((byDate[d] || 0) >= STREAK_MIN_SEC) {
    n += 1;
    d = addDays(d, -1);
  }
  let best = 0;
  let run = 0;
  let prev = null;
  for (const k of Object.keys(byDate).sort()) {
    if ((byDate[k] || 0) < STREAK_MIN_SEC) {
      run = 0;
      prev = k;
      continue;
    }
    run = prev && addDays(prev, 1) === k && run ? run + 1 : 1;
    best = Math.max(best, run);
    prev = k;
  }
  return { current: n, best: Math.max(best, n) };
}

async function participation(name, batch, from, to) {
  if (!batch) return null;
  const held = await M('LmsLiveSession')
    .countDocuments({ removed: { $ne: true }, batchName: rxEq(batch), status: { $in: ['ended', 'recording_processing', 'recording_available'] }, scheduledStart: { $gte: from, $lte: to } })
    .catch(() => 0);
  if (!held) return { held: 0, attended: 0, pct: null };
  const attended = await M('AttendanceRecord')
    .countDocuments({ removed: { $ne: true }, student: rxEq(name), status: { $in: ['Present', 'Late', 'Left Early'] }, date: { $gte: from, $lte: to } })
    .catch(() => 0);
  return { held, attended: Math.min(attended, held), pct: clamp(Math.round((Math.min(attended, held) / held) * 100)) };
}

// coding / output answers per IST day (exercises attempted & completed)
async function exercisesByDay(crmUser, from, to) {
  const atts = await M('AssessmentAttempt')
    .find({ candidate: crmUser, submittedAt: { $gte: from, $lte: to } })
    .select('_id submittedAt')
    .lean()
    .catch(() => []);
  if (!atts.length) return {};
  const dayOf = new Map(atts.map((a) => [String(a._id), istDate(a.submittedAt)]));
  const ans = await M('AssessmentAttemptQuestion').find({ attemptId: { $in: [...dayOf.keys()] } }).select('attemptId questionId isCorrect').lean();
  const qs = await M('AssessmentQuestion')
    .find({ _id: { $in: [...new Set(ans.map((x) => x.questionId))] }, questionType: { $in: ['PROGRAMMING', 'OUTPUT_BASED'] } })
    .select('_id')
    .lean();
  const code = new Set(qs.map((q) => String(q._id)));
  const out = {};
  for (const x of ans) {
    if (!code.has(String(x.questionId)) || x.isCorrect == null) continue;
    const d = dayOf.get(String(x.attemptId));
    if (!out[d]) out[d] = { attempted: 0, completed: 0 };
    out[d].attempted += 1;
    if (x.isCorrect) out[d].completed += 1;
  }
  return out;
}

async function summary({ crmUser, name, batch }, { asOf = new Date(), heatDays = 26 * 7 } = {}) {
  const c = await cfg.get();
  const E = c.engagement;
  const today = istDate(asOf);
  const from = addDays(today, -(heatDays - 1));
  const days = await M('LmsActivityDay')
    .find({ crmUser, date: { $gte: from, $lte: today } })
    .select('date activeSec idleSec byKind items lastAt logins')
    .lean();
  const byDate = Object.fromEntries(days.map((d) => [d.date, d.activeSec || 0]));
  const sumRange = (a, b) => days.filter((d) => d.date >= a && d.date <= b).reduce((s, d) => s + (d.activeSec || 0), 0);

  const avg14 = sumRange(addDays(today, -13), today) / 14 / 60;
  const practiceTime = clamp(Math.round((avg14 / (E.dailyGoalMin || 90)) * 100));

  const since30 = new Date(new Date(asOf).getTime() - 30 * DAY);
  const prog = await M('LmsContentProgress').find({ crmUser, lastAt: { $gte: since30, $lte: asOf } }).select('readPct videoPct completed').lean();
  const completion = prog.length ? clamp(Math.round(prog.reduce((s, p) => s + (p.completed ? 100 : Math.max(p.readPct || 0, p.videoPct || 0)), 0) / prog.length)) : null;

  const ex = await exercisesByDay(crmUser, istStart(addDays(today, -13)), asOf);
  const exAtt = Object.values(ex).reduce((s, x) => s + x.attempted, 0);
  const exDone = Object.values(ex).reduce((s, x) => s + x.completed, 0);
  const exercises = exAtt ? clamp(Math.round(Math.min(1, exDone / 10) * 60 + (exDone / exAtt) * 40)) : null;

  const st = streakOf(byDate, today);
  const streak = clamp(Math.round((st.current / 14) * 100));

  const comps = { practiceTime, completion, exercises, streak };
  const hasAny = days.length > 0 || prog.length > 0 || exAtt > 0;
  let score = null;
  if (hasAny) {
    let wsum = 0;
    let acc = 0;
    for (const [k, w] of Object.entries(E.weights || {})) {
      if (comps[k] == null) continue;
      wsum += w;
      acc += comps[k] * w;
    }
    score = wsum ? Math.round(acc / wsum) : null;
  }
  const part = await participation(name, batch, new Date(new Date(asOf).getTime() - 7 * DAY), asOf);
  const week0 = addDays(today, -((new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7));
  const lastActive = days.reduce((m, d) => (d.lastAt && (!m || d.lastAt > m) ? d.lastAt : m), null);
  return {
    score,
    level: cfg.engagementLevelOf(score, E.levels),
    components: comps,
    participation: part,
    streak: st.current,
    bestStreak: st.best,
    todayMin: Math.round((byDate[today] || 0) / 60),
    weekMin: Math.round(sumRange(week0, today) / 60),
    // daily / weekly / monthly view of one learner (LMS testing report #39)
    periods: (() => {
      const month0 = `${today.slice(0, 7)}-01`;
      const span = (x, y) => {
        const rows = days.filter((d) => d.date >= x && d.date <= y);
        return { min: Math.round(rows.reduce((t, d) => t + (d.activeSec || 0), 0) / 60), daysActive: rows.filter((d) => (d.activeSec || 0) > 60).length, logins: rows.reduce((t, d) => t + (d.logins || 0), 0) };
      };
      return { today: span(today, today), week: span(week0, today), month: span(month0, today) };
    })(),
    lastWeekMin: Math.round(sumRange(addDays(week0, -7), addDays(today, -7)) / 60),
    monthMin: Math.round(sumRange(`${today.slice(0, 8)}01`, today) / 60),
    avgDailyMin14: Math.round(avg14),
    dailyGoalMin: E.dailyGoalMin,
    lastActive,
    exercises: { attempted: exAtt, completed: exDone, today: ex[today] || { attempted: 0, completed: 0 }, byDay: ex },
    heat: Array.from({ length: heatDays }, (_, i) => {
      const d = addDays(from, i);
      return { date: d, v: Math.round((byDate[d] || 0) / 60) };
    }),
    days,
    today,
    week0,
  };
}

module.exports = { summary, istDate, addDays, istStart, streakOf, participation, exercisesByDay, STREAK_MIN_SEC };
