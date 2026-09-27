const mongoose = require('mongoose');
const createCRUDController = require('../../../middlewaresControllers/createCRUDController');
const {
  scopedPaginatedList,
  scopedListAll,
  scopedFilter,
  scopedSearch,
  scopedSummary,
  scopedRead,
} = require('../../../../services/access/scopedCrud');

const create = require('./create');
const { salesDealScopeFilter } = require('./scope');

function modelController() {
  const Model = mongoose.model('SalesDeal');
  const methods = createCRUDController('SalesDeal');

  methods.create = create;

  // Row-level visibility — same rule as Lead: only Admin/owner/Super Admin/
  // Sales Manager/Team Manager see every deal; everyone else sees their own
  // (or their team's) deals only. Previously SalesDeal had no custom
  // controller at all — every read path was the fully generic, identity-
  // blind CRUD method.
  methods.list = async (req, res) => scopedPaginatedList(Model, req, res, await salesDealScopeFilter(req.admin, req));
  methods.listAll = async (req, res) => scopedListAll(Model, req, res, await salesDealScopeFilter(req.admin, req));
  methods.filter = async (req, res) => scopedFilter(Model, req, res, await salesDealScopeFilter(req.admin, req));
  methods.search = async (req, res) => scopedSearch(Model, req, res, await salesDealScopeFilter(req.admin, req));
  methods.summary = async (req, res) => scopedSummary(Model, req, res, await salesDealScopeFilter(req.admin, req));
  methods.read = async (req, res) => scopedRead(Model, req, res, await salesDealScopeFilter(req.admin, req));

  return methods;
}

module.exports = modelController();
