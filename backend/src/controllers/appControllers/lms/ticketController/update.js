const mongoose = require('mongoose');
const { notifyUser } = require('../../../../notify');
const { isTicketFullAccess, canSeeRestricted } = require('./scope');
const { ticketNo, RESTRICTED_TICKET_CATEGORY } = require('../../../../config/supportTickets');
const { sendResolvedAndRecord } = require('../../../../services/support/ticketMail');

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
  if (!existing || (existing.category === RESTRICTED_TICKET_CATEGORY && !canSeeRestricted(req.admin))) {
    return res.status(404).json({ success: false, result: null, message: 'No document found' });
  }

  req.body.removed = false;
  // Raiser identity / source / attached payment are fixed at creation.
  // …and the raiser's timeline / confirmation are only ever appended here
  // or by the raiser themselves (lmsController/supportTickets.js confirm).
  ['createdBy', 'raisedByName', 'raisedByEmail', 'raisedByPhone', 'source', 'payment', 'paymentSnapshot', 'history', 'learnerConfirmedAt', 'reopenCount'].forEach(
    (k) => delete req.body[k]
  );
  const resolvingNow = req.body.status === 'Resolved' && existing.status !== 'Resolved';
  const actorName = [req.admin.name, req.admin.surname].filter(Boolean).join(' ');
  if (resolvingNow) {
    req.body.resolvedAt = new Date();
    req.body.resolvedByName = actorName;
  }
  req.body.updated = new Date();
  const statusChanged = req.body.status && req.body.status !== existing.status;
  const changes = statusChanged
    ? {
        ...req.body,
        $push: {
          history: {
            at: new Date(),
            action: 'status',
            status: req.body.status,
            byName: actorName,
            note: resolvingNow ? req.body.resolutionNote || existing.resolutionNote || undefined : undefined,
          },
        },
      }
    : req.body;

  const result = await Model.findOneAndUpdate({ _id: req.params.id, removed: false }, changes, {
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

    if (resolvingNow) sendResolvedAndRecord(result._id).catch((e) => console.error('[tickets] resolved mail:', e.message));
  }

  return res.status(200).json({
    success: true,
    result,
    message: 'we update this document ',
  });
};

module.exports = update;
