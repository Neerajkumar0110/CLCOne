const mongoose = require('mongoose');
const { STAGE_NAMES, resolveStageSub } = require('../../config/leadStages');

// One entry per stage / sub-status change — the full audit trail the UI
// renders in the lead detail panel.
const stageHistorySchema = new mongoose.Schema(
  {
    fromStage: String,
    fromSubStatus: String,
    toStage: String,
    toSubStatus: String,
    changedBy: { type: mongoose.Schema.ObjectId, ref: 'Admin' },
    changedByName: String,
    remarks: String,
    at: { type: Date, default: Date.now },
  },
  { _id: false }
);

// Lightweight call log kept on the lead itself (separate from the global
// Call model, which is telephony-driven). Populated from the lead panel.
const callLogSchema = new mongoose.Schema(
  {
    outcome: String, // Connected / No Answer / Busy / Wrong Number / ...
    notes: String,
    byName: String,
    at: { type: Date, default: Date.now },
  },
  { _id: false }
);

const schema = new mongoose.Schema({
  removed: {
    type: Boolean,
    default: false,
  },
  enabled: {
    type: Boolean,
    default: true,
  },

  name: {
    type: String,
    required: true,
  },
  phone: String,
  // Last 10 digits of `phone`, kept in sync by the hooks below. Indexed so
  // bulk import / inbound-call matching can dedupe by phone with a bounded
  // `$in` query instead of scanning the whole collection.
  phoneNormalized: { type: String, index: true },
  email: { type: String, index: true },
  source: String,

  // ── Pipeline ──────────────────────────────────────────────────────────
  // `stage` + `subStatus` are the real fields (dependent dropdowns in the
  // UI). `status` is a denormalised mirror ("<stage> - <subStatus>") kept
  // in sync by the hooks below so older code that reads `lead.status`
  // keeps working. Validation of the (stage, subStatus) pair lives in the
  // lead create/update controllers + config/leadStages.js.
  stage: {
    type: String,
    enum: STAGE_NAMES,
    default: 'New Lead',
    index: true,
  },
  subStatus: {
    type: String,
    default: 'Newly Generated',
    index: true,
  },
  status: {
    type: String,
    default: 'New Lead',
  },

  // When `stage` last changed (not sub-status-only edits).
  stageUpdatedAt: { type: Date, default: Date.now },
  lastContactAt: Date,
  nextFollowUpAt: Date,

  // Stage-specific captured detail.
  callBackAt: Date, // Call Back — mandatory date + time
  meetingAt: Date, // Sales Meeting — Meeting Scheduled / Rescheduled
  futureFollowUpAt: Date, // Future Prospects — expected follow-up date
  enrolledAt: Date, // Enrolled — registration date
  registrationLink: String, // Opportunity → Registration Link Shared
  registrationLinkSharedAt: Date,

  // Ownership + free-text.
  assignedUser: { type: mongoose.Schema.ObjectId, ref: 'Admin' },
  assignedUserName: String,
  remarks: String,

  stageHistory: { type: [stageHistorySchema], default: [] },
  callHistory: { type: [callLogSchema], default: [] },

  // Team name (matches Team.name) this lead has been assigned/contributed to.
  team: String,
  position: String,
  color: String,
  image: String,

  // Optional location / secondary-contact detail — mainly from bulk imports.
  alternatePhone: String,
  city: String,
  state: String,
  country: String,
  zipcode: String,

  importBatch: { type: mongoose.Schema.ObjectId, ref: 'LeadImportBatch' },

  // Capture-form custom questions (Website + Facebook Lead Ads).
  budgetRange: String,
  howSoonToStart: String,
  message: String,

  // Campaign attribution for leads that come in through the hosted
  // landing page / embeddable website form. Populated from the page's
  // query string (?utm_source=…&utm_campaign=…&gclid=…) so every ad's
  // leads are traceable without any ad-platform OAuth — this is what
  // lights up the Marketing Analytics Hub "Global Leads Platform".
  attribution: {
    utmSource: String,
    utmMedium: String,
    utmCampaign: String,
    utmContent: String,
    utmTerm: String,
    gclid: String,
    fbclid: String,
    landingPage: String,
    referrer: String,
  },

  // Facebook/Meta lead-ads tracing.
  facebookLeadId: { type: String, unique: true, sparse: true },
  pageId: String,
  metaFormId: String,
  adAccountId: String,
  campaignId: { type: mongoose.Schema.ObjectId, ref: 'FacebookCampaign' },
  adsetId: { type: mongoose.Schema.ObjectId, ref: 'FacebookAdSet' },
  adId: { type: mongoose.Schema.ObjectId, ref: 'FacebookAd' },
  rawMetaData: mongoose.Schema.Types.Mixed,

  // Google Ads lead-ads tracing.
  googleLeadId: { type: String, unique: true, sparse: true },
  googleCampaignId: String,
  googleAdGroupId: String,
  googleAdId: String,
  rawGoogleData: mongoose.Schema.Types.Mixed,

  // LinkedIn lead-ads tracing.
  linkedinLeadId: { type: String, unique: true, sparse: true },
  organizationId: String,
  linkedinFormId: String,
  linkedinCampaignId: String,
  linkedinCreativeId: String,
  rawLinkedInData: mongoose.Schema.Types.Mixed,

  created: {
    type: Date,
    default: Date.now,
  },
  updated: {
    type: Date,
    default: Date.now,
  },
});

// Keep stage / subStatus / status internally consistent. stage+subStatus
// are authoritative (they always have at least a schema default); `status`
// is always re-derived from them so older code that reads `lead.status`
// stays correct. A legacy webhook/import that sets only `status: 'New'`
// still lands on stage 'New Lead' via the schema default.
// last 10 digits of a phone string ("+91 70170 55778" -> "7017055778")
function normalizeLeadPhone(p) {
  const d = String(p == null ? '' : p).replace(/\D/g, '');
  return d.length > 10 ? d.slice(-10) : d;
}

schema.pre('save', function derivePhoneNormalized(next) {
  if (this.isModified('phone')) {
    const n = normalizeLeadPhone(this.phone);
    this.phoneNormalized = n || undefined;
  }
  next();
});

// insertMany bypasses 'save' middleware — stamp phoneNormalized here too so
// bulk imports get the dedupe key without every call site remembering to.
schema.pre('insertMany', function stampPhoneNormalized(next, docs) {
  if (Array.isArray(docs)) {
    for (const d of docs) {
      if (d && d.phone != null && (d.phoneNormalized == null || d.phoneNormalized === '')) {
        const n = normalizeLeadPhone(d.phone);
        if (n) d.phoneNormalized = n;
      }
    }
  }
  next();
});

schema.pre('save', function syncPipeline(next) {
  const r = resolveStageSub({ stage: this.stage, subStatus: this.subStatus, status: this.status });
  this.stage = r.stage;
  this.subStatus = r.subStatus;
  this.status = r.status;
  if (this.isModified('stage') && !this.isModified('stageUpdatedAt')) {
    this.stageUpdatedAt = new Date();
  }
  next();
});

schema.pre('findOneAndUpdate', function syncPipelineUpdate(next) {
  const u = this.getUpdate() || {};
  const target = u.$set || u;
  if (target.phone !== undefined) {
    const n = normalizeLeadPhone(target.phone);
    target.phoneNormalized = n || undefined;
  }
  if (target.stage !== undefined || target.subStatus !== undefined || target.status !== undefined) {
    const r = resolveStageSub({
      stage: target.stage,
      subStatus: target.subStatus,
      status: target.stage === undefined ? target.status : undefined,
    });
    target.stage = r.stage;
    target.subStatus = r.subStatus;
    target.status = r.status;
  }
  next();
});

const LeadModel = mongoose.model('Lead', schema);
LeadModel.normalizePhone = normalizeLeadPhone;
module.exports = LeadModel;
