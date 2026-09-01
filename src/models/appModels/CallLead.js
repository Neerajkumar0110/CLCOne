const mongoose = require('mongoose');

// A lead loaded into a calling campaign (CSV / Excel / manual / bulk).
// Kept separate from the CRM `Lead` model so call-center list churn never
// touches the sales pipeline; `crmLead` optionally links the two.
const schema = new mongoose.Schema({
  removed: { type: Boolean, default: false },
  enabled: { type: Boolean, default: true },

  campaign: { type: mongoose.Schema.ObjectId, ref: 'CallCampaign', index: true },

  name: { type: String, required: true, trim: true },
  phone: { type: String, required: true, trim: true, index: true },
  phoneNormalized: { type: String, index: true }, // digits only, for dedupe
  email: String,
  company: String,
  source: String,
  notes: String,

  status: {
    type: String,
    enum: [
      'New',
      'Queued',
      'Dialing',
      'Connected',
      'No Answer',
      'Busy',
      'Failed',
      'Voicemail',
      'Completed',
      'Callback',
      'DNC', // do not call
    ],
    default: 'New',
    index: true,
  },

  attempts: { type: Number, default: 0 },
  lastAttemptAt: Date,
  lastDisposition: String,
  assignedAgent: { type: mongoose.Schema.ObjectId, ref: 'Admin' },

  crmLead: { type: mongoose.Schema.ObjectId, ref: 'Lead' },
  importBatch: String,

  // Correlation with VICIdial's own lead/list rows (populated by the
  // Telephony Integration Service when a lead is pushed into a campaign).
  vicidialLeadId: { type: String, index: true },
  vicidialListId: String,
  syncedToVicidialAt: Date,

  created: { type: Date, default: Date.now },
  updated: { type: Date, default: Date.now },
});

schema.index({ campaign: 1, phoneNormalized: 1 });

module.exports = mongoose.model('CallLead', schema);
