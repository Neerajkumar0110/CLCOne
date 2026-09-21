const mongoose = require('mongoose');

// Ported from python-test-platform's src/controllers/proctorController.js
// (Prisma -> Mongoose). Auth is the CRM's own bearer auth (req.admin).

const VALID_EVENT_TYPES = [
  'TAB_SWITCH',
  'WINDOW_BLUR',
  'FULLSCREEN_EXIT',
  'CAMERA_OFF',
  'MIC_OFF',
  'SCREEN_SHARE_STOPPED',
  'DEVTOOLS_OPEN',
];

const MAX_WARNINGS = 3;

async function logProctorEvent(req, res) {
  try {
    const { attemptId } = req.params;
    const admin = req.admin;
    const { type } = req.body;

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
      return res.status(200).json({ success: true, result: { status: attempt.status, warningCount: attempt.warningCount } });
    }

    await AssessmentProctorEvent.create({ attemptId, type });

    const newWarningCount = attempt.warningCount + 1;
    const shouldSuspend = newWarningCount >= MAX_WARNINGS;

    attempt.warningCount = newWarningCount;
    if (shouldSuspend) {
      attempt.status = 'SUSPENDED';
      attempt.submittedAt = new Date();
    }
    await attempt.save();

    return res.status(200).json({
      success: true,
      result: { status: attempt.status, warningCount: attempt.warningCount, suspended: shouldSuspend },
    });
  } catch (err) {
    console.error('Proctor event error:', err);
    return res.status(500).json({ success: false, message: 'Something went wrong. Please try again.' });
  }
}

module.exports = { logProctorEvent };
