const mongoose = require('mongoose');

// Team Chat groups (LMS testing report #40): create (staff), list mine,
// open the thread, send, change members. A learner only ever sees groups
// they are a member of.

const M = (n) => mongoose.model(n);
const ok = (res, result, message) => res.status(200).json({ success: true, result, message });
const bad = (res, code, message) => res.status(code).json({ success: false, result: null, message });
const nameOf = (a) => [a && a.name, a && a.surname].filter(Boolean).join(' ') || (a && a.email) || 'user';
const CREATORS = ['owner', 'Super Admin', 'Admin', 'Support', 'Teacher'];
const isAdmin = (a) => ['owner', 'Super Admin', 'Admin'].includes(a && a.role);
const mine = (g, me) => (g.members || []).some((m) => String(m) === String(me));

async function loadGroup(req, res) {
  if (!mongoose.isValidObjectId(req.params.id)) return bad(res, 404, 'Group not found.') && null;
  const g = await M('ChatGroup').findOne({ _id: req.params.id, removed: false });
  if (!g) return bad(res, 404, 'Group not found.') && null;
  if (!mine(g, req.admin._id) && !isAdmin(req.admin)) return bad(res, 403, 'You are not in this group.') && null;
  return g;
}

// GET /api/message/groups
async function list(req, res) {
  const q = { removed: false, members: req.admin._id };
  const groups = await M('ChatGroup').find(q).sort({ lastMessageAt: -1, created: -1 }).lean();
  const Message = M('Message');
  const out = await Promise.all(
    groups.map(async (g) => {
      const read = (g.reads || []).find((r) => String(r.user) === String(req.admin._id));
      const [last, unread] = await Promise.all([
        Message.findOne({ removed: false, group: g._id }).sort({ created: -1 }).lean(),
        Message.countDocuments({ removed: false, group: g._id, from: { $ne: req.admin._id }, created: { $gt: (read && read.at) || new Date(0) } }),
      ]);
      return { id: String(g._id), name: g.name, batch: g.batch || '', members: (g.members || []).length, createdByName: g.createdByName, isOwner: String(g.createdBy) === String(req.admin._id), lastMessage: last ? { text: last.text || (last.attachment ? `📎 ${last.attachment.fileName || 'file'}` : ''), at: last.created } : null, unread };
    })
  );
  return ok(res, { groups: out, canCreate: CREATORS.includes(req.admin.role) });
}

// POST /api/message/groups { name, memberIds, batch }
async function create(req, res) {
  if (!CREATORS.includes(req.admin.role)) return bad(res, 403, 'Only Teachers, Support and admins can create groups.');
  const b = req.body || {};
  const name = String(b.name || '').trim().slice(0, 80);
  if (name.length < 2) return bad(res, 400, 'Name the group.');
  const ids = new Set([String(req.admin._id), ...(Array.isArray(b.memberIds) ? b.memberIds : []).filter((x) => mongoose.isValidObjectId(x)).map(String)]);
  let batch = '';
  if (b.batch) {
    batch = String(b.batch).slice(0, 80);
    const learners = await require('../../../../services/lms/growth/access').learnersOf([batch]);
    learners.forEach((l) => ids.add(String(l._id)));
  }
  const real = await M('Admin').find({ _id: { $in: [...ids] }, removed: false }).select('_id').lean();
  if (real.length < 2) return bad(res, 400, 'Add at least one other member (or a batch).');
  const g = await M('ChatGroup').create({ name, batch: batch || undefined, members: real.map((a) => a._id), createdBy: req.admin._id, createdByName: nameOf(req.admin), reads: [{ user: req.admin._id, at: new Date() }] });
  return ok(res, { id: String(g._id), members: real.length }, `Group "${name}" created with ${real.length} members.`);
}

// GET /api/message/groups/:id/thread?before=
async function thread(req, res) {
  const g = await loadGroup(req, res);
  if (!g) return;
  const q = { removed: false, group: g._id };
  if (req.query.before) q.created = { $lt: new Date(req.query.before) };
  const rows = await M('Message').find(q).sort({ created: -1 }).limit(100).lean();
  const people = await M('Admin').find({ _id: { $in: g.members } }).select('name surname role').lean();
  const nameBy = new Map(people.map((a) => [String(a._id), nameOf(a)]));
  // mark read
  await M('ChatGroup').updateOne({ _id: g._id }, { $pull: { reads: { user: req.admin._id } } });
  await M('ChatGroup').updateOne({ _id: g._id }, { $push: { reads: { user: req.admin._id, at: new Date() } } });
  return ok(res, {
    group: { id: String(g._id), name: g.name, batch: g.batch || '', isOwner: String(g.createdBy) === String(req.admin._id) || isAdmin(req.admin), members: people.map((a) => ({ id: String(a._id), name: nameOf(a), role: a.role })) },
    messages: rows.reverse().map((m) => ({ ...m, fromName: nameBy.get(String(m.from)) || 'Former member' })),
  });
}

// POST /api/message/groups/:id/send { text }
async function send(req, res) {
  const g = await loadGroup(req, res);
  if (!g) return;
  if (!mine(g, req.admin._id)) return bad(res, 403, 'Join the group to write in it.');
  const text = String((req.body || {}).text || '').trim();
  if (!text) return bad(res, 400, 'Type a message.');
  const msg = await M('Message').create({ conversationId: `g_${g._id}`, group: g._id, from: req.admin._id, text: text.slice(0, 4000) });
  await M('ChatGroup').updateOne({ _id: g._id }, { $set: { lastMessageAt: msg.created, updated: new Date() } });
  // live to every member (their open thread / unread badge refresh)
  try {
    const { emitLmsToUsers } = require('../../../../socket');
    if (emitLmsToUsers) emitLmsToUsers(g.members.map(String), 'group:message', { groupId: String(g._id), from: String(req.admin._id) });
  } catch (e) {
    /* polling picks it up */
  }
  return ok(res, { ...msg.toObject(), fromName: nameOf(req.admin) });
}

// POST /api/message/groups/:id/members { add: [ids], remove: [ids], batch? }
async function members(req, res) {
  const g = await loadGroup(req, res);
  if (!g) return;
  if (String(g.createdBy) !== String(req.admin._id) && !isAdmin(req.admin) && req.admin.role !== 'Support') return bad(res, 403, 'Only the group owner, Support or an admin can change members.');
  const b = req.body || {};
  const set = new Set((g.members || []).map(String));
  (Array.isArray(b.add) ? b.add : []).filter((x) => mongoose.isValidObjectId(x)).forEach((x) => set.add(String(x)));
  if (b.batch) (await require('../../../../services/lms/growth/access').learnersOf([String(b.batch)])).forEach((l) => set.add(String(l._id)));
  (Array.isArray(b.remove) ? b.remove : []).forEach((x) => { if (String(x) !== String(g.createdBy)) set.delete(String(x)); });
  g.members = [...set];
  g.updated = new Date();
  await g.save();
  return ok(res, { members: g.members.length }, 'Members updated.');
}

module.exports = { groupList: list, groupCreate: create, groupThread: thread, groupSend: send, groupMembers: members };
