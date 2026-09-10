const mongoose = require('mongoose');

const fileSchema = new mongoose.Schema({ name: String, url: String, sizeKb: Number }, { _id: false });

const schema = new mongoose.Schema({
  removed: { type: Boolean, default: false },

  assignment: { type: mongoose.Schema.ObjectId, ref: 'Assignment', required: true, index: true },
  course: { type: mongoose.Schema.ObjectId, ref: 'Course', index: true },

  student: { type: mongoose.Schema.ObjectId, ref: 'Admin', required: true, index: true },
  studentName: { type: String },
  studentEmail: { type: String },

  submittedAt: { type: Date, default: Date.now },
  files: { type: [fileSchema], default: [] },
  text: { type: String },
  attempt: { type: Number, default: 1 },

  status: { type: String, enum: ['submitted', 'evaluated', 'resubmit_requested'], default: 'submitted' },
  marks: { type: Number },
  grade: { type: String },
  feedback: { type: String },
  evaluatedBy: { type: mongoose.Schema.ObjectId, ref: 'Admin' },
  evaluatedByName: { type: String },
  evaluatedAt: { type: Date },

  created: { type: Date, default: Date.now },
  updated: { type: Date, default: Date.now },
});

schema.index({ assignment: 1, student: 1 }, { unique: true });

module.exports = mongoose.model('AssignmentSubmission', schema);
