const mongoose = require('mongoose');
const { featureSchema } = require('../utils/featureSchema');

// Auto-CRUD model for a feature-section tab — list/create/update/delete come
// from the generic controller. Field spec mirrors config/featureSections.js.
module.exports = mongoose.model(
  'ShiftRoster',
  featureSchema([
    { name: 'employee', type: 'String', required: true },
    { name: 'employeeId', type: 'String' },
    { name: 'department', type: 'String', enum: ["Sales","Marketing","Operations","Engineering","HR","Finance","Support","Training","Admin"] },
    { name: 'shiftName', type: 'String', enum: ["General","Morning","Evening","Night","Split"], default: "General" },
    { name: 'startTime', type: 'String' },
    { name: 'endTime', type: 'String' },
    { name: 'weekOff', type: 'String' },
    { name: 'fromDate', type: 'Date' },
    { name: 'toDate', type: 'Date' },
    { name: 'location', type: 'String' },
    { name: 'status', type: 'String', enum: ["Scheduled","Active","Swapped","Cancelled"], default: "Scheduled" },
    { name: 'notes', type: 'String' },
  ])
);
