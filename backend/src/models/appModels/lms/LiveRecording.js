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
    // AWAITING_UPLOAD: class ended, waiting on the teacher's manual upload
    // (jitsi/mock has no recorder of its own — see liveClassService's
    // endSession). PROCESSING is reserved for the compression step that
    // runs right after an upload — keeping them distinct means the
    // Recordings page's "Upload recording" button (hidden only while an
    // upload is actually compressing) doesn't also hide itself the moment
    // a class ends, before the teacher has uploaded anything.
    enum: ['NOT_STARTED', 'RECORDING', 'AWAITING_UPLOAD', 'PROCESSING', 'AVAILABLE', 'FAILED', 'DELETED'],
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

  // Secondary/mirror location — spec §11 "backup links". Nothing in this app
  // automatically mirrors a recording to a second storage location (that
  // would need cloud-storage credentials this deployment doesn't have
  // configured); this is a manually-set admin field so a recording backed up
  // by hand (e.g. downloaded off BBB and re-uploaded to Drive/S3) has a
  // recorded fallback if the primary playbackUrl/BBB server is ever lost.
  backupUrl: { type: String, select: false },
  backupUpdatedAt: { type: Date },

  views: { type: Number, default: 0 },
  lastViewedAt: { type: Date },

  created: { type: Date, default: Date.now },
  updated: { type: Date, default: Date.now },
});

schema.index({ status: 1, updated: -1 });
schema.index({ crmCourse: 1, batch: 1 });
// Spec §11 "searchable library" — listRecordings previously only supported
// exact-match dropdown filters (status/courseTitle/batchName), no free-text
// search on title/teacher.
schema.index({ className: 'text', courseTitle: 'text', batchName: 'text', teacherName: 'text' });

module.exports = mongoose.model('LiveRecording', schema);
