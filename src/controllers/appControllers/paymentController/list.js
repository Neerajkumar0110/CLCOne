const mongoose = require('mongoose');

// GET /api/payment/list?page=&items=&q= — overrides the generic
// paginatedList (single filter/equal field only) so the Payments page can
// paginate and search by payment ref, invoice number, or client name
// together, the same pattern as invoiceController/list.js.
const list = async (req, res) => {
  const Model = mongoose.model('Payment');
  const Client = mongoose.model('Client');
  const Invoice = mongoose.model('Invoice');

  const page = Math.max(parseInt(req.query.page) || 1, 1);
  const limit = Math.min(parseInt(req.query.items) || 10, 100);
  const skip = (page - 1) * limit;

  const match = { removed: false };
  if (req.query.createdBy) match.createdBy = req.query.createdBy;

  const q = (req.query.q || '').trim();
  if (q) {
    const or = [{ ref: { $regex: q, $options: 'i' } }];

    const asNumber = Number(q);
    if (!Number.isNaN(asNumber)) {
      or.push({ number: asNumber });
      const matchingInvoices = await Invoice.find({ removed: false, number: asNumber }, '_id');
      if (matchingInvoices.length > 0) or.push({ invoice: { $in: matchingInvoices.map((i) => i._id) } });
    }

    const matchingClients = await Client.find({ removed: false, name: { $regex: q, $options: 'i' } }, '_id');
    if (matchingClients.length > 0) or.push({ client: { $in: matchingClients.map((c) => c._id) } });

    match.$or = or;
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
