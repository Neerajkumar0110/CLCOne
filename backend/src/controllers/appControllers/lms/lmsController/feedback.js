const mongoose = require('mongoose');
const { LMS_STUDENT_ROLES, CRM_ADMIN_ROLES } = require('../../../../config/roles');
const cfg = require('../../../../config/lmsFeedback');
const { trainerNames } = require('../../../../services/lms/teacherCourseAccess');
const { notify, notifyUser } = require('../../../../notify');

// Weekly learner feedback (design L7 learner form, P7 Project Manager
// summary, S8 Feedback centre). Week = Monday 00:00 IST, keyed YYYY-MM-DD.
//   GET  /api/lms/my/feedback                  learner: window, questions, history
//   POST /api/lms/my/feedback                  learner: submit { kind, answers, comment, concern, concernText }
//   GET  /api/lms/feedback/my-summary          PM: category averages (min responses), trend
//   GET/POST /api/lms/feedback/actions, PATCH /api/lms/feedback/actions/:id   PM improvement actions
//   GET  /api/lms/feedback/admin/overview      managers: response rates, non-respondents, concerns
//   POST /api/lms/feedback/admin/remind        managers: remind a batch's non-respondents

const IST_MS = 330 * 60000;
const DAY = 86400000;
const ok = (res, result, message) => res.status(200).json({ success: true, result, message });
const bad = (res, code, message) => res.status(code).json({ success: false, result: null, message });
const rx = (s) => new RegExp(`^${String(s || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i');
const isStudent = (a) => !!(a && LMS_STUDENT_ROLES.includes(a.role));
const isManagement = (a) => !!(a && CRM_ADMIN_ROLES.includes(a.role));
// "now" for the weekly window — swappable only by tests (_week.setClock)
let clockFn = () => new Date();
const clock = () => clockFn();

// Monday 00:00 IST of the week containing `d`, as a UTC Date.
function weekStart(d) {
  const ist = new Date(d.getTime() + IST_MS);
  const dow = (ist.getUTCDay() + 6) % 7; // Mon=0
  const mondayIst = Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate() - dow);
  return new Date(mondayIst - IST_MS);
}
const keyOf = (ws) => new Date(ws.getTime() + IST_MS).toISOString().slice(0, 10);
const fromKey = (k) => new Date(Date.parse(`${k}T00:00:00Z`) - IST_MS);
const opensAt = (ws) => new Date(ws.getTime() + cfg.WINDOW.opensDayOffset * DAY + cfg.WINDOW.opensHour * 3600000);
const dueAt = (ws) => new Date(ws.getTime() + (cfg.WINDOW.dueDayOffset + 1) * DAY - 1000);
const lateUntil = (ws) => new Date(ws.getTime() + (cfg.WINDOW.lateUntilDayOffset + 1) * DAY - 1000);

const started = (k) => k >= cfg.START_WEEK;

// Which week a learner can submit for right now, if any.
function targetWindow(now = clock()) {
  const ws = weekStart(now);
  if (now >= opensAt(ws)) {
    return started(keyOf(ws)) ? { weekKey: keyOf(ws), late: now > dueAt(ws), opensAt: opensAt(ws), dueAt: dueAt(ws), lateUntil: lateUntil(ws) } : null;
  }
  const prev = new Date(ws.getTime() - 7 * DAY);
  if (now <= lateUntil(prev) && started(keyOf(prev))) return { weekKey: keyOf(prev), late: true, opensAt: opensAt(prev), dueAt: dueAt(prev), lateUntil: lateUntil(prev) };
  return null;
}
function nextOpens(now = clock()) {
  let ws = weekStart(now);
  if (now >= opensAt(ws)) ws = new Date(ws.getTime() + 7 * DAY);
  while (!started(keyOf(ws))) ws = new Date(ws.getTime() + 7 * DAY);
  return opensAt(ws);
}

async function learnerContext(admin) {
  const Student = mongoose.model('Student');
  const row = await Student.findOne({ removed: false, email: rx(admin.email), status: { $nin: ['Dropped'] } }).sort({ created: -1 }).lean();
  if (!row || !row.batch) return null;
  const batch = await mongoose.model('Batch').findOne({ removed: false, name: row.batch }).select('name course trainer startDate').lean();
  return {
    batch: row.batch,
    course: row.course || (batch && batch.course) || '',
    pmName: batch ? trainerNames(batch.trainer)[0] || '' : '',
    startDate: (batch && batch.startDate) || row.enrolledOn || row.created,
  };
}

function weeksBetween(fromDate, toWs, max = 26) {
  const keys = [];
  let ws = toWs;
  const fromWs = weekStart(fromDate || toWs);
  const startWs = fromKey(cfg.START_WEEK);
  const floor = fromWs > startWs ? fromWs : startWs;
  while (ws >= floor && keys.length < max) {
    keys.unshift(keyOf(ws));
    ws = new Date(ws.getTime() - 7 * DAY);
  }
  return keys;
}

/* ───────── learner ───────── */

async function mine(req, res) {
  if (!isStudent(req.admin)) return bad(res, 403, 'Candidates only.');
  const ctx = await learnerContext(req.admin);
  const win = targetWindow();
  const questions = { weekly: cfg.WEEKLY_QUESTIONS, pm: cfg.PM_QUESTIONS };
  if (!ctx) return ok(res, { enrolled: false, formVersion: cfg.FORM_VERSION, questions, window: null, nextOpensAt: nextOpens(), history: [] });

  const lastWs = win ? fromKey(win.weekKey) : new Date(weekStart(clock()).getTime() - 7 * DAY);
  const keys = weeksBetween(ctx.startDate, lastWs);
  const rows = await mongoose.model('WeeklyFeedback').find({ student: req.admin._id, weekKey: { $in: keys } }).select('kind weekKey late').lean();
  const got = {};
  rows.forEach((r) => {
    got[`${r.kind}:${r.weekKey}`] = r.late ? 'late' : 'submitted';
  });
  const history = keys.map((k, i) => {
    const isOpen = win && win.weekKey === k;
    const state = (kind) => got[`${kind}:${k}`] || (isOpen ? 'open' : 'missing');
    return { weekKey: k, label: `W${i + 1}`, weekly: state('weekly'), pm: state('pm') };
  });
  return ok(res, {
    enrolled: true,
    batch: ctx.batch,
    pmName: ctx.pmName,
    formVersion: cfg.FORM_VERSION,
    questions,
    window: win,
    nextOpensAt: win ? null : nextOpens(),
    submitted: win ? { weekly: !!got[`weekly:${win.weekKey}`], pm: !!got[`pm:${win.weekKey}`] } : null,
    history,
  });
}

async function submit(req, res) {
  if (!isStudent(req.admin)) return bad(res, 403, 'Candidates only.');
  const b = req.body || {};
  const kind = b.kind === 'pm' ? 'pm' : b.kind === 'weekly' ? 'weekly' : null;
  if (!kind) return bad(res, 400, 'Unknown feedback form.');
  const win = targetWindow();
  if (!win) return bad(res, 409, 'Feedback is closed right now — the next form opens on Friday evening.');
  const ctx = await learnerContext(req.admin);
  if (!ctx) return bad(res, 409, 'You are not in an active batch.');
  const qs = kind === 'pm' ? cfg.PM_QUESTIONS : cfg.WEEKLY_QUESTIONS;
  const answers = Array.isArray(b.answers) ? b.answers.map(Number) : [];
  if (answers.length !== qs.length || answers.some((n) => !Number.isInteger(n) || n < 1 || n > 5)) {
    return bad(res, 400, 'Please rate every question from 1 to 5.');
  }
  const concern = kind === 'pm' && b.concern === true;
  const doc = {
    kind,
    weekKey: win.weekKey,
    student: req.admin._id,
    studentName: [req.admin.name, req.admin.surname].filter(Boolean).join(' '),
    batch: ctx.batch,
    course: ctx.course,
    teacherName: kind === 'pm' ? ctx.pmName : undefined,
    answers,
    comment: String(b.comment || '').trim().slice(0, 2000),
    concern,
    concernText: concern ? String(b.concernText || '').trim().slice(0, 2000) : undefined,
    late: win.late,
    formVersion: cfg.FORM_VERSION,
  };
  try {
    await mongoose.model('WeeklyFeedback').create(doc);
  } catch (e) {
    if (e && e.code === 11000) return bad(res, 409, 'You have already submitted this form for this week.');
    throw e;
  }
  if (concern) {
    notify({
      audience: 'management',
      actorId: req.admin._id,
      actorName: 'A learner',
      module: 'LMS',
      type: 'feedback.concern',
      title: `Serious concern reported · ${ctx.batch}`,
      body: 'A learner flagged a conduct / safety concern in Project Manager feedback. Open the Feedback centre (management only).',
      link: '/lms',
    });
  }
  return ok(res, { weekKey: win.weekKey, late: win.late }, 'Thanks — your feedback has been recorded.');
}

/* ───────── Project Manager ───────── */

function averages(rows, n) {
  const sums = Array(n).fill(0);
  rows.forEach((r) => r.answers.forEach((v, i) => (sums[i] += v)));
  return sums.map((s) => (rows.length ? Math.round((s / rows.length) * 10) / 10 : null));
}

async function mySummary(req, res) {
  if (isStudent(req.admin)) return bad(res, 403, 'Project Managers only.');
  const name = req.admin.name;
  const WF = mongoose.model('WeeklyFeedback');
  const thisWs = weekStart(clock());
  const keys = [3, 2, 1, 0].map((k) => keyOf(new Date(thisWs.getTime() - k * 7 * DAY)));
  const rows = await WF.find({ kind: 'pm', teacherName: rx(name), weekKey: { $in: keys } }).select('weekKey answers batch').lean();
  const n = cfg.PM_QUESTIONS.length;
  const weeks = keys.map((k) => {
    const wr = rows.filter((r) => r.weekKey === k);
    const enough = wr.length >= cfg.MIN_RESPONSES_FOR_SCORE;
    return { weekKey: k, responses: wr.length, averages: enough ? averages(wr, n) : null };
  });
  // the latest week with enough responses is the headline; compare with the one before it
  const scored = weeks.filter((w) => w.averages);
  const latest = scored[scored.length - 1] || null;
  const prior = scored.length > 1 ? scored[scored.length - 2] : null;
  const categories = cfg.PM_QUESTIONS.map((label, i) => ({
    label,
    avg: latest ? latest.averages[i] : null,
    delta: latest && prior ? Math.round((latest.averages[i] - prior.averages[i]) * 10) / 10 : null,
  }));
  return ok(res, { minResponses: cfg.MIN_RESPONSES_FOR_SCORE, weeks, latestWeek: latest && latest.weekKey, categories });
}

async function listActions(req, res) {
  if (isStudent(req.admin)) return bad(res, 403, 'Project Managers only.');
  const rows = await mongoose.model('FeedbackAction').find({ teacher: req.admin._id, removed: false }).sort({ created: -1 }).lean();
  return ok(res, rows);
}
const ACTION_STATUSES = ['Planned', 'In progress', 'Done'];
function actionFields(b) {
  const out = {};
  if (b.action !== undefined) out.action = String(b.action).trim().slice(0, 300);
  if (b.fromCategory !== undefined) out.fromCategory = String(b.fromCategory).slice(0, 100);
  if (b.owner !== undefined) out.owner = String(b.owner).slice(0, 100);
  if (b.effectCheck !== undefined) out.effectCheck = String(b.effectCheck).slice(0, 200);
  if (b.due !== undefined) out.due = b.due ? new Date(b.due) : null;
  if (b.status !== undefined && ACTION_STATUSES.includes(b.status)) out.status = b.status;
  return out;
}
async function createAction(req, res) {
  if (isStudent(req.admin)) return bad(res, 403, 'Project Managers only.');
  const f = actionFields(req.body || {});
  if (!f.action) return bad(res, 400, 'Describe the action.');
  const row = await mongoose.model('FeedbackAction').create({ ...f, teacher: req.admin._id, teacherName: req.admin.name });
  return ok(res, row);
}
async function updateAction(req, res) {
  if (isStudent(req.admin)) return bad(res, 403, 'Project Managers only.');
  if (!mongoose.isValidObjectId(req.params.id)) return bad(res, 404, 'Not found.');
  const f = actionFields(req.body || {});
  if (f.action === '') return bad(res, 400, 'Describe the action.');
  const row = await mongoose
    .model('FeedbackAction')
    .findOneAndUpdate({ _id: req.params.id, teacher: req.admin._id, removed: false }, { $set: { ...f, updated: new Date() } }, { new: true })
    .lean();
  if (!row) return bad(res, 404, 'Not found.');
  return ok(res, row);
}

/* ───────── Feedback centre (managers) ───────── */

async function activeRoster() {
  const students = await mongoose.model('Student').find({ removed: false, status: 'Active', batch: { $nin: [null, ''] } }).select('name email batch').lean();
  const admins = await mongoose
    .model('Admin')
    .find({ removed: { $ne: true }, role: { $in: LMS_STUDENT_ROLES }, email: { $in: students.map((s) => String(s.email || '').toLowerCase()).filter(Boolean) } })
    .select('_id email name surname')
    .lean();
  const byEmail = new Map(admins.map((a) => [String(a.email).toLowerCase(), a]));
  return students.map((s) => ({ ...s, admin: byEmail.get(String(s.email || '').toLowerCase()) || null })).filter((s) => s.admin);
}

async function adminOverview(req, res) {
  const weeksBack = Math.min(Math.max(Number(req.query.weeks) || 8, 1), 26);
  const thisWs = weekStart(clock());
  const keys = [];
  for (let k = weeksBack - 1; k >= 0; k -= 1) keys.push(keyOf(new Date(thisWs.getTime() - k * 7 * DAY)));
  const roster = await activeRoster();
  const WF = mongoose.model('WeeklyFeedback');
  const rows = await WF.find({ weekKey: { $in: keys } }).select('kind weekKey student batch answers concern concernText created').lean();
  const win = targetWindow();
  // a week only counts once its form has actually opened (and on/after START_WEEK)
  const asked = (k) => started(k) && opensAt(fromKey(k)) <= clock();

  const batches = [...new Set(roster.map((s) => s.batch))].sort();
  const rate = batches.map((b) => {
    const ids = new Set(roster.filter((s) => s.batch === b).map((s) => String(s.admin._id)));
    return {
      batch: b,
      eligible: ids.size,
      weeks: keys.map((k) => {
        if (!asked(k)) return { weekKey: k, submitted: 0, pct: null, open: false };
        const done = new Set(rows.filter((r) => r.kind === 'weekly' && r.weekKey === k && ids.has(String(r.student))).map((r) => String(r.student)));
        return { weekKey: k, submitted: done.size, pct: ids.size ? Math.round((done.size / ids.size) * 100) : null, open: !!(win && win.weekKey === k && clock() <= win.dueAt) };
      }),
    };
  });

  // non-respondents for the week that's open now, else the last week that was asked
  const askedKeys = keys.filter(asked);
  const focusKey = win ? win.weekKey : askedKeys[askedKeys.length - 1] || null;
  const reminders = focusKey ? await mongoose.model('FeedbackReminder').find({ weekKey: focusKey }).lean() : [];
  const remBy = new Map(reminders.map((r) => [String(r.student), r.count]));
  const recentKeys = askedKeys.slice(-3);
  const nonRespondents = (focusKey ? roster : [])
    .filter((s) => !rows.some((r) => r.kind === 'weekly' && r.weekKey === focusKey && String(r.student) === String(s.admin._id)))
    .map((s) => ({
      name: s.name,
      batch: s.batch,
      reminders: remBy.get(String(s.admin._id)) || 0,
      weeksMissing: recentKeys.filter((k) => !rows.some((r) => r.kind === 'weekly' && r.weekKey === k && String(r.student) === String(s.admin._id))).length,
    }));

  // concerns: low category scores per batch (latest week, enough responses) + flagged ones
  const lowScores = [];
  batches.forEach((b) => {
    for (const kind of ['weekly', 'pm']) {
      const wr = rows.filter((r) => r.kind === kind && r.weekKey === focusKey && r.batch === b);
      if (wr.length < cfg.MIN_RESPONSES_FOR_SCORE) continue;
      const qs = kind === 'pm' ? cfg.PM_QUESTIONS : cfg.WEEKLY_QUESTIONS;
      averages(wr, qs.length).forEach((avg, i) => {
        if (avg !== null && avg < 3) lowScores.push({ batch: b, kind, question: qs[i], avg, responses: wr.length });
      });
    }
  });
  const flagged = rows.filter((r) => r.concern);
  return ok(res, {
    weeks: keys,
    focusWeek: focusKey,
    window: win,
    schedule: { opens: 'Fri 6:00 PM', due: 'Sun 11:59 PM', lateUntil: 'Tue 11:59 PM', maxReminders: cfg.MAX_REMINDERS_PER_WEEK, formVersion: cfg.FORM_VERSION },
    responseRate: rate,
    nonRespondents,
    lowScores,
    concerns: isManagement(req.admin)
      ? { count: flagged.length, items: flagged.map((r) => ({ weekKey: r.weekKey, batch: r.batch, text: r.concernText || '', at: r.created })) }
      : { count: flagged.length, restricted: true },
  });
}

async function adminRemind(req, res) {
  const batch = String((req.body && req.body.batch) || '').trim();
  if (!batch) return bad(res, 400, 'Pick a batch.');
  const win = targetWindow();
  if (!win) return bad(res, 409, 'No feedback week is open right now.');
  const roster = (await activeRoster()).filter((s) => s.batch === batch);
  const done = new Set((await mongoose.model('WeeklyFeedback').find({ kind: 'weekly', weekKey: win.weekKey, batch }).select('student').lean()).map((r) => String(r.student)));
  const FR = mongoose.model('FeedbackReminder');
  let sent = 0;
  let capped = 0;
  for (const s of roster) {
    if (done.has(String(s.admin._id))) continue;
    // eslint-disable-next-line no-await-in-loop
    const r = await FR.findOne({ student: s.admin._id, weekKey: win.weekKey }).lean();
    if (r && r.count >= cfg.MAX_REMINDERS_PER_WEEK) {
      capped += 1;
      continue;
    }
    // eslint-disable-next-line no-await-in-loop
    await FR.updateOne({ student: s.admin._id, weekKey: win.weekKey }, { $inc: { count: 1 }, $set: { lastAt: new Date() } }, { upsert: true });
    notifyUser({
      recipient: s.admin._id,
      actorId: req.admin._id,
      actorName: req.admin.name,
      module: 'LMS',
      type: 'feedback.reminder',
      title: 'Weekly feedback is due',
      body: `Please share this week's feedback (2–3 minutes) by ${win.dueAt.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', weekday: 'short', hour: 'numeric', minute: '2-digit' })}.`,
      link: '/learn/feedback',
    });
    sent += 1;
  }
  return ok(res, { sent, capped }, `${sent} reminder${sent === 1 ? '' : 's'} sent${capped ? ` · ${capped} already at the weekly limit` : ''}.`);
}

module.exports = {
  mine,
  submit,
  mySummary,
  listActions,
  createAction,
  updateAction,
  adminOverview,
  adminRemind,
  // exported for tests
  _week: {
    weekStart,
    keyOf,
    targetWindow,
    setClock: (fn) => {
      clockFn = fn || (() => new Date());
    },
  },
};
