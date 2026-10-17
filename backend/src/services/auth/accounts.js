const mongoose = require('mongoose');
const { LMS_PANEL_ROLES, isLmsRole, departmentOfRole } = require('../../config/roles');

// One email may hold TWO accounts: one on the LMS side (Student / Teacher)
// and one in a CRM department (Sales, Support, Finance, Admin…) — never two
// on the same side.
//
//   Password login → the LMS account (students/teachers get a password)
//   OTP login      → the department account
// With only one account, both ways lead to it, exactly as before.

const sideFilter = (lms) => (lms ? { role: { $in: LMS_PANEL_ROLES } } : { role: { $nin: LMS_PANEL_ROLES } });

async function accountsByEmail(email, Model = mongoose.model('Admin')) {
  const all = await Model.find({ email: String(email || '').toLowerCase().trim(), removed: false }).exec();
  return {
    lms: all.find((u) => isLmsRole(u.role)) || null,
    dept: all.find((u) => !isLmsRole(u.role)) || null,
  };
}

// method: 'otp' | 'password'
async function accountForLogin(email, method, Model) {
  const { lms, dept } = await accountsByEmail(email, Model);
  if (method === 'password') return lms || dept;
  return dept || lms;
}

// Can a new account with `role` be created for `email`? Returns null when
// fine, else the message to show.
async function emailClash(email, role, { exceptId, Model } = {}) {
  const lms = isLmsRole(role);
  const filter = { email: String(email || '').toLowerCase().trim(), removed: false, ...sideFilter(lms) };
  if (exceptId) filter._id = { $ne: exceptId };
  const other = await (Model || mongoose.model('Admin')).findOne(filter).select('role').lean();
  if (!other) return null;
  return lms
    ? `This email already has an LMS account (${other.role}). One email can have one LMS account and one department account.`
    : `This email already has a ${departmentOfRole(other.role)} account (${other.role}). One email can have one LMS account and one department account.`;
}

module.exports = { sideFilter, accountsByEmail, accountForLogin, emailClash };
