const mongoose = require('mongoose');

// Mentor remarks on a learner (Figma 1C → shown on 1A, 1D and the 1F PDF).
// Unlike LmsLearnerNote (private PM notes) these are written FOR the learner.
const schema = new mongoose.Schema({
  removed: { type: Boolean, default: false },
  learner: { type: mongoose.Schema.ObjectId, ref: 'Admin', required: true, index: true },
  tone: { type: String, enum: ['positive', 'action', 'neutral'], default: 'neutral' },
  text: { type: String, required: true },
  showOnReport: { type: Boolean, default: true }, // learner report + PDF
  by: { type: mongoose.Schema.ObjectId, ref: 'Admin' },
  byName: String,
  created: { type: Date, default: Date.now },
});

module.exports = mongoose.model('LmsMentorRemark', schema);
