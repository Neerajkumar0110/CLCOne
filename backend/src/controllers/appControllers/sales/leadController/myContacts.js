const mongoose = require('mongoose');

// GET /api/lead/my-contacts?page=&items=&stage=&owner=&q=
// The Calling › Dialer "Contacts" list for the logged-in agent:
//   - every lead assigned straight to them (`assignedUser`), regardless of
//     team — this is what lets an agent with no team still see their leads;
//   - PLUS their equal share of their team's pooled leads (`team` set,
//     `assignedUser` empty) — split as evenly as possible across the team's
//     members so a team-assigned lead shows to exactly one person here
//     instead of duplicating it to everyone on the team.
// Filters run over the WHOLE list (not just the visible page):
//   stage=<stage name>          — one pipeline stage
//   owner=given | pool          — given = made my lead by management through
//                                 Lead Owner (latest ownerHistory entry is me);
//                                 pool = my share of the team pool
//   q=<text>                    — name / phone contains
// Each row carries `givenByName` / `givenAt` when management gave it to me.
// `result.stageCounts` / `ownerCounts` count the list before the stage/owner
// filters, so the dropdowns can show how many each option holds.
const escapeRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const myContacts = async (req, res) => {
  const Lead = mongoose.model('Lead');
  const Team = mongoose.model('Team');

  const page = parseInt(req.query.page) || 1;
  const items = Math.min(parseInt(req.query.items) || 5, 100);
  const stage = String(req.query.stage || '').trim();
  const owner = ['given', 'pool'].includes(req.query.owner) ? req.query.owner : '';
  const q = String(req.query.q || '').trim();

  const textFilter = q
    ? { $or: [{ name: { $regex: escapeRe(q), $options: 'i' } }, { phone: { $regex: escapeRe(q.replace(/\D/g, '') || q) } }] }
    : {};

  const mine = await Lead.find({ removed: false, assignedUser: req.admin._id, ...textFilter })
    .sort({ created: -1 })
    .lean();

  const team = await Team.findOne({ removed: false, members: req.admin.name }).lean();

  let myShareOfPool = [];
  if (team && Array.isArray(team.members) && team.members.length > 0) {
    const myIndex = team.members.indexOf(req.admin.name);
    if (myIndex !== -1) {
      // Split decided over the whole pool (no text filter) so the share is
      // stable; the search is applied after.
      const pool = await Lead.find({
        removed: false,
        team: team.name,
        $or: [{ assignedUser: null }, { assignedUser: { $exists: false } }],
      })
        .sort({ _id: 1 })
        .lean();

      const n = team.members.length;
      myShareOfPool = pool.filter((_, i) => i % n === myIndex);
      if (q) {
        const re = new RegExp(escapeRe(q), 'i');
        const digits = q.replace(/\D/g, '');
        myShareOfPool = myShareOfPool.filter((l) => re.test(l.name || '') || (digits && String(l.phone || '').includes(digits)));
      }
    }
  }

  const me = String(req.admin._id);
  const tag = (l, fromPool) => {
    const last = Array.isArray(l.ownerHistory) && l.ownerHistory.length ? l.ownerHistory[l.ownerHistory.length - 1] : null;
    const given = !fromPool && last && String(last.to || '') === me;
    return {
      ...l,
      ownerHistory: undefined,
      stageHistory: undefined,
      callHistory: undefined,
      fromPool,
      givenByName: given ? last.byName || 'Management' : null,
      givenAt: given ? last.at : null,
    };
  };

  const combined = [...mine.map((l) => tag(l, false)), ...myShareOfPool.map((l) => tag(l, true))].sort(
    (a, b) => new Date(b.givenAt || b.created).getTime() - new Date(a.givenAt || a.created).getTime()
  );

  const ownerOf = (l) => (l.fromPool ? 'pool' : l.givenByName ? 'given' : 'mine');
  const stageCounts = {};
  const ownerCounts = { all: 0, given: 0, pool: 0 };
  for (const l of combined) {
    if (!owner || ownerOf(l) === owner) stageCounts[l.stage || 'New Lead'] = (stageCounts[l.stage || 'New Lead'] || 0) + 1;
    if (!stage || l.stage === stage) {
      ownerCounts.all += 1;
      if (ownerOf(l) !== 'mine') ownerCounts[ownerOf(l)] += 1;
    }
  }

  const filtered = combined.filter((l) => (!stage || l.stage === stage) && (!owner || ownerOf(l) === owner));

  const count = filtered.length;
  const pages = Math.max(1, Math.ceil(count / items));
  const start = (page - 1) * items;
  const result = filtered.slice(start, start + items);

  return res.status(200).json({
    success: true,
    result,
    pagination: { page, pages, count },
    stageCounts,
    ownerCounts,
    message: 'ok',
  });
};

module.exports = myContacts;
