const mongoose = require('mongoose');

const attachmentSchema = new mongoose.Schema({ name: String, url: String, sizeKb: Number }, { _id: false });

const schema = new mongoose.Schema({
  removed: { type: Boolean, default: false },
  enabled: { type: Boolean, default: true },

  course: { type: mongoose.Schema.ObjectId, ref: 'Course', required: true, index: true },
  module: { type: mongoose.Schema.ObjectId, ref: 'CourseModule' },
  lesson: { type: mongoose.Schema.ObjectId, ref: 'Lesson' },
  batch: { type: String },

  teacherCrmUser: { type: mongoose.Schema.ObjectId, ref: 'Admin', index: true },
  teacherName: { type: String },

  title: { type: String, required: true },
  description: { type: String },
  instructions: { type: String },

  startDate: { type: Date },
  dueDate: { type: Date },

  maxMarks: { type: Number, default: 100 },
  passingMarks: { type: Number, default: 40 },

  attachments: { type: [attachmentSchema], default: [] },
  submissionType: { type: String, enum: ['pdf', 'doc', 'image', 'text', 'file'], default: 'file' },
  allowResubmission: { type: Boolean, default: true },
  published: { type: Boolean, default: true },

  created: { type: Date, default: Date.now },
  updated: { type: Date, default: Date.now },
});

schema.index({ course: 1, dueDate: 1 });

module.exports = mongoose.model('Assignment', schema);
