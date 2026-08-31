const mongoose = require('mongoose');
const { featureSchema } = require('../utils/featureSchema');

// Auto-CRUD model for a feature-section tab — list/create/update/delete come
// from the generic controller. Field spec mirrors config/featureSections.js.
module.exports = mongoose.model(
  'HrTicket',
  featureSchema([
    { name: 'raisedBy', type: 'String', required: true },
    { name: 'employeeId', type: 'String' },
    { name: 'department', type: 'String', enum: ["Sales","Marketing","Operations","Engineering","HR","Finance","Support","Training","Admin"] },
    { name: 'category', type: 'String', enum: ["Payroll","Leave","Attendance","Benefits","IT Access","Facilities","Grievance","Policy","Other"], default: "Other" },
    { name: 'subject', type: 'String' },
    { name: 'priority', type: 'String', enum: ["Low","Normal","High","Urgent"], default: "Normal" },
    { name: 'status', type: 'String', enum: ["Open","In Progress","On Hold","Resolved","Closed"], default: "Open" },
    { name: 'assignedTo', type: 'String' },
    { name: 'raisedOn', type: 'Date' },
    { name: 'resolvedOn', type: 'Date' },
    { name: 'description', type: 'String' },
    { name: 'resolution', type: 'String' },
  ])
);
