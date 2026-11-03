const mongoose = require('mongoose');
const { scopeMatch } = require('./scope');

// GET /api/ticket/read/:id — same row-level visibility as list.js: a
// non-full-access caller can't fetch another admin's ticket directly by id
// even knowing/guessing it.
const read = async (req, res) => {
  const Model = mongoose.model('Ticket');

  const match = { _id: req.params.id, removed: false };
  scopeMatch(req.admin, match);

  const result = await Model.findOne(match).exec();
  if (!result) {
    return res.status(404).json({ success: false, result: null, message: 'No document found' });
  }
  return res.status(200).json({ success: true, result, message: 'we found this document' });
};

module.exports = read;
