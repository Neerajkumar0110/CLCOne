const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const { generate: uniqueId } = require('shortid');
const Joi = require('joi');
const {
  ROLES,
  FINANCE_SUB_ROLES,
  SUPER_ADMIN_ROLES,
  ADMIN_CREATOR_ROLES,
  STAFF_CREATOR_ROLES,
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

  const { name, surname, email, role, subRole } = req.body;

  const objectSchema = Joi.object({
    name: Joi.string().required(),
    surname: Joi.string().allow('', null),
    email: Joi.string()
      .email({ tlds: { allow: true } })
      .required(),
    role: Joi.string()
      .valid(...ROLES.filter((r) => r !== 'owner'))
      .required(),
    subRole: Joi.string()
      .valid(...FINANCE_SUB_ROLES)
      .when('role', { is: 'Finance', then: Joi.optional(), otherwise: Joi.forbidden() }),
  });

  const { error } = objectSchema.validate({ name, surname, email, role, subRole });
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
  } else if (!requester || !STAFF_CREATOR_ROLES.includes(requester.role)) {
    return res.status(403).json({
      success: false,
      result: null,
      message: 'Only an Admin or Super Admin can create this account.',
    });
  }

  const existing = await User.findOne({ email: email.toLowerCase(), removed: false });
  if (existing) {
    return res.status(409).json({
      success: false,
      result: null,
      message: 'A user with this email already exists.',
    });
  }

  let newUser;
  try {
    newUser = await new User({
      name,
      surname,
      email,
      role,
      subRole: role === 'Finance' ? subRole : undefined,
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

  return res.status(200).json({
    success: true,
    result: {
      _id: newUser._id,
      name: newUser.name,
      surname: newUser.surname,
      email: newUser.email,
      role: newUser.role,
      subRole: newUser.subRole,
      enabled: newUser.enabled,
    },
    message: 'User created successfully — they can now log in.',
  });
};

module.exports = create;
