const mongoose = require('mongoose');

// One row per agent's shift assignment (User Management > Shift Management).
// adminName matches Admin.name / Team.members — plain name strings, same
// convention as Team, not an Admin ObjectId ref.
const schema = new mongoose.Schema({
  removed: {
    type: Boolean,
    default: false,
  },

  adminName: {
    type: String,
    required: true,
    unique: true,
  },
  shift: {
    type: String,
    required: true,
  },
  days: {
    type: String,
    required: true,
  },
  status: {
    type: String,
    enum: ['On Shift', 'Off'],
    default: 'On Shift',
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

module.exports = mongoose.model('Shift', schema);
