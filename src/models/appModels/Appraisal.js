const mongoose = require('mongoose');
const { featureSchema } = require('../utils/featureSchema');

// Auto-CRUD model for a feature-section tab — list/create/update/delete come
// from the generic controller. Field spec mirrors config/featureSections.js.
module.exports = mongoose.model(
  'Appraisal',
  featureSchema([
    { name: 'employee', type: 'String', required: true },
    { name: 'employeeId', type: 'String' },
    { name: 'department', type: 'String', enum: ["Sales","Marketing","Operations","Engineering","HR","Finance","Support","Training","Admin"] },
    { name: 'cycle', type: 'String' },
    { name: 'reviewPeriodStart', type: 'Date' },
    { name: 'reviewPeriodEnd', type: 'Date' },
    { name: 'manager', type: 'String' },
    { name: 'reviewer', type: 'String' },
    { name: 'selfRating', type: 'Number', default: 0 },
    { name: 'managerRating', type: 'Number', default: 0 },
    { name: 'finalRating', type: 'Number', default: 0 },
    { name: 'ratingLabel', type: 'String', enum: ["","Outstanding","Exceeds Expectations","Meets Expectations","Needs Improvement","Unsatisfactory"] },
    { name: 'status', type: 'String', enum: ["Not Started","Self Review","Manager Review","Calibration","Completed","Acknowledged"], default: "Not Started" },
    { name: 'promotionRecommended', type: 'Boolean', default: false },
    { name: 'incrementPct', type: 'Number', default: 0 },
    { name: 'goals', type: 'String' },
    { name: 'strengths', type: 'String' },
    { name: 'improvements', type: 'String' },
    { name: 'managerComments', type: 'String' },
  ])
);
