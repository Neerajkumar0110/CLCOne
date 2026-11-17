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
      // in-browser AI proctoring (TestIntro/useAiProctor.js), 2026-11-16
      'MULTIPLE_PERSONS',
      'PHONE_DETECTED',
      'LOUD_NOISE',
    ],
    required: true,
  },
  // what was seen ("2 people in camera, 84%") and a small camera JPEG
  // (data URL) taken at that moment — evidence for the PM / a dispute
  detail: { type: String },
  snapshot: { type: String },
  // this event ended the test on its own (see proctorController SEVERE)
  severe: { type: Boolean, default: false },
  timestamp: { type: Date, default: Date.now },
});

module.exports = mongoose.model('AssessmentProctorEvent', schema);
