const mongoose = require('mongoose');

// Course → Module → [Chapter] → Lesson. A Chapter groups lessons inside a
// module.
const schema = new mongoose.Schema({
  removed: { type: Boolean, default: false },
  enabled: { type: Boolean, default: true },

  course: { type: mongoose.Schema.ObjectId, ref: 'Course', required: true, index: true },
  module: { type: mongoose.Schema.ObjectId, ref: 'CourseModule', required: true, index: true },
  title: { type: String, required: true },
  description: { type: String },
  order: { type: Number, default: 0, index: true },

  created: { type: Date, default: Date.now },
  updated: { type: Date, default: Date.now },
});

schema.index({ module: 1, order: 1 });

module.exports = mongoose.model('Chapter', schema);
