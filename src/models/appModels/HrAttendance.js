const mongoose = require('mongoose');
const { featureSchema } = require('../utils/featureSchema');

// Auto-CRUD model for a feature-section tab — list/create/update/delete come
// from the generic controller. Field spec mirrors config/featureSections.js.
module.exports = mongoose.model(
  'HrAttendance',
  featureSchema([
    { name: 'employee', type: 'String', required: true },
    { name: 'employeeId', type: 'String' },
    { name: 'department', type: 'String', enum: ["Sales","Marketing","Operations","Engineering","HR","Finance","Support","Training","Admin"] },
    { name: 'date', type: 'Date' },
    { name: 'shift', type: 'String', enum: ["General","Morning","Evening","Night","Flexible"], default: "General" },
    { name: 'clockIn', type: 'String' },
    { name: 'clockOut', type: 'String' },
    { name: 'workedHours', type: 'Number', default: 0 },
    { name: 'overtimeHours', type: 'Number', default: 0 },
    { name: 'status', type: 'String', enum: ["Present","Absent","Half Day","Work From Home","On Leave","Holiday","Weekend"], default: "Present" },
    { name: 'lateByMin', type: 'Number', default: 0 },
    { name: 'location', type: 'String' },
    { name: 'regularized', type: 'Boolean', default: false },
    { name: 'remarks', type: 'String' },
  ])
);
