const mongoose = require('mongoose');

// Ported from python-test-platform (Prisma model `ProctorEvent`). Live-only —
// historical events from the reference project's Postgres dump are not
// imported (no UI reads the per-event log; AssessmentAttempt.warningCount is
// what AttemptsAdmin/Results display).
const schema = new mongoose.Schema({
  attemptId: { type: String, required: true, index: true },
  type: {
    type: String,
    enum: [
      'TAB_SWITCH',
      'WINDOW_BLUR',
      'FULLSCREEN_EXIT',
      'CAMERA_OFF',
      'MIC_OFF',
      'SCREEN_SHARE_STOPPED',
      'DEVTOOLS_OPEN',
    ],
    required: true,
  },
  timestamp: { type: Date, default: Date.now },
});

module.exports = mongoose.model('AssessmentProctorEvent', schema);
