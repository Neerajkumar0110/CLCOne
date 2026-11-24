const mongoose = require('mongoose');
const A = require('../../../../../services/lms/growth/access');
const cfg = require('../../../../../services/lms/growth/config');
const eng = require('../../../../../services/lms/growth/engagement');
const S = require('../../../../../services/lms/growth/score360');

// Practice & Engagement Tracker (Figma 3A–3E).
//   learner : heartbeat (active / idle seconds), content progress, 3A tracker, 3B content progress
//   mentor  : 3C alerts + learner activity
//   support : 3D outreach queue
// 3E settings live in the growth config (learner360.saveConfig).

const M = (n) => mongoose.model(n);
const ok = (res, result, message) => res.status(200).json({ success: true, result, message });
const bad = (res, code, message) => res.status(code).json({ success: false, result: null, message });
const str = (v, n = 200) => String(v == null ? '' : v).trim().slice(0, n);
const KINDS = ['editor', 'lesson', 'video', 'assessment', 'live', 'material', 'other'];
const DAY = 86400000;

// GET /activity/config — what the panel's tracker should count
async function activityConfig(req, res) {
  const c = await cfg.get();
  return ok(res, { idleTimeoutMin: c.engagement.idleTimeoutMin, active: c.engagement.active, beatSec: 30, track: A.isStudent(req.admin) });
}

// POST /activity/beat  { activeSec, idleSec, kind, ref, title, course, module, topic, first }
async function beat(req, res) {
  if (!A.isStudent(req.admin)) return ok(res, { skipped: true });
  const c = await cfg.get();
  const b = req.body || {};
  const kind = KINDS.includes(b.kind) ? b.kind : 'other';
  let active = Math.max(0, Math.min(65, Math.round(Number(b.activeSec) || 0)));
  let idle = Math.max(0, Math.min(65, Math.round(Number(b.idleSec) || 0)));
  // the admin switched this kind of activity off (3E "Counts as active")
  const map = { editor: 'editor', lesson: 'lesson', material: 'lesson', video: 'video', assessment: 'assessment', live: 'live' };
  if (map[kind] && c.engagement.active && c.engagement.active[map[kind]] === false) {
    idle += active;
    active = 0;
  }
  const now = new Date();
  const date = eng.istDate(now);
  const hour = Number(new Date(now.getTime() + 330 * 60000).toISOString().slice(11, 13));
  const D = M('LmsActivityDay');
  const inc = { activeSec: active, idleSec: idle, [`byKind.${kind}`]: active };
  if (b.first) inc.logins = 1;
  const upd = { $inc: inc, $set: { lastAt: now, email: req.admin.email }, $setOnInsert: { firstAt: now } };
  await D.updateOne({ crmUser: req.admin._id, date }, upd, { upsert: true });
  if (active) {
    // per-hour seconds (create the 24 slots once)
    await D.updateOne({ crmUser: req.admin._id, date, hours: { $exists: false } }, { $set: { hours: Array(24).fill(0) } });
    await D.updateOne({ crmUser: req.admin._id, date }, { $inc: { [`hours.${hour}`]: active } });
    const ref = str(b.ref, 120);
    if (ref) {
      const item = { kind, ref, title: str(b.title, 160), course: str(b.course, 160), module: str(b.module, 160), topic: str(b.topic, 160) };
      const r = await D.updateOne({ crmUser: req.admin._id, date, items: { $elemMatch: { kind, ref } } }, { $inc: { 'items.$.activeSec': active }, $set: { 'items.$.title': item.title || undefined } });
      if (!r.matchedCount) await D.updateOne({ crmUser: req.admin._id, date }, { $push: { items: { $each: [{ ...item, activeSec: active }], $slice: -200 } } });
    }
  }
  return ok(res, { date, active, idle });
}

// POST /content/progress  { kind, ref, title, course, module, open, activeSec, scrollDepth, durationSec, watched:[bucket…], pauses, rewatches }
async function contentProgress(req, res) {
  if (!A.isStudent(req.admin)) return ok(res, { skipped: true });
  const b = req.body || {};
  const kind = ['lesson', 'material', 'video', 'recording'].includes(b.kind) ? b.kind : null;
  const ref = str(b.ref, 120);
  if (!kind || !ref) return bad(res, 400, 'kind and ref are required');
  const P = M('LmsContentProgress');
  const now = new Date();
  let row = await P.findOne({ crmUser: req.admin._id, kind, ref });
  if (!row) row = new P({ crmUser: req.admin._id, kind, ref, firstAt: now });
  if (b.title) row.title = str(b.title, 160);
  if (b.course) row.course = str(b.course, 160);
  if (b.module) row.module = str(b.module, 160);
  if (b.open) row.opens += 1;
  row.activeSec += Math.max(0, Math.min(120, Math.round(Number(b.activeSec) || 0)));
  if (b.scrollDepth != null) row.scrollDepth = Math.max(row.scrollDepth || 0, Math.max(0, Math.min(100, Math.round(Number(b.scrollDepth)))));
  if (b.durationSec) row.durationSec = Math.round(Number(b.durationSec));
  if (Array.isArray(b.watched) && row.durationSec) {
    const n = Math.ceil(row.durationSec / 10);
    const m = (row.watchedMap || '').padEnd(n, '0').split('').slice(0, n);
    for (const i of b.watched) if (Number.isInteger(i) && i >= 0 && i < n) m[i] = '1';
    row.watchedMap = m.join('');
    const got = m.filter((x) => x === '1').length;
    row.watchedSec = Math.min(row.durationSec, got * 10);
    row.videoPct = Math.round((got / n) * 100);
  }
  row.pauses += Math.max(0, Math.min(50, Math.round(Number(b.pauses) || 0)));
  row.rewatches += Math.max(0, Math.min(50, Math.round(Number(b.rewatches) || 0)));
  // reading completion: scroll depth, plus time on page (3B rule: 90% scroll + 2 min active)
  if (kind === 'lesson' || kind === 'material') row.readPct = Math.min(100, Math.round(row.scrollDepth * (row.activeSec >= 120 ? 1 : 0.9)));
  const done = kind === 'lesson' || kind === 'material' ? row.scrollDepth >= 90 && row.activeSec >= 120 : row.videoPct >= 90;
  if (done && !row.completed) {
    row.completed = true;
    row.completedAt = now;
  }
  row.lastAt = now;
  await row.save();
  return ok(res, { completed: row.completed, readPct: row.readPct, videoPct: row.videoPct });
}

// ── 3A ──
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const hm = (sec) => {
  const m = Math.round((sec || 0) / 60);
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`;
};

// GET /practice/me?range=day|week|month
async function practice(req, res) {
  const id = await S.identity(req.admin._id);
  if (!id) return bad(res, 404, 'Learner not found.');
  const c = await cfg.get();
  const E = c.engagement;
  const s = await eng.summary({ crmUser: req.admin._id, name: id.name, batch: id.batch }, { heatDays: 46 * 7 });
  const prof = (await M('LmsLearnerProfile').findOne({ crmUser: req.admin._id }).select('practice').lean()) || {};
  const pr = prof.practice || {};
  const goal = pr.goalMin || E.dailyGoalMin;
  const range = ['day', 'week', 'month'].includes(req.query.range) ? req.query.range : 'week';
  const today = s.today;
  const byDate = Object.fromEntries(s.days.map((d) => [d.date, d]));

  // bars for the range
  let bars = [];
  let xl = [];
  let from = s.week0;
  if (range === 'day') {
    const h = (byDate[today] && byDate[today].hours) || Array(24).fill(0);
    bars = h.map((x) => Math.round((x / 3600) * 100) / 100);
    xl = h.map((_, i) => (i % 3 === 0 ? `${i}` : ''));
    from = today;
  } else if (range === 'week') {
    xl = Array.from({ length: 7 }, (_, i) => {
      const d = eng.addDays(s.week0, i);
      return d === today ? `${DOW[new Date(`${d}T00:00:00Z`).getUTCDay()]} (today)` : DOW[new Date(`${d}T00:00:00Z`).getUTCDay()];
    });
    bars = Array.from({ length: 7 }, (_, i) => {
      const d = eng.addDays(s.week0, i);
      return d > today ? 0 : Math.round(((byDate[d] && byDate[d].activeSec) || 0) / 36) / 100;
    });
  } else {
    from = `${today.slice(0, 8)}01`;
    const n = new Date(Date.UTC(Number(today.slice(0, 4)), Number(today.slice(5, 7)), 0)).getUTCDate();
    xl = Array.from({ length: n }, (_, i) => (i % 5 === 0 || i === n - 1 ? String(i + 1) : ''));
    bars = Array.from({ length: n }, (_, i) => {
      const d = eng.addDays(from, i);
      return d > today ? 0 : Math.round(((byDate[d] && byDate[d].activeSec) || 0) / 36) / 100;
    });
  }
  const inRange = s.days.filter((d) => d.date >= from && d.date <= today);
  const kinds = { editor: 0, lesson: 0, video: 0, assessment: 0, live: 0 };
  let idle = 0;
  for (const d of inRange) {
    for (const k of Object.keys(kinds)) kinds[k] += (d.byKind && d.byKind[k]) || 0;
    kinds.lesson += (d.byKind && d.byKind.material) || 0;
    idle += d.idleSec || 0;
  }

  // heatmap stats
  const year = today.slice(0, 4);
  const yearDays = s.days.filter((d) => d.date.startsWith(year));
  const activeDays = s.days.filter((d) => (d.activeSec || 0) >= 60).length;
  const firstDay = s.days.length ? s.days.reduce((m, d) => (d.date < m ? d.date : m), today) : today;
  const span = Math.max(1, Math.round((new Date(`${today}T00:00:00Z`) - new Date(`${firstDay}T00:00:00Z`)) / DAY) + 1);
  const dowHour = {};
  for (const d of s.days) {
    const dw = DOW[new Date(`${d.date}T00:00:00Z`).getUTCDay()];
    (d.hours || []).forEach((v, h) => {
      const k = `${dw}|${Math.floor(h / 2) * 2}`;
      dowHour[k] = (dowHour[k] || 0) + v;
    });
  }
  const best = Object.entries(dowHour).sort((a, b) => b[1] - a[1])[0];
  const fmtH = (h) => `${h % 12 || 12}${h < 12 ? ' AM' : ' PM'}`.replace(' AM', ' AM').replace(' PM', ' PM');
  const mostActive = best && best[1] > 0 ? `${best[0].split('|')[0]} · ${fmtH(Number(best[0].split('|')[1]))}–${fmtH(Number(best[0].split('|')[1]) + 2)}` : '—';

  // time per course › module › topic (all tracked time)
  const tree = new Map();
  for (const d of s.days) {
    for (const it of d.items || []) {
      const course = it.course || id.roster?.course || 'General';
      const mod = it.module || '';
      const topic = it.title || it.topic || '';
      const ck = course;
      if (!tree.has(ck)) tree.set(ck, { sec: 0, mods: new Map() });
      const cn = tree.get(ck);
      cn.sec += it.activeSec || 0;
      if (!mod) continue;
      if (!cn.mods.has(mod)) cn.mods.set(mod, { sec: 0, topics: new Map() });
      const mn = cn.mods.get(mod);
      mn.sec += it.activeSec || 0;
      if (topic) mn.topics.set(`${it.kind}|${it.ref}`, { title: topic, sec: (mn.topics.get(`${it.kind}|${it.ref}`) || { sec: 0 }).sec + (it.activeSec || 0), kind: it.kind, ref: it.ref });
    }
  }
  const prog = await M('LmsContentProgress').find({ crmUser: req.admin._id }).select('kind ref module course readPct videoPct completed').lean();
  const pOf = (kind, ref) => prog.find((p) => p.ref === ref && (p.kind === kind || (kind === 'video' && p.kind === 'recording') || (kind === 'material' && p.kind === 'material')));
  const pct = (p) => (p ? (p.completed ? 100 : Math.max(p.readPct || 0, p.videoPct || 0)) : null);
  const avgPct = (list) => {
    const v = list.map(pct).filter((x) => x != null);
    return v.length ? Math.round(v.reduce((a, b) => a + b, 0) / v.length) : null;
  };
  const coding = (await S.compute(req.admin._id, { light: true, id })).lines.coding;
  const rows = [];
  for (const [course, cn] of [...tree.entries()].sort((a, b) => b[1].sec - a[1].sec)) {
    rows.push({ level: 0, name: course, time: hm(cn.sec), completion: avgPct(prog.filter((p) => !p.course || p.course === course)), exercises: `${coding.solved} / ${coding.attempted}` });
    for (const [mod, mn] of [...cn.mods.entries()].sort((a, b) => b[1].sec - a[1].sec).slice(0, 8)) {
      rows.push({ level: 1, name: mod, time: hm(mn.sec), completion: avgPct(prog.filter((p) => p.module === mod)), exercises: '—' });
      for (const t of [...mn.topics.values()].sort((a, b) => b.sec - a.sec).slice(0, 6)) rows.push({ level: 2, name: t.title, time: hm(t.sec), completion: pct(pOf(t.kind, t.ref)), exercises: '—' });
    }
  }

  // today's goal checklist (real): 3 exercises, 1 lecture, the lesson in progress
  const lectureToday = await M('LmsContentProgress').countDocuments({ crmUser: req.admin._id, kind: { $in: ['video', 'recording'] }, completed: true, completedAt: { $gte: eng.istStart(today) } });
  const reading = await M('LmsContentProgress').findOne({ crmUser: req.admin._id, kind: { $in: ['lesson', 'material'] }, completed: false }).sort({ lastAt: -1 }).select('title readPct').lean();
  const readToday = await M('LmsContentProgress').countDocuments({ crmUser: req.admin._id, kind: { $in: ['lesson', 'material'] }, completed: true, completedAt: { $gte: eng.istStart(today) } });
  const exT = s.exercises.today;

  // upcoming class for the reminders list
  const next = id.batch
    ? await M('LmsLiveSession').findOne({ removed: { $ne: true }, batchName: A.rxEq(id.batch), scheduledStart: { $gt: new Date() }, status: { $nin: ['cancelled', 'ended'] } }).sort({ scheduledStart: 1 }).select('title scheduledStart').lean()
    : null;
  const remindHour = pr.remindHour ?? E.reminderHour;
  const left = Math.max(0, goal - s.todayMin);
  const reminders = [];
  if (pr.remind !== false) reminders.push({ i: 'bell', tone: 'pri', text: `${remindHour % 12 || 12}:00 ${remindHour < 12 ? 'AM' : 'PM'} · ${left ? `"${left} min left to hit today's goal"` : '"Goal done — nice work"'}` });
  if (E.streakRisk && pr.streakAlert !== false && s.streak >= 1) reminders.push({ i: 'flame', tone: 'or', text: `Streak at risk · nothing logged by 9 PM${s.todayMin >= 10 ? ' (safe today ✓)' : ''}` });
  if (next) reminders.push({ i: 'cal', tone: 'ind', text: `Live class ${new Date(next.scheduledStart).toLocaleString('en-IN', { weekday: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' })} · ${next.title || 'class'}` });

  const ex30 = await eng.exercisesByDay(req.admin._id, new Date(Date.now() - 30 * DAY), new Date());
  const att30 = Object.values(ex30).reduce((x, y) => x + y.attempted, 0);
  const done30 = Object.values(ex30).reduce((x, y) => x + y.completed, 0);

  return ok(res, {
    range,
    goalMin: goal,
    defaultGoalMin: E.dailyGoalMin,
    idleTimeoutMin: E.idleTimeoutMin,
    prefs: { goalMin: pr.goalMin || null, remindHour, remind: pr.remind !== false, streakAlert: pr.streakAlert !== false },
    kpis: {
      todayMin: s.todayMin,
      weekMin: s.weekMin,
      lastWeekMin: s.lastWeekMin,
      monthMin: s.monthMin,
      monthDays: Number(today.slice(8, 10)),
      streak: s.streak,
      bestStreak: s.bestStreak,
      score: s.score,
      level: s.level,
    },
    goal: {
      pct: Math.min(100, Math.round((s.todayMin / goal) * 100)),
      items: [
        { label: `Solve 3 coding exercises · ${Math.min(3, exT.completed)}/3`, done: exT.completed >= 3 },
        { label: `Watch 1 lecture${lectureToday ? ' ✓' : ''}`, done: lectureToday > 0 },
        { label: reading ? `Read ${reading.title}` : 'Read 1 lesson', done: readToday > 0 },
      ],
    },
    heat: s.heat,
    heatStats: { activeDays, spanDays: span, longest: s.bestStreak, mostActive, idleYear: hm(yearDays.reduce((x, d) => x + (d.idleSec || 0), 0)) },
    bars: { values: bars, xl, goalH: Math.round((goal / 60) * 100) / 100 },
    where: kinds,
    idleRange: idle,
    tree: rows,
    exercises: { attempted: att30, completed: done30, success: att30 ? Math.round((done30 / att30) * 100) : null },
    reminders,
  });
}

// PUT /practice/me  { goalMin, remindHour, remind, streakAlert }
async function savePractice(req, res) {
  const b = req.body || {};
  const set = { email: req.admin.email, updated: new Date() };
  if (b.goalMin !== undefined) set['practice.goalMin'] = b.goalMin ? Math.max(10, Math.min(600, Math.round(Number(b.goalMin)))) : null;
  if (b.remindHour !== undefined) set['practice.remindHour'] = Math.max(0, Math.min(23, Math.round(Number(b.remindHour))));
  if (b.remind !== undefined) set['practice.remind'] = !!b.remind;
  if (b.streakAlert !== undefined) set['practice.streakAlert'] = !!b.streakAlert;
  await M('LmsLearnerProfile').updateOne({ crmUser: req.admin._id }, { $set: set }, { upsert: true });
  return ok(res, null, 'Saved');
}

// ── 3B ──
// GET /content/me?module=
async function contentMe(req, res) {
  const rows = await M('LmsContentProgress').find({ crmUser: req.admin._id }).sort({ lastAt: -1 }).lean();
  const modules = [...new Set(rows.map((r) => r.module).filter(Boolean))];
  // how many modules exist on the curriculum (for "9 / 12")
  let totalModules = null;
  try {
    const id = await S.identity(req.admin._id);
    if (id && id.roster && id.roster.course) {
      const course = await M('Course').findOne({ title: A.rxEq(id.roster.course), removed: false }).select('_id').lean();
      if (course) totalModules = await M('CourseModule').countDocuments({ course: course._id, removed: { $ne: true } });
    }
  } catch (_) {
    totalModules = null;
  }
  const reading = rows.filter((r) => r.kind === 'lesson' || r.kind === 'material');
  const videos = rows.filter((r) => r.kind === 'video' || r.kind === 'recording');
  const avg = (a) => (a.length ? Math.round(a.reduce((s, x) => s + x, 0) / a.length) : null);
  const mod = req.query.module || modules[0] || null;
  const list = mod ? rows.filter((r) => r.module === mod) : rows.slice(0, 30);
  const status = (r) => (r.completed ? 'completed' : (r.readPct || r.videoPct || r.activeSec) ? 'in_progress' : 'not_started');
  return ok(res, {
    modules,
    module: mod,
    kpis: {
      modulesOpened: modules.length,
      totalModules,
      pagesRead: reading.length,
      avgPageSec: reading.length ? Math.round(reading.reduce((s, r) => s + r.activeSec, 0) / reading.length) : null,
      readingCompletion: avg(reading.map((r) => (r.completed ? 100 : r.readPct || 0))),
      avgScroll: avg(reading.map((r) => r.scrollDepth || 0)),
      videoWatch: avg(videos.map((r) => r.videoPct || 0)),
      pauses: videos.reduce((s, r) => s + (r.pauses || 0), 0),
      rewatches: videos.reduce((s, r) => s + (r.rewatches || 0), 0),
    },
    rows: list.map((r) => ({
      id: String(r._id),
      kind: r.kind,
      ref: r.ref,
      title: r.title || r.ref,
      module: r.module,
      course: r.course,
      activeSec: r.activeSec,
      scrollDepth: r.scrollDepth,
      readPct: r.readPct,
      videoPct: r.videoPct,
      durationSec: r.durationSec,
      watchedSec: r.watchedSec,
      watchedMap: r.watchedMap,
      pauses: r.pauses,
      rewatches: r.rewatches,
      opens: r.opens,
      completed: r.completed,
      status: status(r),
      lastAt: r.lastAt,
    })),
    moduleCompletion: avg(list.map((r) => (r.completed ? 100 : Math.max(r.readPct || 0, r.videoPct || 0)))),
  });
}

// ── 3C mentor ──
async function mentorScope(req) {
  const batches = await A.mentorBatches(req.admin);
  const names = req.query.batch ? batches.filter((b) => b.name === req.query.batch).map((b) => b.name) : batches.map((b) => b.name);
  return { batches: batches.map((b) => b.name), names };
}

// GET /engagement/mentor?batch=
async function mentorEngagement(req, res) {
  if (!A.isTeacher(req.admin) && !A.isManager(req.admin)) return bad(res, 403, 'Mentors only.');
  const { batches, names } = await mentorScope(req);
  if (A.isManager(req.admin) && !req.query.batch) return ok(res, { batches, needBatch: true, rows: [], alerts: [], kpis: null });
  const c = await cfg.get();
  const learners = await A.learnersOf(names);
  const today = eng.istDate();
  const weekAgo = new Date(Date.now() - 7 * DAY);
  const rows = [];
  for (const l of learners) {
    // eslint-disable-next-line no-await-in-loop
    const s = await eng.summary({ crmUser: l._id, name: l.name, batch: l.roster && l.roster.batch }, { heatDays: 30 });
    const logins = s.days.filter((d) => d.date >= eng.addDays(today, -6)).reduce((x, d) => x + (d.logins || 0), 0);
    const exW = Object.entries(s.exercises.byDay).filter(([d]) => d >= eng.addDays(today, -6));
    // eslint-disable-next-line no-await-in-loop
    const [doubts, chats] = await Promise.all([
      M('Doubt').countDocuments({ student: l._id, created: { $gte: weekAgo } }).catch(() => 0),
      M('LiveClassChat').countDocuments({ author: l._id, created: { $gte: weekAgo } }).catch(() => 0),
    ]);
    rows.push({
      id: String(l._id),
      name: l.name,
      batch: l.roster && l.roster.batch,
      lastActive: s.lastActive,
      logins,
      streak: s.streak,
      weekMin: s.weekMin,
      exercises: { done: exW.reduce((x, [, v]) => x + v.completed, 0), att: exW.reduce((x, [, v]) => x + v.attempted, 0) },
      live: s.participation || { held: 0, attended: 0 },
      doubts,
      discussions: chats,
      score: s.score,
      level: s.level,
    });
  }
  rows.sort((a, b) => (b.score ?? -1) - (a.score ?? -1));
  const ids = learners.map((l) => l._id);
  const alerts = await M('LmsEngagementAlert').find({ learner: { $in: ids }, status: 'open', kind: { $in: ['inactiveMentor', 'lowStreak', 'missedLive', 'streakBroken', 'readinessLow', 'manual'] } }).sort({ created: -1 }).limit(50).lean();
  // 12-week trend: my learners vs batch (engagement in the weekly snapshots)
  const cur = S.weekOf();
  const weeks = Array.from({ length: 12 }, (_, i) => eng.addDays(cur, -7 * (11 - i)));
  const [mine, all] = await Promise.all([
    M('LmsScoreSnapshot').aggregate([{ $match: { crmUser: { $in: ids }, week: { $in: weeks }, engagement: { $ne: null } } }, { $group: { _id: '$week', v: { $avg: '$engagement' } } }]),
    M('LmsScoreSnapshot').aggregate([{ $match: { batch: { $in: names }, week: { $in: weeks }, engagement: { $ne: null } } }, { $group: { _id: '$week', v: { $avg: '$engagement' } } }]),
  ]);
  const m1 = new Map(mine.map((x) => [x._id, Math.round(x.v)]));
  const m2 = new Map(all.map((x) => [x._id, Math.round(x.v)]));
  const L = c.engagement.levels;
  return ok(res, {
    batches,
    batch: req.query.batch || null,
    kpis: {
      high: rows.filter((r) => r.score != null && r.score >= L.high).length,
      moderate: rows.filter((r) => r.score != null && r.score >= L.moderate && r.score < L.high).length,
      low: rows.filter((r) => r.score != null && r.score < L.moderate).length,
      none: rows.filter((r) => r.score == null).length,
      openAlerts: alerts.length,
      newToday: alerts.filter((a) => new Date(a.created) >= eng.istStart(today)).length,
    },
    levels: L,
    alerts: alerts.map((a) => ({ id: String(a._id), learner: String(a.learner), name: a.learnerName, kind: a.kind, text: a.text, severity: a.severity, at: a.created, queue: a.queue, nudges: (a.nudges || []).length })),
    trend: { weeks: weeks.map((_, i) => `W${i + 1}`), mine: weeks.map((w) => m1.get(w) ?? null), batch: weeks.map((w) => m2.get(w) ?? null) },
    rows,
  });
}

async function loadAlert(req, res) {
  if (!mongoose.isValidObjectId(req.params.id)) {
    bad(res, 400, 'Bad id.');
    return null;
  }
  const a = await M('LmsEngagementAlert').findById(req.params.id);
  if (!a) {
    bad(res, 404, 'Alert not found.');
    return null;
  }
  if (!A.isManager(req.admin) && !(await A.canView(req.admin, a.learner))) {
    bad(res, 403, 'Not your learner.');
    return null;
  }
  return a;
}

// POST /engagement/alerts/:id/nudge  { text? }
async function nudgeLearner(req, res) {
  const a = await loadAlert(req, res);
  if (!a) return;
  const text = str(req.body && req.body.text, 600) || `Hi ${String(a.learnerName || '').split(' ')[0]}, we missed you in the LMS. 10 focused minutes today keeps your progress going — your mentor ${req.admin.name}.`;
  await require('../../../../../services/lms/realtime').notify([a.learner], { type: 'lms.engagement.nudge', title: `A nudge from ${req.admin.name}`, body: text, link: '/learn/practice' });
  if (a.learnerEmail) require('../../../../../services/lms/mailer').sendMail([a.learnerEmail], { subject: `A nudge from ${req.admin.name}`, text: `${text}\n\nCareerLab LMS` }).catch(() => {});
  a.nudges.push({ at: new Date(), by: req.admin.name });
  a.updated = new Date();
  await a.save();
  return ok(res, null, 'Nudge sent (in-app + email)');
}

// POST /engagement/learner/:learnerId/message  { text }
async function messageLearner(req, res) {
  if (!(await A.canView(req.admin, req.params.learnerId))) return bad(res, 403, 'Not your learner.');
  const text = str(req.body && req.body.text, 1500);
  if (text.length < 3) return bad(res, 400, 'Write the message.');
  const l = await M('Admin').findById(req.params.learnerId).select('email name').lean();
  await require('../../../../../services/lms/realtime').notify([req.params.learnerId], { type: 'lms.message', title: `Message from ${req.admin.name}`, body: text, link: '/learn' });
  if (l && l.email) require('../../../../../services/lms/mailer').sendMail([l.email], { subject: `Message from ${req.admin.name}`, text: `${text}\n\nCareerLab LMS` }).catch(() => {});
  return ok(res, null, 'Message sent');
}

// POST /engagement/alerts/:id/to-support
async function toSupport(req, res) {
  const a = await loadAlert(req, res);
  if (!a) return;
  a.queue = 'to_contact';
  a.sentToSupportBy = req.admin.name;
  a.updated = new Date();
  await a.save();
  const sup = await M('Admin').find({ role: 'Support', removed: { $ne: true } }).select('_id').lean();
  await require('../../../../../services/lms/realtime').notify(sup.map((x) => x._id), { type: 'lms.engagement.outreach', title: `Outreach request: ${a.learnerName}`, body: `${req.admin.name}: ${a.text}`, link: '/support-mgr/inactive' });
  return ok(res, null, 'Sent to the support outreach queue');
}

// POST /engagement/alerts/:id/resolve
async function resolveAlert(req, res) {
  const a = await loadAlert(req, res);
  if (!a) return;
  a.status = 'resolved';
  a.resolvedAt = new Date();
  await a.save();
  return ok(res, null, 'Alert closed');
}

// ── 3D support outreach ──
// GET /engagement/outreach?tab=to_contact|follow_up|resolved
async function outreach(req, res) {
  if (!A.isManager(req.admin)) return bad(res, 403, 'Support / admin only.');
  const tab = ['to_contact', 'follow_up', 'resolved'].includes(req.query.tab) ? req.query.tab : 'to_contact';
  const AL = M('LmsEngagementAlert');
  const today = eng.istStart(eng.istDate());
  const c = await cfg.get();
  const [rows, inQueue, newToday, contactedToday, reached, reactivated, risk] = await Promise.all([
    AL.find({ queue: tab }).sort(tab === 'follow_up' ? { followUpAt: 1 } : { inactiveDays: -1, created: -1 }).limit(200).lean(),
    AL.countDocuments({ queue: { $in: ['to_contact', 'follow_up'] } }),
    AL.countDocuments({ queue: { $in: ['to_contact', 'follow_up'] }, created: { $gte: today } }),
    AL.countDocuments({ lastContactAt: { $gte: today } }),
    AL.countDocuments({ lastContactAt: { $gte: today }, lastOutcome: /^Reached/i }),
    AL.countDocuments({ reactivatedAt: { $gte: new Date(Date.now() - 7 * DAY) } }),
    AL.countDocuments({ dropRisk: true, queue: { $ne: 'resolved' } }),
  ]);
  return ok(res, {
    tab,
    days: c.engagement.rules.inactiveSupport.days,
    kpis: { inQueue, newToday, contactedToday, reached, reactivated, risk },
    rows: rows.map((a) => ({
      id: String(a._id),
      learner: String(a.learner),
      name: a.learnerName,
      email: a.learnerEmail,
      phone: a.learnerPhone,
      learnerId: a.learnerId,
      batch: a.batch,
      mentor: a.mentorName,
      inactiveDays: a.inactiveDays,
      lastActive: a.lastActive,
      text: a.text,
      attempts: a.attempts,
      lastOutcome: a.lastOutcome,
      lastContactAt: a.lastContactAt,
      channels: [...new Set((a.contacts || []).map((x) => x.channel))],
      notes: a.notes,
      followUpAt: a.followUpAt,
      escalateTo: a.escalateTo,
      dropRisk: a.dropRisk,
      reactivatedAt: a.reactivatedAt,
      contacts: (a.contacts || []).slice(-10),
    })),
  });
}

// GET /engagement/outreach/:id/learner — the side panel numbers
async function outreachLearner(req, res) {
  const a = await loadAlert(req, res);
  if (!a) return;
  const id = await S.identity(a.learner);
  const s = id ? await eng.summary({ crmUser: a.learner, name: id.name, batch: id.batch }, { heatDays: 30 }) : null;
  const snap = await M('LmsScoreSnapshot').findOne({ crmUser: a.learner }).sort({ week: -1 }).select('total').lean();
  const projs = await M('LmsProjectAllocation').find({ removed: false, $or: [{ learner: a.learner }, { members: a.learner }] }).select('status').lean().catch(() => []);
  const dq = projs.filter((p) => p.status === 'disqualified').length;
  return ok(res, {
    engagement: s ? s.score : null,
    readiness: snap && snap.total != null ? Math.round(snap.total) : null,
    projects: dq ? `${dq} disq.` : `${projs.length}`,
    projectsBad: dq > 0,
    phone: (id && id.roster && id.roster.phone) || a.learnerPhone || '',
    email: a.learnerEmail,
    mentor: id ? id.mentorName : a.mentorName,
  });
}

// POST /engagement/outreach/:id  { channel, outcome, notes, followUpAt, escalateTo }
async function saveOutreach(req, res) {
  if (!A.isManager(req.admin)) return bad(res, 403, 'Support / admin only.');
  const a = await loadAlert(req, res);
  if (!a) return;
  const b = req.body || {};
  const outcome = str(b.outcome, 120);
  if (!outcome) return bad(res, 400, 'Pick the outcome.');
  const now = new Date();
  a.attempts += 1;
  a.contacts.push({ at: now, by: req.admin.name, channel: str(b.channel, 20) || 'call', outcome, notes: str(b.notes, 1000) });
  a.lastContactAt = now;
  a.lastOutcome = outcome;
  a.notes = str(b.notes, 1000);
  a.followUpAt = b.followUpAt ? new Date(b.followUpAt) : null;
  a.escalateTo = str(b.escalateTo, 40);
  a.queue = /^Resolved|Re-activated/i.test(outcome) ? 'resolved' : a.followUpAt ? 'follow_up' : a.queue === 'to_contact' && /^Reached/i.test(outcome) ? 'follow_up' : a.queue || 'to_contact';
  if (a.queue === 'resolved') {
    a.status = 'resolved';
    a.resolvedAt = now;
  }
  a.updated = now;
  await a.save();
  if (a.escalateTo === 'Mentor' && a.mentor) {
    await require('../../../../../services/lms/realtime').notify([a.mentor], { type: 'lms.engagement.escalation', title: `Support escalated: ${a.learnerName}`, body: `${outcome}${a.notes ? ` — ${a.notes}` : ''}`, link: '/teacher/engagement' });
  }
  if (a.escalateTo === 'Admin') {
    const adm = await M('Admin').find({ role: { $in: ['owner', 'Super Admin', 'Admin'] }, removed: { $ne: true } }).select('_id').lean();
    await require('../../../../../services/lms/realtime').notify(adm.map((x) => x._id), { type: 'lms.engagement.escalation', title: `Support escalated: ${a.learnerName}`, body: `${outcome}${a.notes ? ` — ${a.notes}` : ''}`, link: '/support-mgr/inactive' });
  }
  return ok(res, null, 'Outcome saved');
}

// POST /engagement/outreach/:id/drop-risk
async function dropRisk(req, res) {
  if (!A.isManager(req.admin)) return bad(res, 403, 'Support / admin only.');
  const a = await loadAlert(req, res);
  if (!a) return;
  a.dropRisk = !a.dropRisk;
  a.dropRiskAt = a.dropRisk ? new Date() : null;
  await a.save();
  if (a.dropRisk) {
    const adm = await M('Admin').find({ role: { $in: ['owner', 'Super Admin', 'Admin'] }, removed: { $ne: true } }).select('_id').lean();
    await require('../../../../../services/lms/realtime').notify(adm.map((x) => x._id), { type: 'lms.engagement.droprisk', title: `Drop-out risk: ${a.learnerName}`, body: `${a.batch} · ${a.text}`, link: '/support-mgr/inactive' });
  }
  return ok(res, { dropRisk: a.dropRisk }, a.dropRisk ? 'Marked as drop-out risk — admins alerted' : 'Drop-out risk cleared');
}

// POST /engagement/outreach/:id/email  { text }
async function outreachEmail(req, res) {
  if (!A.isManager(req.admin)) return bad(res, 403, 'Support / admin only.');
  const a = await loadAlert(req, res);
  if (!a) return;
  const text = str(req.body && req.body.text, 2000);
  if (!a.learnerEmail) return bad(res, 400, 'No email on file.');
  if (text.length < 5) return bad(res, 400, 'Write the message.');
  const r = await require('../../../../../services/lms/mailer').sendMail([a.learnerEmail], { subject: 'We miss you at CareerLab', text: `${text}\n\nCareerLab Support` });
  await require('../../../../../services/lms/realtime').notify([a.learner], { type: 'lms.engagement.outreach', title: 'A message from CareerLab Support', body: text, link: '/learn' });
  return ok(res, { sent: r.sent || 0 }, r.sent ? 'Email sent' : `Email not sent${r.skipped ? ` (${r.skipped})` : ''} — in-app message delivered`);
}

module.exports = {
  activityConfig,
  beat,
  contentProgress,
  practice,
  savePractice,
  contentMe,
  mentorEngagement,
  nudgeLearner,
  messageLearner,
  toSupport,
  resolveAlert,
  outreach,
  outreachLearner,
  saveOutreach,
  dropRisk,
  outreachEmail,
};
