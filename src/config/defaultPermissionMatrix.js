import { PERMISSION_MODULES, FULL_ACCESS_ROLES } from "@/config/permissionModules";

// Roles that lead a team/desk — broad view/edit access short of the full-access tier.
const LEAD_TIER_ROLES = ["Team Manager", "Team Leader"];
// Individual-contributor roles — restricted to the modules they work in day to day.
const FRONTLINE_ROLES = ["Senior Executive", "Executive", "Team Coordinator", "Sales Intern"];

// The default permission matrix for a single role — the fallback every user
// of that role gets until an admin customizes it via Roles & Permissions.
// Shared by UserManagement (seeding role/user records) and permissionContext
// (so a brand-new user sees their role's real defaults on first login,
// instead of nothing, if no record has been seeded yet).
export function defaultMatrixForRole(role) {
  const perModule = {};
  const fullAccess = FULL_ACCESS_ROLES.includes(role);
  const isFinance = role === "Finance";

  PERMISSION_MODULES.forEach((mod) => {
    // Everyone can raise and see support tickets, regardless of role.
    if (mod === "Support") {
      perModule[mod] = { view: true, edit: true, delete: fullAccess };
      return;
    }

    const canView =
      fullAccess ||
      // Reports is restricted to full-access roles only (owner, Super Admin,
      // Admin, Sales Manager) — the backend /api/report/* endpoints enforce
      // this too (403 for anyone else), this just keeps the nav item honest.
      (LEAD_TIER_ROLES.includes(role) && mod !== "User Management" && mod !== "Payments" && mod !== "Reports") ||
      (FRONTLINE_ROLES.includes(role) && ["Dashboard", "Leads", "Calls"].includes(mod)) ||
      (isFinance && ["Dashboard", "Invoices", "Payments", "Finance"].includes(mod));

    const canEdit =
      fullAccess ||
      (LEAD_TIER_ROLES.includes(role) && canView) ||
      (isFinance && ["Invoices", "Payments", "Finance"].includes(mod));

    const canDelete = fullAccess;

    perModule[mod] = { view: canView, edit: canEdit, delete: canDelete };
  });

  return perModule;
}

export function buildDefaultMatrix(roleList) {
  const matrix = {};
  roleList.forEach((role) => {
    matrix[role] = defaultMatrixForRole(role);
  });
  return matrix;
}

// A matrix saved before a module existed (e.g. Finance, Support were added
// after some roles/users already had a saved Permission record) is missing
// that module's key entirely — reading `matrix[mod].view` on it throws.
// Backfills any missing module with that role's computed default so saved
// records are always safe to read from, regardless of when they were seeded.
export function fillMatrixDefaults(matrix, role) {
  const base = defaultMatrixForRole(role);
  const filled = { ...matrix };
  let changed = false;
  Object.keys(base).forEach((mod) => {
    if (!filled[mod]) {
      filled[mod] = base[mod];
      changed = true;
    }
  });
  return { matrix: filled, changed };
}
