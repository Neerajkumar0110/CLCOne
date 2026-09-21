const mongoose = require('mongoose');

// Ported from python-test-platform (Prisma model `CurriculumSession`) — one
// row per planned session in a syllabus track. Distinct from this codebase's
// existing (unrelated) Course/Module/Chapter/Lesson curriculum builder.
const schema = new mongoose.Schema({
  _id: { type: String },
  code: { type: String, required: true },
  unit: { type: String, required: true },
  title: { type: String, required: true },
  hours: { type: Number, required: true },
  order: { type: Number, required: true },
  track: { type: String, enum: ['FOUNDATION', 'ELITE'], default: 'FOUNDATION' },
  createdAt: { type: Date, default: Date.now },
});

schema.index({ order: 1 });
schema.index({ track: 1 });

module.exports = mongoose.model('AssessmentCurriculumSession', schema);
