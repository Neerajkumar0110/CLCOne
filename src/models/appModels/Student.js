const mongoose = require('mongoose');
const { featureSchema } = require('../utils/featureSchema');

// Auto-CRUD model for a feature-section tab — list/create/update/delete come
// from the generic controller. Field spec mirrors config/featureSections.js.
module.exports = mongoose.model(
  'Student',
  featureSchema([
    { name: 'name', type: 'String', required: true },
    { name: 'email', type: 'String' },
    { name: 'phone', type: 'String' },
    { name: 'altPhone', type: 'String' },
    { name: 'city', type: 'String' },
    { name: 'course', type: 'String' },
    { name: 'batch', type: 'String' },
    { name: 'enrollmentId', type: 'String' },
    { name: 'enrolledOn', type: 'Date' },
    { name: 'status', type: 'String', enum: ["Active","On Hold","Completed","Dropped","Deferred"], default: "Active" },
    { name: 'progress', type: 'Number', default: 0 },
    { name: 'attendancePct', type: 'Number', default: 0 },
    { name: 'avgScore', type: 'Number', default: 0 },
    { name: 'feeTotal', type: 'Number', default: 0 },
    { name: 'feePaid', type: 'Number', default: 0 },
    { name: 'feeStatus', type: 'String', enum: ["Paid","Partial","Unpaid","Waived"], default: "Unpaid" },
    { name: 'source', type: 'String', enum: ["Website","Referral","Walk-in","Ads","Counselor","Partner"], default: "Website" },
    { name: 'counselor', type: 'String' },
    { name: 'guardianName', type: 'String' },
    { name: 'guardianPhone', type: 'String' },
    { name: 'notes', type: 'String' },
  ])
);
