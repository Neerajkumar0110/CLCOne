const { MANAGEMENT_ROLES } = require('../../../../config/roles');

// Who gets the admin view of Support (every module's tickets, every
// raiser, editable status): the existing MANAGEMENT_ROLES (owner/Super
// Admin/Admin/Sales Manager) PLUS the 'Support' role itself. Everyone else
// (Sales Executive, Finance, Team Manager, etc.) only ever sees tickets they
// personally raised.
const TICKET_FULL_ACCESS_ROLES = [...MANAGEMENT_ROLES, 'Support'];

function isTicketFullAccess(admin) {
  return TICKET_FULL_ACCESS_ROLES.includes(admin.role);
}

module.exports = { TICKET_FULL_ACCESS_ROLES, isTicketFullAccess };
