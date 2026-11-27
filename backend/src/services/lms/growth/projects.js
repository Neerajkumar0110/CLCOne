const mongoose = require('mongoose');
const A = require('./access');

// Project allocation & tracking (Figma 2A–2G) — notices, the automation tick
// (2G "Automation rules") and allocation. Every automatic step claims its row
// atomically (findOneAndUpdate on a not-yet-set field), so the laptop and the
// VPS backends — both on the same database — never send a reminder twice.

const M = (n) => mongoose.model(n);
const H = 3600 * 1000;
const fmt = (d) => (d ? new Date(d).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' }) : '—');
const OPEN = ['allocated', 'in_progress'];
const LEVELS = ['beginner', 'intermediate', 'advanced'];

const recipientsOf = (a) => [...new Set([a.learner, ...(a.members || [])].filter(Boolean).map(String))];

// email + in-app to the learner(s) (+ optional mentor copy); logged on the row
async function notice(a, { kind, title, body, link = '/learn/project-tasks', toMentor = false, toSupport = false, channels } = {}) {
  const ch = channels || { email: true, inApp: true };
  const ids = recipientsOf(a);
  const log = [];
  if (ch.inApp) {
    const r = await require('../realtime').notify(ids, { type: `lms.project.${kind}`, title, body, link });
    log.push({ at: new Date(), kind, channel: 'in-app', ok: r.created > 0 || !ids.length, note: `${r.created || 0} learner(s)` });
  }
  if (ch.email) {
    const admins = await M('Admin').find({ _id: { $in: ids } }).select('email').lean();
    const emails = admins.map((x) => x.email);
    if (toMentor && a.mentor) {
      const m = await M('Admin').findById(a.mentor).select('email').lean();
      if (m && m.email) emails.push(m.email);
    }
    let sent = 0;
    let err = null;
    try {
      // a proper email (was plain text — LMS testing report #24)
      const base = (require('../../../config/lms').lmsConfig.meeting.crmBaseUrl || '').replace(/\/$/, '');
      const r = await require('../mailer').sendMail(emails, { ...require('../../mail/inlineEmails').automationLearner({ title, message: body, link: `${base}${link}` }), templateKey: `lms-project-${String(kind).split('-')[0]}` });
      sent = r.sent || 0;
      if (r.skipped) err = r.skipped;
    } catch (e) {
      err = e.message;
    }
    log.push({ at: new Date(), kind, channel: 'email', ok: !err && sent >= Math.min(1, emails.length), note: err ? `failed: ${err}` : `${sent} / ${emails.length} delivered` });
  }
  if (toMentor && a.mentor) await require('../realtime').notify([a.mentor], { type: `lms.project.${kind}`, title, body, link: '/teacher/project-dashboard' });
  if (toSupport) {
    const sup = await M('Admin').find({ role: 'Support', removed: { $ne: true }, enabled: { $ne: false } }).select('_id').lean();
    await require('../realtime').notify(sup.map((s) => s._id), { type: `lms.project.${kind}`, title, body, link: '/support-mgr/extension-desk' });
  }
  if (log.length) await M('LmsProjectAllocation').updateOne({ _id: a._id }, { $push: { notices: { $each: log, $slice: -60 } } });
  return log;
}

const tl = (text, tone = 'mut', kind) => ({ at: new Date(), text, tone, kind });

// ── skill level of a learner, from their real scores (2B "Skill level") ──
async function skillLevels(crmUserIds) {
  const week = require('./score360').weekOf();
  const snaps = await M('LmsScoreSnapshot').find({ crmUser: { $in: crmUserIds } }).sort({ week: -1 }).lean();
  const out = new Map();
  for (const s of snaps) {
    const k = String(s.crmUser);
    if (out.has(k)) continue;
    const v = [s.coding, s.assessment].filter((x) => x != null);
    const avg = v.length ? v.reduce((a, b) => a + b, 0) / v.length : s.total;
    out.set(k, { level: avg == null ? null : avg >= 80 ? 'advanced' : avg >= 60 ? 'intermediate' : 'beginner', score: avg == null ? null : Math.round(avg), week: s.week, fresh: s.week === week });
  }
  return out;
}

function deadlineFor(brief, startAt) {
  if (brief.deadline && (!brief.durationDays || brief.timerStart === 'allocation')) {
    if (new Date(brief.deadline) > startAt) return new Date(brief.deadline);
  }
  if (brief.durationDays) return new Date(startAt.getTime() + brief.durationDays * 24 * H);
  return brief.deadline ? new Date(brief.deadline) : new Date(startAt.getTime() + 5 * 24 * H);
}

// create allocations. units: [{ members:[crmUserId…], groupName? }]
async function allocate(brief, units, { by, mode, batch, notify = { email: true, inApp: true, copyMentor: true } }) {
  const now = new Date();
  const startAt = brief.timerStart === 'startDate' && brief.startDate && new Date(brief.startDate) > now ? new Date(brief.startDate) : now;
  const deadline = deadlineFor(brief, startAt);
  const allIds = units.flatMap((u) => u.members);
  const admins = await M('Admin').find({ _id: { $in: allIds } }).select('name email').lean();
  const byId = new Map(admins.map((a) => [String(a._id), a]));
  const created = [];
  for (const u of units) {
    const ids = u.members.filter((x) => byId.has(String(x)));
    if (!ids.length) continue;
    // skip a learner who already has this project open
    // eslint-disable-next-line no-await-in-loop
    const dup = await M('LmsProjectAllocation').findOne({ brief: brief._id, removed: false, status: { $nin: ['disqualified'] }, $or: [{ learner: { $in: ids } }, { members: { $in: ids } }] }).select('_id').lean();
    if (dup) continue;
    const first = byId.get(String(ids[0]));
    // eslint-disable-next-line no-await-in-loop
    const roster = await M('Student').findOne({ email: A.rxEq(first.email), removed: { $ne: true } }).select('batch').lean();
    const bName = batch || (roster && roster.batch) || '';
    // eslint-disable-next-line no-await-in-loop
    const bDoc = bName ? await M('Batch').findOne({ name: A.rxEq(bName), removed: { $ne: true } }).select('trainer').lean() : null;
    const mentorName = (bDoc && [].concat(bDoc.trainer || [])[0]) || by.name;
    // eslint-disable-next-line no-await-in-loop
    const mentor = mentorName ? await M('Admin').findOne({ name: A.rxEq(mentorName), removed: { $ne: true } }).select('_id name').lean() : null;
    // eslint-disable-next-line no-await-in-loop
    const a = await M('LmsProjectAllocation').create({
      brief: brief._id,
      briefTitle: brief.title,
      stack: (brief.stack || []).join(' · '),
      difficulty: brief.difficulty,
      mode,
      learner: ids[0],
      members: ids.length > 1 ? ids : [],
      memberNames: ids.map((x) => byId.get(String(x)).name),
      groupName: ids.length > 1 ? u.groupName : undefined,
      learnerName: first.name,
      learnerEmail: first.email,
      batch: bName,
      mentor: (mentor && mentor._id) || by._id,
      mentorName: (mentor && mentor.name) || by.name,
      allocatedBy: by._id,
      allocatedByName: by.name,
      allocatedAt: now,
      startAt,
      deadline,
      originalDeadline: deadline,
      deliverablesDone: (brief.deliverables || []).map(() => false),
      allowLate: !!(brief.rules && brief.rules.lockAfterDeadline === false),
      resubmit: { allowed: false, left: (brief.resubmissions && brief.resubmissions.allowed) || 0 },
      timeline: [tl(`Project allocated by ${by.name}${startAt > now ? ` · timer starts ${fmt(startAt)}` : ''}`, 'mut', 'allocated')],
    });
    created.push(a);
    if (notify.email || notify.inApp) {
      const days = Math.max(0, Math.round((deadline - startAt) / (24 * H)));
      // eslint-disable-next-line no-await-in-loop
      await notice(a, {
        kind: 'allocated',
        title: `New project allocated: ${brief.title}`,
        body: `Your mentor ${a.mentorName} allocated a project${ids.length > 1 ? ` to your group (${a.memberNames.join(', ')})` : ''}. ${startAt > now ? `Your timer starts ${fmt(startAt)}` : 'Your timer has started'} — deadline ${fmt(deadline)} IST (${days} day${days === 1 ? '' : 's'}). Reminders at 48 h, 24 h and 1 h.`,
        channels: { email: !!notify.email, inApp: !!notify.inApp },
        toMentor: !!notify.copyMentor,
      }).catch((e) => console.error('[projects] allocate notice', e.message));
    }
  }
  return created;
}

// ── automation tick (2G) ──
let busy = false;
async function tick() {
  if (busy) return;
  busy = true;
  try {
    const AL = M('LmsProjectAllocation');
    const now = new Date();
    // reminders 48 h / 24 h / 1 h (only for projects whose brief asked for them)
    for (const [key, hours, tone] of [
      ['h48', 48, 'wa'],
      ['h24', 24, 'or'],
      ['h1', 1, 'er'],
    ]) {
      for (;;) {
        // eslint-disable-next-line no-await-in-loop
        const a = await AL.findOneAndUpdate(
          { removed: false, status: { $in: OPEN }, deadline: { $gt: now, $lte: new Date(now.getTime() + hours * H) }, [`remindersSent.${key}`]: null, startAt: { $lte: now } },
          { $set: { [`remindersSent.${key}`]: now } },
          { new: true }
        ).lean();
        if (!a) break;
        // eslint-disable-next-line no-await-in-loop
        const brief = await M('LmsProjectBrief').findById(a.brief).select('reminders channels').lean();
        if (brief && brief.reminders && brief.reminders[key] === false) continue;
        // a 48 h reminder that lands after the 24 h mark is pointless — mark & skip
        if (key === 'h48' && a.deadline - now < 24 * H) continue;
        if (key === 'h24' && a.deadline - now < 1 * H) continue;
        // eslint-disable-next-line no-await-in-loop
        await AL.updateOne({ _id: a._id }, { $push: { timeline: tl(`Reminder · ${hours} h left`, tone, 'reminder') } });
        // eslint-disable-next-line no-await-in-loop
        await notice(a, {
          kind: `reminder-${key}`,
          title: `${hours === 1 ? '1 hour' : `${hours} hours`} left: ${a.briefTitle}`,
          body: `Your project "${a.briefTitle}" is due ${fmt(a.deadline)} IST. Submit before the deadline — the form locks automatically.`,
          channels: brief ? { email: brief.channels.email !== false, inApp: brief.channels.inApp !== false } : undefined,
        }).catch(() => {});
      }
    }
    // custom reminder (N hours before)
    const customs = await M('LmsProjectBrief').find({ removed: false, 'reminders.customH': { $gt: 0 } }).select('_id reminders').lean();
    for (const b of customs) {
      for (;;) {
        // eslint-disable-next-line no-await-in-loop
        const a = await AL.findOneAndUpdate(
          { brief: b._id, removed: false, status: { $in: OPEN }, deadline: { $gt: now, $lte: new Date(now.getTime() + b.reminders.customH * H) }, 'remindersSent.custom': null, startAt: { $lte: now } },
          { $set: { 'remindersSent.custom': now }, $push: { timeline: tl(`Reminder · ${b.reminders.customH} h left`, 'wa', 'reminder') } },
          { new: true }
        ).lean();
        if (!a) break;
        // eslint-disable-next-line no-await-in-loop
        await notice(a, { kind: 'reminder-custom', title: `${b.reminders.customH} hours left: ${a.briefTitle}`, body: `Your project "${a.briefTitle}" is due ${fmt(a.deadline)} IST.` }).catch(() => {});
      }
    }
    // deadline passed with nothing submitted → Disqualified (if the brief says so)
    for (;;) {
      // eslint-disable-next-line no-await-in-loop
      const a = await AL.findOneAndUpdate(
        { removed: false, status: { $in: OPEN }, deadline: { $lte: now }, submittedAt: null, 'extension.status': { $ne: 'pending' }, disqualifiedAt: null, allowLate: { $ne: true } },
        { $set: { disqualifiedAt: now, lockedAt: now } },
        { new: true }
      ).lean();
      if (!a) break;
      // eslint-disable-next-line no-await-in-loop
      const brief = await M('LmsProjectBrief').findById(a.brief).select('rules').lean();
      if (brief && brief.rules && brief.rules.autoDisqualify === false) {
        // eslint-disable-next-line no-await-in-loop
        await AL.updateOne({ _id: a._id }, { $push: { timeline: tl('Deadline passed · submission locked', 'er', 'locked') } });
        continue;
      }
      // eslint-disable-next-line no-await-in-loop
      await AL.updateOne(
        { _id: a._id },
        {
          $set: { status: 'disqualified', updated: now },
          $push: { timeline: tl('Deadline passed with no submission · Disqualified automatically', 'er', 'disqualified'), audit: { at: now, byName: 'System', from: a.status, to: 'disqualified', reason: 'auto, no submission' } },
        }
      );
      // eslint-disable-next-line no-await-in-loop
      await notice(a, {
        kind: 'disqualified',
        title: `Disqualified: ${a.briefTitle}`,
        body: `The deadline for "${a.briefTitle}" (${fmt(a.deadline)} IST) passed with no submission, so it is marked Disqualified. Your mentor or support can re-allocate it.`,
        toMentor: true,
        toSupport: true,
      }).catch(() => {});
    }
    // resubmission window closed without a resubmission → closes the option
    await AL.updateMany({ removed: false, status: 'not_qualified', 'resubmit.allowed': true, 'resubmit.deadline': { $lte: now } }, { $set: { 'resubmit.allowed': false }, $push: { timeline: tl('Resubmission window closed', 'mut', 'resubmit-closed') } });
    // auto-allocation rules: new learners who match get the project
    await runAutoRules().catch((e) => console.error('[projects] auto rules', e.message));
  } catch (e) {
    console.error('[projects tick]', e.message);
  } finally {
    busy = false;
  }
}

async function matchRule(rule) {
  const q = { removed: { $ne: true }, status: { $nin: ['Dropped', 'Withdrawn', 'Archived', 'Completed'] } };
  if (rule.batch) q.batch = A.rxEq(rule.batch);
  if (rule.track) q.course = A.rxEq(rule.track);
  const roster = await M('Student').find(q).select('email').lean();
  const emails = [...new Set(roster.map((r) => String(r.email || '').toLowerCase()).filter(Boolean))];
  if (!emails.length) return [];
  const admins = await M('Admin').find({ email: { $in: emails.map(A.rxEq) }, removed: { $ne: true }, role: 'Student' }).select('_id name').lean();
  if (!rule.minSkill || rule.minSkill === 'beginner') return admins;
  const lv = await skillLevels(admins.map((x) => x._id));
  const min = LEVELS.indexOf(rule.minSkill);
  return admins.filter((x) => {
    const s = lv.get(String(x._id));
    return s && s.level && LEVELS.indexOf(s.level) >= min;
  });
}

async function runAutoRules() {
  const briefs = await M('LmsProjectBrief').find({ removed: false, status: 'published', 'autoRule.on': true }).lean();
  for (const b of briefs) {
    if (b.deadline && new Date(b.deadline) < new Date()) continue;
    // eslint-disable-next-line no-await-in-loop
    const learners = await matchRule(b.autoRule);
    if (!learners.length) continue;
    // eslint-disable-next-line no-await-in-loop
    const have = await M('LmsProjectAllocation').find({ brief: b._id, removed: false }).select('learner members').lean();
    const got = new Set(have.flatMap((a) => [a.learner, ...(a.members || [])].map(String)));
    const fresh = learners.filter((l) => !got.has(String(l._id)));
    if (!fresh.length) continue;
    const by = { _id: b.createdBy, name: b.createdByName || 'Auto-allocation' };
    // eslint-disable-next-line no-await-in-loop
    await allocate(
      b,
      fresh.map((l) => ({ members: [l._id] })),
      { by, mode: 'auto' }
    );
  }
}

module.exports = { notice, allocate, tick, skillLevels, matchRule, deadlineFor, tl, recipientsOf, OPEN, LEVELS, fmt };
