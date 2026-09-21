const mongoose = require('mongoose');

// Ported from python-test-platform's src/controllers/curriculumController.js
// (Prisma -> Mongoose). Distinct from this codebase's existing (unrelated)
// Course/Module/Chapter/Lesson curriculum builder — this is a syllabus
// session-by-session delivery tracker, keyed by track + batch.

async function getSessions(req, res) {
  try {
    const { batch, track } = req.query;
    if (!batch) {
      return res.status(400).json({ success: false, message: 'batch query param is required.' });
    }

    const AssessmentCurriculumSession = mongoose.model('AssessmentCurriculumSession');
    const AssessmentDeliveryRecord = mongoose.model('AssessmentDeliveryRecord');

    const sessions = await AssessmentCurriculumSession.find(track ? { track } : {})
      .sort({ order: 1 })
      .lean();

    const records = await AssessmentDeliveryRecord.find({
      sessionId: { $in: sessions.map((s) => s._id) },
      batch,
    }).lean();
    const recordBySessionId = new Map(records.map((r) => [String(r.sessionId), r]));

    const result = sessions.map((s) => {
      const record = recordBySessionId.get(String(s._id)) || null;
      return {
        sessionId: s._id,
        code: s.code,
        unit: s.unit,
        track: s.track,
        title: s.title,
        hours: s.hours,
        order: s.order,
        status: record?.status || 'PENDING',
        plannedDate: record?.plannedDate || null,
        actualDate: record?.actualDate || null,
        notes: record?.notes || null,
      };
    });

    const delivered = result.filter((r) => r.status === 'DELIVERED').length;
    const total = result.length;

    return res.status(200).json({
      success: true,
      result: {
        batch,
        sessions: result,
        progress: { delivered, total, percent: total > 0 ? Math.round((delivered / total) * 100) : 0 },
      },
    });
  } catch (err) {
    console.error('Get curriculum sessions error:', err);
    return res.status(500).json({ success: false, message: 'Something went wrong. Please try again.' });
  }
}

async function updateDelivery(req, res) {
  try {
    const { sessionId } = req.params;
    const { batch, status, plannedDate, actualDate, notes } = req.body;

    if (!batch) {
      return res.status(400).json({ success: false, message: 'batch is required.' });
    }

    const AssessmentCurriculumSession = mongoose.model('AssessmentCurriculumSession');
    const AssessmentDeliveryRecord = mongoose.model('AssessmentDeliveryRecord');

    const session = await AssessmentCurriculumSession.findById(sessionId);
    if (!session) {
      return res.status(404).json({ success: false, message: 'Session not found.' });
    }

    const data = { updatedAt: new Date() };
    if (status !== undefined) data.status = status;
    if (plannedDate !== undefined) data.plannedDate = plannedDate ? new Date(plannedDate) : null;
    if (actualDate !== undefined) data.actualDate = actualDate ? new Date(actualDate) : null;
    if (notes !== undefined) data.notes = notes;

    // If marking delivered and no actualDate explicitly provided, default to now.
    if (status === 'DELIVERED' && actualDate === undefined) {
      data.actualDate = new Date();
    }

    // $set and $setOnInsert must not target the same field (Mongo rejects
    // that as a path conflict) — `status` only goes into $setOnInsert when
    // it's not already present in $set.
    const setOnInsert = { sessionId, batch };
    if (data.status === undefined) setOnInsert.status = 'PENDING';

    const record = await AssessmentDeliveryRecord.findOneAndUpdate(
      { sessionId, batch },
      { $set: data, $setOnInsert: setOnInsert },
      { upsert: true, new: true }
    );

    return res.status(200).json({ success: true, result: { record } });
  } catch (err) {
    console.error('Update delivery error:', err);
    return res.status(500).json({ success: false, message: 'Something went wrong. Please try again.' });
  }
}

module.exports = { getSessions, updateDelivery };
