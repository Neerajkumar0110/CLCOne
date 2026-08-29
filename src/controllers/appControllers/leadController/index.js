const createCRUDController = require('@/controllers/middlewaresControllers/createCRUDController');
const methods = createCRUDController('Lead');

const create = require('./create');
const importLeads = require('./import');
const exportLeads = require('./export');
const teamStats = require('./teamStats');

methods.create = create;
methods.import = importLeads;
methods.export = exportLeads;
methods.teamStats = teamStats;

module.exports = methods;
