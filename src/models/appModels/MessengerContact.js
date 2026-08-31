const mongoose = require('mongoose');
const { featureSchema } = require('../utils/featureSchema');

// Auto-CRUD model for a feature-section tab — list/create/update/delete come
// from the generic controller. Field spec mirrors config/featureSections.js.
module.exports = mongoose.model(
  'MessengerContact',
  featureSchema([
    { name: 'name', type: 'String', required: true },
    { name: 'phone', type: 'String' },
    { name: 'email', type: 'String' },
    { name: 'company', type: 'String' },
    { name: 'whatsappOptIn', type: 'Boolean', default: false },
    { name: 'smsOptIn', type: 'Boolean', default: false },
    { name: 'emailOptIn', type: 'Boolean', default: false },
    { name: 'consent', type: 'String', enum: ["Opted-in","Opted-out","Pending","Unknown"], default: "Unknown" },
    { name: 'consentDate', type: 'Date' },
    { name: 'tags', type: 'String' },
    { name: 'lifecycleStage', type: 'String', enum: ["Lead","Prospect","Customer","Churned"], default: "Lead" },
    { name: 'owner', type: 'String' },
    { name: 'lastContactedAt', type: 'Date' },
    { name: 'lastChannel', type: 'String', enum: ["","WhatsApp","SMS","Email","Call"] },
    { name: 'source', type: 'String', enum: ["Manual","Import","Web Form","CRM Sync","Inbound Message"], default: "Manual" },
    { name: 'notes', type: 'String' },
  ])
);
