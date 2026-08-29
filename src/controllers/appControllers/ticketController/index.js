const createCRUDController = require('@/controllers/middlewaresControllers/createCRUDController');
const methods = createCRUDController('Ticket');

const create = require('./create');
const update = require('./update');
const mine = require('./mine');
const list = require('./list');
const stats = require('./stats');
const categoryCounts = require('./categoryCounts');

methods.create = create;
methods.update = update;
methods.mine = mine;
methods.list = list;
methods.stats = stats;
methods.categoryCounts = categoryCounts;

module.exports = methods;
