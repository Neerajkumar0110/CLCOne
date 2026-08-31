const mongoose = require('mongoose');
const { featureSchema } = require('../utils/featureSchema');

// Auto-CRUD model for a feature-section tab — list/create/update/delete come
// from the generic controller. Field spec mirrors config/featureSections.js.
module.exports = mongoose.model(
  'OpsProject',
  featureSchema([
    { name: 'name', type: 'String', required: true },
    { name: 'code', type: 'String' },
    { name: 'client', type: 'String' },
    { name: 'type', type: 'String', enum: ["Implementation","Consulting","Support","Internal","Retainer"], default: "Implementation" },
    { name: 'owner', type: 'String' },
    { name: 'team', type: 'String' },
    { name: 'priority', type: 'String', enum: ["Low","Medium","High","Critical"], default: "Medium" },
    { name: 'status', type: 'String', enum: ["Planned","In Progress","On Hold","Blocked","Completed","Cancelled"], default: "Planned" },
    { name: 'healthStatus', type: 'String', enum: ["On Track","At Risk","Off Track"], default: "On Track" },
    { name: 'progress', type: 'Number', default: 0 },
    { name: 'startDate', type: 'Date' },
    { name: 'dueDate', type: 'Date' },
    { name: 'completedDate', type: 'Date' },
    { name: 'budget', type: 'Number', default: 0 },
    { name: 'billedAmount', type: 'Number', default: 0 },
    { name: 'estimatedHours', type: 'Number', default: 0 },
    { name: 'loggedHours', type: 'Number', default: 0 },
    { name: 'description', type: 'String' },
  ])
);
