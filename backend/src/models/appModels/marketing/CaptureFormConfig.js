const mongoose = require('mongoose');

// Org-wide capture form configuration — which fields are on/off, and (once
// created) the linked Meta Lead Form. One document per platform
// (Website / Facebook Ads), matching the two tabs in the Capture Form UI.
const fieldSchema = new mongoose.Schema(
  {
    key: String,
    label: String,
    type: String,
    enabled: { type: Boolean, default: false },
    required: { type: Boolean, default: false },
    sortOrder: { type: Number, default: 0 },
    // Form Builder (Marketing › Capture Form): the block of the form the field
    // sits in, its own choices (Dropdown) and placeholder. Fields added with
    // "+ Add field" have keys starting custom_.
    section: { type: String, enum: ['personal', 'lead', 'additional'], default: 'additional' },
    options: { type: [String], default: undefined },
    placeholder: String,
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

  platform: {
    type: String,
    enum: ['Website', 'Facebook Ads'],
    required: true,
  },
  fields: {
    type: [fieldSchema],
    default: [],
  },

  // Hosted page / embed copy, edited in the Form Builder.
  headline: String,
  subtext: String,
  buttonText: String,
  thankYouMessage: String,

  // Only relevant when platform === 'Facebook Ads'.
  metaFormId: String,
  pageId: String,
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

module.exports = mongoose.model('CaptureFormConfig', schema);
