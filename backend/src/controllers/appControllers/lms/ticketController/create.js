const mongoose = require('mongoose');
const { notify } = require('../../../../notify');

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

  // Support / admin can raise it ON BEHALF OF a learner (LMS testing report #23):
  // the learner is the raiser (they see it in Help & Support and get the
  // confirmation), and the history says who opened it for them.
  let onBehalf = null;
  const staffMay = ['owner', 'Super Admin', 'Admin', 'Support'].includes(req.admin.role);
  if (staffMay && body.onBehalfOf && mongoose.isValidObjectId(body.onBehalfOf)) {
    onBehalf = await mongoose.model('Admin').findOne({ _id: body.onBehalfOf, removed: false }).select('name surname email phone role').lean();
  }
  delete body.onBehalfOf;

  body.removed = false;
  body.status = 'Open';
  body.createdBy = onBehalf ? onBehalf._id : req.admin._id;
  body.raisedByName = onBehalf ? [onBehalf.name, onBehalf.surname].filter(Boolean).join(' ') : req.admin.name;
  body.raisedByEmail = onBehalf ? onBehalf.email : req.admin.email;
  if (onBehalf && onBehalf.phone) body.raisedByPhone = onBehalf.phone;
  body.source = onBehalf && onBehalf.role === 'Student' ? 'student' : 'crm';
  body.history = [{ at: new Date(), action: 'created', status: 'Open', byName: req.admin.name, note: onBehalf ? `Raised by ${req.admin.name} on behalf of ${body.raisedByName}` : undefined }];
  delete body.payment;
  delete body.paymentSnapshot;

  const result = await new Model(body).save();

  // confirmations: the person it is for (email + LMS) and the Support inbox
  const ticketMail = require('../../../../services/support/ticketMail');
  ticketMail.newTicketMail(result.toObject()).catch(() => {});
  ticketMail.raisedConfirmationMail(result.toObject(), onBehalf ? req.admin.name : null).catch(() => {});
  if (onBehalf) {
    require('../../../../notify').notifyUser({ recipient: onBehalf._id, actorName: req.admin.name, module: onBehalf.role === 'Student' ? 'LMS' : 'Support', type: 'ticket.created', title: `Ticket raised for you: ${result.subject}`, body: `${req.admin.name} opened it on your behalf — we will reply within 48 hours.`, link: onBehalf.role === 'Student' ? '/learn/support' : '/support' });
  }

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
