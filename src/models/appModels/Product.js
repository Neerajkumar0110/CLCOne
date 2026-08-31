const mongoose = require('mongoose');
const { featureSchema } = require('../utils/featureSchema');

// Auto-CRUD model for a feature-section tab — list/create/update/delete come
// from the generic controller. Field spec mirrors config/featureSections.js.
module.exports = mongoose.model(
  'Product',
  featureSchema([
    { name: 'name', type: 'String', required: true },
    { name: 'sku', type: 'String' },
    { name: 'category', type: 'String' },
    { name: 'type', type: 'String', enum: ["Service","Physical","Digital","Subscription"], default: "Service" },
    { name: 'unitPrice', type: 'Number', default: 0 },
    { name: 'costPrice', type: 'Number', default: 0 },
    { name: 'currency', type: 'String', enum: ["INR","USD","EUR","GBP","AED"], default: "INR" },
    { name: 'taxRate', type: 'Number', default: 0 },
    { name: 'unit', type: 'String', enum: ["Unit","Hour","Day","Month","Year","License","Seat"], default: "Unit" },
    { name: 'billingCycle', type: 'String', enum: ["One-time","Monthly","Quarterly","Yearly"], default: "One-time" },
    { name: 'stockQty', type: 'Number', default: 0 },
    { name: 'reorderLevel', type: 'Number', default: 0 },
    { name: 'hsnCode', type: 'String' },
    { name: 'status', type: 'String', enum: ["Active","Inactive","Discontinued"], default: "Active" },
    { name: 'description', type: 'String' },
  ])
);
