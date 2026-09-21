const mongoose = require('mongoose');

// Ported from python-test-platform (Prisma model `DeliveryRecord`) — per-batch
// delivery status of one AssessmentCurriculumSession.
const schema = new mongoose.Schema({
  _id: { type: String },
  sessionId: { type: String, required: true, index: true },
  batch: { type: String, required: true },
  status: { type: String, enum: ['PENDING', 'DELIVERED', 'SKIPPED'], default: 'PENDING' },
  plannedDate: { type: Date },
  actualDate: { type: Date },
  notes: { type: String },
  updatedAt: { type: Date, default: Date.now },
});

schema.index({ sessionId: 1, batch: 1 }, { unique: true });
schema.index({ batch: 1 });

module.exports = mongoose.model('AssessmentDeliveryRecord', schema);
