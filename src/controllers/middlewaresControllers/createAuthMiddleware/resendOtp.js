const mongoose = require('mongoose');
const Joi = require('joi');
const { issueOtp } = require('./issueOtp');

// Re-sends a fresh 6-digit code — only for an email that already has a
// pending OTP request (i.e. already passed the password step), so this
// can't be used to spam an arbitrary inbox without knowing the password first.
const resendOtp = async (req, res, { userModel }) => {
  const UserPasswordModel = mongoose.model(userModel + 'Password');
  const UserModel = mongoose.model(userModel);

  const { email } = req.body;

  const objectSchema = Joi.object({
    email: Joi.string()
      .email({ tlds: { allow: true } })
      .required(),
  });

  const { error } = objectSchema.validate({ email });
  if (error) {
    return res.status(409).json({
      success: false,
      result: null,
      message: 'Invalid email.',
      errorMessage: error.message,
    });
  }

  const user = await UserModel.findOne({ email, removed: false });
  if (!user)
    return res.status(404).json({
      success: false,
      result: null,
      message: 'No account with this email has been registered.',
    });

  const databasePassword = await UserPasswordModel.findOne({ user: user._id, removed: false });
  if (!databasePassword?.otpCode) {
    return res.status(409).json({
      success: false,
      result: null,
      message: 'Please log in with your password first.',
    });
  }

  try {
    await issueOtp({ user, UserPasswordModel });
  } catch (err) {
    console.error('resendOtp: issueOtp failed:', err);
    return res.status(500).json({
      success: false,
      result: null,
      message: 'Could not send the login code email. Please try again.',
    });
  }

  return res.status(200).json({
    success: true,
    result: { email: user.email, otpRequired: true },
    message: 'A new code has been sent to your email.',
  });
};

module.exports = resendOtp;
