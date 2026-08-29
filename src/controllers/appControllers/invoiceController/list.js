const mongoose = require('mongoose');

// GET /api/invoice/list?page=&items=&status=&q= — overrides the generic
// paginatedList (single filter/equal field only) so the Invoices page can
// paginate, filter by status, AND search by invoice number or client name
// together. `q` first resolves matching Client ids (name regex) so invoices
// can be found by customer, then combines that with a numeric match on
// `number` when q parses as a number.
const list = async (req, res) => {
  const Model = mongoose.model('Invoice');
  const Client = mongoose.model('Client');

  const page = Math.max(parseInt(req.query.page) || 1, 1);
  const limit = Math.min(parseInt(req.query.items) || 10, 100);
  const skip = (page - 1) * limit;

  const match = { removed: false };
  if (req.query.status) match.status = req.query.status;

  const q = (req.query.q || '').trim();
  if (q) {
    const or = [];
    const asNumber = Number(q);
    if (!Number.isNaN(asNumber)) or.push({ number: asNumber });

    const matchingClients = await Client.find({ removed: false, name: { $regex: q, $options: 'i' } }, '_id');
    if (matchingClients.length > 0) {
      or.push({ client: { $in: matchingClients.map((c) => c._id) } });
    }

    if (or.length > 0) match.$or = or;
    else match._id = null; // no possible match — short-circuit to empty result
  }

  const sortDir = req.query.sort === 'asc' ? 1 : -1;

  const [result, count] = await Promise.all([
    Model.find(match).sort({ created: sortDir }).skip(skip).limit(limit).populate('createdBy', 'name').exec(),
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
