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

// Roles that see company-wide data in Dashboard/Performance by default, and
// may narrow it down with team/agent filters. Everyone else is force-scoped
// server-side to their own team (or just themselves, if not on one).
// Mirrors frontend's FULL_ACCESS_ROLES (frontend/src/config/permissionModules.js)
// — the two can't share a literal import across packages, keep in sync by hand.
const MANAGEMENT_ROLES = ['owner', 'Super Admin', 'Admin', 'Sales Manager'];

// MANAGEMENT_ROLES, plus 'Support' — every LMS controller/service's local
// "isManager" admin-access check should be built from this instead, not
// MANAGEMENT_ROLES directly. Support has full view/edit/delete on the LMS
// permission module (frontend/src/config/permissionModules.js,
// defaultPermissionMatrix.js), same as Admin — but that matrix only gates
// the sidebar/route entry; every individual LMS feature (Policies,
// Certificates, Curriculum, Quizzes, Assignments, Projects, Study Material,
// Doubts, Recordings, Attendance, Learner 360, Analytics, batch roster
// management, …) separately re-checks role against MANAGEMENT_ROLES in its
// own controller, which silently excluded Support until this was added.
const LMS_FULL_ACCESS_ROLES = [...MANAGEMENT_ROLES, 'Support'];

// Roles outside the core Sales/CRM pipeline. The Auto-Dialer is a Sales-only
// tool — a campaign may never dial out through, or be worked by, one of
// these roles (see callingController/campaigns.js). Inbound IVR routing is
// unaffected: it already sends a caller straight to whichever department's
// Team the menu option names, independent of this list.
const NON_SALES_ROLES = ['Support', 'Finance', ...LMS_PANEL_ROLES];

module.exports = {
  ROLES,
  FINANCE_SUB_ROLES,
  SUPER_ADMIN_ROLES,
  ADMIN_CREATOR_ROLES,
  STAFF_CREATOR_ROLES,
  MANAGEMENT_ROLES,
  LMS_FULL_ACCESS_ROLES,
  NON_SALES_ROLES,
  LMS_TEACHER_ROLES,
  LMS_STUDENT_ROLES,
  LMS_PANEL_ROLES,
};
