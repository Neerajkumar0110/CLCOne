const mongoose = require('mongoose');
const { featureSchema } = require('../utils/featureSchema');

// Auto-CRUD model for a feature-section tab — list/create/update/delete come
// from the generic controller. Field spec mirrors config/featureSections.js.
//
// `meetingLink` is kept as an OPTIONAL free-text field for backward
// compatibility only — it is NOT required and is hidden from the create form.
// The live-class meeting room is generated automatically (see the post-save
// hook + services/lms/liveClassService.js).
const batchSchema = featureSchema([
  { name: 'name', type: 'String', required: true },
  { name: 'code', type: 'String' },
  { name: 'course', type: 'String' },
  { name: 'mode', type: 'String', enum: ["Online","Offline","Hybrid"], default: "Online" },
  { name: 'trainer', type: 'String' },
  { name: 'coordinator', type: 'String' },
  { name: 'startDate', type: 'Date' },
  { name: 'endDate', type: 'Date' },
  { name: 'schedule', type: 'String' },
  // structured schedule (optional — recurrence.js also parses `schedule` text)
  { name: 'classDays', type: 'String' },        // "Mon,Wed,Fri"
  { name: 'classTime', type: 'String' },        // "10:00" (24h)
  { name: 'classDurationMin', type: 'Number', default: 60 },
  { name: 'seats', type: 'Number', default: 0 },
  { name: 'enrolled', type: 'Number', default: 0 },
  { name: 'waitlist', type: 'Number', default: 0 },
  { name: 'status', type: 'String', enum: ["Planned","Open for Enrollment","Running","Completed","Cancelled"], default: "Planned" },
  { name: 'completionRate', type: 'Number', default: 0 },
  { name: 'venue', type: 'String' },
  { name: 'meetingLink', type: 'String' }, // optional / legacy — auto room replaces it
  { name: 'notes', type: 'String' },
]);

// Additive: remember whether this save is an insert, then (best-effort)
// auto-create the batch's live class + meeting room. Never blocks the batch.
batchSchema.pre('save', function (next) {
  this.$locals.wasNew = this.isNew;
  next();
});
batchSchema.post('save', function (doc) {
  if (!this.$locals || !this.$locals.wasNew) return;
  Promise.resolve()
    .then(() => require('../../services/lms/liveClassService').onBatchCreated(doc))
    .catch((e) => console.error('[lms] onBatchCreated failed:', e && e.message));
});

module.exports = mongoose.model('Batch', batchSchema);
