const mongoose = require('mongoose');
const conversationIdFor = require('./conversationIdFor');
const { peopleFilter } = require('./chatScope');
const { getOnlineUserIds } = require('../../../../socket');

// GET /api/message/conversations — every other registered admin ("jitne
// register hai sab yaha par show ho"), each with their last message and
// unread count if a thread exists yet, so you can start a chat with anyone
// even before the first message is sent.
const conversations = async (req, res) => {
  const Admin = mongoose.model('Admin');
  const Message = mongoose.model('Message');

  const others = await Admin.find({ _id: { $ne: req.admin._id }, removed: false, enabled: true, ...peopleFilter(req.admin) })
    .select('name surname photo role reportsTo')
    .lean();

  // Position for the list: role + team (+ who they report to), so people
  // know whom to message.
  const teams = await mongoose.model('Team').find({ removed: false }).select('name members').lean();
  const teamOf = (o) => {
    const keys = [String(o.name || '').trim().toLowerCase(), `${o.name || ''} ${o.surname || ''}`.trim().toLowerCase()];
    const t = teams.find((x) => (x.members || []).some((m) => keys.includes(String(m).trim().toLowerCase())));
    return t ? t.name : null;
  };
  const nameById = new Map(others.map((o) => [String(o._id), `${o.name || ''} ${o.surname || ''}`.trim()]));
  const bossIds = [...new Set(others.map((o) => o.reportsTo && String(o.reportsTo)).filter((id) => id && !nameById.has(id)))];
  if (bossIds.length) {
    const bosses = await Admin.find({ _id: { $in: bossIds } }).select('name surname').lean();
    bosses.forEach((b) => nameById.set(String(b._id), `${b.name || ''} ${b.surname || ''}`.trim()));
  }
  for (const o of others) {
    o.team = teamOf(o);
    o.reportsToName = o.reportsTo ? nameById.get(String(o.reportsTo)) || null : null;
    delete o.reportsTo;
  }

  const onlineIds = new Set(getOnlineUserIds());

  const results = await Promise.all(
    others.map(async (o) => {
      const conversationId = conversationIdFor(req.admin._id, o._id);
      const [lastMessage, unreadCount] = await Promise.all([
        Message.findOne({ removed: false, conversationId }).sort({ created: -1 }).lean(),
        Message.countDocuments({ removed: false, conversationId, to: req.admin._id, readAt: null }),
      ]);
      return {
        user: o,
        online: onlineIds.has(String(o._id)),
        lastMessage: lastMessage || null,
        unreadCount,
      };
    })
  );

  // Anyone with message history floats to the top, most-recent first;
  // everyone else (no history yet) follows alphabetically.
  results.sort((a, b) => {
    const at = a.lastMessage ? new Date(a.lastMessage.created).getTime() : 0;
    const bt = b.lastMessage ? new Date(b.lastMessage.created).getTime() : 0;
    if (at !== bt) return bt - at;
    return a.user.name.localeCompare(b.user.name);
  });

  return res.status(200).json({
    success: true,
    result: results,
    message: 'Successfully found conversations',
  });
};

module.exports = conversations;
