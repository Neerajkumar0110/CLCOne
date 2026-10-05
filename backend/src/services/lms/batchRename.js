const mongoose = require('mongoose');

// Every place a batch is referenced by its raw name STRING rather than its
// ObjectId — this is why featureSections.js's Batch Name field is
// `lockOnEdit`: a plain rename through the generic CRUD update would
// silently orphan every one of these. Keep in sync with any new model that
// adds its own `batch`/`batchName` string field.
const BATCH_NAME_REFS = [
  ['LiveRecording', 'batchName'],
  ['BatchChapterProgress', 'batchName'],
  ['LmsLiveSession', 'batchName'],
  ['LmsBatchRoom', 'batchName'],
  ['StudyMaterial', 'batch'],
  ['Project', 'batch'],
  ['Assignment', 'batch'],
  ['AssessmentDeliveryRecord', 'batch'],
  ['Student', 'batch'],
  ['Quiz', 'batch'],
  ['PolicyDocument', 'batch'],
  ['LmsAnnouncement', 'batch'],
  ['LiveClass', 'batch'],
  ['Certificate', 'batch'],
  ['AttendanceRecord', 'batch'],
];

// Renames a batch and cascades the new name to every record above that
// still matched it by the old string — manager/Support only (see the route).
async function renameBatch(batchId, newNameRaw, admin) {
  const Batch = mongoose.model('Batch');
  const batch = await Batch.findById(batchId);
  if (!batch || batch.removed) return { error: 404, message: 'Batch not found.' };

  const newName = String(newNameRaw || '').trim();
  if (!newName) return { error: 400, message: 'A batch name is required.' };
  if (newName === batch.name) return { result: { name: batch.name, oldName: batch.name, updated: {} } };

  const clash = await Batch.findOne({ _id: { $ne: batch._id }, name: newName, removed: false });
  if (clash) return { error: 409, message: `Another batch is already named "${newName}".` };

  const oldName = batch.name;
  batch.name = newName;
  await batch.save();

  const updated = {};
  for (const [modelName, field] of BATCH_NAME_REFS) {
    // eslint-disable-next-line no-await-in-loop
    const res = await mongoose.model(modelName).updateMany({ [field]: oldName }, { $set: { [field]: newName } });
    if (res.modifiedCount) updated[modelName] = res.modifiedCount;
  }

  try {
    await require('./auditLog').record({
      module: 'batch',
      action: 'rename',
      entityType: 'Batch',
      entityId: batch._id,
      admin,
      before: { name: oldName },
      after: { name: newName, cascaded: updated },
    });
  } catch (e) {
    /* best-effort */
  }

  return { result: { name: batch.name, oldName, updated } };
}

module.exports = { renameBatch, BATCH_NAME_REFS };
