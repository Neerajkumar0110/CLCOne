import { PERMISSION_MODULES, FULL_ACCESS_ROLES } from "@/config/permissionModules";

// Roles that lead a team/desk — broad view/edit access short of the full-access tier.
const LEAD_TIER_ROLES = ["Team Manager", "Team Leader"];
// Individual-contributor roles — restricted to the modules they work in day to day.
const FRONTLINE_ROLES = ["Senior Executive", "Executive", "Sales Intern"];
// Sales department head — full visibility across the whole sales org chart
// (enforced server-side, see MANAGEMENT_ROLES in salesHierarchy.js/
// salesScope.js/performanceController.js), but scoped to Sales-relevant
// modules only, same spirit as FRONTLINE_ROLES — plus User Management, since
// she's the one expected to add Sales hires and set up their "Reports To"
// chain. NOT the same as a true CRM admin (owner/Super Admin/Admin): no
// LMS/HRMS/Finance/Marketing/Operations access.
const SALES_MANAGER_MODULES = ["Dashboard", "Sales", "Calling", "Payments", "Reports", "Performance", "User Management"];
// Team Manager gets the same User Management grant as Sales Manager — she
// also needs to assign Sales people into a Team Leader's team. Scoped to
// Sales-only users server-side (see createUserController/list.js, read.js,
// update.js), never a path to editing Finance/LMS/HR accounts.
const TEAM_MANAGER_EXTRA_MODULES = ["User Management"];

// The default permission matrix for a single role — the fallback every user
// of that role gets until an admin customizes it via Roles & Permissions.
// Shared by UserManagement (seeding role/user records) and permissionContext
// (so a brand-new user sees their role's real defaults on first login,
// instead of nothing, if no record has been seeded yet).
export function defaultMatrixForRole(role) {
  const perModule = {};
  const fullAccess = FULL_ACCESS_ROLES.includes(role);
  const isFinance = role === "Finance";
  // "Support" is deliberately NOT in FULL_ACCESS_ROLES — that list bypasses
  // the matrix entirely (see permissionContext's fullAccessMatrix() — those
  // roles can't be scoped down even from this screen). Support instead gets
  // a normal, saved, per-role matrix whose seeded default just starts at
  // full access on every module (same shape as taking a full-access role's
  // matrix as a template), so an admin can still dial a specific module
  // back later via Roles & Permissions if needed.
  const isSupportRole = role === "Support";

  PERMISSION_MODULES.forEach((mod) => {
    // Everyone can raise and see support tickets, regardless of role.
    if (mod === "Support") {
      perModule[mod] = { view: true, edit: true, delete: fullAccess || isSupportRole };
      return;
    }

    // Code Editor opens a real VS Code session on this CRM's own source —
    // never defaults to on, not even for a full-access role (owner/Admin/
    // Sales Manager). The only way in is an explicit per-role or per-user
    // grant from Roles & Permissions (see permissionContext's fullAccessMatrix
    // override, which carves this module out of its blanket bypass too).
    if (mod === "Code Editor") {
      perModule[mod] = { view: false, edit: false, delete: false };
      return;
    }

    const canView =
      fullAccess ||
      isSupportRole ||
      // Reports/Performance/Payments/Calling all self-or-team-scope down on
      // the backend for anyone who isn't full-access (see reportController/
      // summary.js, paymentsController/scope.js, salesDealController/scope.js,
      // dashboardController/summary.js) rather than blocking outright — a
      // lead-tier or frontline role sees only their own or their team's rows,
      // never company-wide, so there's no reason to hide the nav item itself.
      (LEAD_TIER_ROLES.includes(role) &&
        (mod !== "User Management" || (role === "Team Manager" && TEAM_MANAGER_EXTRA_MODULES.includes(mod)))) ||
      (FRONTLINE_ROLES.includes(role) && ["Dashboard", "Sales", "Calling", "Payments", "Reports", "Performance"].includes(mod)) ||
      (role === "Sales Manager" && SALES_MANAGER_MODULES.includes(mod)) ||
      (isFinance && ["Dashboard", "Invoices", "Payments", "Finance"].includes(mod));

    const canEdit =
      fullAccess ||
      isSupportRole ||
      (LEAD_TIER_ROLES.includes(role) && canView) ||
      (role === "Sales Manager" && canView) ||
      (isFinance && ["Invoices", "Payments", "Finance"].includes(mod));

    const canDelete = fullAccess || isSupportRole;

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
