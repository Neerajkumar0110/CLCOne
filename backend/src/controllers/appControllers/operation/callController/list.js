const mongoose = require('mongoose');

const RANGE_DAYS = { '1W': 7, '1M': 30, '3M': 90, '6M': 182, '1Y': 365 };

// GET /api/call/list?page=&items=&team=&calledBy=&status=&range= — overrides
// the generic paginatedList (single filter/equal field only) so the Reports
// page's Number Lookup "browse all calls" mode can combine team/agent scope,
// status, and a date range while still paginating server-side.
const list = async (req, res) => {
  const Model = mongoose.model('Call');

  const page = Math.max(parseInt(req.query.page) || 1, 1);
  const limit = Math.min(parseInt(req.query.items) || 10, 100);
  const skip = (page - 1) * limit;

  const match = { removed: false };
  if (req.query.team) match.team = req.query.team;
  if (req.query.calledBy) match.calledBy = req.query.calledBy;
  if (req.query.status) match.status = req.query.status;
  if (RANGE_DAYS[req.query.range]) {
    match.created = { $gte: new Date(Date.now() - RANGE_DAYS[req.query.range] * 24 * 60 * 60 * 1000) };
  }

  const [result, count] = await Promise.all([
    Model.find(match).sort({ created: -1 }).skip(skip).limit(limit).exec(),
    Model.countDocuments(match),
  ]);

  const pagination = { page, pages: Math.ceil(count / limit) || 1, count };

  return res.status(count > 0 ? 200 : 203).json({
    success: true,
    result,
    pagination,
    message: count > 0 ? 'Successfully found documents' : 'Collection is empty',
  });
};

module.exports = list;
