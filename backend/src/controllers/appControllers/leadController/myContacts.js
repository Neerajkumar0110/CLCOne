const mongoose = require('mongoose');

// GET /api/lead/my-contacts?page=&items=
// The Calling › Dialer "Contacts" list for the logged-in agent:
//   - every lead assigned straight to them (`assignedUser`), regardless of
//     team — this is what lets an agent with no team still see their leads;
//   - PLUS their equal share of their team's pooled leads (`team` set,
//     `assignedUser` empty) — split as evenly as possible across the team's
//     members so a team-assigned lead shows to exactly one person here
//     instead of duplicating it to everyone on the team.
const myContacts = async (req, res) => {
  const Lead = mongoose.model('Lead');
  const Team = mongoose.model('Team');

  const page = parseInt(req.query.page) || 1;
  const items = Math.min(parseInt(req.query.items) || 5, 100);

  const mine = await Lead.find({ removed: false, assignedUser: req.admin._id })
    .sort({ created: -1 })
    .lean();

  const team = await Team.findOne({ removed: false, members: req.admin.name }).lean();

  let myShareOfPool = [];
  if (team && Array.isArray(team.members) && team.members.length > 0) {
    const myIndex = team.members.indexOf(req.admin.name);
    if (myIndex !== -1) {
      const pool = await Lead.find({
        removed: false,
        team: team.name,
        $or: [{ assignedUser: null }, { assignedUser: { $exists: false } }],
      })
        .sort({ _id: 1 })
        .lean();

      const n = team.members.length;
      myShareOfPool = pool.filter((_, i) => i % n === myIndex);
    }
  }

  const combined = [...mine, ...myShareOfPool].sort(
    (a, b) => new Date(b.created).getTime() - new Date(a.created).getTime()
  );

  const count = combined.length;
  const pages = Math.max(1, Math.ceil(count / items));
  const start = (page - 1) * items;
  const result = combined.slice(start, start + items);

  return res.status(200).json({
    success: true,
    result,
    pagination: { page, pages, count },
    message: 'ok',
  });
};

module.exports = myContacts;
