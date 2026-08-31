const mongoose = require('mongoose');
const { featureSchema } = require('../utils/featureSchema');

// Auto-CRUD model for a feature-section tab — list/create/update/delete come
// from the generic controller. Field spec mirrors config/featureSections.js.
module.exports = mongoose.model(
  'OpsDocument',
  featureSchema([
    { name: 'title', type: 'String', required: true },
    { name: 'type', type: 'String', enum: ["Contract","MSA","NDA","SOW","Proposal","Invoice","Policy","Report","Other"], default: "Other" },
    { name: 'category', type: 'String' },
    { name: 'linkedType', type: 'String', enum: ["Client","Vendor","Project","Employee","Deal","None"], default: "None" },
    { name: 'linkedTo', type: 'String' },
    { name: 'owner', type: 'String' },
    { name: 'status', type: 'String', enum: ["Draft","In Review","Pending Signature","Signed","Active","Expired","Terminated"], default: "Draft" },
    { name: 'confidentiality', type: 'String', enum: ["Public","Internal","Confidential","Restricted"], default: "Internal" },
    { name: 'version', type: 'String' },
    { name: 'effectiveDate', type: 'Date' },
    { name: 'expiryDate', type: 'Date' },
    { name: 'renewalReminderDate', type: 'Date' },
    { name: 'fileUrl', type: 'String' },
    { name: 'notes', type: 'String' },
  ])
);
