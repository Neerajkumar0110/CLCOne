const mongoose = require('mongoose');
const createCRUDController = require('../../../middlewaresControllers/createCRUDController');
const methods = createCRUDController('Lead');

const create = require('./create');
const update = require('./update');
const importLeads = require('./import');
const exportLeads = require('./export');
const teamStats = require('./teamStats');
const stageStats = require('./stageStats');
const byStage = require('./byStage');
const callbacks = require('./callbacks');
const myContacts = require('./myContacts');
const { leadScopeFilter } = require('./scope');
const {
  scopedPaginatedList,
  scopedListAll,
  scopedFilter,
  scopedSearch,
  scopedSummary,
  scopedRead,
} = require('../../../../services/access/scopedCrud');

methods.create = create;
// Custom update: records stage-change history on the SAME lead record.
methods.update = update;
methods.import = importLeads;
methods.export = exportLeads;
methods.teamStats = teamStats;
methods.stageStats = stageStats;
methods.byStage = byStage;
methods.callbacks = callbacks;
methods.myContacts = myContacts;

// Row-level visibility — a Sales Executive/Intern only ever sees their own
// (or their team's) leads; only Admin/owner/Super Admin/Sales Manager/Team
// Manager see every lead company-wide. Previously these 6 read paths were
// the unmodified generic CRUD methods with zero identity awareness at all.
const Model = mongoose.model('Lead');
methods.list = async (req, res) => scopedPaginatedList(Model, req, res, await leadScopeFilter(req.admin, req));
methods.listAll = async (req, res) => scopedListAll(Model, req, res, await leadScopeFilter(req.admin, req));
methods.filter = async (req, res) => scopedFilter(Model, req, res, await leadScopeFilter(req.admin, req));
methods.search = async (req, res) => scopedSearch(Model, req, res, await leadScopeFilter(req.admin, req));
methods.summary = async (req, res) => scopedSummary(Model, req, res, await leadScopeFilter(req.admin, req));
methods.read = async (req, res) => scopedRead(Model, req, res, await leadScopeFilter(req.admin, req));

module.exports = methods;
