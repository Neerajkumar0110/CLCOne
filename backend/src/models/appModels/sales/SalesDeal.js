const mongoose = require('mongoose');
const { featureSchema } = require('../../utils/featureSchema');

// Auto-CRUD model for a feature-section tab — list/create/update/delete come
// from the generic controller. Field spec mirrors config/featureSections.js.
module.exports = mongoose.model(
  'SalesDeal',
  featureSchema([
    { name: 'title', type: 'String', required: true },
    { name: 'account', type: 'String' },
    { name: 'contactName', type: 'String' },
    { name: 'contactEmail', type: 'String' },
    { name: 'contactPhone', type: 'String' },
    { name: 'pipeline', type: 'String', enum: ["Sales","Renewal","Upsell"], default: "Sales" },
    { name: 'stage', type: 'String', enum: ["Qualification","Needs Analysis","Proposal","Negotiation","Closed Won","Closed Lost"], default: "Qualification" },
    { name: 'amount', type: 'Number', default: 0 },
    { name: 'currency', type: 'String', enum: ["INR","USD","EUR","GBP","AED"], default: "INR" },
    { name: 'probability', type: 'Number', default: 0 },
    { name: 'expectedRevenue', type: 'Number', default: 0 },
    { name: 'closeDate', type: 'Date' },
    { name: 'owner', type: 'String' },
    { name: 'source', type: 'String', enum: ["Website","Referral","Cold Call","Event","Partner","Ads","Other"], default: "Other" },
    { name: 'competitors', type: 'String' },
    { name: 'lossReason', type: 'String', enum: ["","Price","Timing","Features","Competitor","No Budget","No Decision","Other"] },
    { name: 'nextStep', type: 'String' },
    { name: 'lastActivityDate', type: 'Date' },
    { name: 'tags', type: 'String' },
    { name: 'description', type: 'String' },
    // Set only on a deal auto-created/updated from a paid PaymentRequest
    // (services/payments/syncSalesDeal.js) — the correlation key (its
    // planGroupId, or its own _id for a one-off payment) so a later
    // installment on the SAME enrollment tops up this same deal instead of
    // creating a duplicate. Not shown in the Deals form — internal only.
    { name: 'paymentRequestPlanGroupId', type: 'String' },
  ])
);
