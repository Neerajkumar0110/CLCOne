const mongoose = require('mongoose');
const { notify } = require('@/notify');

const Model = mongoose.model('Ticket');

// Raised-by identity always comes from the authenticated admin, never from
// the request body — a client could otherwise claim to be someone else.
const create = async (req, res) => {
  const body = { ...req.body };

  if (!body.subject || !body.subject.trim()) {
    return res.status(400).json({
      success: false,
      result: null,
      message: 'Subject is required',
    });
  }

  body.removed = false;
  body.status = 'Open';
  body.createdBy = req.admin._id;
  body.raisedByName = req.admin.name;

  const result = await new Model(body).save();

  // Support is open to every role (see frontend/src/config/
  // defaultPermissionMatrix.js) — so, unlike Leads/Invoices, this goes to
  // everyone, not just management.
  notify({
    audience: 'everyone',
    actorId: req.admin._id,
    actorName: req.admin.name,
    module: 'Support',
    type: 'ticket.created',
    title: `New ticket: ${result.subject}`,
    body: `${req.admin.name} raised a ${result.category} ticket`,
    link: '/support',
  });

  return res.status(200).json({
    success: true,
    result,
    message: 'Ticket raised successfully',
  });
};

module.exports = create;
