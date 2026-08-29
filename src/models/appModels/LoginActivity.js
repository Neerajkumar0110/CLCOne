const mongoose = require('mongoose');

// One row per login session — created when an admin's first socket
// connects (see backend/src/socket.js) and closed out (logoutAt +
// durationSeconds filled in) when their last socket disconnects. This is
// what powers Shift Management's "who's on/off right now", "logins today",
// and "hours logged in today" — a real measure of active app time, not
// just how long a JWT happens to be valid for.
const schema = new mongoose.Schema({
  removed: {
    type: Boolean,
    default: false,
  },

  admin: { type: mongoose.Schema.ObjectId, ref: 'Admin', required: true, index: true },
  adminName: String,

  loginAt: {
    type: Date,
    required: true,
  },
  // null while the session is still active (admin has at least one open socket).
  logoutAt: Date,
  durationSeconds: Number,
});

schema.index({ admin: 1, loginAt: -1 });

module.exports = mongoose.model('LoginActivity', schema);
