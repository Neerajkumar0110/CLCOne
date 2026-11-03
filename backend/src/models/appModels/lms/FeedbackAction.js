const mongoose = require('mongoose');

// Improvement action a Project Manager commits to from their feedback
// (design P7): what, which category prompted it, owner, due date, status and
// how its effect will be checked.
const schema = new mongoose.Schema({
  teacher: { type: mongoose.Schema.ObjectId, ref: 'Admin', required: true, index: true },
  teacherName: String,
  action: { type: String, required: true, maxlength: 300 },
  fromCategory: String,
  owner: String,
  due: Date,
  status: { type: String, enum: ['Planned', 'In progress', 'Done'], default: 'Planned' },
  effectCheck: String,
  removed: { type: Boolean, default: false },
  created: { type: Date, default: Date.now },
  updated: { type: Date, default: Date.now },
});

module.exports = mongoose.model('FeedbackAction', schema);
