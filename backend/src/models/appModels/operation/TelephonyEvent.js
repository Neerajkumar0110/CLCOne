const mongoose = require('mongoose');

// Every inbound event from the Telephony Integration Service is recorded
// here BEFORE processing — this is the idempotency guard, the audit trail
// and the dead-letter queue in one.
//
//   eventId    unique → a re-delivered event is a no-op
//   status     received → processed | failed
//   attempts   incremented on each processing try
//   raw        the exact payload, so a failed event can be replayed
const schema = new mongoose.Schema({
  eventId: { type: String, required: true, unique: true }, // provider's id or hmac-nonce
  correlationId: { type: String, index: true }, // crmCallId / asteriskUniqueId
  type: { type: String, index: true }, // call.started | call.ringing | call.answered | call.ended | recording.ready | transfer | agent.status
  source: { type: String, default: 'telephony-service' },

  status: { type: String, enum: ['received', 'processed', 'failed'], default: 'received', index: true },
  attempts: { type: Number, default: 0 },
  lastError: String,

  raw: mongoose.Schema.Types.Mixed,

  receivedAt: { type: Date, default: Date.now },
  processedAt: Date,
});

schema.index({ status: 1, receivedAt: 1 });
schema.index({ receivedAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 30 }); // keep 30 days

module.exports = mongoose.model('TelephonyEvent', schema);
