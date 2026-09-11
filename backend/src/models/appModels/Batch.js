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
  { name: 'classTime', type: 'String' },        // "10:00" (24h) — shown as "Start time"
  { name: 'endTime', type: 'String' },          // "11:00" (24h) — used to derive classDurationMin
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

// "HH:mm" (24h) -> minutes since midnight, or null if unparseable.
function toMinutes(hhmm) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || '').trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

// `name` self-generates from Course + Trainer (e.g. "Artificial Intelligence
// — Rohit Kushwaha") and is never shown as an input (see the `hidden` flag
// on its featureSections.js field spec) — this runs in pre('validate'),
// not pre('save'), because `name` is `required: true` and Mongoose runs
// validation *before* pre('save') hooks; filling it in any later would
// fail validation first. Uniqueness-checked with a "(2)", "(3)"… suffix
// since `name` is the string every other model matches a batch by
// (Student.batch, LmsBatchRoom.batchName, recurrence.js, …).
batchSchema.pre('validate', async function (next) {
  if (this.isNew && !this.name) {
    const base = [this.course, this.trainer].filter(Boolean).join(' — ') || 'New Batch';
    const Batch = mongoose.model('Batch');
    let candidate = base;
    let n = 1;
    // eslint-disable-next-line no-await-in-loop
    while (await Batch.exists({ name: candidate })) {
      n += 1;
      candidate = `${base} (${n})`;
    }
    this.name = candidate;
  }
  next();
});

// Additive: remember whether this save is an insert, then (best-effort)
// auto-create the batch's live class + meeting room. Never blocks the batch.
// Also — when both Start time (classTime) and End time (endTime) are set —
// keep classDurationMin (what recurrence.js/liveClassService.js actually
// read) in sync, so entering clock times "just works" without touching the
// scheduling code at all. `code` self-generates from the course — same
// pattern as Course.js — and is never shown as an input either.
batchSchema.pre('save', async function (next) {
  this.$locals.wasNew = this.isNew;
  if (this.isModified('classTime') || this.isModified('endTime')) {
    const start = toMinutes(this.classTime);
    const end = toMinutes(this.endTime);
    if (start != null && end != null && end > start) {
      this.classDurationMin = end - start;
    }
  }
  if (this.isNew && !this.code) {
    const initials = String(this.course || this.name || '')
      .split(/\s+/)
      .filter(Boolean)
      .map((w) => w[0])
      .join('')
      .toUpperCase()
      .slice(0, 4);
    const prefix = initials || 'BATCH';
    const count = await mongoose.model('Batch').countDocuments({});
    this.code = `${prefix}${100 + count}`;
  }
  next();
});
batchSchema.post('save', function (doc) {
  if (!this.$locals || !this.$locals.wasNew) return;
  Promise.resolve()
    .then(() => require('../../services/lms/liveClassService').onBatchCreated(doc))
    .catch((e) => console.error('[lms] onBatchCreated failed:', e && e.message));
});

// Delete (generic CRUD — controllers/middlewaresControllers/
// createCRUDController/remove.js) goes through findOneAndUpdate({$set:
// {removed:true}}), not .save(), so document hooks above never see it.
// Cascade the soft-delete to this batch's live-class sessions so a deleted
// batch's classes stop showing up for the teacher/student/admin — every
// listing query already filters removed:false, so this alone is enough.
batchSchema.post('findOneAndUpdate', function (doc) {
  const update = this.getUpdate() || {};
  const removedNow = update.$set && update.$set.removed === true;
  if (!removedNow || !doc) return;
  Promise.resolve()
    .then(() => mongoose.model('LmsLiveSession').updateMany({ batch: doc._id, removed: false }, { $set: { removed: true } }))
    .catch((e) => console.error('[lms] cascade batch delete -> sessions failed:', e && e.message));
});

module.exports = mongoose.model('Batch', batchSchema);
