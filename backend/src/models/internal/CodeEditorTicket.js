const mongoose = require('mongoose');

// Deliberately NOT under models/appModels/ — that folder is auto-discovered
// into generic CRUD routes (/api/<entity>/listAll etc., see models/utils/
// index.js) for every logged-in admin regardless of per-module permission.
// This collection holds live session tokens; exposing it generically would
// let any logged-in admin read (and replay) another admin's active Code
// Editor session cookie. Only codeEditorController and
// services/access/codeEditorAccess touch this model, and both apply the
// real Code Editor permission check themselves. Still required at boot like
// every other model — server.js globs all of models/**, just not
// models/appModels/** for route generation.
const schema = new mongoose.Schema({
  // Set on issue, cleared (left as-is but no longer matched) once redeemed.
  ticket: { type: String, index: true },
  used: { type: Boolean, default: false },
  // Set only after the ticket is redeemed — the opaque cookie value nginx's
  // auth_request checks on every subsequent request to /code-editor/*.
  sessionToken: { type: String, index: true },

  admin: { type: mongoose.Schema.ObjectId, ref: 'Admin', required: true },
  createdIp: String,
  createdAt: { type: Date, default: Date.now },

  // Drives both the ticket's short redeem window AND, after redemption, the
  // session's sliding idle timeout — bumped forward on every nginx
  // auth_request hit (see codeEditorController.authCheck). The TTL index
  // below re-evaluates this field on its own schedule, so pushing it
  // forward in place is enough to keep a document alive.
  expiresAt: { type: Date, required: true },
});

schema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('CodeEditorTicket', schema);
