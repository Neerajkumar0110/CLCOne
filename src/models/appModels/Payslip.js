const mongoose = require('mongoose');
const { featureSchema } = require('../utils/featureSchema');

// Auto-CRUD model for a feature-section tab — list/create/update/delete come
// from the generic controller. Field spec mirrors config/featureSections.js.
module.exports = mongoose.model(
  'Payslip',
  featureSchema([
    { name: 'employee', type: 'String', required: true },
    { name: 'employeeId', type: 'String' },
    { name: 'department', type: 'String', enum: ["Sales","Marketing","Operations","Engineering","HR","Finance","Support","Training","Admin"] },
    { name: 'payPeriod', type: 'String' },
    { name: 'payDate', type: 'Date' },
    { name: 'currency', type: 'String', enum: ["INR","USD","EUR","GBP","AED"], default: "INR" },
    { name: 'ctc', type: 'Number', default: 0 },
    { name: 'basic', type: 'Number', default: 0 },
    { name: 'hra', type: 'Number', default: 0 },
    { name: 'allowances', type: 'Number', default: 0 },
    { name: 'grossEarnings', type: 'Number', default: 0 },
    { name: 'pf', type: 'Number', default: 0 },
    { name: 'esi', type: 'Number', default: 0 },
    { name: 'tds', type: 'Number', default: 0 },
    { name: 'otherDeductions', type: 'Number', default: 0 },
    { name: 'totalDeductions', type: 'Number', default: 0 },
    { name: 'netPay', type: 'Number', default: 0 },
    { name: 'paidDays', type: 'Number', default: 0 },
    { name: 'lopDays', type: 'Number', default: 0 },
    { name: 'status', type: 'String', enum: ["Draft","Processed","Paid","On Hold"], default: "Draft" },
    { name: 'paymentMode', type: 'String', enum: ["Bank Transfer","Cheque","Cash","UPI"], default: "Bank Transfer" },
    { name: 'notes', type: 'String' },
  ])
);
