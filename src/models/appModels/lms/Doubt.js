const mongoose = require('mongoose');

const attachmentSchema = new mongoose.Schema({ name: String, url: String }, { _id: false });

const replySchema = new mongoose.Schema(
  {
    by: { type: mongoose.Schema.ObjectId, ref: 'Admin' },
    byName: String,
    byRole: { type: String, enum: ['teacher', 'student', 'manager'] },
    body: String,
    attachments: { type: [attachmentSchema], default: [] },
    pinned: { type: Boolean, default: false },
    at: { type: Date, default: Date.now },
  },
  { _id: true }
);

// A student question tied to a course / module / chapter / lesson. Teachers
// (of that course) reply; either side can resolve.
const schema = new mongoose.Schema({
  removed: { type: Boolean, default: false },

  course: { type: mongoose.Schema.ObjectId, ref: 'Course', required: true, index: true },
  module: { type: mongoose.Schema.ObjectId, ref: 'CourseModule' },
  chapter: { type: mongoose.Schema.ObjectId, ref: 'Chapter' },
  lesson: { type: mongoose.Schema.ObjectId, ref: 'Lesson', index: true },

  student: { type: mongoose.Schema.ObjectId, ref: 'Admin', required: true, index: true },
  studentName: String,
  studentEmail: String,

  title: { type: String, required: true },
  body: { type: String },
  attachments: { type: [attachmentSchema], default: [] },

  status: { type: String, enum: ['open', 'answered', 'resolved'], default: 'open', index: true },
  pinned: { type: Boolean, default: false },
  replies: { type: [replySchema], default: [] },
  lastReplyAt: { type: Date },

  created: { type: Date, default: Date.now },
  updated: { type: Date, default: Date.now },
});

schema.index({ course: 1, status: 1, created: -1 });

module.exports = mongoose.model('Doubt', schema);
