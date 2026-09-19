const mongoose = require('mongoose');

// A callback an agent scheduled from the calling screen. Distinct from the
// CRM Lead-stage "Call Back" (that's the sales pipeline) — this one belongs
// to a calling campaign.
const schema = new mongoose.Schema({
  removed: { type: Boolean, default: false },
  enabled: { type: Boolean, default: true },

  campaign: { type: mongoose.Schema.ObjectId, ref: 'CallCampaign', index: true },
  callLead: { type: mongoose.Schema.ObjectId, ref: 'CallLead' },
  callRecord: { type: mongoose.Schema.ObjectId, ref: 'CallRecord' },

  contactName: String,
  phone: String,

  scheduledAt: { type: Date, required: true, index: true },
  notes: String,

  assignedAgent: { type: mongoose.Schema.ObjectId, ref: 'Admin' },
  assignedAgentName: String,

  status: { type: String, enum: ['Pending', 'Done', 'Missed', 'Cancelled'], default: 'Pending', index: true },
  completedAt: Date,

  createdBy: { type: mongoose.Schema.ObjectId, ref: 'Admin' },
  createdByName: String,

  created: { type: Date, default: Date.now },
  updated: { type: Date, default: Date.now },
});

module.exports = mongoose.model('CallCallback', schema);
