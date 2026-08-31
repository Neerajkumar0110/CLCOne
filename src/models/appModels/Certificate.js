const mongoose = require('mongoose');
const { featureSchema } = require('../utils/featureSchema');

// Auto-CRUD model for a feature-section tab — list/create/update/delete come
// from the generic controller. Field spec mirrors config/featureSections.js.
module.exports = mongoose.model(
  'Certificate',
  featureSchema([
    { name: 'student', type: 'String', required: true },
    { name: 'course', type: 'String' },
    { name: 'batch', type: 'String' },
    { name: 'certificateId', type: 'String' },
    { name: 'title', type: 'String' },
    { name: 'type', type: 'String', enum: ["Completion","Participation","Merit","Achievement"], default: "Completion" },
    { name: 'issuedOn', type: 'Date' },
    { name: 'validUntil', type: 'Date' },
    { name: 'grade', type: 'String' },
    { name: 'score', type: 'Number', default: 0 },
    { name: 'status', type: 'String', enum: ["Draft","Issued","Sent","Revoked"], default: "Draft" },
    { name: 'verificationUrl', type: 'String' },
    { name: 'issuedBy', type: 'String' },
    { name: 'notes', type: 'String' },
  ])
);
