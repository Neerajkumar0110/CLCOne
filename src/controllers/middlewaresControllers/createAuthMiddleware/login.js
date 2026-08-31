const Joi = require('joi');

const mongoose = require('mongoose');

const { issueOtp } = require('./issueOtp');

// Passwordless login, step 1 — email only. If it belongs to an enabled
// account, a 6-digit OTP is emailed to it; the session token is only issued
// once that code is confirmed in verifyOtp.js.
const login = async (req, res, { userModel }) => {
  const UserPasswordModel = mongoose.model(userModel + 'Password');
  const UserModel = mongoose.model(userModel);
  const { email } = req.body;

  // validate
  const objectSchema = Joi.object({
    email: Joi.string()
      .email({ tlds: { allow: true } })
      .required(),
  });

  const { error, value } = objectSchema.validate({ email });
  if (error) {
    return res.status(409).json({
      success: false,
      result: null,
      error: error,
      message: 'Invalid/Missing email.',
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

  try {
    await issueOtp({ user, UserPasswordModel });
  } catch (err) {
    // Log the real cause (mail failure, missing password record, DB error)
    // — the client message stays generic, but this shows up in Vercel logs.
    console.error('login: issueOtp failed:', err);
    return res.status(500).json({
      success: false,
      result: null,
      message: 'Could not send the login code email. Please try again.',
    });
  }

  return res.status(200).json({
    success: true,
    result: {
      email: user.email,
      otpRequired: true,
    },
    message: 'A 6-digit code has been sent to your email.',
  });
};

module.exports = login;
