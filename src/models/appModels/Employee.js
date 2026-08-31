const mongoose = require('mongoose');
const { featureSchema } = require('../utils/featureSchema');

// Auto-CRUD model for a feature-section tab — list/create/update/delete come
// from the generic controller. Field spec mirrors config/featureSections.js.
module.exports = mongoose.model(
  'Employee',
  featureSchema([
    { name: 'name', type: 'String', required: true },
    { name: 'employeeId', type: 'String' },
    { name: 'email', type: 'String' },
    { name: 'phone', type: 'String' },
    { name: 'personalEmail', type: 'String' },
    { name: 'department', type: 'String', enum: ["Sales","Marketing","Operations","Engineering","HR","Finance","Support","Training","Admin"] },
    { name: 'designation', type: 'String' },
    { name: 'reportingManager', type: 'String' },
    { name: 'employmentType', type: 'String', enum: ["Permanent","Contract","Probation","Intern","Consultant"], default: "Permanent" },
    { name: 'workLocation', type: 'String', enum: ["Office","Remote","Hybrid"], default: "Office" },
    { name: 'dateOfJoining', type: 'Date' },
    { name: 'dateOfBirth', type: 'Date' },
    { name: 'gender', type: 'String', enum: ["Male","Female","Other","Prefer not to say"] },
    { name: 'status', type: 'String', enum: ["Active","On Leave","Notice Period","Suspended","Resigned","Terminated"], default: "Active" },
    { name: 'ctc', type: 'Number', default: 0 },
    { name: 'currency', type: 'String', enum: ["INR","USD","EUR","GBP","AED"], default: "INR" },
    { name: 'bankAccount', type: 'String' },
    { name: 'pan', type: 'String' },
    { name: 'uan', type: 'String' },
    { name: 'emergencyContactName', type: 'String' },
    { name: 'emergencyContactPhone', type: 'String' },
    { name: 'address', type: 'String' },
    { name: 'skills', type: 'String' },
  ])
);
