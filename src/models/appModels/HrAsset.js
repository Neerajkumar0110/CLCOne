const mongoose = require('mongoose');
const { featureSchema } = require('../utils/featureSchema');

// Auto-CRUD model for a feature-section tab — list/create/update/delete come
// from the generic controller. Field spec mirrors config/featureSections.js.
module.exports = mongoose.model(
  'HrAsset',
  featureSchema([
    { name: 'assetTag', type: 'String', required: true },
    { name: 'category', type: 'String', enum: ["Laptop","Desktop","Monitor","Phone","SIM","Access Card","Headset","Furniture","Software License","Other"], default: "Laptop" },
    { name: 'model', type: 'String' },
    { name: 'serialNumber', type: 'String' },
    { name: 'assignedTo', type: 'String' },
    { name: 'employeeId', type: 'String' },
    { name: 'department', type: 'String', enum: ["Sales","Marketing","Operations","Engineering","HR","Finance","Support","Training","Admin"] },
    { name: 'issueDate', type: 'Date' },
    { name: 'returnDate', type: 'Date' },
    { name: 'condition', type: 'String', enum: ["New","Good","Fair","Damaged","Retired"], default: "Good" },
    { name: 'status', type: 'String', enum: ["In Stock","Assigned","In Repair","Retired","Lost"], default: "In Stock" },
    { name: 'value', type: 'Number', default: 0 },
    { name: 'notes', type: 'String' },
  ])
);
