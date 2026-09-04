const mongoose = require('mongoose');

// One row per dial attempt handled by the calling module (mock or, later,
// VICIdial). Separate from the legacy `Call` model so the existing
// dashboard/report aggregates over `Call` keep working untouched.
const recordingSchema = new mongoose.Schema(
  {
    status: {
      type: String,
      enum: ['unavailable', 'processing', 'available'],
      default: 'unavailable',
    },
    // In mock mode this stays null — no fake production audio is served.
    // With CALLING_PROVIDER=telephony it also stays null: the file lives on
    // the VPS and is streamed ONLY through the authorised CRM proxy
    // (/api/calling/recordings/:id/stream). `reference` is the opaque
    // VPS-side handle used by that proxy.
    url: { type: String, default: null },
    reference: { type: String, default: null }, // VPS recording id / relative path
    durationSec: { type: Number, default: 0 },
    sizeBytes: { type: Number, default: 0 },
    readyAt: Date,
  },
  { _id: false }
);

const schema = new mongoose.Schema({
  removed: { type: Boolean, default: false },
  enabled: { type: Boolean, default: true },

  campaign: { type: mongoose.Schema.ObjectId, ref: 'CallCampaign', index: true },
  callLead: { type: mongoose.Schema.ObjectId, ref: 'CallLead', index: true },
  agent: { type: mongoose.Schema.ObjectId, ref: 'Admin', index: true },
  agentName: String,

  contactName: String,
  phone: String,
  direction: { type: String, enum: ['Outbound', 'Inbound'], default: 'Outbound' },

  // Lifecycle. queued → dialing → ringing → (connected|no-answer|busy|failed|voicemail)
  // connected → completed | transferred.
  status: {
    type: String,
    enum: [
      'queued',
      'dialing',
      'ringing',
      'connected',
      'onhold',
      'no-answer',
      'busy',
      'failed',
      'voicemail',
      'completed',
      'transferred',
      'cancelled',
    ],
    default: 'queued',
    index: true,
  },
  // Sub-state timestamps drive the mock state machine deterministically.
  phaseAt: { type: Date, default: Date.now }, // when the current status began
  queuedAt: { type: Date, default: Date.now },
  ringingAt: Date,
  answeredAt: Date,
  endedAt: Date,
  duration: { type: Number, default: 0 }, // talk seconds

  muted: { type: Boolean, default: false },
  onHold: { type: Boolean, default: false },

  disposition: String,
  notes: String,
  transferredTo: String, // team or agent label
  transferredToAgent: { type: mongoose.Schema.ObjectId, ref: 'Admin' },
  transferStatus: {
    type: String,
    enum: ['none', 'requested', 'ringing', 'completed', 'failed'],
    default: 'none',
  },

  recording: { type: recordingSchema, default: () => ({}) },

  provider: { type: String, default: 'mock' }, // mock | telephony | vicidial | cloud | manual
  providerCallId: String,
  isMock: { type: Boolean, default: true },
  // Last raw payload from a cloud calling provider webhook (Tata Smartflo /
  // Exotel / …) — shape varies by provider, kept verbatim for tracing.
  providerRaw: { type: mongoose.Schema.Types.Mixed },

  // ── Correlation (spec §14) — CRM ↔ VICIdial ↔ Asterisk ──────────────
  // `_id` IS the CRM call id (crm_call_id). These link it to the other
  // systems so every event can be matched to exactly one record.
  callerId: String,
  asteriskUniqueId: { type: String, index: true, unique: true, sparse: true },
  asteriskLinkedId: { type: String, index: true },
  vicidialLeadId: { type: String, index: true },
  vicidialCallId: String,
  vicidialListId: String,
  vicidialCampaignId: String,

  team: String,

  created: { type: Date, default: Date.now },
  updated: { type: Date, default: Date.now },
});

schema.index({ campaign: 1, created: -1 });
schema.index({ agent: 1, status: 1 });

module.exports = mongoose.model('CallRecord', schema);
