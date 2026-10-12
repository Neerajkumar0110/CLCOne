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

  // sourceType 'file': the upload's path RELATIVE to this server's public
  // root, e.g. "public/uploads/material/notes-ab12c.pdf" — exactly what
  // uploadMiddleware hands back. The browsable URL is built from it at read
  // time (studyMaterial.js#fileUrlOf) against the host we are serving as
  // right now.
  //
  // It used to be the other way round: the absolute URL was composed at
  // upload time and stored in `fileUrl`. That bakes whatever host the
  // uploading process happened to think it was into the row forever, so a
  // file uploaded from a developer laptop was saved as
  // http://localhost:8888/... and stayed a dead link for every student. The
  // host is a property of the request, never of the file.
  filePath: { type: String },

  // sourceType 'link': the external URL a teacher pasted (YouTube, Drive,
  // anything) — stored as given and never rewritten, since it is not ours.
  // For legacy 'file' rows written before `filePath` existed this still
  // holds an absolute URL; fileUrlOf() strips the stale host off those.
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
