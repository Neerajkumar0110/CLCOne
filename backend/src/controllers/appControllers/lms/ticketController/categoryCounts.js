const mongoose = require('mongoose');
const { isTicketFullAccess } = require('./scope');

// GET /api/ticket/category-counts — open-ticket count per module category,
// for the badge shown on each Support page tab (see pages/Support/index.jsx).
// Mirrors the sidebar's overall open-ticket badge but split out by category.
const categoryCounts = async (req, res) => {
  const Model = mongoose.model('Ticket');

  const match = { removed: false, status: 'Open' };
  // Same row-level visibility as list.js — a non-full-access caller's tab
  // badges should only ever count their own tickets.
  if (!isTicketFullAccess(req.admin)) match.createdBy = req.admin._id;

  const rows = await Model.aggregate([
    { $match: match },
    { $group: { _id: '$category', count: { $sum: 1 } } },
  ]);

  const byCategory = {};
  rows.forEach((r) => {
    byCategory[r._id] = r.count;
  });

  return res.status(200).json({
    success: true,
    result: byCategory,
    message: 'Successfully computed ticket category counts',
  });
};

module.exports = categoryCounts;
