const mongoose = require('mongoose');

// Teacher-uploaded study resources (PDFs, videos, images, or a pasted link),
// scoped to a batch so students only ever see material for their own batch
// — same visibility model as LmsAnnouncement's audience:'batch'.
const schema = new mongoose.Schema({
  removed: { type: Boolean, default: false },

  teacherCrmUser: { type: mongoose.Schema.ObjectId, ref: 'Admin', index: true },
  teacherName: String,

  title: { type: String, required: true },
  subject: { type: String },

  batch: { type: String, required: true, index: true },

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

module.exports = mongoose.model('StudyMaterial', schema);
