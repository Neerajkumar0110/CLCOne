const mongoose = require('mongoose');

// Messenger › Email (Email centre). One row per email the app sends:
//   kind 'system' — an email the code sends (key from services/mail/emailCatalog.js).
//     defaultSubject / defaultHtml are captured automatically from the real
//     sends (variable values swapped back to {{placeholders}}), `sample` is the
//     last email that actually went out. When an admin saves an edit,
//     `override` is set and services/mail/transport.js sends subject / html
//     from here instead of the code's own text. `enabled: false` stops it.
//   kind 'custom' — an email an admin created, sent by jobs/emailScheduleTick.js
//     on its `schedule` to its `audience`.
// Every save keeps the previous version in `versions` (last 20).
const versionSchema = new mongoose.Schema(
  { _id: false, at: Date, byName: String, subject: String, html: String, note: String },
  { _id: false }
);

const schema = new mongoose.Schema({
  removed: { type: Boolean, default: false },
  key: { type: String, required: true, unique: true },
  kind: { type: String, enum: ['system', 'custom'], default: 'system', index: true },
  name: String,
  enabled: { type: Boolean, default: true },

  // what goes out when edited (system) / always (custom)
  subject: String,
  html: String,
  override: { type: Boolean, default: false },

  // system: the code's own text with {{placeholders}}, refreshed from real sends
  defaultSubject: String,
  defaultHtml: String,
  variables: { type: [String], default: undefined },
  sample: { _id: false, subject: String, html: String, to: String, at: Date },
  // system emails whose catalog entry has `timing` — e.g. minutes before a class
  timingValue: Number,

  // custom only
  schedule: {
    _id: false,
    // once | daily | weekly | after-enrolment | before-class | after-class
    type: { type: String },
    at: Date, // once
    time: String, // 'HH:mm' IST — daily / weekly
    weekday: Number, // 0 = Sunday — weekly
    offsetMin: Number, // after-enrolment / before-class / after-class
  },
  audience: {
    _id: false,
    // all-learners | batch | role | emails
    type: { type: String },
    value: String, // batch name / role / comma-separated emails
  },
  lastRunAt: Date,

  versions: { type: [versionSchema], default: undefined },
  updatedByName: String,
  created: { type: Date, default: Date.now },
  updated: { type: Date, default: Date.now },
});

module.exports = mongoose.model('EmailTemplate', schema);
