const mongoose = require('mongoose');

// GET /api/ticket/list?page=&items=&category=&status= — overrides the
// generic createCRUDController list (which only supports one filter field
// at a time via ?filter=&equal=) so the Support page can filter by category
// AND status together while still paginating server-side, instead of
// fetching every ticket into the browser (see pages/Support/index.jsx).
const list = async (req, res) => {
  const Model = mongoose.model('Ticket');

  const page = Math.max(parseInt(req.query.page) || 1, 1);
  const limit = Math.min(parseInt(req.query.items) || 10, 100);
  const skip = (page - 1) * limit;

  const match = { removed: false };
  if (req.query.category) match.category = req.query.category;
  if (req.query.status && req.query.status !== 'All') match.status = req.query.status;

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
