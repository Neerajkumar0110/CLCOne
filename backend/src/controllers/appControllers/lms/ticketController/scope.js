const { CRM_ADMIN_ROLES } = require('../../../../config/roles');

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

module.exports = { TICKET_FULL_ACCESS_ROLES, isTicketFullAccess };
