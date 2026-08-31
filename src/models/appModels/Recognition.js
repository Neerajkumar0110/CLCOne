const mongoose = require('mongoose');
const { featureSchema } = require('../utils/featureSchema');

// Auto-CRUD model for a feature-section tab — list/create/update/delete come
// from the generic controller. Field spec mirrors config/featureSections.js.
module.exports = mongoose.model(
  'Recognition',
  featureSchema([
    { name: 'employee', type: 'String', required: true },
    { name: 'employeeId', type: 'String' },
    { name: 'department', type: 'String', enum: ["Sales","Marketing","Operations","Engineering","HR","Finance","Support","Training","Admin"] },
    { name: 'awardType', type: 'String', enum: ["Employee of the Month","Spot Award","Team Award","Long Service","Values Champion","Peer Recognition"], default: "Spot Award" },
    { name: 'givenBy', type: 'String' },
    { name: 'date', type: 'Date' },
    { name: 'points', type: 'Number', default: 0 },
    { name: 'reason', type: 'String' },
    { name: 'status', type: 'String', enum: ["Nominated","Approved","Awarded","Rejected"], default: "Nominated" },
    { name: 'visibility', type: 'String', enum: ["Public","Team","Private"], default: "Public" },
  ])
);
