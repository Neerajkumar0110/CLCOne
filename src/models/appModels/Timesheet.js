const mongoose = require('mongoose');
const { featureSchema } = require('../utils/featureSchema');

// Auto-CRUD model for a feature-section tab — list/create/update/delete come
// from the generic controller. Field spec mirrors config/featureSections.js.
module.exports = mongoose.model(
  'Timesheet',
  featureSchema([
    { name: 'employee', type: 'String', required: true },
    { name: 'employeeId', type: 'String' },
    { name: 'department', type: 'String', enum: ["Sales","Marketing","Operations","Engineering","HR","Finance","Support","Training","Admin"] },
    { name: 'project', type: 'String' },
    { name: 'task', type: 'String' },
    { name: 'date', type: 'Date' },
    { name: 'weekOf', type: 'String' },
    { name: 'hours', type: 'Number', default: 0 },
    { name: 'billable', type: 'Boolean', default: false },
    { name: 'status', type: 'String', enum: ["Draft","Submitted","Approved","Rejected"], default: "Draft" },
    { name: 'approver', type: 'String' },
    { name: 'description', type: 'String' },
  ])
);
