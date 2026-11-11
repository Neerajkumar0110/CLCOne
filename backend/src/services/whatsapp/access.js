// Who sees WhatsApp. One rule, used by every /api/whatsapp endpoint and the
// admin Access screen:
//   1. CRM admins (owner / Super Admin / Admin) — always (they run Access + Live Chats).
//   2. users[].mode === 'block'  → no, even if the department is on.
//   3. users[].mode === 'allow'  → yes.
//   4. department enabled AND the user's role ticked in it → yes.
//   5. otherwise no.

const mongoose = require('mongoose');
const { CRM_ADMIN_ROLES, DEPARTMENT_ROLES, departmentOfRole } = require('../../config/roles');

// Departments shown on the Access screen. Admin is always on, and LMS roles
// (Teacher/Student) only ever see the LMS panel, never the CRM — so neither is listed.
const ACCESS_DEPARTMENTS = ['Sales', 'Support', 'Finance'];

const isWhatsAppAdmin = (admin) => !!admin && CRM_ADMIN_ROLES.includes(admin.role);

async function loadConfig() {
  const WhatsAppAccess = mongoose.model('WhatsAppAccess');
  const doc = await WhatsAppAccess.findOne({ key: 'global' }).lean();
  return doc || { key: 'global', departments: {}, users: [] };
}

function evaluate(config, user) {
  if (!user) return { on: false, source: 'none' };
  if (CRM_ADMIN_ROLES.includes(user.role)) return { on: true, source: 'admin' };
  const id = String(user._id);
  const override = (config.users || []).find((u) => String(u.userId) === id);
  const dept = departmentOfRole(user.role);
  const d = (config.departments || {})[dept];
  const viaDept = !!(d && d.enabled && Array.isArray(d.roles) && d.roles.includes(user.role));
  if (override && override.mode === 'block') return { on: false, source: 'block', viaDept };
  if (override && override.mode === 'allow') return { on: true, source: 'allow', viaDept };
  if (viaDept) return { on: true, source: 'department', viaDept };
  return { on: false, source: d && d.enabled ? 'role-off' : 'department-off', viaDept };
}

async function hasAccess(user) {
  if (isWhatsAppAdmin(user)) return true;
  return evaluate(await loadConfig(), user).on;
}

// Clean an admin-submitted config: only known departments/roles, only allow/block.
function sanitise(input) {
  const departments = {};
  ACCESS_DEPARTMENTS.forEach((name) => {
    const d = (input && input.departments && input.departments[name]) || {};
    const valid = DEPARTMENT_ROLES[name] || [];
    const roles = Array.isArray(d.roles) ? d.roles.filter((r) => valid.includes(r)) : [];
    departments[name] = { enabled: !!d.enabled && roles.length > 0, roles };
  });
  const seen = new Set();
  const users = [];
  ((input && input.users) || []).forEach((u) => {
    if (!u || !['allow', 'block'].includes(u.mode)) return;
    if (!mongoose.isValidObjectId(u.userId) || seen.has(String(u.userId))) return;
    seen.add(String(u.userId));
    users.push({ userId: u.userId, mode: u.mode });
  });
  return { departments, users };
}

module.exports = { ACCESS_DEPARTMENTS, isWhatsAppAdmin, loadConfig, evaluate, hasAccess, sanitise };
