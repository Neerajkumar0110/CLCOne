const mongoose = require('mongoose');

// ONE persistent meeting room per batch. Every live-class session of the batch
// reuses this room's meetingId / roomName / passwords, so a student joins the
// "same link" for the whole batch (>= LMS_MIN_BATCH_MONTHS). The provider
// meeting is created once (lazily on the first class start) and re-used.
const schema = new mongoose.Schema({
  removed: { type: Boolean, default: false },
  enabled: { type: Boolean, default: true },

  batch: { type: mongoose.Schema.ObjectId, ref: 'Batch', required: true, unique: true },
  batchName: { type: String },
  courseTitle: { type: String },
  crmCourse: { type: mongoose.Schema.ObjectId, ref: 'Course' },
  moodleCourseId: { type: Number },
  teacherName: { type: String },
  teacherCrmUser: { type: mongoose.Schema.ObjectId, ref: 'Admin' },

  provider: { type: String, enum: ['bigbluebutton', 'jitsi', 'mock'], default: 'mock' },
  meetingId: { type: String, index: true }, // stable BBB meetingID / jitsi room
  roomName: { type: String }, // course-slug-batch-slug-<hex> (no per-class part)
  publicKey: { type: String }, // mock room capability key (stable per batch)
  moderatorPW: { type: String, select: false },
  attendeePW: { type: String, select: false },
  providerData: { type: mongoose.Schema.Types.Mixed, select: false },

  providerRoomCreated: { type: Boolean, default: false },
  validFrom: { type: Date, default: Date.now },
  validUntil: { type: Date }, // max(batch.endDate, validFrom + minBatchMonths)

  created: { type: Date, default: Date.now },
  updated: { type: Date, default: Date.now },
});

module.exports = mongoose.model('LmsBatchRoom', schema);
