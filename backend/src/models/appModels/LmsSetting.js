const mongoose = require('mongoose');

// Single-document store for LMS live-class configuration (attendance
// thresholds, recording policy, in-class permissions, notification timing).
// One row, key = 'live'. Read through services/lms/settingsService.js which
// merges it over DEFAULTS, so a missing row / missing field is always safe.
const schema = new mongoose.Schema({
  removed: { type: Boolean, default: false },
  enabled: { type: Boolean, default: true },
  key: { type: String, default: 'live', unique: true },

  // attendance
  presentThresholdPct: { type: Number, default: 75 }, // >= => PRESENT
  partialThresholdPct: { type: Number, default: 25 }, // >= => PARTIAL, else ABSENT
  lateThresholdMin: { type: Number, default: 10 }, // first join later than this => LATE flag
  attendanceCountsToProgress: { type: Boolean, default: true },
  liveClassProgressWeightPct: { type: Number, default: 0 }, // 0 = don't auto-bump course %

  // recording
  recordingEnabled: { type: Boolean, default: true },
  recordingAutoStart: { type: Boolean, default: true },
  recordingRetentionDays: { type: Number, default: 365 },
  recordingAccess: { type: String, enum: ['enrolled', 'batch', 'course', 'admin-only'], default: 'enrolled' },
  recordingAvailableImmediately: { type: Boolean, default: true },

  // class lifecycle policy
  autoStartPolicy: { type: String, enum: ['manual', 'at-schedule'], default: 'manual' },
  autoEndPolicy: { type: String, enum: ['manual', 'at-schedule', 'grace'], default: 'grace' },
  autoEndGraceMin: { type: Number, default: 20 }, // end N min after scheduledEnd if still live

  // in-class permissions (passed to the provider where supported)
  studentMic: { type: Boolean, default: false },
  studentCamera: { type: Boolean, default: false },
  studentScreenShare: { type: Boolean, default: false },
  chatEnabled: { type: Boolean, default: true },

  // notifications
  notifyBeforeMins: { type: [Number], default: [1440, 60, 15] },
  notifyOnStart: { type: Boolean, default: true },
  notifyOnRecording: { type: Boolean, default: true },

  updated: { type: Date, default: Date.now },
});

module.exports = mongoose.model('LmsSetting', schema);
