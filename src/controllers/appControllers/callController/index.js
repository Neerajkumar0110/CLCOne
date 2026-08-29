const createCRUDController = require('@/controllers/middlewaresControllers/createCRUDController');
const methods = createCRUDController('Call');

const agentStats = require('./agentStats');
const list = require('./list');

methods.agentStats = agentStats;
methods.list = list;

module.exports = methods;
