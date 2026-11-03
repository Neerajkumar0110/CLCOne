const mongoose = require('mongoose');

// Private per-class notes (design L4 "Notes" tab).
//   GET /api/lms/live-classes/:id/my-note
//   POST /api/lms/live-classes/:id/my-note  { text }
// Always scoped to the caller — nobody can read or write another person's note.

const ok = (res, result) => res.status(200).json({ success: true, result });
const bad = (res, code, message) => res.status(code).json({ success: false, result: null, message });

async function sessionExists(id) {
  if (!mongoose.isValidObjectId(id)) return false;
  return !!(await mongoose.model('LmsLiveSession').exists({ _id: id }));
}

async function getMine(req, res) {
  if (!(await sessionExists(req.params.id))) return bad(res, 404, 'Class not found.');
  const note = await mongoose.model('LiveClassNote').findOne({ liveSession: req.params.id, owner: req.admin._id }).lean();
  return ok(res, { text: (note && note.text) || '', updated: note ? note.updated : null });
}

async function saveMine(req, res) {
  if (!(await sessionExists(req.params.id))) return bad(res, 404, 'Class not found.');
  const text = String((req.body && req.body.text) || '');
  if (text.length > 20000) return bad(res, 400, 'Notes are limited to 20,000 characters.');
  const now = new Date();
  const note = await mongoose
    .model('LiveClassNote')
    .findOneAndUpdate(
      { liveSession: req.params.id, owner: req.admin._id },
      { $set: { text, updated: now }, $setOnInsert: { created: now } },
      { upsert: true, new: true }
    )
    .lean();
  return ok(res, { text: note.text, updated: note.updated });
}

module.exports = { getMine, saveMine };
