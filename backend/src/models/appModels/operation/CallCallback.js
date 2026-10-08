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

  // Set only for an auto-created inbound-missed-call callback (no agent was
  // Available to take the IVR-routed call) — which team should work it,
  // since there's no assignedAgent yet to imply that.
  team: String,

  status: { type: String, enum: ['Pending', 'Done', 'Missed', 'Cancelled'], default: 'Pending', index: true },
  completedAt: Date,

  // Auto-dial bookkeeping (jobs/callingCallbackTick.js). A Pending callback
  // whose scheduledAt has passed gets dialled on its own, so these exist to
  // keep that from becoming a loop: `lastDialedAt` is stamped the moment a
  // tick claims this row (which is also what makes the claim atomic), and
  // `dialAttempts` caps how many times an unreachable contact is retried.
  lastDialedAt: Date,
  dialAttempts: { type: Number, default: 0 },
  // Set once the auto-dialer gives up, so the row stops being picked up but
  // the agent can still see why and call by hand.
  autoDialGaveUpAt: Date,

  createdBy: { type: mongoose.Schema.ObjectId, ref: 'Admin' },
  createdByName: String,

  created: { type: Date, default: Date.now },
  updated: { type: Date, default: Date.now },
});

module.exports = mongoose.model('CallCallback', schema);
