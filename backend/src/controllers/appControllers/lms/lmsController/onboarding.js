const mongoose = require('mongoose');
const { LMS_STUDENT_ROLES } = require('../../../../config/roles');
const { trainerNames } = require('../../../../services/lms/teacherCourseAccess');
const { pendingMandatoryCount } = require('./policies');

// Learner onboarding checklist (design L10).
//   GET  /api/lms/my/onboarding                 steps + state
//   POST /api/lms/my/onboarding/:step { done, device? }   calendar | setup | device (self-marked)
// Steps backed by real records are never self-marked: policies (pending
// mandatory acknowledgements), batch (roster row), readiness (a submitted
// BASIC attempt).

const SELF = { calendar: 'calendarAt', setup: 'setupAt', device: 'deviceAt' };
const ok = (res, result, message) => res.status(200).json({ success: true, result, message });
const bad = (res, code, message) => res.status(code).json({ success: false, result: null, message });
const rx = (s) => new RegExp(`^${String(s || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i');
const isStudent = (a) => !!(a && LMS_STUDENT_ROLES.includes(a.role));

async function build(admin) {
  const row = await mongoose.model('Student').findOne({ removed: false, email: rx(admin.email) }).sort({ created: -1 }).lean();
  const batch = row && row.batch ? await mongoose.model('Batch').findOne({ removed: false, name: row.batch }).select('name trainer startDate classTime endTime').lean() : null;
  const [policiesPending, basic, prog] = await Promise.all([
    pendingMandatoryCount(admin).catch(() => 0),
    mongoose
      .model('AssessmentAttempt')
      .findOne({ $or: [{ candidate: admin._id }, { candidateEmail: admin.email }], testType: 'BASIC', status: 'SUBMITTED' })
      .sort({ submittedAt: -1 })
      .select('qualified score totalCount')
      .lean(),
    mongoose.model('OnboardingProgress').findOne({ student: admin._id }).lean(),
  ]);
  const p = prog || {};
  const steps = [
    { key: 'account', title: 'Account created', note: admin.email, state: 'done', auto: true },
    { key: 'policies', title: 'Policies accepted', note: policiesPending ? `${policiesPending} pending` : 'All mandatory policies accepted', state: policiesPending ? 'todo' : 'done', auto: true, link: '/learn/policies' },
    {
      key: 'batch',
      title: 'Batch assigned',
      note: batch ? [batch.name, batch.classTime && batch.endTime ? `${batch.classTime}–${batch.endTime}` : ''].filter(Boolean).join(' · ') : 'Waiting for the team to assign your batch',
      state: row && row.batch ? 'done' : 'todo',
      auto: true,
    },
    { key: 'calendar', title: 'Add class calendar', note: 'Your batch schedule is on the Calendar page', state: p.calendarAt ? 'done' : 'self', link: '/learn/calendar' },
    { key: 'setup', title: 'Python + VS Code setup', note: 'Follow the setup guide', state: p.setupAt ? 'done' : 'self' },
    {
      key: 'device',
      title: 'Device check (camera, mic, browser)',
      note: p.deviceAt && p.device ? `Camera ${p.device.camera ? 'OK' : 'not found'} · Mic ${p.device.microphone ? 'OK' : 'not found'}${p.device.browser ? ` · ${p.device.browser}` : ''}` : 'Run the check on the device you will use for classes',
      state: p.deviceAt ? (p.device && (!p.device.camera || !p.device.microphone) ? 'blocked' : 'done') : 'self',
    },
    {
      key: 'readiness',
      title: 'Basic AI Readiness Test',
      note: basic ? `${basic.score} / ${basic.totalCount} · ${basic.qualified ? 'passed' : 'not passed yet'}` : 'Before your first AI session',
      state: basic && basic.qualified ? 'done' : 'todo',
      auto: true,
      link: '/learn/tests/basic',
    },
  ];
  return {
    name: admin.name,
    batch: batch ? batch.name : row && row.batch,
    batchTime: batch && batch.classTime && batch.endTime ? `${batch.classTime}–${batch.endTime}` : '',
    enrollmentId: (row && row.enrollmentId) || '',
    pmName: batch ? trainerNames(batch.trainer)[0] || '' : '',
    startDate: batch && batch.startDate,
    steps,
    done: steps.filter((s) => s.state === 'done').length,
    total: steps.length,
  };
}

async function mine(req, res) {
  if (!isStudent(req.admin)) return bad(res, 403, 'Candidates only.');
  return ok(res, await build(req.admin));
}

async function mark(req, res) {
  if (!isStudent(req.admin)) return bad(res, 403, 'Candidates only.');
  const field = SELF[req.params.step];
  if (!field) return bad(res, 400, 'This step is updated automatically.');
  const b = req.body || {};
  const set = { [field]: b.done === false ? null : new Date(), updated: new Date() };
  if (req.params.step === 'device' && b.device) {
    set.device = { camera: !!b.device.camera, microphone: !!b.device.microphone, browser: String(b.device.browser || '').slice(0, 80) };
  }
  await mongoose.model('OnboardingProgress').updateOne({ student: req.admin._id }, { $set: set }, { upsert: true });
  const ticket = set.device && (!set.device.camera || !set.device.microphone) ? await blockedTicket(req.admin, set.device) : null;
  return res.status(200).json({
    success: true,
    result: { ...(await build(req.admin)), autoTicket: ticket },
    message: ticket ? `Device check blocked — ticket ${ticket} Support ko chala gaya.` : undefined,
  });
}

// Design L10: "Blocked step ka ticket automatic ban jaata hai, Support
// Manager ko dikh jaata hai." One open ticket per learner for it.
const BLOCKED_SUBJECT = 'Onboarding blocked: device check (camera / microphone)';
async function blockedTicket(admin, device) {
  const Ticket = mongoose.model('Ticket');
  const { ticketNo } = require('../../../../config/supportTickets');
  const open = await Ticket.findOne({ removed: false, createdBy: admin._id, subject: BLOCKED_SUBJECT, status: { $ne: 'Resolved' } }).lean();
  if (open) return ticketNo(open);
  const name = [admin.name, admin.surname].filter(Boolean).join(' ');
  const t = await new Ticket({
    subject: BLOCKED_SUBJECT,
    description: `Automatic: onboarding device check — camera ${device.camera ? 'OK' : 'not available'}, microphone ${device.microphone ? 'OK' : 'not available'}${device.browser ? `, ${device.browser}` : ''}.`,
    category: 'Login / Technical',
    priority: 'Medium',
    status: 'Open',
    source: 'student',
    createdBy: admin._id,
    raisedByName: name,
    raisedByEmail: admin.email,
    raisedByPhone: admin.phone || undefined,
    reference: 'Onboarding · device check',
    history: [{ at: new Date(), action: 'created', status: 'Open', byName: 'System (onboarding)' }],
  }).save();
  const { notify } = require('../../../../notify');
  notify({
    audience: 'support',
    actorId: admin._id,
    actorName: name,
    module: 'Support',
    type: 'ticket.created',
    title: `New Login / Technical ticket ${ticketNo(t)}`,
    body: `${name}: ${BLOCKED_SUBJECT}`,
    link: '/support',
  });
  return ticketNo(t);
}

module.exports = { mine, mark };
