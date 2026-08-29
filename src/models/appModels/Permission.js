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

module.exports = mongoose.model('Permission', schema);
