const mongoose = require('mongoose');
const { featureSchema } = require('../utils/featureSchema');

// Auto-CRUD model for a feature-section tab — list/create/update/delete come
// from the generic controller. Field spec mirrors config/featureSections.js.
module.exports = mongoose.model(
  'Approval',
  featureSchema([
    { name: 'title', type: 'String', required: true },
    { name: 'type', type: 'String', enum: ["Discount","Purchase Order","Expense","Leave","Budget","Contract","Hiring","Other"], default: "Other" },
    { name: 'requestedBy', type: 'String' },
    { name: 'department', type: 'String', enum: ["Sales","Marketing","Operations","Engineering","HR","Finance","Support","Training","Admin"] },
    { name: 'amount', type: 'Number', default: 0 },
    { name: 'currency', type: 'String', enum: ["INR","USD","EUR","GBP","AED"], default: "INR" },
    { name: 'priority', type: 'String', enum: ["Low","Normal","High","Urgent"], default: "Normal" },
    { name: 'currentStage', type: 'String' },
    { name: 'approver', type: 'String' },
    { name: 'status', type: 'String', enum: ["Draft","Pending","In Review","Approved","Rejected","Withdrawn"], default: "Pending" },
    { name: 'requestedDate', type: 'Date' },
    { name: 'dueDate', type: 'Date' },
    { name: 'decisionDate', type: 'Date' },
    { name: 'justification', type: 'String' },
    { name: 'decisionNote', type: 'String' },
  ])
);
