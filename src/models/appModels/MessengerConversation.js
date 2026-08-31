const mongoose = require('mongoose');
const { featureSchema } = require('../utils/featureSchema');

// Auto-CRUD model for a feature-section tab — list/create/update/delete come
// from the generic controller. Field spec mirrors config/featureSections.js.
module.exports = mongoose.model(
  'MessengerConversation',
  featureSchema([
    { name: 'contact', type: 'String', required: true },
    { name: 'channel', type: 'String', enum: ["WhatsApp","SMS","Email"], default: "WhatsApp" },
    { name: 'handle', type: 'String' },
    { name: 'subject', type: 'String' },
    { name: 'assignedTo', type: 'String' },
    { name: 'team', type: 'String' },
    { name: 'status', type: 'String', enum: ["Open","Pending","Snoozed","Resolved","Closed"], default: "Open" },
    { name: 'priority', type: 'String', enum: ["Low","Normal","High","Urgent"], default: "Normal" },
    { name: 'lastMessage', type: 'String' },
    { name: 'lastMessageAt', type: 'Date' },
    { name: 'lastDirection', type: 'String', enum: ["","Inbound","Outbound"] },
    { name: 'unreadCount', type: 'Number', default: 0 },
    { name: 'messageCount', type: 'Number', default: 0 },
    { name: 'firstResponseMin', type: 'Number', default: 0 },
    { name: 'tags', type: 'String' },
    { name: 'withinWindow', type: 'Boolean', default: false },
    { name: 'notes', type: 'String' },
  ])
);
