const mongoose = require('mongoose');
const { featureSchema } = require('../utils/featureSchema');

// Auto-CRUD model for a feature-section tab — list/create/update/delete come
// from the generic controller. Field spec mirrors config/featureSections.js.
module.exports = mongoose.model(
  'Campaign',
  featureSchema([
    { name: 'name', type: 'String', required: true },
    { name: 'type', type: 'String', enum: ["Email","SMS","WhatsApp","Social","Paid Ads","Event","Webinar","Content","SEO"], default: "Email" },
    { name: 'objective', type: 'String', enum: ["Awareness","Lead Gen","Nurture","Conversion","Retention"], default: "Lead Gen" },
    { name: 'status', type: 'String', enum: ["Draft","Scheduled","Active","Paused","Completed","Cancelled"], default: "Draft" },
    { name: 'startDate', type: 'Date' },
    { name: 'endDate', type: 'Date' },
    { name: 'budget', type: 'Number', default: 0 },
    { name: 'actualSpend', type: 'Number', default: 0 },
    { name: 'currency', type: 'String', enum: ["INR","USD","EUR","GBP","AED"], default: "INR" },
    { name: 'targetAudience', type: 'String' },
    { name: 'expectedLeads', type: 'Number', default: 0 },
    { name: 'leads', type: 'Number', default: 0 },
    { name: 'conversions', type: 'Number', default: 0 },
    { name: 'revenue', type: 'Number', default: 0 },
    { name: 'owner', type: 'String' },
    { name: 'utmSource', type: 'String' },
    { name: 'utmMedium', type: 'String' },
    { name: 'utmCampaign', type: 'String' },
    { name: 'description', type: 'String' },
  ])
);
