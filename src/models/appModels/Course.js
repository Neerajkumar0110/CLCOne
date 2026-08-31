const mongoose = require('mongoose');
const { featureSchema } = require('../utils/featureSchema');

// Auto-CRUD model for a feature-section tab — list/create/update/delete come
// from the generic controller. Field spec mirrors config/featureSections.js.
module.exports = mongoose.model(
  'Course',
  featureSchema([
    { name: 'title', type: 'String', required: true },
    { name: 'code', type: 'String' },
    { name: 'category', type: 'String', enum: ["Aptitude","Technical","Communication","Interview Prep","Domain","Soft Skills","Certification"], default: "Technical" },
    { name: 'level', type: 'String', enum: ["Beginner","Intermediate","Advanced"], default: "Beginner" },
    { name: 'mode', type: 'String', enum: ["Self-paced","Cohort","Live","Blended"], default: "Cohort" },
    { name: 'language', type: 'String', enum: ["English","Hindi","Bilingual"], default: "English" },
    { name: 'durationHours', type: 'Number', default: 0 },
    { name: 'modules', type: 'Number', default: 0 },
    { name: 'lessons', type: 'Number', default: 0 },
    { name: 'price', type: 'Number', default: 0 },
    { name: 'discountPrice', type: 'Number', default: 0 },
    { name: 'currency', type: 'String', enum: ["INR","USD","EUR","GBP","AED"], default: "INR" },
    { name: 'instructor', type: 'String' },
    { name: 'status', type: 'String', enum: ["Draft","Published","Archived"], default: "Draft" },
    { name: 'publishedDate', type: 'Date' },
    { name: 'rating', type: 'Number', default: 0 },
    { name: 'enrolledCount', type: 'Number', default: 0 },
    { name: 'thumbnailUrl', type: 'String' },
    { name: 'prerequisites', type: 'String' },
    { name: 'outcomes', type: 'String' },
    { name: 'description', type: 'String' },
  ])
);
