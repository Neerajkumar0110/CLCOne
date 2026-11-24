const mongoose = require('mongoose');
const cfg = require('./config');
const eng = require('./engagement');
const A = require('./access');

// Engagement alerts & reminders (Figma 3C / 3D / 3E). The rules come from the
// 3E settings. Called every 15 min by jobs/lmsGrowthTick.js:
//   • learner reminders (daily goal, streak at risk, weekly email) — every call
//   • full evaluation of every active learner — once an hour
// Alerts are keyed per episode (unique index), so two backends can't double them.

const M = (n) => mongoose.model(n);
const DAY = 86400000;
const realtime = () => require('../realtime');
const mailer = () => require('../mailer');

let busy = false;
let lastFull = 0;

const istHour = (d = new Date()) => Number(new Date(d.getTime() + 330 * 60000).toISOString().slice(11, 13));
const quiet = (E, h) => (E.quiet.from > E.quiet.to ? h >= E.quiet.from || h < E.quiet.to : h >= E.quiet.from && h < E.quiet.to);

// every active learner login with roster + mentor
async function activeLearners() {
  const roster = await M('Student')
    .find({ removed: { $ne: true }, status: 'Active', batch: { $nin: [null, ''] } })
    .select('email name batch phone enrollmentId enrolledOn')
    .lean();
  const emails = [...new Set(roster.map((r) => String(r.email || '').toLowerCase()).filter(Boolean))];
  if (!emails.length) return [];
  const admins = await M('Admin').find({ email: { $in: emails.map(A.rxEq) }, removed: { $ne: true }, role: 'Student' }).select('_id name email').lean();
  const byEmail = new Map(roster.map((r) => [String(r.email).toLowerCase(), r]));
  const batches = await M('Batch').find({ name: { $in: [...new Set(roster.map((r) => r.batch))] } }).select('name trainer status').lean();
  const mentorOf = new Map(batches.map((b) => [b.name, [].concat(b.trainer || [])[0] || null]));
  const runningBatch = new Set(batches.filter((b) => !['Completed', 'Cancelled'].includes(b.status)).map((b) => b.name));
  const mentorNames = [...new Set([...mentorOf.values()].filter(Boolean))];
  const mentors = mentorNames.length ? await M('Admin').find({ name: { $in: mentorNames.map(A.rxEq) }, removed: { $ne: true } }).select('_id name email').lean() : [];
  const mentorByName = new Map(mentors.map((m) => [String(m.name).toLowerCase(), m]));
  return admins
    .map((a) => {
      const r = byEmail.get(String(a.email).toLowerCase());
      const mn = r && mentorOf.get(r.batch);
      return { ...a, roster: r, batch: r && r.batch, mentor: mn ? mentorByName.get(String(mn).toLowerCase()) || { name: mn } : null };
    })
    .filter((l) => l.batch && runningBatch.has(l.batch));
}

async function raise(l, kind, { episode, text, severity = 'wa', inactiveDays, lastActive, queue = null }) {
  const key = `${kind}:${l._id}:${episode}`;
  try {
    const row = await M('LmsEngagementAlert').create({
      key,
      learner: l._id,
      learnerName: l.name,
      learnerEmail: l.email,
      learnerPhone: l.roster && l.roster.phone,
      learnerId: l.roster && l.roster.enrollmentId,
      batch: l.batch,
      mentor: l.mentor && l.mentor._id,
      mentorName: l.mentor && l.mentor.name,
      kind,
      text,
      severity,
      inactiveDays,
      lastActive,
      queue,
    });
    return row;
  } catch (e) {
    if (e && e.code === 11000) return null; // already raised for this episode
    throw e;
  }
}

// Last activity from what the LMS already recorded before the tracker existed
// (user ask 2026-11-24: the outreach queue was empty because inactivity only
// counted from the tracker's first day): last login/seen, last lesson progress,
// last class attended. → Map(learnerId → Date)
async function historyLastActive(learners) {
  const out = new Map();
  if (!learners.length) return out;
  const ids = learners.map((l) => l._id);
  const put = (id, d) => {
    if (!d) return;
    const k = String(id);
    const t = new Date(d);
    if (!out.has(k) || out.get(k) < t) out.set(k, t);
  };
  const [admins, lessons, attended] = await Promise.all([
    M('Admin').find({ _id: { $in: ids } }).select('_id lastSeenAt').lean(),
    M('LessonProgress').aggregate([{ $match: { crmUser: { $in: ids } } }, { $group: { _id: '$crmUser', t: { $max: '$updated' } } }]),
    M('AttendanceRecord').aggregate([
      { $match: { status: { $in: ['Present', 'Late', 'Left Early'] } } },
      { $group: { _id: { $toLower: '$student' }, t: { $max: '$date' } } },
    ]),
  ]);
  admins.forEach((a) => put(a._id, a.lastSeenAt));
  lessons.forEach((x) => put(x._id, x.t));
  const byName = new Map(attended.map((x) => [x._id, x.t]));
  learners.forEach((l) => put(l._id, byName.get(String(l.name || '').toLowerCase())));
  return out;
}

// learners whose roster status says they dropped out — always on the outreach queue
async function droppedLearners() {
  const roster = await M('Student')
    .find({ removed: { $ne: true }, status: { $in: ['Dropped', 'Withdrawn'] } })
    .select('email name batch phone enrollmentId enrolledOn status')
    .lean();
  const emails = [...new Set(roster.map((r) => String(r.email || '').toLowerCase()).filter(Boolean))];
  if (!emails.length) return [];
  const admins = await M('Admin').find({ email: { $in: emails.map(A.rxEq) }, removed: { $ne: true } }).select('_id name email').lean();
  const byEmail = new Map(roster.map((r) => [String(r.email).toLowerCase(), r]));
  const batches = await M('Batch').find({ name: { $in: [...new Set(roster.map((r) => r.batch).filter(Boolean))] } }).select('name trainer').lean();
  const mentorOf = new Map(batches.map((b) => [b.name, [].concat(b.trainer || [])[0] || null]));
  return admins.map((a) => {
    const r = byEmail.get(String(a.email).toLowerCase());
    const mn = r && mentorOf.get(r.batch);
    return { ...a, roster: r, batch: (r && r.batch) || '—', mentor: mn ? { name: mn } : null };
  });
}

async function supportIds() {
  return (await M('Admin').find({ role: 'Support', removed: { $ne: true } }).select('_id email').lean());
}

async function evaluate() {
  const c = await cfg.get();
  const E = c.engagement;
  const R = E.rules;
  const learners = await activeLearners();
  const today = eng.istDate();
  const week = require('./score360').weekOf();
  const sup = await supportIds();
  // Inactivity is only counted from the day the tracker started collecting
  // data — before that "no activity" just means "not tracked yet".
  const first = await M('LmsActivityDay').findOne({ activeSec: { $gt: 0 } }).sort({ date: 1 }).select('date').lean();
  const trackingSince = first ? eng.istStart(first.date) : null;
  const hist = await historyLastActive(learners);
  for (const l of learners) {
    // eslint-disable-next-line no-await-in-loop
    const s = await eng.summary({ crmUser: l._id, name: l.name, batch: l.batch }, { heatDays: 60 }).catch(() => null);
    if (!s) continue;
    // remember today's score (for "Low N days in a row") + this week's engagement in the 360° snapshot
    // eslint-disable-next-line no-await-in-loop
    await M('LmsActivityDay').updateOne({ crmUser: l._id, date: today }, { $set: { score: s.score, batch: l.batch }, $setOnInsert: { email: l.email } }, { upsert: true }).catch(() => {});
    // eslint-disable-next-line no-await-in-loop
    await M('LmsScoreSnapshot').updateOne({ crmUser: l._id, week }, { $set: { engagement: s.score, batch: l.batch } }, { upsert: true }).catch(() => {});

    // last activity: the tracker, or what the LMS recorded before it (login, lessons, classes)
    const h = hist.get(String(l._id));
    const lastAny = [s.lastActive, h].filter(Boolean).map((d) => new Date(d)).sort((x, y) => y - x)[0] || null;
    // never seen anywhere: count from enrolment, but not before tracking began
    const cands = (lastAny ? [lastAny, l.roster && l.roster.enrolledOn] : [l.roster && l.roster.enrolledOn, trackingSince]).filter(Boolean).map((d) => new Date(d).getTime());
    const since = (lastAny || trackingSince) && cands.length ? Math.max(...cands) : null;
    const inactiveDays = since ? Math.floor((Date.now() - since) / DAY) : null;
    const episode = lastAny ? eng.istDate(lastAny) : 'never';
    const lastTxt = lastAny ? `last active ${new Date(lastAny).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}` : 'never active in the LMS';

    // 1 · inactive N days → mentor
    if (R.inactiveMentor.on && inactiveDays != null && inactiveDays >= R.inactiveMentor.days) {
      // eslint-disable-next-line no-await-in-loop
      const a = await raise(l, 'inactiveMentor', { episode, text: `Inactive ${inactiveDays} days · ${lastTxt}`, severity: 'er', inactiveDays, lastActive: lastAny });
      if (a && l.mentor && l.mentor._id) {
        // eslint-disable-next-line no-await-in-loop
        await realtime().notify([l.mentor._id], { type: 'lms.engagement.alert', title: `${l.name} inactive ${inactiveDays} days`, body: `${lastTxt}. Nudge them from Engagement Alerts.`, link: '/teacher/engagement' });
        if (l.mentor.email) mailer().sendMail([l.mentor.email], { subject: `Engagement alert: ${l.name} inactive ${inactiveDays} days`, text: `${l.name} (${l.batch}) has been inactive for ${inactiveDays} days — ${lastTxt}.\n\nOpen Engagement Alerts in the LMS to nudge them.\n\nCareerLab LMS` }).catch(() => {});
      }
    }
    // 2 · inactive N days → support outreach queue
    if (R.inactiveSupport.on && inactiveDays != null && inactiveDays >= R.inactiveSupport.days) {
      // eslint-disable-next-line no-await-in-loop
      const a = await raise(l, 'inactiveSupport', { episode, text: `Inactive ${inactiveDays} days · ${lastTxt}`, severity: 'er', inactiveDays, lastActive: lastAny, queue: 'to_contact' });
      if (a) {
        // eslint-disable-next-line no-await-in-loop
        await realtime().notify(sup.map((x) => x._id), { type: 'lms.engagement.outreach', title: `Outreach: ${l.name} inactive ${inactiveDays} days`, body: `${l.batch} · mentor ${(l.mentor && l.mentor.name) || '—'}`, link: '/support-mgr/inactive' });
        mailer().sendMail(sup.map((x) => x.email), { subject: `Inactive learner: ${l.name} (${inactiveDays} days)`, text: `${l.name} (${l.batch}) is in the outreach queue — ${lastTxt}.\n\nCareerLab LMS` }).catch(() => {});
      } else {
        // keep the queue row's inactive-days count fresh
        // eslint-disable-next-line no-await-in-loop
        await M('LmsEngagementAlert').updateOne({ key: `inactiveSupport:${l._id}:${episode}`, status: 'open' }, { $set: { inactiveDays, text: `Inactive ${inactiveDays} days · ${lastTxt}`, updated: new Date() } });
      }
    }
    // 3 · Low Engagement N days in a row → mentor
    if (R.lowStreak.on && trackingSince && l.mentor && l.mentor._id) {
      const last = Array.from({ length: R.lowStreak.days }, (_, i) => eng.addDays(today, -i));
      // eslint-disable-next-line no-await-in-loop
      const rows = await M('LmsActivityDay').find({ crmUser: l._id, date: { $in: last } }).select('date score').lean();
      const low = rows.length === last.length && rows.every((r) => r.score != null && r.score < E.levels.moderate);
      if (low) {
        // eslint-disable-next-line no-await-in-loop
        const a = await raise(l, 'lowStreak', { episode: last[last.length - 1], text: `Low engagement ${R.lowStreak.days} days in a row (score ${s.score})`, severity: 'er' });
        // eslint-disable-next-line no-await-in-loop
        if (a) await realtime().notify([l.mentor._id], { type: 'lms.engagement.alert', title: `${l.name}: low engagement ${R.lowStreak.days} days`, body: `Engagement score ${s.score}.`, link: '/teacher/engagement' });
      }
    }
    // 4 · missed N live classes in a week → mentor + learner
    if (R.missedLive.on && s.participation && s.participation.held) {
      const missed = s.participation.held - s.participation.attended;
      if (missed >= R.missedLive.count) {
        // eslint-disable-next-line no-await-in-loop
        const a = await raise(l, 'missedLive', { episode: week, text: `Missed ${missed} live class${missed === 1 ? '' : 'es'} this week`, severity: 'wa' });
        if (a) {
          // eslint-disable-next-line no-await-in-loop
          await realtime().notify([l._id], { type: 'lms.engagement.missed', title: `You missed ${missed} live classes this week`, body: 'Recordings are in Recordings — catch up before the next class.', link: '/learn/recordings' });
          // eslint-disable-next-line no-await-in-loop
          if (l.mentor && l.mentor._id) await realtime().notify([l.mentor._id], { type: 'lms.engagement.alert', title: `${l.name} missed ${missed} live classes`, body: 'This week.', link: '/teacher/engagement' });
        }
      }
    }
    // 5 · streak of N+ days broken → learner
    if (R.streakBroken.on) {
      const byDate = Object.fromEntries(s.days.map((d) => [d.date, d.activeSec || 0]));
      const y = eng.addDays(today, -1);
      if ((byDate[y] || 0) < eng.STREAK_MIN_SEC) {
        let n = 0;
        let d = eng.addDays(today, -2);
        while ((byDate[d] || 0) >= eng.STREAK_MIN_SEC) {
          n += 1;
          d = eng.addDays(d, -1);
        }
        if (n >= R.streakBroken.days) {
          // eslint-disable-next-line no-await-in-loop
          const a = await raise(l, 'streakBroken', { episode: y, text: `${n}-day streak broken`, severity: 'wa' });
          // eslint-disable-next-line no-await-in-loop
          if (a) await realtime().notify([l._id], { type: 'lms.engagement.streak', title: `Your ${n}-day streak ended`, body: 'Start a new one today — 10 active minutes is enough.', link: '/learn/practice' });
        }
      }
    }
    // 6 · readiness below X → mentor + admin (email)
    if (R.readinessLow.on) {
      // eslint-disable-next-line no-await-in-loop
      const snap = await M('LmsScoreSnapshot').findOne({ crmUser: l._id, week }).select('total').lean();
      if (snap && snap.total != null && snap.total < R.readinessLow.below) {
        // eslint-disable-next-line no-await-in-loop
        const a = await raise(l, 'readinessLow', { episode: week, text: `Hire-readiness ${Math.round(snap.total)} — below ${R.readinessLow.below}`, severity: 'wa' });
        if (a) {
          // eslint-disable-next-line no-await-in-loop
          const admins = await M('Admin').find({ role: { $in: ['owner', 'Super Admin', 'Admin'] }, removed: { $ne: true } }).select('email').lean();
          const to = [...admins.map((x) => x.email), l.mentor && l.mentor.email].filter(Boolean);
          mailer().sendMail(to, { subject: `Readiness alert: ${l.name} at ${Math.round(snap.total)}`, text: `${l.name} (${l.batch}) hire-readiness is ${Math.round(snap.total)}, below ${R.readinessLow.below}.\n\nCareerLab LMS` }).catch(() => {});
        }
      }
    }
  }

  // dropped-out learners (roster status Dropped / Withdrawn) — on the queue to win back
  const dropped = await droppedLearners();
  const dHist = await historyLastActive(dropped);
  for (const l of dropped) {
    const last = dHist.get(String(l._id)) || null;
    const days = last ? Math.floor((Date.now() - last.getTime()) / DAY) : null;
    const lastTxt = last ? `last active ${last.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}` : 'never active in the LMS';
    // eslint-disable-next-line no-await-in-loop
    const a = await raise(l, 'dropped', { episode: 'dropped', text: `Dropped out (${(l.roster && l.roster.status) || 'Dropped'}) · ${lastTxt}`, severity: 'er', inactiveDays: days, lastActive: last, queue: 'to_contact' });
    if (a) {
      // eslint-disable-next-line no-await-in-loop
      await M('LmsEngagementAlert').updateOne({ _id: a._id }, { $set: { dropRisk: true, dropRiskAt: new Date() } });
    } else {
      // eslint-disable-next-line no-await-in-loop
      await M('LmsEngagementAlert').updateOne({ key: `dropped:${l._id}:dropped`, status: 'open' }, { $set: { inactiveDays: days, lastActive: last, updated: new Date() } });
    }
  }

  // re-activation: open alerts whose learner was active after the alert
  const open = await M('LmsEngagementAlert').find({ status: 'open' }).select('learner created queue').lean();
  for (const al of open) {
    // eslint-disable-next-line no-await-in-loop
    const back = await M('LmsActivityDay').findOne({ crmUser: al.learner, lastAt: { $gt: al.created }, activeSec: { $gte: 5 * 60 } }).select('lastAt').lean();
    if (back) {
      // eslint-disable-next-line no-await-in-loop
      await M('LmsEngagementAlert').updateOne(
        { _id: al._id },
        { $set: { status: 'resolved', resolvedAt: new Date(), reactivatedAt: back.lastAt, ...(al.queue && al.queue !== 'resolved' ? { queue: 'resolved', lastOutcome: al.queue ? 'Re-activated (back to practice)' : undefined } : {}), updated: new Date() } }
      );
    }
  }
}

// learner reminders — goal at the reminder hour, streak at risk at 9 PM, weekly email Monday 9 AM
async function reminders() {
  const c = await cfg.get();
  const E = c.engagement;
  const h = istHour();
  if (quiet(E, h)) return;
  const today = eng.istDate();
  const learners = await activeLearners();
  if (!learners.length) return;
  const ids = learners.map((l) => l._id);
  const [days, profiles] = await Promise.all([
    M('LmsActivityDay').find({ crmUser: { $in: ids }, date: { $gte: eng.addDays(today, -15), $lte: today } }).select('crmUser date activeSec').lean(),
    M('LmsLearnerProfile').find({ crmUser: { $in: ids } }).select('crmUser practice').lean(),
  ]);
  const prof = new Map(profiles.map((p) => [String(p.crmUser), p.practice || {}]));
  const byUser = new Map();
  for (const d of days) {
    const k = String(d.crmUser);
    if (!byUser.has(k)) byUser.set(k, {});
    byUser.get(k)[d.date] = d.activeSec || 0;
  }
  const monday = new Date(`${today}T00:00:00Z`).getUTCDay() === 1;
  for (const l of learners) {
    const p = prof.get(String(l._id)) || {};
    const map = byUser.get(String(l._id)) || {};
    const todayMin = Math.round((map[today] || 0) / 60);
    const goal = p.goalMin || E.dailyGoalMin;
    const remindHour = p.remindHour ?? E.reminderHour;
    // daily goal
    if (p.remind !== false && h >= remindHour && p.lastRemindedDay !== today && todayMin < goal) {
      // eslint-disable-next-line no-await-in-loop
      const claimed = await M('LmsLearnerProfile').findOneAndUpdate({ crmUser: l._id, 'practice.lastRemindedDay': { $ne: today } }, { $set: { 'practice.lastRemindedDay': today, email: l.email } }, { upsert: true, new: true }).catch(() => null);
      // eslint-disable-next-line no-await-in-loop
      if (claimed) await realtime().notify([l._id], { type: 'lms.practice.goal', title: `${goal - todayMin} min left to hit today's goal`, body: `You've done ${todayMin} of ${goal} active minutes today.`, link: '/learn/practice' });
    }
    // streak at risk (9 PM)
    const st = eng.streakOf(map, today);
    if (E.streakRisk && p.streakAlert !== false && h >= 21 && p.lastStreakAlertDay !== today && st.current >= 3 && (map[today] || 0) < eng.STREAK_MIN_SEC) {
      // eslint-disable-next-line no-await-in-loop
      const claimed = await M('LmsLearnerProfile').findOneAndUpdate({ crmUser: l._id, 'practice.lastStreakAlertDay': { $ne: today } }, { $set: { 'practice.lastStreakAlertDay': today, email: l.email } }, { upsert: true, new: true }).catch(() => null);
      // eslint-disable-next-line no-await-in-loop
      if (claimed) await realtime().notify([l._id], { type: 'lms.practice.streak', title: `Streak at risk · ${st.current} days`, body: 'Nothing logged today yet — 10 active minutes keeps it going.', link: '/learn/practice' });
    }
    // weekly progress email (Monday, 9 AM+)
    if (E.weeklyEmail && monday && h >= 9) {
      const wk = require('./score360').weekOf();
      if (p.lastWeeklyWeek !== wk) {
        // eslint-disable-next-line no-await-in-loop
        const claimed = await M('LmsLearnerProfile').findOneAndUpdate({ crmUser: l._id, 'practice.lastWeeklyWeek': { $ne: wk } }, { $set: { 'practice.lastWeeklyWeek': wk, email: l.email } }, { upsert: true, new: true }).catch(() => null);
        if (claimed) {
          const last7 = Array.from({ length: 7 }, (_, i) => eng.addDays(today, -1 - i)).reduce((s, d) => s + (map[d] || 0), 0);
          const m = Math.round(last7 / 60);
          mailer()
            .sendMail([l.email], {
              subject: `Your week in the LMS: ${Math.floor(m / 60)}h ${m % 60}m of practice`,
              text: `Hi ${l.name},\n\nLast week you practised ${Math.floor(m / 60)}h ${m % 60}m (active time only). Current streak: ${st.current} day${st.current === 1 ? '' : 's'}.\n\nYour daily goal is ${goal} minutes — see your Practice Tracker in the LMS.\n\nCareerLab LMS`,
            })
            .catch(() => {});
        }
      }
    }
  }
}

async function tick() {
  if (busy) return;
  busy = true;
  try {
    await reminders().catch((e) => console.error('[alerts] reminders', e.message));
    if (Date.now() - lastFull > 55 * 60 * 1000) {
      lastFull = Date.now();
      await evaluate().catch((e) => console.error('[alerts] evaluate', e.message));
    }
  } finally {
    busy = false;
  }
}

module.exports = { tick, evaluate, reminders, activeLearners, droppedLearners, historyLastActive, raise };
