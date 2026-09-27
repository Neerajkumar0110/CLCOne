const mongoose = require('mongoose');
const createCRUDController = require('../../../middlewaresControllers/createCRUDController');
const {
  scopedPaginatedList,
  scopedListAll,
  scopedFilter,
  scopedSearch,
  scopedRead,
} = require('../../../../services/access/scopedCrud');

const summary = require('./summary');
const { clientScopeFilter } = require('./scope');

function modelController() {
  const Model = mongoose.model('Client');
  const methods = createCRUDController('Client');

  methods.summary = (req, res) => summary(Model, req, res);

  // Row-level visibility — same rule as Lead/SalesDeal. `summary` above is a
  // company-wide KPI card (total/new/active client %), left un-scoped on
  // purpose — it doesn't leak individual records, only aggregate counts.
  methods.list = async (req, res) => scopedPaginatedList(Model, req, res, await clientScopeFilter(req.admin, req));
  methods.listAll = async (req, res) => scopedListAll(Model, req, res, await clientScopeFilter(req.admin, req));
  methods.filter = async (req, res) => scopedFilter(Model, req, res, await clientScopeFilter(req.admin, req));
  methods.search = async (req, res) => scopedSearch(Model, req, res, await clientScopeFilter(req.admin, req));
  methods.read = async (req, res) => scopedRead(Model, req, res, await clientScopeFilter(req.admin, req));

  return methods;
}

module.exports = modelController();
