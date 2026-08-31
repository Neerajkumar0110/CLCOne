const mongoose = require('mongoose');
const { featureSchema } = require('../utils/featureSchema');

// Auto-CRUD model for a feature-section tab — list/create/update/delete come
// from the generic controller. Field spec mirrors config/featureSections.js.
module.exports = mongoose.model(
  'HrOnboarding',
  featureSchema([
    { name: 'employee', type: 'String', required: true },
    { name: 'employeeId', type: 'String' },
    { name: 'department', type: 'String', enum: ["Sales","Marketing","Operations","Engineering","HR","Finance","Support","Training","Admin"] },
    { name: 'designation', type: 'String' },
    { name: 'manager', type: 'String' },
    { name: 'buddy', type: 'String' },
    { name: 'joiningDate', type: 'Date' },
    { name: 'dueDate', type: 'Date' },
    { name: 'status', type: 'String', enum: ["Not Started","In Progress","Completed","Delayed"], default: "Not Started" },
    { name: 'progress', type: 'Number', default: 0 },
    { name: 'docsCollected', type: 'Boolean', default: false },
    { name: 'itSetupDone', type: 'Boolean', default: false },
    { name: 'assetsIssued', type: 'Boolean', default: false },
    { name: 'accessGranted', type: 'Boolean', default: false },
    { name: 'inductionDone', type: 'Boolean', default: false },
    { name: 'notes', type: 'String' },
  ])
);
