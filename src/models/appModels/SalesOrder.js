const mongoose = require('mongoose');
const { featureSchema } = require('../utils/featureSchema');

// Auto-CRUD model for a feature-section tab — list/create/update/delete come
// from the generic controller. Field spec mirrors config/featureSections.js.
module.exports = mongoose.model(
  'SalesOrder',
  featureSchema([
    { name: 'number', type: 'String', required: true },
    { name: 'account', type: 'String' },
    { name: 'quoteRef', type: 'String' },
    { name: 'status', type: 'String', enum: ["Draft","Confirmed","Processing","Fulfilled","Partially Fulfilled","Invoiced","Cancelled"], default: "Draft" },
    { name: 'currency', type: 'String', enum: ["INR","USD","EUR","GBP","AED"], default: "INR" },
    { name: 'subtotal', type: 'Number', default: 0 },
    { name: 'tax', type: 'Number', default: 0 },
    { name: 'shipping', type: 'Number', default: 0 },
    { name: 'total', type: 'Number', default: 0 },
    { name: 'orderDate', type: 'Date' },
    { name: 'expectedDelivery', type: 'Date' },
    { name: 'deliveredDate', type: 'Date' },
    { name: 'paymentStatus', type: 'String', enum: ["Unpaid","Partial","Paid"], default: "Unpaid" },
    { name: 'invoiceRef', type: 'String' },
    { name: 'owner', type: 'String' },
    { name: 'billingAddress', type: 'String' },
    { name: 'shippingAddress', type: 'String' },
    { name: 'notes', type: 'String' },
  ])
);
