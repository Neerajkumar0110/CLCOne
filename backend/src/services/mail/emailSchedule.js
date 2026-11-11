const mongoose = require('mongoose');
const { sendMailWithRetry, mailReady } = require('./transport');
const { render } = require('./emailTemplates');

// Custom emails made in Messenger › Email: who they go to, when, and the
// actual send. Used by jobs/emailScheduleTick.js and the "Send test" button.
//
// schedule.type
//   once             at schedule.at
//   daily            every day at schedule.time (IST, 'HH:mm')
//   weekly           every schedule.weekday at schedule.time
//   after-enrolment  schedule.offsetMin after each learner's enrolment
//   before-class     schedule.offsetMin before each class of the audience's batch(es)
//   after-class      schedule.offsetMin after each class ends
// audience.type: all-learners | batch (value = batch name) | role (value = CRM role) | emails (comma list)
// Variables every custom email can use: {{name}} {{email}} {{batch}} {{course}}
// {{portalLink}} and, for class-based ones, {{classTitle}} {{classTime}} {{joinLink}}.

const M = (n) => mongoose.model(n);
const DAY = 86400000;
const BRAND = process.env.GMAIL_SENDER_NAME || 'Career Lab Consulting';
const rxEq = (s) => new RegExp(`^${String(s || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i');
const base = () => String(require('../../config/lms').lmsConfig.meeting.crmBaseUrl || '').replace(/\/+$/, '');
const fmt = (d) => new Date(d).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
const ist = (d = new Date()) => new Date(d.getTime() + 330 * 60000);
const dayKey = (d = new Date()) => ist(d).toISOString().slice(0, 10);

const SCHEDULE_TYPES = ['once', 'daily', 'weekly', 'after-enrolment', 'before-class', 'after-class'];
const AUDIENCE_TYPES = ['all-learners', 'batch', 'role', 'emails'];
const CUSTOM_VARS = ['name', 'email', 'batch', 'course', 'portalLink', 'classTitle', 'classTime', 'joinLink'];

// [{ email, name, batch, course, created }]
async function recipients(audience = {}) {
  const t = audience.type;
  const v = String(audience.value || '').trim();
  if (t === 'emails') {
    return [...new Set(v.split(/[\s,;]+/).map((e) => e.trim().toLowerCase()).filter((e) => /.+@.+\..+/.test(e)))].map((email) => ({ email, name: '' }));
  }
  if (t === 'role') {
    const rows = await M('Admin').find({ removed: { $ne: true }, enabled: { $ne: false }, role: v }).select('name surname email').lean();
    return rows.filter((r) => r.email).map((r) => ({ email: r.email, name: [r.name, r.surname].filter(Boolean).join(' ') }));
  }
  if (t === 'all-learners' || t === 'batch') {
    const q = { removed: false, status: 'Active' };
    if (t === 'batch') q.batch = v;
    const rows = await M('Student').find(q).select('name email batch course created enrolledOn').lean();
    const held = new Set(
      (await M('Admin').find({ email: { $in: rows.map((r) => rxEq(r.email)) }, rosterHold: true }).select('email').lean()).map((a) => String(a.email).toLowerCase())
    );
    return rows.filter((r) => r.email && !held.has(String(r.email).toLowerCase())).map((r) => ({ email: r.email, name: r.name || '', batch: r.batch || '', course: r.course || '', created: r.enrolledOn || r.created }));
  }
  return [];
}

function varsFor(r, extra = {}) {
  return { name: r.name || '', email: r.email, batch: r.batch || '', course: r.course || '', portalLink: `${base()}/#/learn`, ...extra };
}

async function sendOne(t, to, vars) {
  return sendMailWithRetry({ from: `"${BRAND}" <${process.env.GMAIL_USER}>`, to, subject: render(t.subject, vars), html: render(t.html, vars), templateKey: t.key });
}

// mark-then-send, so two ticks can never send the same occurrence twice
async function sendOnce(t, ref, to, vars) {
  try {
    await M('EmailTemplateSend').create({ key: t.key, ref });
  } catch (e) {
    return false; // already sent
  }
  try {
    await sendOne(t, to, vars);
    return true;
  } catch (e) {
    return false; // logged as failed by the transport
  }
}

const timeReached = (now, hhmm) => {
  const [h, m] = String(hhmm || '09:00').split(':').map(Number);
  const x = ist(now);
  return x.getUTCHours() > h || (x.getUTCHours() === h && x.getUTCMinutes() >= (m || 0));
};

// Run one custom email for this tick → number sent.
async function run(t, now = new Date()) {
  const s = t.schedule || {};
  const off = Math.max(0, Number(s.offsetMin) || 0) * 60000;
  let sent = 0;
  if (s.type === 'once') {
    if (!s.at || new Date(s.at) > now || t.lastRunAt) return 0;
    for (const r of await recipients(t.audience)) if (await sendOnce(t, `once:${r.email}`, r.email, varsFor(r))) sent += 1;
    await M('EmailTemplate').updateOne({ _id: t._id }, { $set: { lastRunAt: now } });
    return sent;
  }
  if (s.type === 'daily' || s.type === 'weekly') {
    if (!timeReached(now, s.time)) return 0;
    if (s.type === 'weekly' && ist(now).getUTCDay() !== Number(s.weekday)) return 0;
    const day = dayKey(now);
    for (const r of await recipients(t.audience)) if (await sendOnce(t, `${day}:${r.email}`, r.email, varsFor(r))) sent += 1;
    if (sent) await M('EmailTemplate').updateOne({ _id: t._id }, { $set: { lastRunAt: now } });
    return sent;
  }
  if (s.type === 'after-enrolment') {
    // only learners who crossed the offset in the last 2 days — a new rule
    // never mails everyone who enrolled months ago
    for (const r of await recipients(t.audience)) {
      if (!r.created) continue;
      const due = new Date(r.created).getTime() + off;
      if (due > now.getTime() || now.getTime() - due > 2 * DAY) continue;
      if (await sendOnce(t, `enrol:${r.email}`, r.email, varsFor(r))) sent += 1;
    }
  }
  if (s.type === 'before-class' || s.type === 'after-class') {
    const q = { removed: false };
    if (t.audience && t.audience.type === 'batch') q.batchName = String(t.audience.value || '');
    if (s.type === 'before-class') {
      q.status = { $in: ['scheduled', 'upcoming'] };
      q.scheduledStart = { $gt: now, $lte: new Date(now.getTime() + off) };
    } else {
      q.status = { $in: ['ended', 'recording_processing', 'recording_available'] };
      q.actualEnd = { $lte: new Date(now.getTime() - off), $gte: new Date(now.getTime() - off - DAY) };
    }
    const sessions = await M('LmsLiveSession').find(q).select('title batchName courseTitle scheduledStart').limit(100).lean();
    for (const c of sessions) {
      if (!c.batchName) continue;
      for (const r of await recipients({ type: 'batch', value: c.batchName })) {
        const vars = varsFor(r, { classTitle: c.title, classTime: fmt(c.scheduledStart), joinLink: `${base()}/#/learn/classes` });
        if (await sendOnce(t, `${c._id}:${r.email}`, r.email, vars)) sent += 1;
      }
    }
  }
  if (sent) await M('EmailTemplate').updateOne({ _id: t._id }, { $set: { lastRunAt: now } });
  return sent;
}

// Human sentence for the accordion: when this custom email goes out.
function describe(t) {
  const s = t.schedule || {};
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const off = (m) => (m >= 1440 && m % 1440 === 0 ? `${m / 1440} day(s)` : m >= 60 && m % 60 === 0 ? `${m / 60} hour(s)` : `${m || 0} min`);
  switch (s.type) {
    case 'once':
      return s.at ? `Once, on ${fmt(s.at)}` : 'Once (date not set)';
    case 'daily':
      return `Every day at ${s.time || '09:00'}`;
    case 'weekly':
      return `Every ${days[Number(s.weekday) || 0]} at ${s.time || '09:00'}`;
    case 'after-enrolment':
      return `${off(s.offsetMin)} after a learner is enrolled`;
    case 'before-class':
      return `${off(s.offsetMin)} before each class`;
    case 'after-class':
      return `${off(s.offsetMin)} after each class ends`;
    default:
      return 'Not scheduled';
  }
}

function describeAudience(a = {}) {
  if (a.type === 'all-learners') return 'All active learners';
  if (a.type === 'batch') return `Learners of batch ${a.value || '—'}`;
  if (a.type === 'role') return `Staff with role ${a.value || '—'}`;
  if (a.type === 'emails') return `${String(a.value || '').split(/[\s,;]+/).filter(Boolean).length} email address(es)`;
  return '—';
}

module.exports = { run, recipients, varsFor, sendOne, describe, describeAudience, SCHEDULE_TYPES, AUDIENCE_TYPES, CUSTOM_VARS, mailReady };
