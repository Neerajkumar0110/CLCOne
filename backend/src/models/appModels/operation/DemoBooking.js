const mongoose = require('mongoose');

// One customer's seat in the daily live demo (Mon–Sat, 6–7 PM IST, one
// BigBlueButton room per day — see services/sales/demoBookings.js).
// Created when an agent marks a lead "Demo Booked" (call modal or Leads
// page). Each person who gets the email has their OWN unguessable token, so
// the join link works without a CRM login, like a Google Meet link — but
// only on the booked day, from 10 min before 6 PM while the demo is live.
const demoBookingSchema = new mongoose.Schema({
  removed: { type: Boolean, default: false },

  lead: { type: mongoose.Schema.ObjectId, ref: 'Lead', required: true },
  name: { type: String, trim: true },
  email: { type: String, trim: true, lowercase: true },
  phone: { type: String, trim: true },

  // IST calendar day of the demo, 'YYYY-MM-DD'. The slot is always 18:00–19:00.
  date: { type: String, required: true },

  agent: { type: mongoose.Schema.ObjectId, ref: 'Admin' },
  agentName: String,
  agentEmail: String,
  teamLeader: { type: mongoose.Schema.ObjectId, ref: 'Admin' },
  teamLeaderName: String,
  teamLeaderEmail: String,
  callRecord: { type: mongoose.Schema.ObjectId, ref: 'CallRecord' },

  // booked → attended (joined) | missed (no-show after its one auto-rebook)
  // | cancelled (lead moved off Demo Booked / rebooked by an agent).
  status: { type: String, enum: ['booked', 'attended', 'missed', 'cancelled'], default: 'booked' },
  attendedAt: Date,
  // Customer no-show → moved once to the next demo day automatically.
  rebookCount: { type: Number, default: 0 },
  missedDates: [String],

  tokens: {
    customer: { type: String, index: true },
    agent: { type: String, index: true },
    leader: { type: String, index: true },
  },
  joins: [{ who: String, name: String, at: Date }],
  emails: [{ kind: String, to: [String], sent: Number, at: Date }],

  createdBy: { type: mongoose.Schema.ObjectId, ref: 'Admin' },
  created: { type: Date, default: Date.now },
  updated: { type: Date, default: Date.now },
});

demoBookingSchema.index({ date: 1, status: 1 });
demoBookingSchema.index({ lead: 1, status: 1 });

module.exports = mongoose.model('DemoBooking', demoBookingSchema);
