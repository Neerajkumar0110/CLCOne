const mongoose = require('mongoose');

// GET /api/ticket/mine — tickets raised by the logged-in admin, newest first.
const mine = async (req, res) => {
  const Ticket = mongoose.model('Ticket');

  const result = await Ticket.find({ removed: false, createdBy: req.admin._id })
    .sort({ created: -1 })
    .exec();

  return res.status(200).json({
    success: true,
    result,
    message: 'Successfully found your tickets',
  });
};

module.exports = mine;
