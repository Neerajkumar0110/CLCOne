const mongoose = require('mongoose');
const { featureSchema } = require('../utils/featureSchema');

// Auto-CRUD model for a feature-section tab — list/create/update/delete come
// from the generic controller. Field spec mirrors config/featureSections.js.
module.exports = mongoose.model(
  'ExpenseClaim',
  featureSchema([
    { name: 'employee', type: 'String', required: true },
    { name: 'employeeId', type: 'String' },
    { name: 'department', type: 'String', enum: ["Sales","Marketing","Operations","Engineering","HR","Finance","Support","Training","Admin"] },
    { name: 'category', type: 'String', enum: ["Travel","Food","Accommodation","Fuel","Office Supplies","Client Entertainment","Training","Other"], default: "Travel" },
    { name: 'title', type: 'String' },
    { name: 'amount', type: 'Number', default: 0 },
    { name: 'currency', type: 'String', enum: ["INR","USD","EUR","GBP","AED"], default: "INR" },
    { name: 'expenseDate', type: 'Date' },
    { name: 'claimDate', type: 'Date' },
    { name: 'status', type: 'String', enum: ["Draft","Submitted","Approved","Rejected","Reimbursed"], default: "Draft" },
    { name: 'approver', type: 'String' },
    { name: 'paymentDate', type: 'Date' },
    { name: 'receiptUrl', type: 'String' },
    { name: 'notes', type: 'String' },
  ])
);
