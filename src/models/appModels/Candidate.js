const mongoose = require('mongoose');
const { featureSchema } = require('../utils/featureSchema');

// Auto-CRUD model for a feature-section tab — list/create/update/delete come
// from the generic controller. Field spec mirrors config/featureSections.js.
module.exports = mongoose.model(
  'Candidate',
  featureSchema([
    { name: 'name', type: 'String', required: true },
    { name: 'email', type: 'String' },
    { name: 'phone', type: 'String' },
    { name: 'role', type: 'String' },
    { name: 'department', type: 'String', enum: ["Sales","Marketing","Operations","Engineering","HR","Finance","Support","Training","Admin"] },
    { name: 'stage', type: 'String', enum: ["Applied","Screening","Shortlisted","Interview","Assessment","Offer","Hired","Rejected","On Hold","Withdrawn"], default: "Applied" },
    { name: 'source', type: 'String', enum: ["Job Portal","Referral","LinkedIn","Career Page","Agency","Walk-in","Campus"], default: "Job Portal" },
    { name: 'currentCompany', type: 'String' },
    { name: 'currentCtc', type: 'Number', default: 0 },
    { name: 'expectedCtc', type: 'Number', default: 0 },
    { name: 'noticePeriodDays', type: 'Number', default: 0 },
    { name: 'experienceYears', type: 'Number', default: 0 },
    { name: 'location', type: 'String' },
    { name: 'appliedOn', type: 'Date' },
    { name: 'interviewDate', type: 'Date' },
    { name: 'recruiter', type: 'String' },
    { name: 'rating', type: 'Number', default: 0 },
    { name: 'resumeUrl', type: 'String' },
    { name: 'feedback', type: 'String' },
  ])
);
