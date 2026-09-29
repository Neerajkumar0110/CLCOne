const mongoose = require('mongoose');

const attachmentSchema = new mongoose.Schema({ name: String, url: String, sizeKb: Number }, { _id: false });

const schema = new mongoose.Schema({
  removed: { type: Boolean, default: false },
  enabled: { type: Boolean, default: true },

  // Self-generated, human-readable ID (e.g. "ASG-AI101") — a plain Mongo
  // _id gave students/teachers nothing to refer an assignment by out loud
  // or in a support message. Same initials+counter pattern as Course.code/
  // Batch.code, with an "ASG-" prefix so it's never confused with those.
  code: { type: String },

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
  submissionType: { type: String, enum: ['pdf', 'doc', 'image', 'text', 'file', 'link'], default: 'file' },
  allowResubmission: { type: Boolean, default: true },
  published: { type: Boolean, default: true },

  created: { type: Date, default: Date.now },
  updated: { type: Date, default: Date.now },
});

schema.index({ course: 1, dueDate: 1 });

schema.pre('save', async function (next) {
  if (this.isNew && !this.code) {
    const Course = mongoose.model('Course');
    const course = await Course.findById(this.course).select('title').lean();
    const initials = String((course && course.title) || '')
      .split(/\s+/)
      .filter(Boolean)
      .map((w) => w[0])
      .join('')
      .toUpperCase()
      .slice(0, 4);
    const prefix = initials || 'ASG';
    const count = await mongoose.model('Assignment').countDocuments({});
    this.code = `ASG-${prefix}${100 + count}`;
  }
  next();
});

module.exports = mongoose.model('Assignment', schema);
