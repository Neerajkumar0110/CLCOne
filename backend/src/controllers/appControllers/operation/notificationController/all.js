const mongoose = require('mongoose');
const { CRM_ADMIN_ROLES } = require('../../../../config/roles');

// GET /api/notification/all?limit=<n> — admins only: every user's
// notifications, newest first. One event fanned out to many people (e.g. a
// payment → every manager) shows once, with who received it and how many
// have read it.
const all = async (req, res) => {
  if (!CRM_ADMIN_ROLES.includes(req.admin.role)) {
    return res.status(403).json({ success: false, result: null, message: 'Admins only.' });
  }
  const Notification = mongoose.model('Notification');
  const limit = Math.min(parseInt(req.query.limit) || 150, 400);
  const rows = await Notification.find({ removed: false })
    .sort({ _id: -1 })
    .limit(limit * 6)
    .lean();
  const ids = [...new Set(rows.map((r) => String(r.recipient)))];
  const people = await mongoose.model('Admin').find({ _id: { $in: ids } }).select('name surname').lean();
  const nameOf = new Map(people.map((p) => [String(p._id), `${p.name || ''} ${p.surname || ''}`.trim()]));

  const groups = new Map();
  for (const r of rows) {
    const key = [r.type, r.title, r.body || '', r.link || '', Math.floor(new Date(r.created).getTime() / 10000)].join('|');
    let g = groups.get(key);
    if (!g) {
      g = { _id: String(r._id), module: r.module, type: r.type, title: r.title, body: r.body, link: r.link, actorName: r.actorName, created: r.created, recipients: [], readCount: 0 };
      groups.set(key, g);
    }
    g.recipients.push(nameOf.get(String(r.recipient)) || 'Unknown');
    if (r.readAt) g.readCount += 1;
  }
  return res.status(200).json({ success: true, result: [...groups.values()].slice(0, limit), message: 'ok' });
};

module.exports = all;
