const mongoose = require('mongoose');

// CLC-POL-001: an employee's dispute (section 14), a formal performance review
// and improvement plan (section 10), or a conduct issue (section 13). The
// decision and its reason stay on the record.
const schema = new mongoose.Schema({
  type: { type: String, enum: ['dispute', 'review', 'conduct'], required: true },
  admin: { type: mongoose.Schema.ObjectId, ref: 'Admin', required: true },
  adminName: String,
  dayKey: String, // YYYY-MM-DD, IST, when it's about one day
  topic: { type: String, enum: ['attendance', 'dialer', 'task', 'prospect', 'performance', 'conduct', 'other'], default: 'other' },
  message: { type: String, required: true },
  raisedBy: { type: mongoose.Schema.ObjectId, ref: 'Admin' },
  raisedByName: String,
  status: { type: String, enum: ['open', 'accepted', 'rejected', 'closed'], default: 'open' },
  decision: String,
  decidedByName: String,
  decidedAt: Date,
  created: { type: Date, default: Date.now },
});

schema.index({ admin: 1, created: -1 });
schema.index({ status: 1, created: -1 });

module.exports = mongoose.model('PolicyCase', schema);
