// CRM role  →  LMS role  →  Moodle role (shortname) @ context.
//
// The CRM's Admin.role (config/roles.js) is broad; for the LMS we collapse it
// to one of the seven LMS roles from the blueprint (Section 07), then map that
// to a Moodle archetype shortname and the context the role is assigned in.
//
// Moodle role shortnames below are the stock ones plus two we create during
// Phase 1 setup (deploy/moodle/setup.sh): `counsellor` and `contentmanager`.

// ── 1. CRM Admin.role  →  LMS role ──────────────────────────────────────
const CRM_TO_LMS = {
  owner: 'superadmin',
  'Super Admin': 'superadmin',
  Admin: 'admin',
  'Sales Manager': 'counsellor',
  'Team Manager': 'counsellor',
  'Team Coordinator': 'counsellor',
  'Team Leader': 'counsellor',
  'Senior Executive': 'counsellor',
  Executive: 'counsellor',
  'Sales Intern': 'student',
  Finance: 'admin',
};

// ── 2. LMS role  →  Moodle assignment ─────────────────────────────────
// context: 'system' | 'coursecat' | 'course' | 'cohort'
//   - system   → assigned once at user provision
//   - course   → assigned per enrolment (enrol_manual_enrol_users carries roleid)
//   - coursecat→ assigned per assigned category (content manager / category lead)
const LMS_TO_MOODLE = {
  superadmin: { shortname: 'manager', context: 'system', portal: 'admin', siteAdmin: true },
  admin: { shortname: 'manager', context: 'system', portal: 'admin', siteAdmin: false },
  counsellor: { shortname: 'counsellor', context: 'system', portal: 'admin', siteAdmin: false },
  contentmanager: { shortname: 'contentmanager', context: 'coursecat', portal: 'teacher', siteAdmin: false },
  teacher: { shortname: 'editingteacher', context: 'course', portal: 'teacher', siteAdmin: false },
  assistantteacher: { shortname: 'teacher', context: 'course', portal: 'teacher', siteAdmin: false },
  student: { shortname: 'student', context: 'course', portal: 'student', siteAdmin: false },
};

// Numeric roleid per shortname is resolved once at runtime from
// core_role... (Moodle has no WS to list roles, so setup.sh writes them into
// MOODLE_ROLE_IDS as JSON: {"student":5,"editingteacher":3,...}).
let ROLE_IDS = {};
try {
  ROLE_IDS = JSON.parse(process.env.MOODLE_ROLE_IDS || '{}');
} catch (e) {
  ROLE_IDS = {};
}
// Moodle ships these ids on a standard install; used as a fallback only.
const DEFAULT_ROLE_IDS = { manager: 1, coursecreator: 2, editingteacher: 3, teacher: 4, student: 5, guest: 6, user: 7, frontpage: 8 };

function lmsRoleForCrm(crmRole) {
  return CRM_TO_LMS[crmRole] || 'student';
}

// The Moodle role a person gets *inside a course* they are enrolled in.
// Counsellors and admins still enter courses as students unless they also
// teach; teachers/assistants are set per course assignment in the CRM.
function courseRoleFor(lmsRole, { teaches = false, assists = false } = {}) {
  if (assists) return 'teacher';
  if (teaches) return 'editingteacher';
  return 'student';
}

function moodleRoleId(shortname) {
  return ROLE_IDS[shortname] || DEFAULT_ROLE_IDS[shortname] || DEFAULT_ROLE_IDS.student;
}

function portalFor(crmRole) {
  const lms = lmsRoleForCrm(crmRole);
  return (LMS_TO_MOODLE[lms] || LMS_TO_MOODLE.student).portal;
}

module.exports = {
  CRM_TO_LMS,
  LMS_TO_MOODLE,
  lmsRoleForCrm,
  courseRoleFor,
  moodleRoleId,
  portalFor,
};
