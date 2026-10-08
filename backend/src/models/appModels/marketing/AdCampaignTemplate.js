const mongoose = require('mongoose');

// One saved "what to run" template per ad platform (unique on `platform`) —
// what services/marketing/autoLaunchCampaign.js uses to build and publish a
// real campaign the moment that platform's account finishes connecting,
// instead of an admin walking through Campaign → Ad Set/Group → Creative →
// Ad by hand every time (see pages/Leads/CaptureForm.jsx's CampaignSetup/
// GoogleCampaignSetup/LinkedInCampaignSetup, which this reuses verbatim —
// same controllers, same required fields, just driven by this saved config
// instead of a human filling a form).
const schema = new mongoose.Schema({
  removed: { type: Boolean, default: false },

  platform: { type: String, enum: ['facebook', 'google', 'linkedin'], required: true, unique: true },
  // Auto-launch only fires for a platform whose template is enabled — saving
  // a template does not by itself turn auto-launch on.
  enabled: { type: Boolean, default: false },

  campaignName: { type: String, default: 'Career Lab Consulting' },

  // ── Facebook Ads ──
  objective: { type: String, default: 'OUTCOME_LEADS' },
  dailyBudget: { type: Number }, // Facebook/LinkedIn: major currency units (e.g. INR)
  countries: { type: [String], default: ['IN'] },
  ageMin: { type: Number, default: 18 },
  ageMax: { type: Number, default: 65 },
  genders: { type: [Number], default: [] }, // Meta: 1=male, 2=female, []=all
  placements: { type: [String], default: [] }, // e.g. ['facebook','instagram']
  optimizationGoal: { type: String },
  billingEvent: { type: String },
  primaryText: { type: String },
  headline: { type: String },
  description: { type: String },
  callToAction: { type: String, default: 'LEARN_MORE' },
  privacyPolicyUrl: { type: String }, // required by Meta to auto-create the Lead Form

  // ── Google Ads ──
  advertisingChannelType: { type: String, default: 'SEARCH' },
  dailyBudgetMicros: { type: Number }, // Google: micros (1 INR = 1,000,000 micros)
  cpcBidMicros: { type: Number },
  headlines: { type: [String], default: [] }, // Google requires >= 3
  descriptions: { type: [String], default: [] }, // Google requires >= 2
  finalUrls: { type: [String], default: [] },

  // ── LinkedIn Ads ──
  totalBudget: { type: Number },
  locations: { type: [String], default: [] },
  commentary: { type: String },
  landingPageUrl: { type: String },
  // LinkedIn has no API to create a Lead Gen Form — must already exist,
  // created by hand in LinkedIn Campaign Manager (see autoLaunchCampaign.js
  // header comment for why).
  leadGenFormId: { type: String },

  // ── shared creative media (Facebook + LinkedIn only — Google's
  // integration here is text-only Responsive Search Ads) ──
  mediaFilePath: { type: String }, // e.g. "public/uploads/adtemplate/<file>" — same shape uploadMiddleware produces
  mediaFileName: { type: String },
  mediaType: { type: String, enum: ['image', 'video'], default: 'image' },

  // ── bookkeeping for the last auto-launch attempt ──
  lastRunAt: { type: Date },
  lastRunStatus: { type: String, enum: ['success', 'failed'] },
  lastRunError: { type: String },
  lastRunSteps: { type: mongoose.Schema.Types.Mixed }, // e.g. { campaign: 'ok', adSet: 'ok', creative: 'failed: ...' }

  created: { type: Date, default: Date.now },
  updated: { type: Date, default: Date.now },
});

module.exports = mongoose.model('AdCampaignTemplate', schema);
