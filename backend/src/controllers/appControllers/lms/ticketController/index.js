const createCRUDController = require('../../../middlewaresControllers/createCRUDController');
const methods = createCRUDController('Ticket');

const create = require('./create');
const update = require('./update');
const mine = require('./mine');
const list = require('./list');
const read = require('./read');
const stats = require('./stats');
const categoryCounts = require('./categoryCounts');

methods.create = create;
methods.update = update;
methods.mine = mine;
methods.list = list;
methods.read = read;
methods.stats = stats;
methods.categoryCounts = categoryCounts;

module.exports = methods;
