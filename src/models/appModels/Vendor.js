const mongoose = require('mongoose');
const { featureSchema } = require('../utils/featureSchema');

// Auto-CRUD model for a feature-section tab — list/create/update/delete come
// from the generic controller. Field spec mirrors config/featureSections.js.
module.exports = mongoose.model(
  'Vendor',
  featureSchema([
    { name: 'name', type: 'String', required: true },
    { name: 'code', type: 'String' },
    { name: 'category', type: 'String', enum: ["IT & Software","Marketing","Facilities","Professional Services","Logistics","Other"], default: "Other" },
    { name: 'contactPerson', type: 'String' },
    { name: 'contactEmail', type: 'String' },
    { name: 'contactPhone', type: 'String' },
    { name: 'website', type: 'String' },
    { name: 'address', type: 'String' },
    { name: 'gstin', type: 'String' },
    { name: 'paymentTerms', type: 'String', enum: ["Net 15","Net 30","Net 45","Net 60","Advance","On Delivery"], default: "Net 30" },
    { name: 'currency', type: 'String', enum: ["INR","USD","EUR","GBP","AED"], default: "INR" },
    { name: 'rating', type: 'Number', default: 0 },
    { name: 'status', type: 'String', enum: ["Active","Inactive","On Hold","Blacklisted"], default: "Active" },
    { name: 'onboardedDate', type: 'Date' },
    { name: 'contractEnd', type: 'Date' },
    { name: 'notes', type: 'String' },
  ])
);
