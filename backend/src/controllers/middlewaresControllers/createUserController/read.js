const mongoose = require('mongoose');
const { SALES_ROLES } = require('../../../config/roles');

const read = async (userModel, req, res) => {
  const User = mongoose.model(userModel);

  // Find document by id
  const tmpResult = await User.findOne({
    _id: req.params.id,
    removed: false,
  }).exec();
  // Same Sales-only scoping as list.js — a Sales Manager/Team Manager
  // reading a non-Sales user's record (e.g. by guessing an id) gets the
  // same "not found" a true 404 would, rather than leaking it exists.
  const scopedOut =
    userModel === 'Admin' &&
    req.admin &&
    ['Sales Manager', 'Team Manager'].includes(req.admin.role) &&
    tmpResult &&
    !SALES_ROLES.includes(tmpResult.role);
  // If no results found, return document not found
  if (!tmpResult || scopedOut) {
    return res.status(404).json({
      success: false,
      result: null,
      message: 'No document found ',
    });
  } else {
    // Return success resposne
    let result = {
      _id: tmpResult._id,
      enabled: tmpResult.enabled,
      email: tmpResult.email,
      name: tmpResult.name,
      surname: tmpResult.surname,
      photo: tmpResult.photo,
      role: tmpResult.role,
      reportsTo: tmpResult.reportsTo,
    };

    return res.status(200).json({
      success: true,
      result,
      message: 'we found this document ',
    });
  }
};

module.exports = read;
