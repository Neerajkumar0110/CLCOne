const mongoose = require('mongoose');
const Joi = require('joi');
const { ROLES, FINANCE_SUB_ROLES, SUPER_ADMIN_ROLES, ADMIN_CREATOR_ROLES } = require('../../../config/roles');

// Lets an admin change another user's role/position (and name/surname/email)
// after creation — e.g. promoting an Executive, correcting a Team Manager's
// title, or fixing a candidate's mistyped email. Password has its own
// dedicated endpoint.
const update = async (userModel, req, res) => {
  const User = mongoose.model(userModel);

  const { name, surname, email, role, subRole, removed, reportsTo } = req.body;

  const objectSchema = Joi.object({
    name: Joi.string(),
    surname: Joi.string().allow('', null),
    email: Joi.string().email({ tlds: { allow: true } }),
    role: Joi.string().valid(...ROLES.filter((r) => r !== 'owner')),
    subRole: Joi.string()
      .valid(...FINANCE_SUB_ROLES)
      .when('role', { is: 'Finance', then: Joi.optional(), otherwise: Joi.forbidden() }),
    removed: Joi.boolean(),
    // '' or null clears it (e.g. promoted to Sales Manager, top of the
    // chain) — see Admin.js's reportsTo comment.
    reportsTo: Joi.string().allow('', null),
  });

  const { error } = objectSchema.validate({ name, surname, email, role, subRole, removed, reportsTo });
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

  if (email !== undefined) {
    const normalizedEmail = email.toLowerCase().trim();
    const clash = await User.findOne({ email: normalizedEmail, removed: false, _id: { $ne: req.params.id } });
    if (clash) {
      return res.status(409).json({
        success: false,
        result: null,
        message: 'A user with this email already exists.',
      });
    }
  }

  if (reportsTo && reportsTo === String(req.params.id)) {
    return res.status(409).json({
      success: false,
      result: null,
      message: 'A user cannot report to themselves.',
    });
  }

  const updateFields = {};
  if (name !== undefined) updateFields.name = name;
  if (surname !== undefined) updateFields.surname = surname;
  if (email !== undefined) updateFields.email = email.toLowerCase().trim();
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
  if (reportsTo !== undefined) {
    if (reportsTo && mongoose.isValidObjectId(reportsTo)) updateFields.reportsTo = reportsTo;
    else unsetFields.reportsTo = '';
  }

  const mongoUpdate = Object.keys(unsetFields).length
    ? { $set: updateFields, $unset: unsetFields }
    : updateFields;

  // Spec §17 "every sensitive change records who/what/when" — a role change
  // (including Super Admin/Admin promotion, gated above) previously left no
  // audit trail at all. Also doubles as the pre-edit snapshot a Student's
  // linked LMS roster row needs to be found by (see the sync call below —
  // email is the only link between the two, so it has to be captured before
  // findOneAndUpdate overwrites it).
  const needsPrevSnapshot = role !== undefined || email !== undefined || name !== undefined;
  const prevForAudit = needsPrevSnapshot ? await User.findById(req.params.id).select('role email name').lean() : null;

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

  if (prevForAudit && prevForAudit.role !== result.role) {
    require('../../../services/lms/auditLog')
      .record({
        module: 'user-management',
        action: 'role.change',
        entityType: userModel,
        entityId: result._id,
        admin: req.admin,
        after: { user: result.email, from: prevForAudit.role, to: result.role },
      })
      .catch(() => {});
  }

  // A Candidate's email/name can also be fixed from here instead of the LMS
  // roster — mirror it back onto their Student row and (on an email change)
  // reset + re-send their login credentials, same as the LMS-side edit does
  // in the other direction (see Student.js's findOneAndUpdate hooks).
  if (
    userModel === 'Admin' &&
    prevForAudit &&
    prevForAudit.role === 'Student' &&
    ((email !== undefined && prevForAudit.email !== result.email) ||
      (name !== undefined && prevForAudit.name !== result.name))
  ) {
    require('../../../services/lms/studentAccountService')
      .syncStudentRosterFromAdmin(result, { prevEmail: prevForAudit.email })
      .catch((e) => console.error('[lms] syncStudentRosterFromAdmin failed:', e && e.message));
  }

  // Push name / role / active-state changes to Moodle (no-op until the LMS
  // is configured — services/lms/, jobs/lmsSyncTick.js).
  try {
    if (userModel === 'Admin') {
      const lmsQueue = require('../../../services/lms').queue;
      if (result.removed) {
        await lmsQueue.enqueue('user.suspend', { crmUserId: String(result._id) }, { dedupeKey: `user.suspend:${result._id}` });
      } else {
        await lmsQueue.enqueue('user.update', { crmUserId: String(result._id) }, { dedupeKey: `user.provision:${result._id}` });
      }
    }
  } catch (e) {
    console.error('lms enqueue (user.update) failed:', e.message);
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
      reportsTo: result.reportsTo,
      enabled: result.enabled,
      removed: result.removed,
    },
    message: 'User updated successfully.',
  });
};

module.exports = update;
