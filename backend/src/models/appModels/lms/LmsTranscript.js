const mongoose = require('mongoose');

// Class transcript (WhisperLiveKit plan, phase 1 = recorded videos; user ask
// 2026-11-15). One row per LiveRecording. Segment times are milliseconds of
// the recording's own media file — the same timeline the player shows — so a
// line can seek the video and the playing second can highlight its line.
// kind 'live' is reserved for phase 2 (live captions from a separate
// WhisperLiveKit server); the final transcript replaces it once ready.
const segmentSchema = new mongoose.Schema(
  {
    s: { type: Number, required: true }, // start, ms
    e: { type: Number, required: true }, // end, ms
    t: { type: String, default: '' }, // text
  },
  { _id: false }
);

const schema = new mongoose.Schema({
  removed: { type: Boolean, default: false },
  recording: { type: mongoose.Schema.ObjectId, ref: 'LiveRecording', required: true, index: true },
  liveSession: { type: mongoose.Schema.ObjectId, ref: 'LmsLiveSession', index: true },
  kind: { type: String, enum: ['final', 'live'], default: 'final' },

  // queued → processing → done | failed. 'skipped' = no audio we can read.
  status: { type: String, enum: ['queued', 'processing', 'done', 'failed', 'skipped'], default: 'queued', index: true },
  priority: { type: Number, default: 0 }, // higher first (manual "Transcribe now")
  recordedAt: { type: Date }, // class date — newest classes are transcribed first
  worker: { type: String }, // host running it (only one process may claim a row)
  attempts: { type: Number, default: 0 },
  error: { type: String },

  model: { type: String },
  language: { type: String },
  durationSec: { type: Number },
  progressSec: { type: Number, default: 0 },
  segments: { type: [segmentSchema], default: [] },
  wordCount: { type: Number, default: 0 },

  // a teacher / manager corrected some lines
  edited: { type: Boolean, default: false },
  editedBy: { type: mongoose.Schema.ObjectId, ref: 'Admin' },
  editedAt: { type: Date },

  requestedBy: { type: mongoose.Schema.ObjectId, ref: 'Admin' },
  startedAt: { type: Date },
  finishedAt: { type: Date },
  created: { type: Date, default: Date.now },
  updated: { type: Date, default: Date.now },
});

schema.index({ recording: 1, kind: 1 }, { unique: true });
schema.index({ status: 1, priority: -1, recordedAt: -1 });

module.exports = mongoose.model('LmsTranscript', schema);
