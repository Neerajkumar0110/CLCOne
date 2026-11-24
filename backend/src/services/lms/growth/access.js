const mongoose = require('mongoose');
const { LMS_FULL_ACCESS_ROLES, LMS_TEACHER_ROLES, LMS_STUDENT_ROLES, CRM_ADMIN_ROLES } = require('../../../config/roles');

// Who may see which learner (Figma 1B "Role-based visibility"):
//   Learner — own report only · Mentor / Teacher — assigned learners
//   Support — all, read-only · Admin — all, edits weights · Recruiter — shared link only

const M = (n) => mongoose.model(n);
const esc = (s) => String(s || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const rxEq = (s) => new RegExp(`^${esc(s)}$`, 'i');

// _lmsAdmin: set for users with full LMS rights (routes/lmsApi → services/access/lmsAccess.hasLmsFull)
const isAdmin = (a) => !!(a && (CRM_ADMIN_ROLES.includes(a.role) || a._lmsAdmin));
const isSupport = (a) => !!(a && a.role === 'Support' && !a._lmsAdmin);
const isManager = (a) => !!(a && (LMS_FULL_ACCESS_ROLES.includes(a.role) || a._lmsAdmin)); // admin + support
const isTeacher = (a) => !!(a && LMS_TEACHER_ROLES.includes(a.role));
const isStudent = (a) => !!(a && LMS_STUDENT_ROLES.includes(a.role));
const roleKey = (a) => (isAdmin(a) ? 'admin' : isSupport(a) ? 'support' : isTeacher(a) ? 'mentor' : isStudent(a) ? 'learner' : 'other');

const trainerHas = (trainer, name) =>
  (Array.isArray(trainer) ? trainer : [trainer]).some((t) =>
    String(t || '')
      .split(/[,/&]+/)
      .map((x) => x.trim().toLowerCase())
      .includes(String(name || '').trim().toLowerCase())
  );

// a mentor's batches (Batch.trainer lists them); managers get every batch
async function mentorBatches(admin) {
  const sel = 'name code course status trainer classTime startDate endDate classDurationMin';
  if (isManager(admin)) return M('Batch').find({ removed: { $ne: true } }).select(sel).lean();
  if (!isTeacher(admin) || !admin.name) return [];
  const rows = await M('Batch').find({ removed: { $ne: true }, trainer: new RegExp(esc(admin.name), 'i') }).select(sel).lean();
  return rows.filter((b) => trainerHas(b.trainer, admin.name));
}

// learner logins in a list of batches
async function learnersOf(batchNames) {
  if (!batchNames.length) return [];
  const roster = await M('Student')
    .find({ removed: { $ne: true }, batch: { $in: batchNames }, status: { $nin: ['Dropped', 'Withdrawn', 'Archived'] } })
    .select('email name batch enrollmentId')
    .lean();
  const emails = [...new Set(roster.map((r) => String(r.email || '').toLowerCase()).filter(Boolean))];
  if (!emails.length) return [];
  const admins = await M('Admin').find({ email: { $in: emails.map(rxEq) }, removed: { $ne: true } }).select('_id name email').lean();
  const byEmail = new Map(roster.map((r) => [String(r.email).toLowerCase(), r]));
  return admins.map((a) => ({ ...a, roster: byEmail.get(String(a.email).toLowerCase()) }));
}

// may `viewer` read learner `crmUserId`'s 360° / projects / engagement?
async function canView(viewer, crmUserId) {
  if (!viewer || !crmUserId) return false;
  if (String(viewer._id) === String(crmUserId)) return true;
  if (isManager(viewer)) return true;
  if (!isTeacher(viewer)) return false;
  const learner = await M('Admin').findById(crmUserId).select('email').lean();
  if (!learner) return false;
  const row = await M('Student').findOne({ email: rxEq(learner.email), removed: { $ne: true } }).select('batch').lean();
  if (!row || !row.batch) return false;
  const mine = await mentorBatches(viewer);
  return mine.some((b) => String(b.name).toLowerCase() === String(row.batch).toLowerCase());
}

module.exports = { isAdmin, isSupport, isManager, isTeacher, isStudent, roleKey, mentorBatches, learnersOf, canView, rxEq, esc };
