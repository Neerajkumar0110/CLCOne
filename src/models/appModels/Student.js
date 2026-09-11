const mongoose = require('mongoose');
const { featureSchema } = require('../utils/featureSchema');

// Auto-CRUD model for a feature-section tab — list/create/update/delete come
// from the generic controller. Field spec mirrors config/featureSections.js.
//
// Additive: a new roster row also gets a real CRM login (Admin, role:
// 'Student') — see the post-save hook below + services/lms/studentAccountService.js.
const studentSchema = featureSchema([
    { name: 'name', type: 'String', required: true },
    { name: 'email', type: 'String', required: true },
    { name: 'phone', type: 'String' },
    { name: 'altPhone', type: 'String' },
    { name: 'city', type: 'String' },
    { name: 'course', type: 'String' },
    { name: 'batch', type: 'String' },
    { name: 'enrollmentId', type: 'String' },
    { name: 'enrolledOn', type: 'Date' },
    { name: 'status', type: 'String', enum: ["Active","On Hold","Completed","Dropped","Deferred"], default: "Active" },
    { name: 'progress', type: 'Number', default: 0 },
    { name: 'attendancePct', type: 'Number', default: 0 },
    { name: 'avgScore', type: 'Number', default: 0 },
    { name: 'feeTotal', type: 'Number', default: 0 },       // course fee, before GST
    { name: 'feeGrandTotal', type: 'Number', default: 0 },  // feeTotal * 1.18 (fixed 18% GST) — computed client-side, stored as-is
    { name: 'feePaid', type: 'Number', default: 0 },
    { name: 'feeDue', type: 'Number', default: 0 },         // feeGrandTotal - feePaid — computed client-side, stored as-is
    { name: 'feeStatus', type: 'String', enum: ["Paid","Partial","Unpaid","Waived"], default: "Unpaid" },
    { name: 'source', type: 'String', enum: ["Website","Referral","Walk-in","Ads","Counselor","Partner"], default: "Website" },
    { name: 'counselor', type: 'String' },
    { name: 'guardianName', type: 'String' },
    { name: 'guardianPhone', type: 'String' },
    { name: 'notes', type: 'String' },
  ]);

// Additive: remember whether this save is an insert, then (best-effort)
// auto-provision the student a real CRM login. Never blocks the roster row.
// Also fills in an Enrollment ID when none was typed, and keeps the GST
// total / balance due in sync with feeTotal + feePaid as a server-side
// safety net (the form already computes these live — see
// components/CrudTab's `compute` handling of config/featureSections.js —
// this just covers any save that didn't come through that form).
studentSchema.pre('save', async function (next) {
  this.$locals.wasNew = this.isNew;

  if (this.isNew && !this.enrollmentId) {
    // e.g. "Artificial Intelligence" -> "AI"; falls back to "STU" for a
    // blank/single-word course. Not strictly race-condition-free under
    // concurrent creates in the same course — fine for a display ID, not a
    // billing/legal identifier.
    const initials = String(this.course || '')
      .split(/\s+/)
      .filter(Boolean)
      .map((w) => w[0])
      .join('')
      .toUpperCase()
      .slice(0, 4);
    const prefix = initials || 'STU';
    const count = await mongoose.model('Student').countDocuments(this.course ? { course: this.course } : {});
    this.enrollmentId = `${prefix}${100 + count}`;
  }

  if (this.isModified('feeTotal') || this.isModified('feePaid') || this.isNew) {
    const base = Number(this.feeTotal) || 0;
    if (!this.feeGrandTotal) this.feeGrandTotal = Math.round(base * 1.18 * 100) / 100;
    const paid = Number(this.feePaid) || 0;
    if (!this.feeDue) this.feeDue = Math.max(0, Math.round((this.feeGrandTotal - paid) * 100) / 100);
  }

  // Batch.enrolled needs a recount whenever this student's batch changes —
  // capture the *previous* value here (before it's overwritten below) so
  // post-save can recount both the batch they left and the one they joined.
  this.$locals.batchTouched = this.isNew ? !!this.batch : this.isModified('batch');
  if (!this.isNew && this.isModified('batch')) {
    const prev = await mongoose.model('Student').findById(this._id).select('batch').lean();
    this.$locals.prevBatch = prev && prev.batch;
  }

  next();
});
studentSchema.post('save', function (doc) {
  if (!this.$locals) return;
  if (this.$locals.wasNew) {
    Promise.resolve()
      .then(() => require('../../services/lms/studentAccountService').onStudentCreated(doc))
      .catch((e) => console.error('[lms] onStudentCreated failed:', e && e.message));
  }
  if (this.$locals.batchTouched) {
    const batches = [doc.batch, this.$locals.prevBatch].filter(Boolean);
    if (batches.length) {
      Promise.resolve()
        .then(() => require('../../services/lms/studentAccountService').syncBatchEnrolledCounts(batches))
        .catch((e) => console.error('[lms] syncBatchEnrolledCounts failed:', e && e.message));
    }
  }
});

// The generic CRUD Edit/Delete paths (controllers/middlewaresControllers/
// createCRUDController/{update,remove}.js) go through Model.findOneAndUpdate
// directly, which the document-level pre/post('save') hooks above never
// see — this keeps Batch.enrolled accurate for edits (moving a student
// between batches) and soft-deletes too.
studentSchema.pre('findOneAndUpdate', async function (next) {
  const update = this.getUpdate() || {};
  if (Object.prototype.hasOwnProperty.call(update, 'batch') || Object.prototype.hasOwnProperty.call(update, 'removed')) {
    const prev = await this.model.findOne(this.getQuery()).select('batch').lean();
    this._prevBatch = prev && prev.batch;
    this._recountBatch = true;
  }
  next();
});
studentSchema.post('findOneAndUpdate', function (doc) {
  if (!this._recountBatch || !doc) return;
  const batches = [doc.batch, this._prevBatch].filter(Boolean);
  if (!batches.length) return;
  Promise.resolve()
    .then(() => require('../../services/lms/studentAccountService').syncBatchEnrolledCounts(batches))
    .catch((e) => console.error('[lms] syncBatchEnrolledCounts failed:', e && e.message));
});

module.exports = mongoose.model('Student', studentSchema);
