const mongoose = require('mongoose');
const { featureSchema } = require('../utils/featureSchema');

// Auto-CRUD model for a feature-section tab — list/create/update/delete come
// from the generic controller. Field spec mirrors config/featureSections.js.
module.exports = mongoose.model(
  'MessengerBroadcast',
  featureSchema([
    { name: 'name', type: 'String', required: true },
    { name: 'channel', type: 'String', enum: ["WhatsApp","SMS","Email"], default: "WhatsApp" },
    { name: 'templateRef', type: 'String' },
    { name: 'audience', type: 'String' },
    { name: 'recipientCount', type: 'Number', default: 0 },
    { name: 'status', type: 'String', enum: ["Draft","Scheduled","Sending","Sent","Paused","Failed","Cancelled"], default: "Draft" },
    { name: 'scheduledAt', type: 'Date' },
    { name: 'sentAt', type: 'Date' },
    { name: 'sentCount', type: 'Number', default: 0 },
    { name: 'deliveredCount', type: 'Number', default: 0 },
    { name: 'readCount', type: 'Number', default: 0 },
    { name: 'replyCount', type: 'Number', default: 0 },
    { name: 'failedCount', type: 'Number', default: 0 },
    { name: 'throttlePerMin', type: 'Number', default: 0 },
    { name: 'owner', type: 'String' },
    { name: 'message', type: 'String' },
    { name: 'notes', type: 'String' },
  ])
);
