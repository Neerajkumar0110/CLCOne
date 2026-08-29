const mongoose = require('mongoose');
const { MANAGEMENT_ROLES } = require('@/config/roles');
const { emitNotification } = require('@/socket');

// Who sees a given notification, mirroring the same role-tier access rule
// already used server-side by dashboard/performance/report (see
// config/roles.js MANAGEMENT_ROLES) — extended with the one real exception
// in this app's permission model: Support/Tickets is intentionally open to
// every role (see frontend/src/config/defaultPermissionMatrix.js), so a
// ticket notification has to reach everyone the same way the ticket board
// itself does.
//
//   'management' — only MANAGEMENT_ROLES (owner, Super Admin, Admin, Sales
//                   Manager). For modules only they can see (Invoices,
//                   Payments, User Management).
//   'team'       — MANAGEMENT_ROLES plus everyone on `teamName`. For
//                   modules a team lead/member also has real access to
//                   (Leads).
//   'everyone'   — every enabled admin. For modules with no access
//                   restriction at all (Support).
async function resolveRecipients({ audience, teamName, excludeAdminId }) {
  const Admin = mongoose.model('Admin');

  if (audience === 'everyone') {
    const all = await Admin.find({ removed: false, enabled: true }).select('_id').lean();
    return all.map((a) => String(a._id)).filter((id) => id !== String(excludeAdminId));
  }

  const managementAdmins = await Admin.find({
    removed: false,
    enabled: true,
    role: { $in: MANAGEMENT_ROLES },
  })
    .select('_id')
    .lean();

  const ids = new Set(managementAdmins.map((a) => String(a._id)));

  if (audience === 'team' && teamName) {
    const Team = mongoose.model('Team');
    const team = await Team.findOne({ removed: false, name: teamName }).lean();
    if (team) {
      const teamAdmins = await Admin.find({ removed: false, enabled: true, name: { $in: team.members } })
        .select('_id')
        .lean();
      teamAdmins.forEach((a) => ids.add(String(a._id)));
    }
  }

  ids.delete(String(excludeAdminId));
  return [...ids];
}

// Fans a notification out to everyone in its audience. Never throws —
// notifications are a side effect of the real action (creating a lead,
// raising a ticket, ...), and a notify() failure shouldn't fail that action.
async function notify({ audience, teamName, actorId, actorName, module, type, title, body, link }) {
  try {
    const Notification = mongoose.model('Notification');
    const recipients = await resolveRecipients({ audience, teamName, excludeAdminId: actorId });
    if (recipients.length === 0) return;

    const docs = await Notification.insertMany(
      recipients.map((recipient) => ({ recipient, module, type, title, body, link, actorName }))
    );
    docs.forEach((doc) => emitNotification(doc));
  } catch (err) {
    console.error('notify() failed:', err.message);
  }
}

// Single-recipient variant — for events about one specific person's own
// thing (e.g. "your ticket was resolved") rather than a whole audience.
async function notifyUser({ recipient, actorId, actorName, module, type, title, body, link }) {
  try {
    if (String(recipient) === String(actorId)) return; // don't notify yourself of your own action
    const Notification = mongoose.model('Notification');
    const doc = await new Notification({ recipient, module, type, title, body, link, actorName }).save();
    emitNotification(doc);
  } catch (err) {
    console.error('notifyUser() failed:', err.message);
  }
}

module.exports = { notify, notifyUser };
