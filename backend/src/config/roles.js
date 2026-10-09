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
  'Support',
  'Team Leader',
  'Sales Intern',
  'Finance',
  // LMS-only roles. These accounts see ONLY their LMS panel (/teacher or
  // /learn) — never the CRM (leads, calling, admin, etc.).
  'Teacher',
  'Student',
];

// LMS role helpers — used by the LMS panel controllers + route guards.
const LMS_TEACHER_ROLES = ['Teacher'];
const LMS_STUDENT_ROLES = ['Student'];
const LMS_PANEL_ROLES = [...LMS_TEACHER_ROLES, ...LMS_STUDENT_ROLES];

// Only shown/stored when role === 'Finance'.
const FINANCE_SUB_ROLES = ['Finance Manager', 'Finance Executive', 'Finance Support'];

// 'owner' is the account backend/src/setup/setup.js bootstraps — it's the
// same tier as 'Super Admin' and the two together may only have one holder.
const SUPER_ADMIN_ROLES = ['owner', 'Super Admin'];

// Who is allowed to create a user of a given role (backend/src/controllers/
// middlewaresControllers/createUserController/create.js and update.js).
const ADMIN_CREATOR_ROLES = SUPER_ADMIN_ROLES;
const STAFF_CREATOR_ROLES = [...SUPER_ADMIN_ROLES, 'Admin'];

// True CRM admins only — owner/Super Admin/Admin. Use this (not
// MANAGEMENT_ROLES below) for anything outside the Sales module: LMS/HRMS/
// Finance/Marketing admin bypasses, company-wide admin notifications, etc.
// 'Sales Manager' is deliberately excluded — she gets full visibility across
// every Sales person's data (that's what MANAGEMENT_ROLES below is for), but
// is NOT a general CRM admin; frontend/src/config/permissionModules.js's
// FULL_ACCESS_ROLES mirrors this same split (see its comment).
const CRM_ADMIN_ROLES = ['owner', 'Super Admin', 'Admin'];

// CRM_ADMIN_ROLES plus 'Sales Manager' — roles that see company-wide SALES
// data in Dashboard/Performance by default, and may narrow it down with
// team/agent/role filters. Everyone else is force-scoped server-side to
// their own sales-hierarchy chain (see services/access/salesHierarchy.js) or
// team (or just themselves, if on neither). Only ever use this for
// Sales-module scoping — for anything outside Sales, use CRM_ADMIN_ROLES
// instead (see its comment); the two used to be the same list, which is how
// Sales Manager ended up with blanket LMS/Finance/Marketing access it was
// never meant to have.
const MANAGEMENT_ROLES = [...CRM_ADMIN_ROLES, 'Sales Manager'];

// CRM_ADMIN_ROLES, plus 'Support' — every LMS controller/service's local
// "isManager" admin-access check should be built from this instead, not
// CRM_ADMIN_ROLES directly. Support has full view/edit/delete on the LMS
// permission module (frontend/src/config/permissionModules.js,
// defaultPermissionMatrix.js), same as Admin — but that matrix only gates
// the sidebar/route entry; every individual LMS feature (Policies,
// Certificates, Curriculum, Quizzes, Assignments, Projects, Study Material,
// Doubts, Recordings, Attendance, Learner 360, Analytics, batch roster
// management, …) separately re-checks role against this list in its own
// controller. Deliberately NOT built from MANAGEMENT_ROLES — Sales Manager
// has no LMS access (see CRM_ADMIN_ROLES's comment).
const LMS_FULL_ACCESS_ROLES = [...CRM_ADMIN_ROLES, 'Support'];

// Roles outside the core Sales/CRM pipeline. The Auto-Dialer is a Sales-only
// tool — a campaign may never dial out through, or be worked by, one of
// these roles (see callingController/campaigns.js). Inbound IVR routing is
// unaffected: it already sends a caller straight to whichever department's
// Team the menu option names, independent of this list.
const NON_SALES_ROLES = ['Support', 'Finance', ...LMS_PANEL_ROLES];

// The actual Sales/CRM pipeline roles — every ROLES entry except the admin
// tiers (owner/Super Admin/Admin) and NON_SALES_ROLES. Used to decide who
// gets the Sales welcome email (services/sales/salesWelcomeEmail.js) and the
// one-off backfill (scripts/sendSalesWelcomeEmails.cjs).
const SALES_ROLES = ROLES.filter(
  (r) => !SUPER_ADMIN_ROLES.includes(r) && r !== 'Admin' && !NON_SALES_ROLES.includes(r)
);

// The sales org chart, top to bottom — mirrors frontend/src/config/roles.js's
// SALES_ROLE_PARENT (kept in sync by hand, same convention as the rest of
// this file). SALES_ROLE_ORDER's index is used by services/access/
// salesHierarchy.js to compute a person's display "depth" relative to the
// viewer without walking the Admin.reportsTo graph a second time; SALES_ROLE_PARENT
// is which role a given tier's "Reports To" picker should be filtered to in
// the Add/Edit User forms.
const SALES_ROLE_ORDER = ['Sales Manager', 'Team Manager', 'Team Leader', 'Senior Executive', 'Executive', 'Sales Intern'];
const SALES_ROLE_PARENT = {
  'Team Manager': 'Sales Manager',
  'Team Leader': 'Team Manager',
  'Senior Executive': 'Team Leader',
  Executive: 'Senior Executive',
  'Sales Intern': 'Executive',
};

module.exports = {
  ROLES,
  FINANCE_SUB_ROLES,
  SUPER_ADMIN_ROLES,
  ADMIN_CREATOR_ROLES,
  STAFF_CREATOR_ROLES,
  CRM_ADMIN_ROLES,
  MANAGEMENT_ROLES,
  LMS_FULL_ACCESS_ROLES,
  NON_SALES_ROLES,
  SALES_ROLES,
  SALES_ROLE_ORDER,
  SALES_ROLE_PARENT,
  LMS_TEACHER_ROLES,
  LMS_STUDENT_ROLES,
  LMS_PANEL_ROLES,
};
