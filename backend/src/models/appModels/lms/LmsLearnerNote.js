const mongoose = require('mongoose');

// Project Manager's private notes on one learner (design P5 "PM notes").
// Keyed by the learner's email (lower-case), like the roster; visible to the
// learner's PMs and management, never to the learner.
const schema = new mongoose.Schema({
  removed: { type: Boolean, default: false },
  email: { type: String, required: true, index: true },
  batch: String,
  text: { type: String, required: true },
  by: { type: mongoose.Schema.ObjectId, ref: 'Admin' },
  byName: String,
  created: { type: Date, default: Date.now },
});

module.exports = mongoose.model('LmsLearnerNote', schema);
