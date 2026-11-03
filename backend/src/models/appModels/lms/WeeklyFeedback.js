const mongoose = require('mongoose');

// One learner's answers for one week — kind 'weekly' (the week in general) or
// 'pm' (their batch's Project Manager). weekKey = that week's Monday (IST) as
// YYYY-MM-DD. See config/lmsFeedback.js and lmsController/feedback.js.
const schema = new mongoose.Schema({
  kind: { type: String, enum: ['weekly', 'pm'], required: true },
  weekKey: { type: String, required: true },
  student: { type: mongoose.Schema.ObjectId, ref: 'Admin', required: true },
  studentName: String,
  batch: { type: String, index: true },
  course: String,
  // the PM this 'pm' response is about (batch trainer at the time)
  teacherName: { type: String, index: true },
  answers: { type: [Number], default: [] },
  comment: { type: String, default: '' },
  // conduct / safety concern — only management ever sees these
  concern: { type: Boolean, default: false },
  concernText: String,
  late: { type: Boolean, default: false },
  formVersion: String,
  created: { type: Date, default: Date.now },
});

schema.index({ student: 1, kind: 1, weekKey: 1 }, { unique: true });
schema.index({ weekKey: 1, batch: 1 });

module.exports = mongoose.model('WeeklyFeedback', schema);
