const mongoose = require('mongoose');
const { isTicketFullAccess } = require('./scope');

// GET /api/ticket/read/:id — same row-level visibility as list.js: a
// non-full-access caller can't fetch another admin's ticket directly by id
// even knowing/guessing it.
const read = async (req, res) => {
  const Model = mongoose.model('Ticket');

  const match = { _id: req.params.id, removed: false };
  if (!isTicketFullAccess(req.admin)) match.createdBy = req.admin._id;

  const result = await Model.findOne(match).exec();
  if (!result) {
    return res.status(404).json({ success: false, result: null, message: 'No document found' });
  }
  return res.status(200).json({ success: true, result, message: 'we found this document' });
};

module.exports = read;
