const mongoose = require('mongoose');

// Ported from python-test-platform (Prisma model `DeliveryRecord`) — per-batch
// delivery status of one AssessmentCurriculumSession.
const schema = new mongoose.Schema({
  _id: { type: String },
  sessionId: { type: String, required: true, index: true },
  batch: { type: String, required: true },
  status: { type: String, enum: ['PENDING', 'DELIVERED', 'SKIPPED'], default: 'PENDING' },

  // true  = set by curriculumTracker.autoAdvance from the class calendar.
  // false = a teacher/manager resolved this one by hand.
  //
  // The distinction matters because the calendar can shrink: a class gets
  // cancelled, or a holiday pushes the schedule, and a unit that was
  // auto-marked delivered has not actually been taught any more. Those get
  // retracted to PENDING on the next pass. A human decision never is.
  auto: { type: Boolean, default: false },
  plannedDate: { type: Date },
  actualDate: { type: Date },
  notes: { type: String },
  // "What was taught today" (design P2, DATA-03) — written by the PM after
  // class: full / partial (carried to the next class) / a different topic.
  coverage: { type: String, enum: ['full', 'partial', 'different'] },
  deliveredTopic: { type: String },
  liveClass: { type: String }, // LmsLiveSession id
  recordingTitle: { type: String },
  recordedBy: { type: String },
  recordedByName: { type: String },
  updatedAt: { type: Date, default: Date.now },
});

schema.index({ sessionId: 1, batch: 1 }, { unique: true });
schema.index({ batch: 1 });

module.exports = mongoose.model('AssessmentDeliveryRecord', schema);
