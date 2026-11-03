const mongoose = require('mongoose');

// A learner's private notes for one live class (design L4 "Notes" tab) —
// one row per person per session, visible only to its owner.
const schema = new mongoose.Schema({
  liveSession: { type: mongoose.Schema.ObjectId, ref: 'LmsLiveSession', required: true },
  owner: { type: mongoose.Schema.ObjectId, ref: 'Admin', required: true },
  text: { type: String, default: '', maxlength: 20000 },
  created: { type: Date, default: Date.now },
  updated: { type: Date, default: Date.now },
});

schema.index({ owner: 1, liveSession: 1 }, { unique: true });

module.exports = mongoose.model('LiveClassNote', schema);
