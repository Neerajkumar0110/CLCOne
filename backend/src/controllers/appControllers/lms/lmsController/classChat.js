const mongoose = require('mongoose');
const liveClassService = require('../../../../services/lms/liveClassService');

// Class chat (design L4 "Chat" tab).
//   GET    /api/lms/live-classes/:id/chat?after=<ISO>   messages (oldest first, max 200)
//   POST   /api/lms/live-classes/:id/chat               { text }
//   DELETE /api/lms/live-classes/:id/chat/:msgId        PM / management only
// Only people resolveRole() lets into the class — its batch's learners, its
// Project Manager, management/Support — can read or write.

const ok = (res, result, message) => res.status(200).json({ success: true, result, message });
const bad = (res, code, message) => res.status(code).json({ success: false, result: null, message });
const lastPost = new Map(); // adminId -> ms, simple flood guard

async function access(req) {
  if (!mongoose.isValidObjectId(req.params.id)) return { err: [404, 'Class not found.'] };
  const session = await mongoose.model('LmsLiveSession').findOne({ _id: req.params.id, removed: { $ne: true } });
  if (!session) return { err: [404, 'Class not found.'] };
  const role = await liveClassService.resolveRole(session, req.admin);
  if (role !== 'student' && role !== 'teacher') return { err: [403, 'This chat is for this batch only.'] };
  return { session, role };
}

const shape = (m, me, role) => ({
  id: String(m._id),
  authorName: m.authorName,
  authorRole: m.authorRole,
  mine: String(m.author) === String(me._id),
  text: m.text,
  created: m.created,
  canDelete: role === 'teacher',
});

async function list(req, res) {
  const a = await access(req);
  if (a.err) return bad(res, ...a.err);
  const q = { liveSession: a.session._id, removed: false };
  const after = req.query.after ? new Date(req.query.after) : null;
  if (after && !Number.isNaN(after.getTime())) q.created = { $gt: after };
  const rows = await mongoose.model('LiveClassChat').find(q).sort({ created: -1 }).limit(200).lean();
  return ok(res, { messages: rows.reverse().map((m) => shape(m, req.admin, a.role)), role: a.role });
}

async function post(req, res) {
  const a = await access(req);
  if (a.err) return bad(res, ...a.err);
  const text = String((req.body && req.body.text) || '').trim();
  if (!text) return bad(res, 400, 'The message is empty.');
  if (text.length > 500) return bad(res, 400, 'Message 500 characters tak.');
  const key = String(req.admin._id);
  const now = Date.now();
  if (now - (lastPost.get(key) || 0) < 1500) return bad(res, 429, 'Thoda dheere — ek second ruk kar bhejein.');
  lastPost.set(key, now);
  const m = await new (mongoose.model('LiveClassChat'))({
    liveSession: a.session._id,
    author: req.admin._id,
    authorName: [req.admin.name, req.admin.surname].filter(Boolean).join(' '),
    authorRole: a.role,
    text,
  }).save();
  return ok(res, shape(m.toObject(), req.admin, a.role));
}

async function remove(req, res) {
  const a = await access(req);
  if (a.err) return bad(res, ...a.err);
  if (a.role !== 'teacher') return bad(res, 403, 'Sirf Project Manager message hata sakte hain.');
  if (!mongoose.isValidObjectId(req.params.msgId)) return bad(res, 404, 'Not found.');
  const r = await mongoose.model('LiveClassChat').updateOne({ _id: req.params.msgId, liveSession: a.session._id }, { $set: { removed: true, removedBy: req.admin._id } });
  if (!r.matchedCount) return bad(res, 404, 'Not found.');
  return ok(res, { id: req.params.msgId }, 'Removed.');
}

module.exports = { list, post, remove };
