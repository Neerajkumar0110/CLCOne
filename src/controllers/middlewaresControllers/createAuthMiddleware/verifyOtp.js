const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const Joi = require('joi');

// Second step of login — checks the 6-digit code emailed by login.js and,
// if it's correct and not expired, issues the real session token.
const verifyOtp = async (req, res, { userModel }) => {
  const UserPasswordModel = mongoose.model(userModel + 'Password');
  const UserModel = mongoose.model(userModel);

  const { email, otp, remember } = req.body;

  const objectSchema = Joi.object({
    email: Joi.string()
      .email({ tlds: { allow: true } })
      .required(),
    otp: Joi.string()
      .pattern(/^[0-9]{6}$/)
      .required(),
    remember: Joi.boolean(),
  });

  const { error } = objectSchema.validate({ email, otp, remember });
  if (error) {
    return res.status(409).json({
      success: false,
      result: null,
      message: 'Invalid/Missing fields.',
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

  if (!databasePassword?.otpCode || !databasePassword.otpExpires) {
    return res.status(409).json({
      success: false,
      result: null,
      message: 'No login code was requested — please log in again.',
    });
  }

  if (databasePassword.otpExpires.getTime() < Date.now()) {
    return res.status(409).json({
      success: false,
      result: null,
      message: 'This code has expired — please request a new one.',
    });
  }

  const isMatch = bcrypt.compareSync(databasePassword.otpSalt + otp, databasePassword.otpCode);
  if (!isMatch)
    return res.status(403).json({
      success: false,
      result: null,
      message: 'Incorrect code.',
    });

  const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, {
    expiresIn: remember ? 365 * 24 + 'h' : '24h',
  });

  await UserPasswordModel.findOneAndUpdate(
    { user: user._id },
    { $push: { loggedSessions: token }, $unset: { otpCode: '', otpSalt: '', otpExpires: '' } }
  ).exec();

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
      maxAge: remember ? 365 : null,
    },
    message: 'Successfully login user',
  });
};

module.exports = verifyOtp;
