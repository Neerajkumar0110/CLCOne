const mongoose = require('mongoose');

// Mirrors a Meta Ad Creative. Media is uploaded to Meta first (via
// metaGraphClient.uploadImage/uploadVideo) — only the returned Meta asset
// reference (image hash / video id) is stored here, never the raw file.
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
  pageId: { type: String, required: true },
  campaignId: { type: mongoose.Schema.ObjectId, ref: 'FacebookCampaign' },
  adSetId: { type: mongoose.Schema.ObjectId, ref: 'FacebookAdSet' },

  metaCreativeId: String,
  name: { type: String, required: true },

  mediaType: { type: String, enum: ['image', 'video'], default: 'image' },
  metaImageHash: String,
  metaVideoId: String,

  primaryText: String,
  headline: String,
  description: String,
  callToAction: { type: String, default: 'LEARN_MORE' },

  metaFormId: String, // the Meta Lead Form this creative's ad will submit to

  status: {
    type: String,
    enum: ['draft', 'created', 'error'],
    default: 'draft',
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

module.exports = mongoose.model('FacebookAdCreative', schema);
