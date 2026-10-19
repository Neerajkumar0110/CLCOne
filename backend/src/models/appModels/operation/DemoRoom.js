const mongoose = require('mongoose');

// The day's live-demo BigBlueButton room (one per IST date). Created lazily
// the first time anyone joins that day — see services/sales/demoBookings.js.
const demoRoomSchema = new mongoose.Schema({
  date: { type: String, required: true, unique: true }, // 'YYYY-MM-DD' IST
  meetingId: { type: String, required: true },
  moderatorPW: String,
  attendeePW: String,
  createdAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model('DemoRoom', demoRoomSchema);
