const mongoose = require('mongoose');
const { featureSchema } = require('../utils/featureSchema');

// Auto-CRUD model for a feature-section tab — list/create/update/delete come
// from the generic controller. Field spec mirrors config/featureSections.js.
module.exports = mongoose.model(
  'Announcement',
  featureSchema([
    { name: 'title', type: 'String', required: true },
    { name: 'category', type: 'String', enum: ["General","Policy","Event","Holiday","Payroll","Benefits","Emergency","Celebration"], default: "General" },
    { name: 'audience', type: 'String' },
    { name: 'publishedBy', type: 'String' },
    { name: 'publishDate', type: 'Date' },
    { name: 'expiryDate', type: 'Date' },
    { name: 'status', type: 'String', enum: ["Draft","Scheduled","Published","Archived"], default: "Draft" },
    { name: 'pinned', type: 'Boolean', default: false },
    { name: 'acknowledgementRequired', type: 'Boolean', default: false },
    { name: 'readCount', type: 'Number', default: 0 },
    { name: 'body', type: 'String' },
  ])
);
