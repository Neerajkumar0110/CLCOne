const mongoose = require('mongoose');
const { notifyUser } = require('../../../../notify');
const { isTicketFullAccess } = require('./scope');

const Model = mongoose.model('Ticket');

// Same write as the generic createCRUDController/update.js (used by every
// other field-edit route, e.g. the Support page's status dropdown) — the
// only additions are (1) only the Support role / management may actually
// change a ticket (the status dropdown is hidden from everyone else in the
// UI, but that's cosmetic — this is the real enforcement) and (2) telling
// the person who raised the ticket, directly, when its status actually
// changes. A targeted notifyUser() rather than the 'everyone' audience
// create.js uses: nobody else needs a push for "ticket #x moved to In
// Progress", only the person waiting on it.
const update = async (req, res) => {
  if (!isTicketFullAccess(req.admin)) {
    return res.status(403).json({ success: false, result: null, message: 'Only Support can update a ticket' });
  }

  const existing = await Model.findOne({ _id: req.params.id, removed: false }).lean();
  if (!existing) {
    return res.status(404).json({ success: false, result: null, message: 'No document found' });
  }

  req.body.removed = false;
  const result = await Model.findOneAndUpdate({ _id: req.params.id, removed: false }, req.body, {
    new: true,
    runValidators: true,
  }).exec();

  if (!result) {
    return res.status(404).json({ success: false, result: null, message: 'No document found' });
  }

  if (req.body.status && req.body.status !== existing.status) {
    notifyUser({
      recipient: result.createdBy,
      actorId: req.admin._id,
      actorName: req.admin.name,
      module: 'Support',
      type: 'ticket.status',
      title: `Your ticket is now ${result.status}`,
      body: result.subject,
      link: '/support',
    });
  }

  return res.status(200).json({
    success: true,
    result,
    message: 'we update this document ',
  });
};

module.exports = update;
