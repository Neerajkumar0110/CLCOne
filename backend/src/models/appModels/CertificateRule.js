const mongoose = require('mongoose');

// One rule per course — the criteria a student must meet for a certificate.
// The engine (services/lms/certificateEngine.js) checks these on course
// completion / quiz evaluation and, if autoIssue, creates a Certificate.
const schema = new mongoose.Schema({
  removed: { type: Boolean, default: false },

  course: { type: mongoose.Schema.ObjectId, ref: 'Course', required: true, unique: true },
  courseTitle: String,

  title: { type: String, default: 'Certificate of Completion' },
  type: { type: String, enum: ['Completion', 'Participation', 'Merit', 'Achievement'], default: 'Completion' },

  minCoursePercent: { type: Number, default: 100 },       // lesson/course progress
  minAttendancePercent: { type: Number, default: 0 },     // live-class attendance
  requireAllAssignments: { type: Boolean, default: false },
  minQuizPercent: { type: Number, default: 0 },           // avg quiz %

  autoIssue: { type: Boolean, default: true },
  validMonths: { type: Number, default: 0 },              // 0 = no expiry
  enabled: { type: Boolean, default: true },

  created: { type: Date, default: Date.now },
  updated: { type: Date, default: Date.now },
});

module.exports = mongoose.model('CertificateRule', schema);
