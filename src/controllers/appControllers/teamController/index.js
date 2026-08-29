const createCRUDController = require('@/controllers/middlewaresControllers/createCRUDController');
const methods = createCRUDController('Team');

const mine = require('./mine');

methods.mine = mine;

module.exports = methods;
