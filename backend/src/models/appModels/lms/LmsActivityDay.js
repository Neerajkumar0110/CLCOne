const mongoose = require('mongoose');

// Practice & Engagement Tracker (Figma 3A): ACTIVE learning time per learner
// per day (IST date). The learner panel sends a heartbeat every 30 s while
// the learner is really working (input within the idle timeout, or a video
// playing); idle time is counted separately and never added to active time.
const itemSchema = new mongoose.Schema(
  {
    kind: { type: String, enum: ['editor', 'lesson', 'video', 'assessment', 'live', 'material', 'other'] },
    ref: String, // id of the lesson / material / recording / test
    title: String,
    course: String,
    module: String,
    topic: String,
    activeSec: { type: Number, default: 0 },
  },
  { _id: false }
);

const schema = new mongoose.Schema({
  crmUser: { type: mongoose.Schema.ObjectId, ref: 'Admin', required: true },
  email: String,
  batch: { type: String, index: true },
  date: { type: String, required: true }, // 'YYYY-MM-DD' (IST)
  activeSec: { type: Number, default: 0 },
  idleSec: { type: Number, default: 0 },
  byKind: {
    editor: { type: Number, default: 0 },
    lesson: { type: Number, default: 0 },
    video: { type: Number, default: 0 },
    assessment: { type: Number, default: 0 },
    live: { type: Number, default: 0 },
    material: { type: Number, default: 0 },
    other: { type: Number, default: 0 },
  },
  items: { type: [itemSchema], default: [] },
  hours: { type: [Number], default: undefined }, // active seconds per IST hour (24) — "Most active"
  exercisesAttempted: { type: Number, default: 0 },
  exercisesCompleted: { type: Number, default: 0 },
  logins: { type: Number, default: 0 },
  score: Number, // engagement score as of this day (alerts tick) — "Low N days in a row"
  firstAt: Date,
  lastAt: Date,
});

schema.index({ crmUser: 1, date: 1 }, { unique: true });
schema.index({ date: 1 });

module.exports = mongoose.model('LmsActivityDay', schema);
