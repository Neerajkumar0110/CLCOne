const { CRM_ADMIN_ROLES } = require('../../../../config/roles');
const { RESTRICTED_TICKET_CATEGORY } = require('../../../../config/supportTickets');

// Who gets the admin view of Support (every module's tickets, every
// raiser, editable status): CRM_ADMIN_ROLES (owner/Super Admin/Admin) PLUS
// the 'Support' role itself. Everyone else (Sales Manager/Executive,
// Finance, Team Manager, etc.) only ever sees tickets they personally
// raised — tickets span every module (HRMS, Finance, LMS, ...), not just
// Sales, so this is deliberately built from CRM_ADMIN_ROLES, not
// MANAGEMENT_ROLES (see CRM_ADMIN_ROLES's comment in config/roles.js).
const TICKET_FULL_ACCESS_ROLES = [...CRM_ADMIN_ROLES, 'Support'];

function isTicketFullAccess(admin) {
  return TICKET_FULL_ACCESS_ROLES.includes(admin.role);
}

// A learner's "Policy / privacy (restricted)" ticket (design L9) is for
// authorised management only — the Support role doesn't see it.
function canSeeRestricted(admin) {
  return CRM_ADMIN_ROLES.includes(admin.role);
}

// Row-level visibility shared by list / read / counts / stats.
function scopeMatch(admin, match) {
  if (!isTicketFullAccess(admin)) match.createdBy = admin._id;
  else if (!canSeeRestricted(admin)) match.$and = [...(match.$and || []), { category: { $ne: RESTRICTED_TICKET_CATEGORY } }];
  return match;
}

module.exports = { TICKET_FULL_ACCESS_ROLES, isTicketFullAccess, canSeeRestricted, scopeMatch };
