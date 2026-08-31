const mongoose = require('mongoose');

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
  email: String,
  source: String,
  status: {
    type: String,
    enum: ['New', 'Contacted', 'Qualified', 'Won', 'Lost'],
    default: 'New',
  },
  // Team name (matches Team.name) this lead has been assigned/contributed to.
  team: String,
  position: String,
  color: String,
  image: String,

  // Optional location / secondary-contact detail — populated mainly by
  // bulk imports whose file carries these columns; surfaced on hover in
  // the Unassigned Leads table and in the lead detail modal.
  alternatePhone: String,
  city: String,
  state: String,
  country: String,
  zipcode: String,

  // Set when this lead came in through a bulk import — lets a batch's rows
  // be looked up later via GET /api/lead/filter?filter=importBatch&equal=<id>.
  importBatch: { type: mongoose.Schema.ObjectId, ref: 'LeadImportBatch' },

  // Capture-form custom questions (Website + Facebook Lead Ads).
  budgetRange: String,
  howSoonToStart: String,
  message: String,

  // Facebook/Meta lead-ads tracing — set only for source === 'Facebook Ads'.
  // facebookLeadId is unique+sparse so it only enforces uniqueness on actual
  // Facebook leads, and doubles as the duplicate-webhook guard.
  facebookLeadId: { type: String, unique: true, sparse: true },
  pageId: String,
  metaFormId: String,
  adAccountId: String,
  campaignId: { type: mongoose.Schema.ObjectId, ref: 'FacebookCampaign' },
  adsetId: { type: mongoose.Schema.ObjectId, ref: 'FacebookAdSet' },
  adId: { type: mongoose.Schema.ObjectId, ref: 'FacebookAd' },
  rawMetaData: mongoose.Schema.Types.Mixed,

  // Google Ads lead-ads tracing — set only for source === 'Google Ads'.
  // Plain Strings holding Google's raw ids (not ObjectId refs) — see the
  // adId cast-error note above; the Google/LinkedIn webhook handlers only
  // ever have the platform's own raw id, never this app's local _id.
  googleLeadId: { type: String, unique: true, sparse: true },
  googleCampaignId: String,
  googleAdGroupId: String,
  googleAdId: String,
  rawGoogleData: mongoose.Schema.Types.Mixed,

  // LinkedIn lead-ads tracing — set only for source === 'LinkedIn Ads'.
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

module.exports = mongoose.model('Lead', schema);
