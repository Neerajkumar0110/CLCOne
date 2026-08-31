const mongoose = require('mongoose');
const { featureSchema } = require('../utils/featureSchema');

// Auto-CRUD model for a feature-section tab — list/create/update/delete come
// from the generic controller. Field spec mirrors config/featureSections.js.
module.exports = mongoose.model(
  'Segment',
  featureSchema([
    { name: 'name', type: 'String', required: true },
    { name: 'type', type: 'String', enum: ["Dynamic","Static"], default: "Dynamic" },
    { name: 'description', type: 'String' },
    { name: 'criteria', type: 'String' },
    { name: 'contactCount', type: 'Number', default: 0 },
    { name: 'marketableCount', type: 'Number', default: 0 },
    { name: 'usedInCount', type: 'Number', default: 0 },
    { name: 'source', type: 'String', enum: ["CRM","Import","Form","Manual","Integration"], default: "CRM" },
    { name: 'status', type: 'String', enum: ["Active","Archived"], default: "Active" },
    { name: 'lastRefreshed', type: 'Date' },
    { name: 'owner', type: 'String' },
    { name: 'tags', type: 'String' },
  ])
);
