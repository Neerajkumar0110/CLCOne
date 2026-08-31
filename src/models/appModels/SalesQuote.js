const mongoose = require('mongoose');
const { featureSchema } = require('../utils/featureSchema');

// Auto-CRUD model for a feature-section tab — list/create/update/delete come
// from the generic controller. Field spec mirrors config/featureSections.js.
module.exports = mongoose.model(
  'SalesQuote',
  featureSchema([
    { name: 'number', type: 'String', required: true },
    { name: 'title', type: 'String' },
    { name: 'account', type: 'String' },
    { name: 'contactName', type: 'String' },
    { name: 'contactEmail', type: 'String' },
    { name: 'deal', type: 'String' },
    { name: 'status', type: 'String', enum: ["Draft","Pending Approval","Sent","Accepted","Rejected","Expired"], default: "Draft" },
    { name: 'currency', type: 'String', enum: ["INR","USD","EUR","GBP","AED"], default: "INR" },
    { name: 'subtotal', type: 'Number', default: 0 },
    { name: 'discount', type: 'Number', default: 0 },
    { name: 'taxRate', type: 'Number', default: 0 },
    { name: 'total', type: 'Number', default: 0 },
    { name: 'issueDate', type: 'Date' },
    { name: 'validTill', type: 'Date' },
    { name: 'owner', type: 'String' },
    { name: 'terms', type: 'String' },
    { name: 'notes', type: 'String' },
  ])
);
