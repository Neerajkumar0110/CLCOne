const mongoose = require('mongoose');

// One row per recording of a live class session. Created NOT_STARTED when a
// session is scheduled with recording on; driven through its states by the
// class lifecycle + the BBB "recording ready" webhook / poller.
const schema = new mongoose.Schema({
  removed: { type: Boolean, default: false },
  enabled: { type: Boolean, default: true },

  liveSession: { type: mongoose.Schema.ObjectId, ref: 'LmsLiveSession', required: true, index: true },
  liveClass: { type: mongoose.Schema.ObjectId, ref: 'LiveClass' },
  crmCourse: { type: mongoose.Schema.ObjectId, ref: 'Course' },
  batch: { type: mongoose.Schema.ObjectId, ref: 'Batch' },
  teacherCrmUser: { type: mongoose.Schema.ObjectId, ref: 'Admin' },

  // denormalised for list pages
  courseTitle: { type: String },
  batchName: { type: String },
  teacherName: { type: String },
  className: { type: String },

  provider: { type: String, enum: ['bigbluebutton', 'jitsi', 'mock'], default: 'mock' },
  recordingId: { type: String, index: true }, // provider recordID
  meetingId: { type: String },

  status: {
    type: String,
    enum: ['NOT_STARTED', 'RECORDING', 'PROCESSING', 'AVAILABLE', 'FAILED', 'DELETED'],
    default: 'NOT_STARTED',
  },
  startedAt: { type: Date },
  endedAt: { type: Date },
  durationMin: { type: Number, default: 0 },
  publishedAt: { type: Date },
  failReason: { type: String },

  // player info — never a raw provider secret. `playbackUrl` is the provider's
  // playback page (auth still enforced by the CRM before we hand it out).
  playbackUrl: { type: String, select: false },
  downloadUrl: { type: String, select: false },
  thumbnails: { type: [String], default: [] },

  views: { type: Number, default: 0 },
  lastViewedAt: { type: Date },

  created: { type: Date, default: Date.now },
  updated: { type: Date, default: Date.now },
});

schema.index({ status: 1, updated: -1 });
schema.index({ crmCourse: 1, batch: 1 });

module.exports = mongoose.model('LiveRecording', schema);
