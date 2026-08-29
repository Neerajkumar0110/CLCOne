// Single source of truth for Admin roles on the backend.
// Mirrored at frontend/src/config/roles.js — the two can't share a literal
// import across packages, so keep them in sync by hand when this changes.
const ROLES = [
  'owner',
  'Super Admin',
  'Admin',
  'Sales Manager',
  'Team Manager',
  'Senior Executive',
  'Executive',
  'Team Coordinator',
  'Team Leader',
  'Sales Intern',
  'Finance',
];

// Only shown/stored when role === 'Finance'.
const FINANCE_SUB_ROLES = ['Finance Manager', 'Finance Executive', 'Finance Support'];

// 'owner' is the account backend/src/setup/setup.js bootstraps — it's the
// same tier as 'Super Admin' and the two together may only have one holder.
const SUPER_ADMIN_ROLES = ['owner', 'Super Admin'];

// Who is allowed to create a user of a given role (backend/src/controllers/
// middlewaresControllers/createUserController/create.js and update.js).
const ADMIN_CREATOR_ROLES = SUPER_ADMIN_ROLES;
const STAFF_CREATOR_ROLES = [...SUPER_ADMIN_ROLES, 'Admin'];

// Roles that see company-wide data in Dashboard/Performance by default, and
// may narrow it down with team/agent filters. Everyone else is force-scoped
// server-side to their own team (or just themselves, if not on one).
// Mirrors frontend's FULL_ACCESS_ROLES (frontend/src/config/permissionModules.js)
// — the two can't share a literal import across packages, keep in sync by hand.
const MANAGEMENT_ROLES = ['owner', 'Super Admin', 'Admin', 'Sales Manager'];

module.exports = {
  ROLES,
  FINANCE_SUB_ROLES,
  SUPER_ADMIN_ROLES,
  ADMIN_CREATOR_ROLES,
  STAFF_CREATOR_ROLES,
  MANAGEMENT_ROLES,
};
