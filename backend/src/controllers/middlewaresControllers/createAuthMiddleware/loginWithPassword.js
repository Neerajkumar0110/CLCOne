const mongoose = require('mongoose');
const Joi = require('joi');
const { issueSession } = require('./issueSession');

// Direct email+password login — a shortcut alongside the normal OTP flow
// (login.js + verifyOtp.js), not a replacement for it. Every account can
// still use OTP; this endpoint only ever actually succeeds for one whose
// AdminPassword record holds a real password someone was told — today
// that's just Students (see services/lms/studentAccountService.js's
// provisionLogin, "name@123"). Every other account (staff added through
// User Management) has a random, never-shared throwaway hash there, so a
// password attempt against those accounts simply always fails — this route
// adds no new attack surface for them.
const loginWithPassword = async (req, res, { userModel }) => {
  const UserPasswordModel = mongoose.model(userModel + 'Password');
  const UserModel = mongoose.model(userModel);
  const { email, password, remember } = req.body;

  const objectSchema = Joi.object({
    email: Joi.string().email({ tlds: { allow: true } }).required(),
    password: Joi.string().min(1).required(),
    remember: Joi.boolean(),
  });

  const { error, value } = objectSchema.validate({ email, password, remember });
  if (error) {
    return res.status(409).json({
      success: false,
      result: null,
      message: 'Invalid/Missing fields.',
      errorMessage: error.message,
    });
  }

  const user = await UserModel.findOne({ email: value.email, removed: false });
  if (!user)
    return res.status(404).json({
      success: false,
      result: null,
      message: 'No account with this email has been registered.',
    });

  if (!user.enabled)
    return res.status(409).json({
      success: false,
      result: null,
      message: 'Your account is disabled, contact your account adminstrator',
    });

  const dbPassword = await UserPasswordModel.findOne({ user: user._id, removed: false });
  if (!dbPassword || !dbPassword.validPassword(dbPassword.salt, value.password)) {
    return res.status(403).json({
      success: false,
      result: null,
      message: 'Incorrect email or password.',
    });
  }

  const token = await issueSession({ user, UserPasswordModel, remember: value.remember });

  return res.status(200).json({
    success: true,
    result: {
      _id: user._id,
      name: user.name,
      surname: user.surname,
      role: user.role,
      email: user.email,
      photo: user.photo,
      token,
      maxAge: value.remember ? 365 : null,
    },
    message: 'Successfully login user',
  });
};

module.exports = loginWithPassword;
