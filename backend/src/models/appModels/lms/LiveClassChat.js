const mongoose = require('mongoose');

// Per-class text chat (design L4 "Chat" tab — "Chat sirf is batch ko dikhti
// hai"). Readable by the class's own learners, its Project Manager and LMS
// management (liveClassService.resolveRole); the PM / management can remove
// a message (soft delete, kept for audit).
const schema = new mongoose.Schema({
  liveSession: { type: mongoose.Schema.ObjectId, ref: 'LmsLiveSession', required: true, index: true },
  author: { type: mongoose.Schema.ObjectId, ref: 'Admin', required: true },
  authorName: String,
  authorRole: { type: String, enum: ['student', 'teacher'] },
  text: { type: String, required: true },
  removed: { type: Boolean, default: false },
  removedBy: { type: mongoose.Schema.ObjectId, ref: 'Admin' },
  created: { type: Date, default: Date.now },
});
schema.index({ liveSession: 1, created: 1 });

module.exports = mongoose.model('LiveClassChat', schema);
