const mongoose = require('mongoose');

// Spec §13 "Communication Centre: Templates, ... event triggers, delivery
// logs and retry queue." Previously this whole area was a frontend-only mock
// (frontend/src/pages/Communication/index.jsx's EmailWhatsapp component had
// a hardcoded local `useState` template array with zero backend — Connect/
// Disconnect buttons just flipped local booleans). This is the real,
// persisted template store behind it. WhatsApp is intentionally out of scope
// (no approved WhatsApp Business/API provider is configured for this
// deployment) — `channel` only ever contains 'email' today; the field exists
// so a real WhatsApp provider can be added later without a schema change.
const schema = new mongoose.Schema({
  removed: { type: Boolean, default: false },
  enabled: { type: Boolean, default: true },

  name: { type: String, required: true },
  // Matches the event keys used by the jobs/controllers that actually send
  // (see services/lms/notificationEvents.js) — informational/filtering only,
  // not yet wired to override those jobs' own hardcoded HTML (a template
  // referenced here is a admin-authored starting point / record of what's
  // sent, not (yet) live-substituted into every send path).
  eventKey: { type: String, default: '' },
  channel: { type: String, enum: ['email'], default: 'email' },
  subject: { type: String, default: '' },
  html: { type: String, default: '' },
  // Documents which {{placeholders}} this template expects — surfaced in the
  // admin UI so a template can be sanity-checked before saving, per spec §8
  // "variable validation".
  variables: { type: [String], default: [] },

  createdBy: { type: mongoose.Schema.ObjectId, ref: 'Admin' },
  createdByName: { type: String, default: '' },

  created: { type: Date, default: Date.now },
  updated: { type: Date, default: Date.now },
});

module.exports = mongoose.model('NotificationTemplate', schema);
