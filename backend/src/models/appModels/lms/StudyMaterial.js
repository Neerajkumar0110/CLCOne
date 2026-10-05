const mongoose = require('mongoose');

// Teacher-uploaded study resources (PDFs, videos, images, or a pasted link),
// scoped to EITHER a single batch OR a whole course — same two-scope shape
// as LmsAnnouncement's audience:'batch'|'course'. Course-scoped material
// reaches every batch of that course (and any batch added to it later)
// without re-uploading per batch.
const schema = new mongoose.Schema({
  removed: { type: Boolean, default: false },

  teacherCrmUser: { type: mongoose.Schema.ObjectId, ref: 'Admin', index: true },
  teacherName: String,

  title: { type: String, required: true },
  subject: { type: String },

  // Exactly one of these two is set per row (enforced in the controller,
  // not the schema, same as Announcement's audience-dependent fields).
  batch: { type: String, index: true },
  course: { type: mongoose.Schema.ObjectId, ref: 'Course', index: true },
  courseTitle: { type: String }, // denormalized for display without a join

  kind: { type: String, enum: ['pdf', 'video', 'image', 'other'], default: 'other' },
  sourceType: { type: String, enum: ['file', 'link'], default: 'file' },
  fileUrl: { type: String, required: true },
  originalName: String,
  mimeType: String,
  sizeBytes: Number,

  uploadedAt: { type: Date, default: Date.now },
  created: { type: Date, default: Date.now },
  updated: { type: Date, default: Date.now },
});

schema.index({ batch: 1, uploadedAt: -1 });
schema.index({ course: 1, uploadedAt: -1 });

module.exports = mongoose.model('StudyMaterial', schema);
