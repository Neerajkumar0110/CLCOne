const mongoose = require('mongoose');

// The 11 spec §17.1 workflows that were "Not built / manual" in the A8
// Automation catalogue, run by jobs/lmsAutomationTick.js. Each rule:
//   • acts only on real data, and only inside its own schedule window;
//   • is limited (once per day / week / learner) so nobody gets spammed;
//   • never takes a decision a person owns (the "human" column of the
//     catalogue) — it reminds, drafts, flags or escalates, and a person acts;
//   • can be paused from the Automation screen (automation.isPaused);
//   • returns a one-line summary that is kept as the rule's run log.
// `ctx.dry` = compute and report only, write / send nothing (used by tests).

const M = (n) => mongoose.model(n);
const DAY = 86400000;
// onboarding / setup automation only looks at learners enrolled this recently —
// a learner who has been attending for months is not "stuck in onboarding"
const NEW_LEARNER_DAYS = 30;
const rxEq = (s) => new RegExp(`^${String(s || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i');
const fmt = (d) => new Date(d).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
const dayKey = (d = new Date()) => new Date(d.getTime() + 330 * 60000).toISOString().slice(0, 10); // IST date
const istHour = (d = new Date()) => new Date(d.getTime() + 330 * 60000).getUTCHours();
const istDow = (d = new Date()) => new Date(d.getTime() + 330 * 60000).getUTCDay(); // 0 = Sun

// ── shared helpers ──────────────────────────────────────────────────────────

// Active learners with a batch, joined to their login (Admin) row.
async function activeLearners() {
  const students = await M('Student').find({ removed: false, status: 'Active', batch: { $nin: [null, ''] } }).select('name email batch created enrolledOn source').lean();
  const emails = students.map((s) => String(s.email || '').toLowerCase()).filter(Boolean);
  const admins = await M('Admin').find({ removed: { $ne: true }, email: { $in: emails }, rosterHold: { $ne: true } }).select('_id email name surname').lean();
  const byEmail = new Map(admins.map((a) => [String(a.email).toLowerCase(), a]));
  return students.map((s) => ({ ...s, admin: byEmail.get(String(s.email || '').toLowerCase()) || null })).filter((s) => s.admin);
}

async function managementEmails() {
  const { CRM_ADMIN_ROLES } = require('../../config/roles');
  const rows = await M('Admin').find({ removed: { $ne: true }, enabled: { $ne: false }, role: { $in: CRM_ADMIN_ROLES } }).select('email').lean();
  return rows.map((r) => r.email).filter(Boolean);
}

// Was this learner already sent a notification of `type` since `since`?
async function notifiedSince(recipient, type, since) {
  return !!(await M('Notification').exists({ recipient, type, created: { $gte: since } }));
}

async function tellLearner(ctx, admin, { type, title, body, link, email }) {
  if (ctx.dry) return;
  await require('./realtime').notify([admin._id], { type, title, body, link, actorName: 'Automation' });
  if (email && admin.email) {
    const vars = { title, message: body, link: link ? `${require('../../config/lms').lmsConfig.meeting.crmBaseUrl}${link}` : '' };
    await require('./mailer').sendMail([admin.email], { ...require('../mail/inlineEmails').automationLearner(vars), templateKey: 'lms-automation-learner', vars }).catch(() => {});
  }
}

function tellSupport(ctx, { type, title, body, link }) {
  if (ctx.dry) return;
  require('../../notify').notify({ audience: 'support', actorName: 'Automation', module: 'LMS', type, title, body, link: link || '/lms' });
}

function csv(rows) {
  if (!rows.length) return '';
  const cols = Object.keys(rows[0]);
  const q = (v) => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;
  return [cols.map(q).join(','), ...rows.map((r) => cols.map((c) => q(r[c])).join(','))].join('\n');
}

// ── 1. assessment-coordination ─────────────────────────────────────────────
// Daily from 10:00: learners with an OPEN test they have not attempted get a
// reminder (once a week per test); attempts stuck "in progress" 3h+ and the
// pending count per batch go to Support. Results are never touched.
async function assessmentCoordination(ctx) {
  const { UNLOCK_THRESHOLD_PCT, completionPercentForBatchName, isTestUnlocked } = require('./curriculumTracker');
  const gate = require('./readinessGate');
  const TYPES = Object.keys(UNLOCK_THRESHOLD_PCT);
  const learners = await activeLearners();
  const pctByBatch = new Map();
  const attempts = await M('AssessmentAttempt').find({ candidate: { $in: learners.map((l) => l.admin._id) } }).select('candidate testType status startedAt').lean();
  let reminded = 0;
  const pendingByBatch = {};
  for (const l of learners) {
    if (!pctByBatch.has(l.batch)) pctByBatch.set(l.batch, await completionPercentForBatchName(l.batch).catch(() => 0));
    const mine = attempts.filter((a) => String(a.candidate) === String(l.admin._id));
    let toldThisRun = false;
    for (const t of TYPES) {
      if (mine.some((a) => a.testType === t)) continue;
      // eslint-disable-next-line no-await-in-loop
      if (!(await isTestUnlocked({ testType: t, curriculumPercent: pctByBatch.get(l.batch), batch: l.batch, candidateId: l.admin._id }))) continue;
      // eslint-disable-next-line no-await-in-loop
      if (!(await gate.check({ testType: t, candidateId: l.admin._id, email: l.admin.email, batch: l.batch })).allowed) continue;
      pendingByBatch[l.batch] = (pendingByBatch[l.batch] || 0) + 1;
      const type = `assessment.pending.${t}`;
      // eslint-disable-next-line no-await-in-loop
      if (toldThisRun || (await notifiedSince(l.admin._id, type, new Date(Date.now() - 7 * DAY)))) continue;
      toldThisRun = true; // one reminder per learner per day, the earliest open test first
      // eslint-disable-next-line no-await-in-loop
      await tellLearner(ctx, l.admin, { type, title: `Your ${t === 'BASIC' ? 'Readiness' : t.replace('_', ' ')} test is open`, body: 'This test is open for you and not attempted yet. Take it from your Assessments page.', link: '/learn/assessment-dashboard' });
      reminded += 1;
    }
  }
  const stuck = await M('AssessmentAttempt').countDocuments({ status: 'IN_PROGRESS', startedAt: { $lt: new Date(Date.now() - 3 * 3600000) } });
  const pending = Object.values(pendingByBatch).reduce((s, n) => s + n, 0);
  if (pending || stuck) {
    tellSupport(ctx, {
      type: 'automation.assessment-report',
      title: `Assessment report: ${pending} pending attempt${pending === 1 ? '' : 's'}${stuck ? `, ${stuck} stuck in progress` : ''}`,
      body: Object.entries(pendingByBatch).map(([b, n]) => `${b}: ${n}`).join(' · ').slice(0, 230) || 'No pending attempts',
      link: '/lms/assessment-dashboard',
    });
  }
  return `${reminded} learner reminder(s) · ${pending} pending attempt(s) in ${Object.keys(pendingByBatch).length} batch(es) · ${stuck} stuck`;
}

// ── 2. weekly-feedback ─────────────────────────────────────────────────────
// While a week's form is open: reminders on Saturday 11:00 and Sunday 17:00
// (the controller caps it at MAX_REMINDERS_PER_WEEK per learner, in-app +
// email). Wednesday: response-rate summary to Support for the closed week.
async function weeklyFeedback(ctx, state) {
  const fb = require('../../controllers/appControllers/lms/lmsController/feedback');
  const win = fb.targetWindow();
  const dow = istDow();
  const out = [];
  if (win && !win.late && ((dow === 6 && istHour() >= 11) || (dow === 0 && istHour() >= 17))) {
    const slot = `${win.weekKey}:${dow}`;
    if (state.lastSlot !== slot) {
      const batches = [...new Set((await fb.activeRoster()).map((s) => s.batch))];
      let sent = 0;
      let emailed = 0;
      for (const b of batches) {
        if (ctx.dry) continue;
        // eslint-disable-next-line no-await-in-loop
        const r = await fb.remindBatch(b, { name: 'Automation' });
        sent += r.sent || 0;
        emailed += r.emailed || 0;
      }
      if (!ctx.dry) state.lastSlot = slot;
      out.push(`${sent} reminder(s), ${emailed} email(s) across ${batches.length} batch(es)`);
    }
  }
  if (dow === 3 && istHour() >= 10) {
    const lastWeek = dayKey(new Date(Date.now() - 9 * DAY)); // a day inside last week
    const wk = fb._week.keyOf(fb._week.weekStart(new Date(`${lastWeek}T12:00:00+05:30`)));
    if (state.lastSummary !== wk) {
      const roster = await fb.activeRoster();
      const done = await M('WeeklyFeedback').countDocuments({ kind: 'weekly', weekKey: wk });
      tellSupport(ctx, { type: 'automation.feedback-summary', title: `Weekly feedback ${wk}: ${done} of ${roster.length} responded`, body: 'See Feedback centre for batch rates and concerns.', link: '/lms/feedback' });
      if (!ctx.dry) state.lastSummary = wk;
      out.push(`summary for ${wk}: ${done}/${roster.length}`);
    }
  }
  return out.join(' · ') || 'nothing due in this window';
}

// ── 3. onboarding ──────────────────────────────────────────────────────────
// New learner (enrolled ≤ 2 days): one in-app welcome. Checklist still
// incomplete after a day: reminder every 3 days. "Complete" stays the
// learner's own steps — automation never ticks them.
async function onboarding(ctx) {
  const learners = await activeLearners();
  const prog = await M('OnboardingProgress').find({ student: { $in: learners.map((l) => l.admin._id) } }).lean();
  const byId = new Map(prog.map((p) => [String(p.student), p]));
  let welcomed = 0;
  let reminded = 0;
  for (const l of learners) {
    const since = new Date(l.enrolledOn || l.created || 0);
    const p = byId.get(String(l.admin._id));
    const complete = p && p.calendarAt && p.setupAt && p.deviceAt;
    if (Date.now() - since > NEW_LEARNER_DAYS * DAY) continue; // onboarding is for new learners only
    if (Date.now() - since < 2 * DAY) {
      // eslint-disable-next-line no-await-in-loop
      if (!(await notifiedSince(l.admin._id, 'onboarding.welcome', new Date(0)))) {
        // eslint-disable-next-line no-await-in-loop
        await tellLearner(ctx, l.admin, { type: 'onboarding.welcome', title: `Welcome to ${l.batch}!`, body: 'Start with your onboarding checklist: calendar, software setup and a device check.', link: '/learn/onboarding' });
        welcomed += 1;
      }
    }
    if (!complete && Date.now() - since >= DAY) {
      // eslint-disable-next-line no-await-in-loop
      if (await notifiedSince(l.admin._id, 'onboarding.reminder', new Date(Date.now() - 3 * DAY))) continue;
      const left = [!(p && p.calendarAt) && 'calendar', !(p && p.setupAt) && 'software setup', !(p && p.deviceAt) && 'device check'].filter(Boolean).join(', ');
      // eslint-disable-next-line no-await-in-loop
      await tellLearner(ctx, l.admin, { type: 'onboarding.reminder', title: 'Finish your onboarding', body: `Still to do: ${left}.`, link: '/learn/onboarding' });
      reminded += 1;
    }
  }
  return `${welcomed} welcome(s) · ${reminded} checklist reminder(s)`;
}

// ── 4. software-setup ──────────────────────────────────────────────────────
// Setup or device check still not done 5+ days after enrolment → ONE
// "Login / Technical" ticket so Support calls them. Remote install stays a
// person's job, with the learner's permission.
const SETUP_SUBJECT = 'Onboarding stuck: software setup / device check not done';
async function softwareSetup(ctx) {
  const learners = await activeLearners();
  const prog = await M('OnboardingProgress').find({ student: { $in: learners.map((l) => l.admin._id) } }).lean();
  const byId = new Map(prog.map((p) => [String(p.student), p]));
  const T = M('Ticket');
  let raised = 0;
  for (const l of learners) {
    const since = new Date(l.enrolledOn || l.created || 0);
    if (Date.now() - since < 5 * DAY || Date.now() - since > NEW_LEARNER_DAYS * DAY) continue;
    const p = byId.get(String(l.admin._id));
    if (p && p.setupAt && p.deviceAt) continue;
    // eslint-disable-next-line no-await-in-loop
    if (await T.exists({ removed: false, createdBy: l.admin._id, subject: SETUP_SUBJECT })) continue;
    raised += 1;
    if (ctx.dry) continue;
    const missing = [!(p && p.setupAt) && 'software setup', !(p && p.deviceAt) && 'device check'].filter(Boolean).join(' + ');
    // eslint-disable-next-line no-await-in-loop
    await new T({
      subject: SETUP_SUBJECT,
      description: `Automatic: ${missing} not completed ${Math.floor((Date.now() - since) / DAY)} days after enrolment. Call the learner and help them finish it (remote access only with their permission).`,
      category: 'Login / Technical',
      priority: 'Medium',
      status: 'Open',
      source: 'student',
      createdBy: l.admin._id,
      raisedByName: [l.admin.name, l.admin.surname].filter(Boolean).join(' ') || l.name,
      raisedByEmail: l.admin.email,
      reference: 'Onboarding · software setup',
      history: [{ at: new Date(), action: 'created', status: 'Open', byName: 'System (automation)' }],
    }).save();
  }
  if (raised) tellSupport(ctx, { type: 'ticket.created', title: `${raised} onboarding setup ticket(s) raised`, body: SETUP_SUBJECT, link: '/support' });
  return `${raised} setup ticket(s) raised`;
}

// ── 5. ticket-creation ─────────────────────────────────────────────────────
// Every run: each ticket gets its SLA target, the raiser gets an
// acknowledgement once, and an open ticket past its SLA (not waiting on the
// learner) is escalated to the Support Manager once.
const SLA_H = { Urgent: 1, High: 4, Medium: 24, Low: 72 };
async function ticketCreation(ctx) {
  const T = M('Ticket');
  const { ticketNo } = require('../../config/supportTickets');
  const open = await T.find({ removed: false, status: { $ne: 'Resolved' } }).select('subject priority created slaDueAt ackAt createdBy source escalatedTo waiting').lean();
  let sla = 0;
  let acked = 0;
  let escalated = 0;
  for (const t of open) {
    const due = t.slaDueAt || new Date(new Date(t.created).getTime() + (SLA_H[t.priority] || 24) * 3600000);
    const set = {};
    if (!t.slaDueAt) {
      set.slaDueAt = due;
      sla += 1;
    }
    if (!t.ackAt && t.createdBy && Date.now() - new Date(t.created) < 2 * DAY) {
      set.ackAt = new Date();
      acked += 1;
      if (!ctx.dry) {
        // eslint-disable-next-line no-await-in-loop
        await require('../../notify').notifyUser({ recipient: t.createdBy, actorName: 'Support', module: t.source === 'student' ? 'LMS' : 'Support', type: 'ticket.ack', title: `We have your ticket ${ticketNo(t)}`, body: `${t.subject} — we aim to respond by ${fmt(due)}.`, link: t.source === 'student' ? '/learn/support' : '/support' });
      }
    }
    const push = {};
    if (!t.escalatedTo && !t.waiting && due < new Date()) {
      set.escalatedTo = 'Support Manager';
      push.history = { at: new Date(), action: 'escalated', status: 'Open', byName: 'System (automation)', note: `SLA target ${fmt(due)} passed — escalated to Support Manager` };
      escalated += 1;
      tellSupport(ctx, { type: 'ticket.escalated', title: `SLA breached: ${ticketNo(t)} escalated`, body: t.subject, link: '/support' });
    }
    if (!ctx.dry && (Object.keys(set).length || push.history)) {
      // eslint-disable-next-line no-await-in-loop
      await T.updateOne({ _id: t._id }, { $set: set, ...(push.history ? { $push: push } : {}) });
    }
  }
  return `${sla} SLA set · ${acked} acknowledged · ${escalated} escalated`;
}

// ── 6. query-assistance ────────────────────────────────────────────────────
// New learner tickets: suggest an answer for Support — an open problem
// record (PRB) that matches, or how a similar ticket in the same category
// was resolved. Stored on the ticket + as an internal note; it is a DRAFT a
// person reviews, never sent to the learner by the system.
const STOP = new Set('the a an and or to of in on for is it my i not with this that from be at as are was have has can cannot unable please help class'.split(' '));
const words = (s) => new Set(String(s || '').toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2 && !STOP.has(w)));
const overlap = (a, b) => {
  if (!a.size || !b.size) return 0;
  let n = 0;
  a.forEach((w) => b.has(w) && (n += 1));
  return n / Math.min(a.size, b.size);
};
async function queryAssistance(ctx) {
  const T = M('Ticket');
  const fresh = await T.find({ removed: false, source: 'student', status: 'Open', suggestedAt: null, created: { $gte: new Date(Date.now() - 2 * DAY) } }).select('subject description category').lean();
  if (!fresh.length) return 'no new learner tickets';
  const problems = await M('LmsProblem').find({ status: { $in: ['Open', 'Known error'] } }).select('code title rootCause workaround category').lean();
  const solved = await T.find({ removed: false, status: 'Resolved', resolutionNote: { $nin: [null, ''] }, created: { $gte: new Date(Date.now() - 120 * DAY) } }).select('subject category resolutionNote').sort({ created: -1 }).limit(400).lean();
  let suggested = 0;
  for (const t of fresh) {
    const w = words(`${t.subject} ${t.description}`);
    let best = null;
    for (const p of problems) {
      const s = overlap(w, words(`${p.title} ${p.rootCause}`));
      if (s >= 0.5 && (!best || s > best.s)) best = { s, kind: 'problem', ref: p.code, text: `Known problem ${p.code}: ${p.title}${p.workaround ? ` — workaround: ${p.workaround}` : ''}` };
    }
    if (!best) {
      for (const r of solved) {
        if (r.category !== t.category) continue;
        const s = overlap(w, words(r.subject));
        if (s >= 0.6 && (!best || s > best.s)) best = { s, kind: 'similar-ticket', ref: String(r._id), text: `A similar ticket ("${r.subject}") was resolved with: ${r.resolutionNote}` };
      }
    }
    if (best) suggested += 1;
    if (ctx.dry) continue;
    const set = { suggestedAt: new Date() };
    const upd = { $set: set };
    if (best) {
      set.suggestion = { kind: best.kind, ref: best.ref, text: best.text.slice(0, 1000) };
      upd.$push = { internalNotes: { at: new Date(), byName: 'Automation (suggestion — review before sending)', text: best.text.slice(0, 1000) } };
    }
    // eslint-disable-next-line no-await-in-loop
    await T.updateOne({ _id: t._id }, upd);
  }
  return `${fresh.length} new ticket(s) checked · ${suggested} suggestion(s) drafted`;
}

// ── 7. session-change ──────────────────────────────────────────────────────
// A class whose time was moved after the batch last heard about it →
// in-app + email to that batch only. (Cancellations already notify the
// batch from liveClassService.cancelSession.)
async function sessionChange(ctx) {
  const S = M('LmsLiveSession');
  const rows = await S.find({ removed: false, status: { $in: ['scheduled', 'upcoming'] }, scheduledStart: { $gte: new Date() }, batchName: { $nin: [null, ''] } }).select('title batchName courseTitle scheduledStart announcedStart').lean();
  let baseline = 0;
  let told = 0;
  for (const s of rows) {
    if (!s.announcedStart) {
      baseline += 1;
      // eslint-disable-next-line no-await-in-loop
      if (!ctx.dry) await S.updateOne({ _id: s._id }, { $set: { announcedStart: s.scheduledStart } });
      continue;
    }
    if (Math.abs(new Date(s.announcedStart) - new Date(s.scheduledStart)) < 60000) continue;
    told += 1;
    if (ctx.dry) continue;
    // eslint-disable-next-line no-await-in-loop
    const roster = await M('Student').find({ removed: false, batch: s.batchName, status: 'Active' }).select('email').lean();
    // eslint-disable-next-line no-await-in-loop
    const admins = await M('Admin').find({ removed: false, email: { $in: roster.map((r) => rxEq(r.email)) }, rosterHold: { $ne: true } }).select('_id email').lean();
    const title = `Class time changed: ${s.title}`;
    const body = `${s.courseTitle || s.batchName} · was ${fmt(s.announcedStart)}, now ${fmt(s.scheduledStart)}.`;
    // eslint-disable-next-line no-await-in-loop
    await require('./realtime').notify(admins.map((a) => a._id), { type: 'live.rescheduled', title, body, link: '/learn/classes', actorName: 'Automation' });
    // eslint-disable-next-line no-await-in-loop
    const vars = { classTitle: s.title, course: s.courseTitle || s.batchName, fromTime: fmt(s.announcedStart), toTime: fmt(s.scheduledStart) };
    // eslint-disable-next-line no-await-in-loop
    await require('./mailer').sendMail(admins.map((a) => a.email), { ...require('../mail/inlineEmails').classRescheduled(vars), templateKey: 'lms-class-rescheduled', vars }).catch(() => {});
    // eslint-disable-next-line no-await-in-loop
    await S.updateOne({ _id: s._id }, { $set: { announcedStart: s.scheduledStart } });
  }
  return `${told} batch(es) told about a new class time${baseline ? ` · ${baseline} class(es) recorded as baseline` : ''}`;
}

// ── 8. project-due ─────────────────────────────────────────────────────────
// Daily from 09:30: project due in ≤ 2 days → reminder to the learner;
// overdue → learner + mentor (PM). Monday: overdue exception list to
// Support. Extensions stay a person's decision (approval rules).
async function projectDue(ctx) {
  const P = M('Project');
  const live = await P.find({ removed: false, status: { $in: ['assigned', 'in_progress', 'revision_requested'] }, dueDate: { $ne: null } }).select('title dueDate student studentName mentor batch').lean();
  const now = Date.now();
  let soon = 0;
  let overdue = 0;
  for (const p of live) {
    const left = new Date(p.dueDate) - now;
    if (left > 2 * DAY) continue;
    const isLate = left < 0;
    const type = isLate ? 'project.overdue' : 'project.due-soon';
    // eslint-disable-next-line no-await-in-loop
    if (await notifiedSince(p.student, type, new Date(now - (isLate ? 3 : 1) * DAY))) continue;
    if (isLate) overdue += 1;
    else soon += 1;
    if (ctx.dry) continue;
    const to = [p.student, ...(isLate && p.mentor ? [p.mentor] : [])];
    // eslint-disable-next-line no-await-in-loop
    await require('./realtime').notify(to, { type, title: isLate ? `Project overdue: ${p.title}` : `Project due ${fmt(p.dueDate)}: ${p.title}`, body: isLate ? `${p.studentName || 'Learner'} · was due ${fmt(p.dueDate)}. Submit it, or ask for an extension.` : 'Submit it from your Projects page before the due time.', link: '/learn/projects', actorName: 'Automation' });
  }
  let report = '';
  if (istDow() === 1) {
    const late = live.filter((p) => new Date(p.dueDate) < now);
    if (late.length) {
      tellSupport(ctx, { type: 'automation.project-exceptions', title: `${late.length} overdue project(s)`, body: late.slice(0, 8).map((p) => `${p.studentName || ''} (${p.batch || ''})`).join(' · '), link: '/lms/projects' });
      report = ` · exception list (${late.length}) sent`;
    }
  }
  return `${soon} due-soon reminder(s) · ${overdue} overdue reminder(s)${report}`;
}

// ── 9. referral-handoff ────────────────────────────────────────────────────
// Learners who came by referral and have not started onboarding 2 days
// after enrolment → Support follows up (staff only — no message to the
// referred person, so channel consent is untouched). Once per learner.
async function referralHandoff(ctx, state) {
  const since = new Date(Date.now() - 30 * DAY);
  const refs = (await activeLearners()).filter((l) => l.source === 'Referral' && new Date(l.enrolledOn || l.created || 0) >= since);
  const prog = await M('OnboardingProgress').find({ student: { $in: refs.map((l) => l.admin._id) } }).select('student').lean();
  const started = new Set(prog.map((p) => String(p.student)));
  state.done = state.done || {};
  const fresh = refs.filter((l) => !started.has(String(l.admin._id)) && Date.now() - new Date(l.enrolledOn || l.created) >= 2 * DAY && !state.done[String(l.admin._id)]);
  if (fresh.length) {
    tellSupport(ctx, { type: 'automation.referral-followup', title: `${fresh.length} referred learner(s) not onboarded yet`, body: fresh.map((l) => `${l.name} (${l.batch})`).join(' · ').slice(0, 230), link: '/lms/learners' });
    if (!ctx.dry) fresh.forEach((l) => (state.done[String(l.admin._id)] = dayKey()));
  }
  return `${refs.length} referral learner(s) in last 30 days · ${fresh.length} flagged for follow-up`;
}

// ── 10. qualified-report ───────────────────────────────────────────────────
// Monday from 10:00: DRAFT qualified / not-qualified status per batch from
// the last 7 days' submitted attempts → saved (LmsAdminConfig
// 'report:qualified-draft') and emailed to Management as CSV marked DRAFT.
// The owner verifies it before anything is published.
async function qualifiedReport(ctx) {
  const { qualifyThreshold } = await require('./assessmentSettingsService').get();
  const atts = await M('AssessmentAttempt').find({ status: 'SUBMITTED', submittedAt: { $gte: new Date(Date.now() - 7 * DAY) } }).select('candidate candidateName candidateEmail testType score totalCount qualified submittedAt').lean();
  const studs = await M('Student').find({ removed: false, email: { $in: [...new Set(atts.map((a) => String(a.candidateEmail || '').toLowerCase()).filter(Boolean))] } }).select('email batch').lean();
  const batchOf = new Map(studs.map((s) => [String(s.email).toLowerCase(), s.batch]));
  const rows = atts.map((a) => {
    const q = a.qualified !== undefined && a.qualified !== null ? a.qualified : a.totalCount ? a.score / a.totalCount >= qualifyThreshold : false;
    return { Batch: batchOf.get(String(a.candidateEmail || '').toLowerCase()) || '', Learner: a.candidateName || a.candidateEmail || '', Test: a.testType, Score: `${a.score}/${a.totalCount}`, Status: q ? 'Qualified' : 'Not qualified', Submitted: fmt(a.submittedAt) };
  });
  rows.sort((x, y) => x.Batch.localeCompare(y.Batch));
  const q = rows.filter((r) => r.Status === 'Qualified').length;
  if (!ctx.dry) {
    await M('LmsAdminConfig').updateOne({ key: 'report:qualified-draft' }, { $set: { value: { status: 'draft — verify before publishing', at: new Date(), rows }, updatedByName: 'Automation', updated: new Date() } }, { upsert: true });
    if (rows.length) {
      await require('./mailer').sendMail(await managementEmails(), {
        ...require('../mail/inlineEmails').qualifiedDraft({ results: rows.length, qualified: q }),
        attachments: [{ filename: `qualified-draft-${dayKey()}.csv`, content: csv(rows), contentType: 'text/csv' }],
        templateKey: 'lms-qualified-draft',
        vars: { results: rows.length, qualified: q },
      });
    }
  }
  return `${rows.length} result(s) · ${q} qualified · draft saved for verification`;
}

// ── 11. mgmt-report ────────────────────────────────────────────────────────
// Monday 09:00 (last week) and the 1st 09:00 (last month): KPI summary to
// Management only — counts and percentages, no learner-level detail.
async function kpis(from, to) {
  const [classes, att, opened, resolved, breached, feedback, newLearners] = await Promise.all([
    M('LmsLiveSession').countDocuments({ removed: false, actualStart: { $gte: from, $lt: to } }),
    M('AttendanceRecord').aggregate([{ $match: { removed: { $ne: true }, date: { $gte: from, $lt: to } } }, { $group: { _id: null, n: { $sum: 1 }, p: { $sum: { $cond: [{ $in: ['$status', ['Present', 'Late']] }, 1, 0] } } } }]),
    M('Ticket').countDocuments({ removed: false, created: { $gte: from, $lt: to } }),
    M('Ticket').countDocuments({ removed: false, resolvedAt: { $gte: from, $lt: to } }),
    M('Ticket').countDocuments({ removed: false, created: { $gte: from, $lt: to }, escalatedTo: { $nin: [null, ''] } }),
    M('WeeklyFeedback').countDocuments({ created: { $gte: from, $lt: to } }),
    M('Student').countDocuments({ removed: false, created: { $gte: from, $lt: to } }),
  ]);
  const a = att[0] || { n: 0, p: 0 };
  return [
    ['Classes held', classes],
    ['Attendance (present + late)', a.n ? `${Math.round((a.p / a.n) * 100)}% of ${a.n} records` : 'no records'],
    ['Tickets opened', opened],
    ['Tickets resolved', resolved],
    ['Tickets escalated (SLA / manual)', breached],
    ['Feedback responses', feedback],
    ['New learners', newLearners],
  ];
}
async function mgmtReport(ctx, state) {
  const out = [];
  const today = dayKey();
  const ist = new Date(Date.now() + 330 * 60000);
  const periods = [];
  if (istDow() === 1 && state.lastWeekly !== today) {
    const to = new Date(`${today}T00:00:00+05:30`);
    periods.push({ kind: 'Weekly', from: new Date(to - 7 * DAY), to, mark: 'lastWeekly' });
  }
  if (ist.getUTCDate() === 1 && state.lastMonthly !== today) {
    const to = new Date(`${today}T00:00:00+05:30`);
    const from = new Date(`${new Date(to - DAY + 330 * 60000).toISOString().slice(0, 7)}-01T00:00:00+05:30`);
    periods.push({ kind: 'Monthly', from, to, mark: 'lastMonthly' });
  }
  for (const p of periods) {
    // eslint-disable-next-line no-await-in-loop
    const k = await kpis(p.from, p.to);
    const label = `${dayKey(p.from)} to ${dayKey(new Date(p.to - DAY))}`;
    if (!ctx.dry) {
      // eslint-disable-next-line no-await-in-loop
      await require('./mailer').sendMail(await managementEmails(), {
        ...require('../mail/inlineEmails').mgmtReport({ kind: p.kind, label, kpis: k }),
        templateKey: 'lms-mgmt-report',
        vars: { kind: p.kind, label },
      });
      state[p.mark] = today;
    }
    out.push(`${p.kind} (${label}): ${k.map(([n, v]) => `${n} ${v}`).join(', ')}`);
  }
  return out.join(' · ') || 'not due today';
}

// key → { run, when(now, state) } — `when` decides whether this tick is inside the rule's window.
const daily = (hour, minute = 0) => (now, st) => st.lastDay !== dayKey(now) && (istHour(now) > hour || (istHour(now) === hour && new Date(now.getTime() + 330 * 60000).getUTCMinutes() >= minute));
const always = () => true;
// `daily: true` → the job stores the day after a run so it runs once a day.
const RUNNERS = {
  'assessment-coordination': { run: assessmentCoordination, when: daily(10), daily: true, schedule: 'Daily 10:00' },
  'weekly-feedback': { run: weeklyFeedback, when: always, schedule: 'Sat 11:00 + Sun 17:00 reminders · Wed summary' },
  onboarding: { run: onboarding, when: daily(11), daily: true, schedule: 'Daily 11:00' },
  'software-setup': { run: softwareSetup, when: daily(12), daily: true, schedule: 'Daily 12:00' },
  'ticket-creation': { run: ticketCreation, when: always, schedule: 'Every 10 min' },
  'query-assistance': { run: queryAssistance, when: always, schedule: 'Every 10 min' },
  'session-change': { run: sessionChange, when: always, schedule: 'Every 10 min' },
  'project-due': { run: projectDue, when: daily(9, 30), daily: true, schedule: 'Daily 09:30 · Mon exception list' },
  'referral-handoff': { run: referralHandoff, when: daily(12), daily: true, schedule: 'Daily 12:00' },
  'qualified-report': { run: qualifiedReport, when: (now, st) => istDow(now) === 1 && daily(10)(now, st), daily: true, schedule: 'Monday 10:00' },
  'mgmt-report': { run: mgmtReport, when: daily(9), daily: true, schedule: 'Monday 09:00 weekly · 1st 09:00 monthly' },
};

module.exports = { RUNNERS, _h: { activeLearners, kpis, words, overlap, dayKey, istHour, istDow } };
