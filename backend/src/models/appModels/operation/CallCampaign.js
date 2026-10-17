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

  // Inbound campaigns: the IVR menu callers land in.
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

  // The one system-managed campaign behind the per-agent "Instant Lead
  // Pool" toggle (see services/calling/callingShared.js's
  // getOrCreateLeadPoolCampaign). Always exactly one such document exists;
  // it's excluded from the ordinary campaign list/picker and can't be
  // removed through the normal campaign endpoints.
  isLeadPool: { type: Boolean, default: false },
  // Set the moment the pool runs dry (so participating agents get notified
  // once, not every tick); cleared as soon as new leads are queued again.
  leadsExhaustedNotifiedAt: Date,
  // Which Sales pipeline stage the Instant Lead Pool dials from — picked by
  // management on the Calls page (leadPool.js's setStage). Changing it
  // stamps leadPoolStageSetAt so leadPoolSyncTick re-queues leads in that
  // stage even if the pool already dialed them under an earlier pick.
  leadPoolStage: { type: String, default: 'New Lead' },
  // Up to 5 stages in priority order (the Calls page multi-pick). The pool
  // dials leadPoolStages[0] first; once its leads run out it moves on to the
  // next, and falls back to an earlier one the moment new leads land there.
  // leadPoolStage above is always the stage dialing RIGHT NOW. Empty = just
  // [leadPoolStage] (older single-stage picks).
  leadPoolStages: { type: [String], default: undefined },
  leadPoolStageActiveAt: Date,
  // How a pool customer who answers reaches the agent (services/calling/
  // connectModes.js) — switched by Admin / Super Admin on the Calls page:
  //   classic  — ring the agent's mobile for every call (the original flow)
  //   alwaysOn — the agent's mobile is called ONCE when they join and stays
  //              on the line; each customer drops straight into it
  //   browser  — the agent takes calls in the CRM tab (Plivo browser SDK),
  //              auto-answered
  leadPoolConnectMode: { type: String, enum: ['classic', 'alwaysOn', 'browser'], default: 'classic' },
  leadPoolConnectModeSetByName: String,
  leadPoolStageSetAt: Date,
  leadPoolStageSetByName: String,

  created: { type: Date, default: Date.now },
  updated: { type: Date, default: Date.now },
});

module.exports = mongoose.model('CallCampaign', schema);
