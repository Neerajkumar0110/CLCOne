const mongoose = require('mongoose');
const { featureSchema } = require('../utils/featureSchema');

// Auto-CRUD model for a feature-section tab — list/create/update/delete come
// from the generic controller. Field spec mirrors config/featureSections.js.
module.exports = mongoose.model(
  'Journey',
  featureSchema([
    { name: 'name', type: 'String', required: true },
    { name: 'description', type: 'String' },
    { name: 'triggerType', type: 'String', enum: ["Form Submission","Tag Added","List Join","Field Change","Date Based","Page Visit","Manual"], default: "Form Submission" },
    { name: 'triggerDetail', type: 'String' },
    { name: 'status', type: 'String', enum: ["Draft","Active","Paused","Archived"], default: "Draft" },
    { name: 'goal', type: 'String' },
    { name: 'steps', type: 'Number', default: 0 },
    { name: 'enrolled', type: 'Number', default: 0 },
    { name: 'inProgress', type: 'Number', default: 0 },
    { name: 'completed', type: 'Number', default: 0 },
    { name: 'goalMet', type: 'Number', default: 0 },
    { name: 'exitCount', type: 'Number', default: 0 },
    { name: 'owner', type: 'String' },
    { name: 'startDate', type: 'Date' },
    { name: 'endDate', type: 'Date' },
    { name: 'notes', type: 'String' },
  ])
);
