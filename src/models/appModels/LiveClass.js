const mongoose = require('mongoose');
const { featureSchema } = require('../utils/featureSchema');

// Auto-CRUD model for a feature-section tab — list/create/update/delete come
// from the generic controller. Field spec mirrors config/featureSections.js.
module.exports = mongoose.model(
  'LiveClass',
  featureSchema([
    { name: 'topic', type: 'String', required: true },
    { name: 'course', type: 'String' },
    { name: 'batch', type: 'String' },
    { name: 'trainer', type: 'String' },
    { name: 'scheduledAt', type: 'Date' },
    { name: 'durationMin', type: 'Number', default: 60 },
    { name: 'mode', type: 'String', enum: ["Zoom","Google Meet","MS Teams","In-person"], default: "Zoom" },
    { name: 'joinUrl', type: 'String' },
    { name: 'status', type: 'String', enum: ["Scheduled","Live","Completed","Cancelled","Rescheduled"], default: "Scheduled" },
    { name: 'registeredCount', type: 'Number', default: 0 },
    { name: 'attendedCount', type: 'Number', default: 0 },
    { name: 'recordingUrl', type: 'String' },
    { name: 'materialsUrl', type: 'String' },
    { name: 'agenda', type: 'String' },
    { name: 'notes', type: 'String' },
  ])
);
