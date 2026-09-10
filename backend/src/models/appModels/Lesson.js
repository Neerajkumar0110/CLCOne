const mongoose = require('mongoose');

// Course → Module → Chapter → [Lesson]. The atomic unit a student consumes.
const LESSON_TYPES = ['video', 'recorded', 'pdf', 'document', 'text', 'link', 'quiz', 'assignment', 'live'];
const VIDEO_SOURCES = ['upload', 'youtube', 'vimeo', 'cloud', 'bbb'];

const attachmentSchema = new mongoose.Schema(
  { name: String, url: String, sizeKb: Number },
  { _id: false }
);

const schema = new mongoose.Schema({
  removed: { type: Boolean, default: false },
  enabled: { type: Boolean, default: true },

  course: { type: mongoose.Schema.ObjectId, ref: 'Course', required: true, index: true },
  module: { type: mongoose.Schema.ObjectId, ref: 'CourseModule', required: true, index: true },
  chapter: { type: mongoose.Schema.ObjectId, ref: 'Chapter', required: true, index: true },

  title: { type: String, required: true },
  description: { type: String },
  order: { type: Number, default: 0, index: true },
  type: { type: String, enum: LESSON_TYPES, default: 'video' },

  // video / recorded
  videoSource: { type: String, enum: VIDEO_SOURCES },
  videoUrl: { type: String },        // full URL (upload/cloud) or watch URL
  videoId: { type: String },         // youtube / vimeo id (parsed on save)
  durationSec: { type: Number, default: 0 },
  thumbnailUrl: { type: String },
  recording: { type: mongoose.Schema.ObjectId, ref: 'LiveRecording' },
  liveSession: { type: mongoose.Schema.ObjectId, ref: 'LmsLiveSession' },

  // text
  content: { type: String },         // HTML / markdown

  // pdf / document
  fileUrl: { type: String },

  // link
  externalUrl: { type: String },

  // quiz / assignment (models land in P3)
  quiz: { type: mongoose.Schema.ObjectId, ref: 'Quiz' },
  assignment: { type: mongoose.Schema.ObjectId, ref: 'Assignment' },

  attachments: { type: [attachmentSchema], default: [] },
  notes: { type: String },

  isPreview: { type: Boolean, default: false },   // watchable before enrolling
  allowDownload: { type: Boolean, default: false },
  published: { type: Boolean, default: true },

  created: { type: Date, default: Date.now },
  updated: { type: Date, default: Date.now },
});

schema.index({ chapter: 1, order: 1 });
schema.index({ course: 1, module: 1, chapter: 1, order: 1 });

// parse a youtube / vimeo id out of a pasted URL so the player can embed it
schema.pre('save', function parseVideoId(next) {
  if ((this.isModified('videoUrl') || this.isModified('videoSource')) && this.videoUrl) {
    const u = this.videoUrl.trim();
    if (this.videoSource === 'youtube' || /youtu/.test(u)) {
      const m = u.match(/(?:v=|youtu\.be\/|embed\/|shorts\/)([A-Za-z0-9_-]{6,})/);
      if (m) this.videoId = m[1];
    } else if (this.videoSource === 'vimeo' || /vimeo/.test(u)) {
      const m = u.match(/vimeo\.com\/(?:video\/)?(\d+)/);
      if (m) this.videoId = m[1];
    }
  }
  next();
});

module.exports = mongoose.model('Lesson', schema);
module.exports.LESSON_TYPES = LESSON_TYPES;
module.exports.VIDEO_SOURCES = VIDEO_SOURCES;
