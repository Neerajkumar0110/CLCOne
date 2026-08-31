const mongoose = require('mongoose');
const { featureSchema } = require('../utils/featureSchema');

// Auto-CRUD model for a feature-section tab — list/create/update/delete come
// from the generic controller. Field spec mirrors config/featureSections.js.
module.exports = mongoose.model(
  'HrDocument',
  featureSchema([
    { name: 'employee', type: 'String', required: true },
    { name: 'employeeId', type: 'String' },
    { name: 'docType', type: 'String', enum: ["Offer Letter","Appointment Letter","Contract","ID Proof","Address Proof","PAN","Aadhaar","Educational","Experience","Relieving Letter","Payslip","Other"], default: "Other" },
    { name: 'title', type: 'String' },
    { name: 'fileUrl', type: 'String' },
    { name: 'issueDate', type: 'Date' },
    { name: 'expiryDate', type: 'Date' },
    { name: 'status', type: 'String', enum: ["Pending","Received","Verified","Rejected","Expired"], default: "Pending" },
    { name: 'confidential', type: 'Boolean', default: false },
    { name: 'uploadedBy', type: 'String' },
    { name: 'notes', type: 'String' },
  ])
);
