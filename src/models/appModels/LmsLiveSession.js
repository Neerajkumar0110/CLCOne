const mongoose = require('mongoose');

// A live class session — the thing a teacher starts and students join. Created
// automatically from a Batch (Batch.js post-save hook -> recurrence engine) or
// scheduled explicitly. The meeting room is generated automatically (no manual
// link); the real meeting URL lives only here, never in an API body or the FE.
//
// Provider (services/lms/meeting/): bigbluebutton when configured, else jitsi
// / mock — switches automatically, no data migration.

// One continuous presence interval for a participant. A student who
// disconnects + reconnects gets multiple of these; the total is their
// attendance. Sourced from provider webhooks where available ('bbb'),
// otherwise from the CRM join/leave calls ('crm').
const attSessionSchema = new mongoose.Schema(
  {
    joinedAt: { type: Date, required: true },
    leftAt: { type: Date },
    durationMin: { type: Number, default: 0 },
    source: { type: String, enum: ['bbb', 'crm', 'reconcile'], default: 'crm' },
    providerUserId: { type: String },
  },
  { _id: false }
);

const participantSchema = new mongoose.Schema(
  {
    crmUser: { type: mongoose.Schema.ObjectId, ref: 'Admin' },
    name: { type: String },
    email: { type: String },
    role: { type: String, enum: ['teacher', 'student', 'observer'], default: 'student' },

    firstJoinAt: { type: Date },
    lastLeftAt: { type: Date },
    sessions: { type: [attSessionSchema], default: [] },
    joinCount: { type: Number, default: 0 },
    leaveCount: { type: Number, default: 0 },
    totalDurationMin: { type: Number, default: 0 },
    attendancePct: { type: Number, default: 0 },
    lateBySec: { type: Number, default: 0 },
    present: { type: Boolean, default: false },
    // spec statuses
    attendanceStatus: {
      type: String,
      enum: ['PRESENT', 'PARTIAL', 'ABSENT', 'LATE', 'EXCUSED'],
      default: 'ABSENT',
    },
    excusedReason: { type: String },
    // transient: is the participant currently "in" (a session with no leftAt)
    online: { type: Boolean, default: false },
  },
  { _id: false }
);

const ticketSchema = new mongoose.Schema(
  { ticket: String, crmUser: mongoose.Schema.ObjectId, role: String, exp: Date, used: { type: Boolean, default: false } },
  { _id: false }
);

const schema = new mongoose.Schema({
  removed: { type: Boolean, default: false },
  enabled: { type: Boolean, default: true },

  // links
  liveClass: { type: mongoose.Schema.ObjectId, ref: 'LiveClass' }, // mirror row for the legacy tab
  crmCourse: { type: mongoose.Schema.ObjectId, ref: 'Course' },
  batch: { type: mongoose.Schema.ObjectId, ref: 'Batch' },
  moodleCourseId: { type: Number },

  // recurrence
  recurrenceGroup: { type: String, index: true }, // shared id for a generated series
  sessionIndex: { type: Number, default: 1 }, // "Class 1", "Class 2", ...

  // denormalised for the card
  title: { type: String, required: true },
  description: { type: String },
  courseTitle: { type: String },
  batchName: { type: String },
  teacherName: { type: String },
  teacherCrmUser: { type: mongoose.Schema.ObjectId, ref: 'Admin' },

  // schedule
  scheduledStart: { type: Date, index: true },
  scheduledEnd: { type: Date },
  scheduledDurationMin: { type: Number, default: 60 },
  actualStart: { type: Date },
  actualEnd: { type: Date },

  // meeting room (auto-generated — NO manual link)
  meetingProvider: { type: String, enum: ['bigbluebutton', 'jitsi', 'mock'], default: 'mock' },
  isMock: { type: Boolean, default: true },
  meetingId: { type: String, index: true },
  roomName: { type: String, index: true }, // course-slug-batch-slug-<id>
  publicKey: { type: String, index: true }, // mock room-page capability key
  moderatorPW: { type: String, select: false },
  attendeePW: { type: String, select: false },
  providerData: { type: mongoose.Schema.Types.Mixed, select: false },
  videoUrl: { type: String, select: false },

  // lifecycle
  status: {
    type: String,
    enum: [
      'scheduled',
      'upcoming',
      'starting',
      'live',
      'ending',
      'ended',
      'recording_processing',
      'recording_available',
      'cancelled',
    ],
    default: 'scheduled',
    index: true,
  },

  // recording (summary — full record is LiveRecording)
  recordingEnabled: { type: Boolean, default: true },
  recordingStatus: {
    type: String,
    enum: ['NOT_STARTED', 'RECORDING', 'PROCESSING', 'AVAILABLE', 'FAILED', 'DELETED'],
    default: 'NOT_STARTED',
  },
  recording: { type: mongoose.Schema.ObjectId, ref: 'LiveRecording' },

  participants: { type: [participantSchema], default: [] },
  joinTickets: { type: [ticketSchema], default: [], select: false },

  // idempotency + bookkeeping
  handledWebhookEvents: { type: [String], default: [], select: false },
  progressApplied: { type: Boolean, default: false },
  notifiedBeforeMins: { type: [Number], default: [] },
  notifiedStart: { type: Boolean, default: false },
  notifiedRecording: { type: Boolean, default: false },
  autoCreated: { type: Boolean, default: false },
  autoEnded: { type: Boolean, default: false },

  created: { type: Date, default: Date.now },
  updated: { type: Date, default: Date.now },
});

schema.index({ status: 1, scheduledStart: 1 });
schema.index({ batch: 1, scheduledStart: 1 });
schema.index({ teacherCrmUser: 1, scheduledStart: -1 });

module.exports = mongoose.model('LmsLiveSession', schema);
