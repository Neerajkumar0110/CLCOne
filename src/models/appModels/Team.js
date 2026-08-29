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

  name: {
    type: String,
    required: true,
  },
  // Team lead / members are stored as user names (matches how the rest of the
  // User Management UI identifies people) rather than Admin ObjectId refs.
  lead: {
    type: String,
  },
  members: {
    type: [String],
    default: [],
  },
  color: {
    type: String,
    default: '#2563EB',
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

module.exports = mongoose.model('Team', schema);
