const mongoose = require('mongoose');

// A calling campaign — the unit the auto-dialer works through. Independent
// of the CRM `Lead` pipeline; its leads live in the `CallLead` model.
const schema = new mongoose.Schema({
  removed: { type: Boolean, default: false },
  enabled: { type: Boolean, default: true },

  name: { type: String, required: true, trim: true },
  description: String,
  campaignType: {
    type: String,
    enum: ['Outbound', 'Inbound', 'Blended', 'Survey', 'Follow-up'],
    default: 'Outbound',
  },

  team: String, // Team.name
  agents: [{ type: mongoose.Schema.ObjectId, ref: 'Admin' }],

  startDate: Date,
  endDate: Date,
  callingHoursStart: { type: String, default: '09:00' }, // "HH:mm" local
  callingHoursEnd: { type: String, default: '18:00' },

  priority: { type: String, enum: ['Low', 'Normal', 'High', 'Urgent'], default: 'Normal' },
  callerId: String, // outbound caller-ID number
  dialRatio: { type: Number, default: 1 }, // lines per available agent

  // ── auto-dialer engine (CloudCallProvider.tick / callingDialerTick job) ──
  // When true and status==='Active', the engine feeds Available agents the
  // next lead without an agent pressing "dial next".
  autoDial: { type: Boolean, default: true },
  maxAttempts: { type: Number, default: 3 }, // per lead before it's parked as Failed
  retryDelayMin: { type: Number, default: 30 }, // wait between attempts on a soft outcome

  // Inbound campaigns: the IVR menu callers land in (Edesy voice-agent).
  ivrFlow: { type: mongoose.Schema.ObjectId, ref: 'IvrFlow' },

  status: {
    type: String,
    enum: ['Draft', 'Scheduled', 'Active', 'Paused', 'Completed', 'Cancelled'],
    default: 'Draft',
  },

  // Denormalised counters kept fresh by the calling controllers / mock tick.
  stats: {
    totalLeads: { type: Number, default: 0 },
    pending: { type: Number, default: 0 },
    dialed: { type: Number, default: 0 },
    connected: { type: Number, default: 0 },
    failed: { type: Number, default: 0 },
    callbacks: { type: Number, default: 0 },
  },

  activatedAt: Date,
  completedAt: Date,
  createdBy: { type: mongoose.Schema.ObjectId, ref: 'Admin' },
  createdByName: String,

  created: { type: Date, default: Date.now },
  updated: { type: Date, default: Date.now },
});

module.exports = mongoose.model('CallCampaign', schema);
