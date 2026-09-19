const mongoose = require('mongoose');

// GET /api/ticket/stats?category= — status counts (Open/In Progress/
// Resolved) for the KPI cards, computed server-side so they stay correct
// under pagination instead of only reflecting whichever page happens to be
// loaded in the browser.
const stats = async (req, res) => {
  const Model = mongoose.model('Ticket');

  const match = { removed: false };
  if (req.query.category) match.category = req.query.category;

  const rows = await Model.aggregate([{ $match: match }, { $group: { _id: '$status', count: { $sum: 1 } } }]);

  const byStatus = { Open: 0, 'In Progress': 0, Resolved: 0 };
  rows.forEach((r) => {
    if (r._id in byStatus) byStatus[r._id] = r.count;
  });

  return res.status(200).json({
    success: true,
    result: byStatus,
    message: 'Successfully computed ticket stats',
  });
};

module.exports = stats;
