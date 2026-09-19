const mongoose = require('mongoose');

const schema = new mongoose.Schema({
  removed: {
    type: Boolean,
    default: false,
  },
  enabled: {
    type: Boolean,
    default: true,
  },

  // 'role'  -> key is a role name (e.g. "Agent"), applies to every user with that role by default
  // 'user'  -> key is a user's name, overrides the role default for just that one user
  scope: {
    type: String,
    enum: ['role', 'user'],
    required: true,
  },
  key: {
    type: String,
    required: true,
  },
  // { [moduleName]: { view: Boolean, edit: Boolean, delete: Boolean } }
  matrix: {
    type: mongoose.Schema.Types.Mixed,
    required: true,
  },

  created: {
    type: Date,
    default: Date.now,
  },
  updated: {
    type: Date,
    default: Date.now,
  },
});

// One record per (scope, key) — e.g. only ever one 'role'/"Executive" doc.
// Without this, a race between concurrent page loads of Roles & Permissions
// (each independently "create a default if none exists yet") can leave two
// or more conflicting records for the same role, and whichever one a given
// read happens to return becomes effectively random — see
// backend/scripts/dedupePermissionRecords.cjs for the one-off cleanup this
// index required before it could be created.
schema.index({ scope: 1, key: 1 }, { unique: true });

module.exports = mongoose.model('Permission', schema);
