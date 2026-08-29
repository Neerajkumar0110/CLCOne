const mongoose = require('mongoose');

// One row per placed/received call — powers Recent Calls and the Call Log &
// Status screen. `team` and `calledBy` are denormalized at call time so
// history stays correct even if the caller later changes teams.
const schema = new mongoose.Schema({
  removed: {
    type: Boolean,
    default: false,
  },
  enabled: {
    type: Boolean,
    default: true,
  },

  lead: { type: mongoose.Schema.ObjectId, ref: 'Lead' },
  contactName: String,
  phone: String,

  direction: {
    type: String,
    enum: ['Outgoing', 'Inbound'],
    default: 'Outgoing',
  },
  status: {
    type: String,
    enum: ['Connected', 'Missed', 'No Answer', 'Busy', 'Voicemail'],
    default: 'Connected',
  },
  duration: { type: Number, default: 0 }, // seconds

  team: String,
  calledBy: String,

  created: {
    type: Date,
    default: Date.now,
  },
  updated: {
    type: Date,
    default: Date.now,
  },
});

module.exports = mongoose.model('Call', schema);
