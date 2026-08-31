const mongoose = require('mongoose');
const { featureSchema } = require('../utils/featureSchema');

// Auto-CRUD model for a feature-section tab — list/create/update/delete come
// from the generic controller. Field spec mirrors config/featureSections.js.
module.exports = mongoose.model(
  'TrainingProgram',
  featureSchema([
    { name: 'title', type: 'String', required: true },
    { name: 'category', type: 'String', enum: ["Onboarding","Compliance","Technical","Leadership","Soft Skills","Product","Safety"], default: "Technical" },
    { name: 'mode', type: 'String', enum: ["Online","Classroom","Workshop","Self-paced","External"], default: "Online" },
    { name: 'trainer', type: 'String' },
    { name: 'audience', type: 'String' },
    { name: 'startDate', type: 'Date' },
    { name: 'endDate', type: 'Date' },
    { name: 'durationHours', type: 'Number', default: 0 },
    { name: 'seats', type: 'Number', default: 0 },
    { name: 'enrolled', type: 'Number', default: 0 },
    { name: 'completed', type: 'Number', default: 0 },
    { name: 'completionRate', type: 'Number', default: 0 },
    { name: 'status', type: 'String', enum: ["Planned","Open","Running","Completed","Cancelled"], default: "Planned" },
    { name: 'mandatory', type: 'Boolean', default: false },
    { name: 'cost', type: 'Number', default: 0 },
    { name: 'notes', type: 'String' },
  ])
);
