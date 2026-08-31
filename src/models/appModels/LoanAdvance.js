const mongoose = require('mongoose');
const { featureSchema } = require('../utils/featureSchema');

// Auto-CRUD model for a feature-section tab — list/create/update/delete come
// from the generic controller. Field spec mirrors config/featureSections.js.
module.exports = mongoose.model(
  'LoanAdvance',
  featureSchema([
    { name: 'employee', type: 'String', required: true },
    { name: 'employeeId', type: 'String' },
    { name: 'department', type: 'String', enum: ["Sales","Marketing","Operations","Engineering","HR","Finance","Support","Training","Admin"] },
    { name: 'type', type: 'String', enum: ["Salary Advance","Personal Loan","Emergency Loan","Travel Advance"], default: "Salary Advance" },
    { name: 'amount', type: 'Number', default: 0 },
    { name: 'currency', type: 'String', enum: ["INR","USD","EUR","GBP","AED"], default: "INR" },
    { name: 'requestDate', type: 'Date' },
    { name: 'reason', type: 'String' },
    { name: 'tenureMonths', type: 'Number', default: 0 },
    { name: 'emi', type: 'Number', default: 0 },
    { name: 'outstanding', type: 'Number', default: 0 },
    { name: 'status', type: 'String', enum: ["Requested","Approved","Disbursed","Repaying","Closed","Rejected"], default: "Requested" },
    { name: 'approver', type: 'String' },
    { name: 'disbursedDate', type: 'Date' },
    { name: 'notes', type: 'String' },
  ])
);
