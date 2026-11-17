const mongoose = require('mongoose');

// Ported from python-test-platform's src/controllers/proctorController.js
// (Prisma -> Mongoose). Auth is the CRM's own bearer auth (req.admin).
//
// 2026-11-16 (management ask): a test is ENDED at once — not after 3
// warnings — when the learner switches tab / opens a new one, stops the
// camera or the screen share, or the in-browser AI proctoring
// (frontend TestIntro/useAiProctor.js) sees another person, a phone, or
// hears sustained talking / loud noise. The learner gets an email saying
// why, management a notification, and the event keeps a camera snapshot as
// evidence. Leaving full screen / clicking outside the window stay warnings
// (3 warnings still end the test).

const VALID_EVENT_TYPES = [
  'TAB_SWITCH',
  'WINDOW_BLUR',
  'FULLSCREEN_EXIT',
  'CAMERA_OFF',
  'MIC_OFF',
  'SCREEN_SHARE_STOPPED',
  'DEVTOOLS_OPEN',
  'MULTIPLE_PERSONS',
  'PHONE_DETECTED',
  'LOUD_NOISE',
];

// one of these ends the test immediately
const SEVERE = ['TAB_SWITCH', 'CAMERA_OFF', 'SCREEN_SHARE_STOPPED', 'MULTIPLE_PERSONS', 'PHONE_DETECTED', 'LOUD_NOISE'];

// what the learner (email, suspended screen) and the PM are told
const REASON = {
  TAB_SWITCH: 'You switched to another tab or window during the test.',
  CAMERA_OFF: 'Your camera was turned off during the test.',
  SCREEN_SHARE_STOPPED: 'Your screen sharing was stopped during the test.',
  MULTIPLE_PERSONS: 'More than one person was seen on your camera during the test.',
  PHONE_DETECTED: 'A mobile phone was seen on your camera during the test.',
  LOUD_NOISE: 'Continuous talking or loud background sound was detected during the test.',
  WINDOW_BLUR: 'You left the test window too many times (3 warnings).',
  FULLSCREEN_EXIT: 'You left full screen too many times (3 warnings).',
  MIC_OFF: 'Your microphone was turned off too many times (3 warnings).',
  DEVTOOLS_OPEN: 'Browser developer tools were opened too many times (3 warnings).',
};

const MAX_WARNINGS = 3;
const MAX_SNAPSHOT = 200000; // ~150 KB JPEG as a data URL

const TEST_LABELS = { BASIC: 'Basic', MAJOR: 'Major', MICRO: 'Micro', NLP_MICRO: 'NLP Micro', NLP_MAJOR: 'NLP Major', LLM_MAJOR: 'LLM Major' };

// Email + in-app notice to the learner, notice to management. Best-effort —
// never blocks ending the test.
async function announceSuspension(attempt, type) {
  const testType = TEST_LABELS[attempt.testType] || attempt.testType;
  const reason = attempt.suspendReason || REASON[type] || 'A proctoring rule was broken during the test.';
  const when = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  try {
    if (attempt.candidate) {
      await require('../../../../../services/lms/realtime').notify([attempt.candidate], {
        type: 'assessment.suspended',
        title: `${testType} test ended — proctoring violation`,
        body: reason,
        link: '/learn/results',
      });
    }
  } catch (e) {
    console.error('[lms] suspension notice failed:', e && e.message);
  }
  try {
    if (attempt.candidateEmail) {
      const vars = { name: attempt.candidateName || '', testType, reason, when };
      await require('../../../../../services/lms/mailer').sendMail([attempt.candidateEmail], {
        ...require('../../../../../services/mail/inlineEmails').assessmentSuspended(vars),
        templateKey: 'lms-assessment-suspended',
        vars,
      });
    }
  } catch (e) {
    console.error('[lms] suspension email failed:', e && e.message);
  }
  try {
    await require('../../../../../notify').notify({
      audience: 'management',
      module: 'LMS',
      type: 'assessment.suspended',
      title: `Test ended for malpractice: ${attempt.candidateName || attempt.candidateEmail || 'learner'}`,
      body: `${testType} test${attempt.candidateBatch ? ` · ${attempt.candidateBatch}` : ''} — ${reason}`,
      link: '/teacher/attempts',
    });
  } catch (e) {
    /* best-effort */
  }
}

async function logProctorEvent(req, res) {
  try {
    const { attemptId } = req.params;
    const admin = req.admin;
    const { type } = req.body;
    const detail = typeof req.body.detail === 'string' ? req.body.detail.slice(0, 300) : undefined;
    const snapshot =
      typeof req.body.snapshot === 'string' && req.body.snapshot.startsWith('data:image/jpeg;base64,') && req.body.snapshot.length <= MAX_SNAPSHOT
        ? req.body.snapshot
        : undefined;

    if (!VALID_EVENT_TYPES.includes(type)) {
      return res.status(400).json({ success: false, message: 'Invalid proctor event type.' });
    }

    const AssessmentAttempt = mongoose.model('AssessmentAttempt');
    const AssessmentProctorEvent = mongoose.model('AssessmentProctorEvent');

    const attempt = await AssessmentAttempt.findById(attemptId);
    if (!attempt || String(attempt.candidate) !== String(admin._id)) {
      return res.status(404).json({ success: false, message: 'Attempt not found.' });
    }

    if (attempt.status !== 'IN_PROGRESS') {
      // Attempt already closed — nothing to log against, but don't error the client.
      return res.status(200).json({ success: true, result: { status: attempt.status, warningCount: attempt.warningCount, suspended: attempt.status === 'SUSPENDED', reason: attempt.suspendReason } });
    }

    const severe = SEVERE.includes(type);
    await AssessmentProctorEvent.create({ attemptId, type, detail, snapshot, severe });

    const newWarningCount = attempt.warningCount + 1;
    const shouldSuspend = severe || newWarningCount >= MAX_WARNINGS;

    attempt.warningCount = newWarningCount;
    if (shouldSuspend) {
      attempt.status = 'SUSPENDED';
      attempt.submittedAt = new Date();
      attempt.suspendType = type;
      attempt.suspendReason = REASON[type] || 'A proctoring rule was broken during the test.';
    }
    await attempt.save();
    if (shouldSuspend) announceSuspension(attempt, type).catch(() => {});

    return res.status(200).json({
      success: true,
      result: { status: attempt.status, warningCount: attempt.warningCount, suspended: shouldSuspend, severe, reason: shouldSuspend ? attempt.suspendReason : undefined },
    });
  } catch (err) {
    console.error('Proctor event error:', err);
    return res.status(500).json({ success: false, message: 'Something went wrong. Please try again.' });
  }
}

module.exports = { logProctorEvent, SEVERE, REASON };
