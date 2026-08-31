const mongoose = require('mongoose');
const { featureSchema } = require('../utils/featureSchema');

// Auto-CRUD model for a feature-section tab — list/create/update/delete come
// from the generic controller. Field spec mirrors config/featureSections.js.
module.exports = mongoose.model(
  'AttendanceRecord',
  featureSchema([
    { name: 'student', type: 'String', required: true },
    { name: 'batch', type: 'String' },
    { name: 'course', type: 'String' },
    { name: 'sessionTopic', type: 'String' },
    { name: 'date', type: 'Date' },
    { name: 'status', type: 'String', enum: ["Present","Absent","Late","Left Early","Excused"], default: "Present" },
    { name: 'joinTime', type: 'String' },
    { name: 'leaveTime', type: 'String' },
    { name: 'durationMin', type: 'Number', default: 0 },
    { name: 'markedBy', type: 'String', enum: ["Auto","Manual"], default: "Manual" },
    { name: 'remarks', type: 'String' },
  ])
);
