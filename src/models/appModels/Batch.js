const mongoose = require('mongoose');
const { featureSchema } = require('../utils/featureSchema');

// Auto-CRUD model for a feature-section tab — list/create/update/delete come
// from the generic controller. Field spec mirrors config/featureSections.js.
module.exports = mongoose.model(
  'Batch',
  featureSchema([
    { name: 'name', type: 'String', required: true },
    { name: 'code', type: 'String' },
    { name: 'course', type: 'String' },
    { name: 'mode', type: 'String', enum: ["Online","Offline","Hybrid"], default: "Online" },
    { name: 'trainer', type: 'String' },
    { name: 'coordinator', type: 'String' },
    { name: 'startDate', type: 'Date' },
    { name: 'endDate', type: 'Date' },
    { name: 'schedule', type: 'String' },
    { name: 'seats', type: 'Number', default: 0 },
    { name: 'enrolled', type: 'Number', default: 0 },
    { name: 'waitlist', type: 'Number', default: 0 },
    { name: 'status', type: 'String', enum: ["Planned","Open for Enrollment","Running","Completed","Cancelled"], default: "Planned" },
    { name: 'completionRate', type: 'Number', default: 0 },
    { name: 'venue', type: 'String' },
    { name: 'meetingLink', type: 'String' },
    { name: 'notes', type: 'String' },
  ])
);
