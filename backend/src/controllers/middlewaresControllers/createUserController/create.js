const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const { generate: uniqueId } = require('shortid');
const Joi = require('joi');
const {
  ROLES,
  FINANCE_SUB_ROLES,
  BUSINESS_NAMES,
  BUSINESS_SEGMENTS,
  SUPER_ADMIN_ROLES,
  ADMIN_CREATOR_ROLES,
  STAFF_CREATOR_ROLES,
  SALES_ROLES,
} = require('../../../config/roles');
const { notify } = require('../../../notify');

// Creates a new loginable user (e.g. Admin) + its password record (login
// itself is passwordless/OTP-only — see login.js — so no password is
// collected here), the same way backend/src/setup/setup.js bootstraps the
// very first account, except `enabled: true` is set explicitly so the new
// user can log in right away, and `role` is taken from the request instead
// of being hardcoded to 'owner'.
const create = async (userModel, req, res) => {
  const User = mongoose.model(userModel);
  const UserPassword = mongoose.model(userModel + 'Password');

  const { name, surname, email, phone, role, subRole, reportsTo, businessName, businessSegment } = req.body;

  const objectSchema = Joi.object({
    name: Joi.string().required(),
    surname: Joi.string().allow('', null),
    email: Joi.string()
      .email({ tlds: { allow: true } })
      .required(),
    phone: Joi.string().min(7).required(),
    role: Joi.string()
      .valid(...ROLES.filter((r) => r !== 'owner'))
      .required(),
    subRole: Joi.string()
      .valid(...FINANCE_SUB_ROLES)
      .when('role', { is: 'Finance', then: Joi.optional(), otherwise: Joi.forbidden() }),
    // Sales org-chart "reports to" — see Admin.js's reportsTo comment. Only
    // meaningful for the sales hierarchy roles; harmless to accept (and
    // leave unset) for any other role.
    reportsTo: Joi.string().allow('', null),
    businessName: Joi.string().valid(...BUSINESS_NAMES).allow('', null),
    businessSegment: Joi.string().valid(...BUSINESS_SEGMENTS).allow('', null),
  });

  const { error } = objectSchema.validate({ name, surname, email, phone, role, subRole, reportsTo, businessName, businessSegment });
  if (error) {
    return res.status(409).json({
      success: false,
      result: null,
      message: 'Invalid/Missing fields.',
      errorMessage: error.message,
    });
  }

  // Only a Super Admin (or the bootstrap 'owner') may create an Admin account,
  // and only they may create another Super Admin — of which there can be only one.
  const requester = req.admin;
  if (SUPER_ADMIN_ROLES.includes(role)) {
    if (!requester || !SUPER_ADMIN_ROLES.includes(requester.role)) {
      return res.status(403).json({
        success: false,
        result: null,
        message: 'Only a Super Admin can create a Super Admin account.',
      });
    }
    const existingSuperAdmin = await User.findOne({ role: { $in: SUPER_ADMIN_ROLES }, removed: false });
    if (existingSuperAdmin) {
      return res.status(409).json({
        success: false,
        result: null,
        message: 'A Super Admin already exists — only one is allowed.',
      });
    }
  } else if (role === 'Admin') {
    if (!requester || !ADMIN_CREATOR_ROLES.includes(requester.role)) {
      return res.status(403).json({
        success: false,
        result: null,
        message: 'Only a Super Admin can create an Admin account.',
      });
    }
  } else if (
    !requester ||
    !(
      STAFF_CREATOR_ROLES.includes(requester.role) ||
      // Sales Manager/Team Manager may add new Sales people directly — same
      // Sales-only scope as everything else they can do from User
      // Management (see list.js/read.js/update.js). Never any other role.
      (['Sales Manager', 'Team Manager'].includes(requester.role) && SALES_ROLES.includes(role))
    )
  ) {
    return res.status(403).json({
      success: false,
      result: null,
      message: 'Only an Admin, Super Admin, Sales Manager or Team Manager can create this account.',
    });
  }

  // One email may hold one LMS account + one department account
  // (services/auth/accounts.js) — only a second one on the SAME side clashes.
  const clashMsg = await require('../../../services/auth/accounts').emailClash(email, role, { Model: User });
  if (clashMsg) {
    return res.status(409).json({ success: false, result: null, message: clashMsg });
  }

  let newUser;
  try {
    newUser = await new User({
      name,
      surname,
      email,
      phone,
      role,
      subRole: role === 'Finance' ? subRole : undefined,
      reportsTo: reportsTo && mongoose.isValidObjectId(reportsTo) ? reportsTo : undefined,
      businessName: businessName || undefined,
      // Segment is a Sales-only concept — dropped for every other department.
      businessSegment: SALES_ROLES.includes(role) && businessSegment ? businessSegment : undefined,
      enabled: true,
    }).save();
  } catch (err) {
    return res.status(409).json({
      success: false,
      result: null,
      message: err.message,
    });
  }

  // Login is passwordless (OTP-only) — this is just an internal placeholder
  // to satisfy AdminPassword's schema, never used to authenticate.
  const salt = uniqueId();
  const passwordHash = bcrypt.hashSync(salt + uniqueId());

  await new UserPassword({
    password: passwordHash,
    salt,
    emailVerified: true,
    user: newUser._id,
  }).save();

  notify({
    audience: 'management',
    actorId: req.admin?._id,
    actorName: req.admin?.name,
    module: 'User Management',
    type: 'user.created',
    title: `${newUser.name} joined as ${newUser.role}`,
    body: newUser.email,
    link: '/user-management',
  });

  // Mirror the new user into Moodle (no-op until the LMS is configured — see
  // services/lms/, jobs/lmsSyncTick.js).
  try {
    if (userModel === 'Admin') {
      await require('../../../services/lms').queue.enqueue(
        'user.provision',
        { crmUserId: String(newUser._id) },
        { dedupeKey: `user.provision:${newUser._id}` }
      );
    }
  } catch (e) {
    console.error('lms enqueue (user.provision) failed:', e.message);
  }

  // Sales-pipeline accounts get a one-time welcome email with their login
  // email + the login URL (login is OTP-only, see login.js — no password to
  // send). Best-effort, same as the Moodle provisioning above: never blocks
  // or fails account creation.
  // Every DEPARTMENT account (not LMS — students/teachers get their own
  // LMS emails) gets its department's login details; if the email also has
  // an LMS account, the email explains password → LMS, code → department.
  try {
    const { isLmsRole, LMS_PANEL_ROLES } = require('../../../config/roles');
    if (userModel === 'Admin' && !isLmsRole(newUser.role)) {
      const hasLms = !!(await User.exists({ email: newUser.email, removed: false, role: { $in: LMS_PANEL_ROLES } }));
      await require('../../../services/auth/departmentWelcomeEmail').sendDepartmentWelcomeEmail(newUser, { hasLms });
    }
  } catch (e) {
    console.error('department welcome email failed:', e.message);
  }

  return res.status(200).json({
    success: true,
    result: {
      _id: newUser._id,
      name: newUser.name,
      surname: newUser.surname,
      email: newUser.email,
      phone: newUser.phone,
      role: newUser.role,
      subRole: newUser.subRole,
      reportsTo: newUser.reportsTo,
      enabled: newUser.enabled,
    },
    message: 'User created successfully — they can now log in.',
  });
};

module.exports = create;
