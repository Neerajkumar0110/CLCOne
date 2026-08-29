const read = require('./read');
const updateProfile = require('./updateProfile');

const updatePassword = require('./updatePassword');
const updateProfilePassword = require('./updateProfilePassword');
const create = require('./create');
const list = require('./list');
const update = require('./update');
const remove = require('./remove');

const createUserController = (userModel) => {
  let userController = {};

  userController.updateProfile = (req, res) => updateProfile(userModel, req, res);
  userController.updatePassword = (req, res) => updatePassword(userModel, req, res);
  userController.updateProfilePassword = (req, res) => updateProfilePassword(userModel, req, res);

  userController.read = (req, res) => read(userModel, req, res);
  userController.create = (req, res) => create(userModel, req, res);
  userController.list = (req, res) => list(userModel, req, res);
  userController.update = (req, res) => update(userModel, req, res);
  userController.delete = (req, res) => remove(userModel, req, res);

  return userController;
};

module.exports = createUserController;
