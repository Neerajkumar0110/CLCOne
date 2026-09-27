const mongoose = require('mongoose');
const { resolveScope, requestedNarrowing, namesForTeam } = require('../../../../services/access/salesScope');

async function idsForNames(names) {
  if (!names || names.length === 0) return [];
  const Admin = mongoose.model('Admin');
  const admins = await Admin.find({ name: { $in: names }, removed: false }).select('_id').lean();
  return admins.map((a) => a._id);
}

// Client identifies its owner via two real ObjectId refs (createdBy,
// assigned) rather than a name string, so team-member names need one extra
// lookup to resolve to Admin _ids before they can be matched.
//
// `req` is optional, only consulted for a full-access caller — lets them
// narrow down to one team (`?team=`) or one person (`?agent=`), same
// resolve-name(s)-to-ids step as the default scoping below.
async function clientScopeFilter(admin, req) {
  const { isFullAccess, teamMemberNames } = await resolveScope(admin);
  if (isFullAccess) {
    const { team, agent } = requestedNarrowing(req);
    if (agent) {
      const ids = await idsForNames([agent]);
      return { $or: [{ createdBy: { $in: ids } }, { assigned: { $in: ids } }] };
    }
    if (team) {
      const ids = await idsForNames(await namesForTeam(team));
      return { $or: [{ createdBy: { $in: ids } }, { assigned: { $in: ids } }] };
    }
    return {};
  }

  const ids = await idsForNames(teamMemberNames);
  // Always include the caller's own id even if the name lookup above somehow
  // missed them (e.g. a display-name mismatch) — never fully lock someone
  // out of their own records.
  if (!ids.some((id) => String(id) === String(admin._id))) ids.push(admin._id);

  return { $or: [{ createdBy: { $in: ids } }, { assigned: { $in: ids } }] };
}

module.exports = { clientScopeFilter };
