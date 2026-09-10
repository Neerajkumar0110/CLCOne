const mongoose = require('mongoose');

// LMS teacher → student broadcast. Distinct from the HR `Announcement`
// feature-section model.
const schema = new mongoose.Schema({
  removed: { type: Boolean, default: false },

  teacherCrmUser: { type: mongoose.Schema.ObjectId, ref: 'Admin', index: true },
  teacherName: String,

  title: { type: String, required: true },
  body: { type: String },

  audience: { type: String, enum: ['all', 'course', 'batch'], default: 'course' },
  course: { type: mongoose.Schema.ObjectId, ref: 'Course' },
  courseTitle: String,
  batch: { type: String },

  channels: { type: [String], default: ['in_app'] },   // in_app | email
  recipientsCount: { type: Number, default: 0 },
  emailedCount: { type: Number, default: 0 },
  sentAt: { type: Date, default: Date.now },

  created: { type: Date, default: Date.now },
  updated: { type: Date, default: Date.now },
});

schema.index({ course: 1, sentAt: -1 });

module.exports = mongoose.model('LmsAnnouncement', schema);
