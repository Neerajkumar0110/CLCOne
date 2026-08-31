const mongoose = require('mongoose');
const { featureSchema } = require('../utils/featureSchema');

// Auto-CRUD model for a feature-section tab — list/create/update/delete come
// from the generic controller. Field spec mirrors config/featureSections.js.
module.exports = mongoose.model(
  'Holiday',
  featureSchema([
    { name: 'name', type: 'String', required: true },
    { name: 'date', type: 'Date' },
    { name: 'type', type: 'String', enum: ["National","Regional","Restricted","Company"], default: "National" },
    { name: 'day', type: 'String' },
    { name: 'applicableLocations', type: 'String' },
    { name: 'optional', type: 'Boolean', default: false },
    { name: 'year', type: 'Number', default: 0 },
    { name: 'description', type: 'String' },
  ])
);
