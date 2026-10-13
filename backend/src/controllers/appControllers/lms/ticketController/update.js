const mongoose = require('mongoose');
const { notifyUser } = require('../../../../notify');
const { isTicketFullAccess } = require('./scope');
const { ticketNo } = require('../../../../config/supportTickets');
const { ticketResolvedMail } = require('../../../../services/support/ticketMail');

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
  // Raiser identity / source / attached payment are fixed at creation.
  ['createdBy', 'raisedByName', 'raisedByEmail', 'raisedByPhone', 'source', 'payment', 'paymentSnapshot'].forEach(
    (k) => delete req.body[k]
  );
  const resolvingNow = req.body.status === 'Resolved' && existing.status !== 'Resolved';
  if (resolvingNow) {
    req.body.resolvedAt = new Date();
    req.body.resolvedByName = [req.admin.name, req.admin.surname].filter(Boolean).join(' ');
  }
  req.body.updated = new Date();

  const result = await Model.findOneAndUpdate({ _id: req.params.id, removed: false }, req.body, {
    new: true,
    runValidators: true,
  }).exec();

  if (!result) {
    return res.status(404).json({ success: false, result: null, message: 'No document found' });
  }

  if (req.body.status && req.body.status !== existing.status) {
    // A student's ticket lives in the LMS panel — notify under module 'LMS'
    // so the panel's bell/toast picks it up live (LmsPanelApp listens for
    // LMS notifications), and link to their Help & Support page.
    const fromStudent = result.source === 'student';
    notifyUser({
      recipient: result.createdBy,
      actorId: req.admin._id,
      actorName: req.admin.name,
      module: fromStudent ? 'LMS' : 'Support',
      type: 'ticket.status',
      title: `Your ticket ${ticketNo(result)} is now ${result.status}`,
      body: result.status === 'Resolved' && result.resolutionNote ? result.resolutionNote : result.subject,
      link: fromStudent ? '/learn/support' : '/support',
    });

    if (resolvingNow) {
      let toEmail = result.raisedByEmail;
      if (!toEmail) {
        const raiser = await mongoose.model('Admin').findById(result.createdBy).select('email').lean();
        toEmail = raiser && raiser.email;
      }
      ticketResolvedMail(result.toObject(), toEmail).catch(() => {});
    }
  }

  return res.status(200).json({
    success: true,
    result,
    message: 'we update this document ',
  });
};

module.exports = update;
