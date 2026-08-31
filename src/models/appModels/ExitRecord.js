const mongoose = require('mongoose');
const { featureSchema } = require('../utils/featureSchema');

// Auto-CRUD model for a feature-section tab — list/create/update/delete come
// from the generic controller. Field spec mirrors config/featureSections.js.
module.exports = mongoose.model(
  'ExitRecord',
  featureSchema([
    { name: 'employee', type: 'String', required: true },
    { name: 'employeeId', type: 'String' },
    { name: 'department', type: 'String', enum: ["Sales","Marketing","Operations","Engineering","HR","Finance","Support","Training","Admin"] },
    { name: 'designation', type: 'String' },
    { name: 'exitType', type: 'String', enum: ["Resignation","Termination","Retirement","End of Contract","Absconding"], default: "Resignation" },
    { name: 'resignationDate', type: 'Date' },
    { name: 'lastWorkingDay', type: 'Date' },
    { name: 'noticePeriodServedDays', type: 'Number', default: 0 },
    { name: 'reason', type: 'String', enum: ["Better Opportunity","Compensation","Relocation","Personal","Higher Studies","Work Environment","Performance","Other"], default: "Other" },
    { name: 'status', type: 'String', enum: ["Initiated","Notice Period","Clearance Pending","Exit Interview","FnF Pending","Completed"], default: "Initiated" },
    { name: 'clearanceIT', type: 'Boolean', default: false },
    { name: 'clearanceFinance', type: 'Boolean', default: false },
    { name: 'clearanceHR', type: 'Boolean', default: false },
    { name: 'clearanceManager', type: 'Boolean', default: false },
    { name: 'exitInterviewDone', type: 'Boolean', default: false },
    { name: 'fnfAmount', type: 'Number', default: 0 },
    { name: 'fnfSettledDate', type: 'Date' },
    { name: 'rehireEligible', type: 'Boolean', default: false },
    { name: 'notes', type: 'String' },
  ])
);
