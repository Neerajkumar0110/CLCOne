const createCRUDController = require('../../middlewaresControllers/createCRUDController');
const methods = createCRUDController('Lead');

const create = require('./create');
const update = require('./update');
const importLeads = require('./import');
const exportLeads = require('./export');
const teamStats = require('./teamStats');
const stageStats = require('./stageStats');
const byStage = require('./byStage');
const callbacks = require('./callbacks');

methods.create = create;
// Custom update: records stage-change history on the SAME lead record.
methods.update = update;
methods.import = importLeads;
methods.export = exportLeads;
methods.teamStats = teamStats;
methods.stageStats = stageStats;
methods.byStage = byStage;
methods.callbacks = callbacks;

module.exports = methods;
