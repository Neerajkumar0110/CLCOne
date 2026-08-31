const mongoose = require('mongoose');
const { featureSchema } = require('../utils/featureSchema');

// Auto-CRUD model for a feature-section tab — list/create/update/delete come
// from the generic controller. Field spec mirrors config/featureSections.js.
module.exports = mongoose.model(
  'OpsDelivery',
  featureSchema([
    { name: 'engagement', type: 'String', required: true },
    { name: 'client', type: 'String' },
    { name: 'service', type: 'String' },
    { name: 'stage', type: 'String', enum: ["Kickoff","Discovery","Build","Review","UAT","Handover","Closed"], default: "Kickoff" },
    { name: 'owner', type: 'String' },
    { name: 'status', type: 'String', enum: ["In Delivery","Awaiting Client","Blocked","On Hold","Delivered"], default: "In Delivery" },
    { name: 'health', type: 'String', enum: ["Green","Amber","Red"], default: "Green" },
    { name: 'startDate', type: 'Date' },
    { name: 'eta', type: 'Date' },
    { name: 'deliveredDate', type: 'Date' },
    { name: 'signedOff', type: 'Boolean', default: false },
    { name: 'cycleTimeDays', type: 'Number', default: 0 },
    { name: 'notes', type: 'String' },
  ])
);
