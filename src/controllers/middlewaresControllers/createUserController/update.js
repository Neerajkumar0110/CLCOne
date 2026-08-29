const mongoose = require('mongoose');
const Joi = require('joi');
const { ROLES, FINANCE_SUB_ROLES, SUPER_ADMIN_ROLES, ADMIN_CREATOR_ROLES } = require('@/config/roles');

// Lets an admin change another user's role/position (and name/surname) after
// creation — e.g. promoting an Executive, or correcting a Team Manager's title.
// Does not touch password/email — those have their own dedicated endpoints.
const update = async (userModel, req, res) => {
  const User = mongoose.model(userModel);

  const { name, surname, role, subRole, removed } = req.body;

  const objectSchema = Joi.object({
    name: Joi.string(),
    surname: Joi.string().allow('', null),
    role: Joi.string().valid(...ROLES.filter((r) => r !== 'owner')),
    subRole: Joi.string()
      .valid(...FINANCE_SUB_ROLES)
      .when('role', { is: 'Finance', then: Joi.optional(), otherwise: Joi.forbidden() }),
    removed: Joi.boolean(),
  });

  const { error } = objectSchema.validate({ name, surname, role, subRole, removed });
  if (error) {
    return res.status(409).json({
      success: false,
      result: null,
      message: 'Invalid fields.',
      errorMessage: error.message,
    });
  }

  if (role !== undefined) {
    const requester = req.admin;
    if (SUPER_ADMIN_ROLES.includes(role)) {
      if (!requester || !SUPER_ADMIN_ROLES.includes(requester.role)) {
        return res.status(403).json({
          success: false,
          result: null,
          message: 'Only a Super Admin can promote someone to Super Admin.',
        });
      }
      const existingSuperAdmin = await User.findOne({
        role: { $in: SUPER_ADMIN_ROLES },
        removed: false,
        _id: { $ne: req.params.id },
      });
      if (existingSuperAdmin) {
        return res.status(409).json({
          success: false,
          result: null,
          message: 'A Super Admin already exists — only one is allowed.',
        });
      }
    } else if (role === 'Admin' && (!requester || !ADMIN_CREATOR_ROLES.includes(requester.role))) {
      return res.status(403).json({
        success: false,
        result: null,
        message: 'Only a Super Admin can promote someone to Admin.',
      });
    }
  }

  const updateFields = {};
  if (name !== undefined) updateFields.name = name;
  if (surname !== undefined) updateFields.surname = surname;
  if (role !== undefined) updateFields.role = role;
  if (removed !== undefined) updateFields.removed = removed;

  const unsetFields = {};
  if (role !== undefined) {
    if (role === 'Finance' && subRole !== undefined) {
      updateFields.subRole = subRole;
    } else if (role !== 'Finance') {
      unsetFields.subRole = '';
    }
  }

  const mongoUpdate = Object.keys(unsetFields).length
    ? { $set: updateFields, $unset: unsetFields }
    : updateFields;

  let result;
  try {
    // No removed:false filter here — this also has to work for restoring a
    // soft-deleted user (removed: true -> false).
    result = await User.findOneAndUpdate(
      { _id: req.params.id },
      mongoUpdate,
      { new: true, runValidators: true }
    ).exec();
  } catch (err) {
    return res.status(409).json({
      success: false,
      result: null,
      message: err.message,
    });
  }

  if (!result) {
    return res.status(404).json({
      success: false,
      result: null,
      message: 'No user found.',
    });
  }

  return res.status(200).json({
    success: true,
    result: {
      _id: result._id,
      name: result.name,
      surname: result.surname,
      email: result.email,
      role: result.role,
      subRole: result.subRole,
      enabled: result.enabled,
      removed: result.removed,
    },
    message: 'User updated successfully.',
  });
};

module.exports = update;
