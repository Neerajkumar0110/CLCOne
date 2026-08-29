// Single source of truth for selectable Admin roles on the frontend.
// Mirrored at backend/src/config/roles.js — the two packages can't share a
// literal import, so keep them in sync by hand when this changes.
//
// "Super Admin" is intentionally excluded — there's exactly one Super Admin
// account (provisioned outside this UI, see backend/src/setup/setup.js) and
// it's never picked from a dropdown. Roles that still recognize it (display,
// permission bypass) read KNOWN_NON_SELECTABLE_ROLES separately below.
export const ROLES = [
  "Admin",
  "Sales Manager",
  "Team Manager",
  "Team Leader",
  "Team Coordinator",
  "Senior Executive",
  "Executive",
  "Sales Intern",
  "Finance",
];

// Roles whose accounts exist but are never offered in the role dropdown.
export const KNOWN_NON_SELECTABLE_ROLES = ["owner", "Super Admin"];

// Shown as a second dropdown only when the selected role is "Finance".
export const FINANCE_SUB_ROLES = ["Finance Manager", "Finance Executive", "Finance Support"];

// Roles that lead a team — get the "create a new team" option and, once they
// lead one, a read-only view of it instead of a plain team picker.
export const MANAGER_TEAM_ROLES = ["Team Leader"];

// Roles with no team concept at all — the Team field is hidden entirely for them.
export const NO_TEAM_FIELD_ROLES = ["Admin", "Sales Manager", "Team Manager"];

// Roles with nothing worth editing (no team, role change not meant to happen
// from this UI) — the Edit action is hidden entirely for them in All Users.
export const NO_EDIT_ROLES = [...KNOWN_NON_SELECTABLE_ROLES, "Admin", "Sales Manager"];

// Roles ranked below Team Manager — the pool a manager can assign into their team.
export const BELOW_TEAM_MANAGER_ROLES = [
  "Team Leader",
  "Team Coordinator",
  "Senior Executive",
  "Executive",
  "Sales Intern",
];

// Old role names that no longer exist, mapped to their closest new
// equivalent — purely for display of users created before this rename.
export const ROLE_ALIASES = {
  "Senior Agent": "Senior Executive",
  Agent: "Executive",
  "Sales Person": "Executive",
  "Sales Admin": "Sales Intern",
};

export const DEFAULT_FALLBACK_ROLE = "Executive";
