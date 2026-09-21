const mongoose = require('mongoose');

// Mirrors a LinkedIn Marketing API Creative — LinkedIn has no separate "Ad"
// resource the way Meta does (Creative -> Ad); a LinkedIn Creative is
// already the final servable unit tied directly to a Campaign, so this one
// model plays the combined role of FacebookAdCreative.js + FacebookAd.js.
// Media (imageUrn) is uploaded to LinkedIn first — only the returned asset
// URN is stored here, never the raw file, same rule as
// FacebookAdCreative.metaImageHash/metaVideoId.
const schema = new mongoose.Schema({
  removed: {
    type: Boolean,
    default: false,
  },
  enabled: {
    type: Boolean,
    default: true,
  },

  adAccountId: { type: String, required: true },
  organizationId: { type: String, required: true },
  campaignId: { type: mongoose.Schema.ObjectId, ref: 'LinkedInCampaign', required: true },

  linkedinCreativeId: String, // numeric id inside urn:li:sponsoredCreative:...
  name: { type: String, required: true },

  commentary: String, // LinkedIn's term for the post body / primary text
  headline: String,
  landingPageUrl: String,
  callToAction: { type: String, default: 'Submit' },

  imageUrn: String, // e.g. urn:li:image:...

  leadGenFormId: String, // LinkedIn URN string (urn:li:leadGenForm:...) this creative's lead-gen CTA submits to

  status: {
    type: String,
    enum: ['DRAFT', 'PAUSED', 'ACTIVE', 'ARCHIVED'],
    default: 'PAUSED',
  },
  lastError: String,

  created: {
    type: Date,
    default: Date.now,
  },
  updated: {
    type: Date,
    default: Date.now,
  },
});

module.exports = mongoose.model('LinkedInCreative', schema);
