const mongoose = require('mongoose');

// Course → [Module] → Chapter → Lesson. A Module is the top level of a
// course's curriculum. Kept as its own collection (not a subdoc) so the
// builder can reorder / edit pieces independently and Lesson/Progress can
// reference it directly.
const schema = new mongoose.Schema({
  removed: { type: Boolean, default: false },
  enabled: { type: Boolean, default: true },

  course: { type: mongoose.Schema.ObjectId, ref: 'Course', required: true, index: true },
  title: { type: String, required: true },
  description: { type: String },
  order: { type: Number, default: 0, index: true },

  created: { type: Date, default: Date.now },
  updated: { type: Date, default: Date.now },
});

schema.index({ course: 1, order: 1 });

module.exports = mongoose.model('CourseModule', schema);
