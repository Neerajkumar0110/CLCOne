const mongoose = require('mongoose');

// An IVR menu: the greeting a caller hears and what each keypress does.
// The audio + digit gathering happens on the Edesy voice-agent side; this
// model is the CRM's copy so the webhook can LABEL a pressed digit
// ("1" -> "Interested") and ROUTE the call (to a team, an agent, an
// external number, voicemail, or hang up).
const optionSchema = new mongoose.Schema(
  {
    digit: { type: String, required: true, trim: true }, // "1".."9", "0", "*", "#"
    label: { type: String, required: true, trim: true }, // shown in reports
    action: {
      type: String,
      enum: ['route_team', 'route_agent', 'route_number', 'voicemail', 'hangup', 'capture'],
      default: 'route_team',
    },
    targetTeam: String, // action === route_team
    targetAgent: { type: mongoose.Schema.ObjectId, ref: 'Admin' }, // route_agent
    targetNumber: String, // route_number (external / desk phone)
    // action === 'capture' just records the digit+label on the lead (surveys)
    // and continues the flow on the provider side.
  },
  { _id: false }
);

const schema = new mongoose.Schema({
  removed: { type: Boolean, default: false },
  enabled: { type: Boolean, default: true },

  name: { type: String, required: true, trim: true },
  description: String,
  direction: { type: String, enum: ['Inbound', 'Outbound'], default: 'Inbound' },

  // Prompt text — used as TTS on the provider, and as documentation here.
  greeting: { type: String, default: 'Thank you for calling. Please listen to the menu.' },
  promptKey: { type: String, default: 'main' }, // matches the provider's gather node id

  options: [optionSchema],

  // Fallbacks
  noInputAction: {
    type: String,
    enum: ['repeat', 'route_team', 'route_number', 'voicemail', 'hangup'],
    default: 'repeat',
  },
  invalidAction: {
    type: String,
    enum: ['repeat', 'route_team', 'route_number', 'voicemail', 'hangup'],
    default: 'repeat',
  },
  fallbackTeam: String,
  fallbackNumber: String,

  // The provider-side agent/flow id this maps to (Edesy voice-agent `agentId`).
  providerFlowId: String,

  createdBy: { type: mongoose.Schema.ObjectId, ref: 'Admin' },
  createdByName: String,

  created: { type: Date, default: Date.now },
  updated: { type: Date, default: Date.now },
});

schema.methods.optionForDigit = function optionForDigit(digit) {
  const d = String(digit || '').trim();
  return (this.options || []).find((o) => o.digit === d) || null;
};

module.exports = mongoose.model('IvrFlow', schema);
