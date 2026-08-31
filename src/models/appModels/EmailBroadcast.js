const mongoose = require('mongoose');
const { featureSchema } = require('../utils/featureSchema');

// Auto-CRUD model for a feature-section tab — list/create/update/delete come
// from the generic controller. Field spec mirrors config/featureSections.js.
module.exports = mongoose.model(
  'EmailBroadcast',
  featureSchema([
    { name: 'name', type: 'String', required: true },
    { name: 'channel', type: 'String', enum: ["Email","SMS","WhatsApp"], default: "Email" },
    { name: 'subject', type: 'String' },
    { name: 'fromName', type: 'String' },
    { name: 'fromAddress', type: 'String' },
    { name: 'audience', type: 'String' },
    { name: 'recipientCount', type: 'Number', default: 0 },
    { name: 'status', type: 'String', enum: ["Draft","Scheduled","Sending","Sent","Paused","Failed"], default: "Draft" },
    { name: 'scheduledAt', type: 'Date' },
    { name: 'sentAt', type: 'Date' },
    { name: 'sentCount', type: 'Number', default: 0 },
    { name: 'deliveredCount', type: 'Number', default: 0 },
    { name: 'openCount', type: 'Number', default: 0 },
    { name: 'clickCount', type: 'Number', default: 0 },
    { name: 'bounceCount', type: 'Number', default: 0 },
    { name: 'unsubscribeCount', type: 'Number', default: 0 },
    { name: 'templateRef', type: 'String' },
    { name: 'abTest', type: 'Boolean', default: false },
    { name: 'content', type: 'String' },
  ])
);
