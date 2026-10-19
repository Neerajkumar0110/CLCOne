const mongoose = require('mongoose');
const { paymentScopeFilter } = require('./scope');
const fin = require('../../../../services/payments/financeApplications');

// "Request type: Finance" on the Sales Payments page — see
// models/appModels/finance/FinanceApplication.js. Same row visibility as
// payment requests (scope.js: self, ?teamView=1 team, full access all).
//
//   POST /api/payments/finance            create + email the KYC form link
//   GET  /api/payments/finance            list
//   GET  /api/payments/finance/:id        detail incl. submitted KYC
//   POST /api/payments/finance/:id/resend re-send the email

async function create(req, res) {
  const b = req.body || {};
  const studentName = String(b.studentName || '').trim();
  const studentEmail = String(b.studentEmail || '').trim().toLowerCase();
  const studentPhone = String(b.studentPhone || '').trim();
  const course = String(b.course || '').trim();
  const courseFee = Number(b.courseFee) || undefined;
  const financeAmount = Number(b.financeAmount) || undefined;
  const tenureMonths = Number(b.tenureMonths) || undefined;

  if (!studentName) return res.status(400).json({ success: false, message: 'Candidate name is required.' });
  if (!/.+@.+\..+/.test(studentEmail)) return res.status(400).json({ success: false, message: 'A valid candidate email is required.' });
  if (studentPhone.replace(/\D/g, '').length < 10) {
    return res.status(400).json({ success: false, message: 'A 10-digit candidate phone is required for finance.' });
  }
  if (!course) return res.status(400).json({ success: false, message: 'Select the internship.' });
  if (!financeAmount || financeAmount <= 0) return res.status(400).json({ success: false, message: 'Enter the amount to finance.' });
  if (!tenureMonths) return res.status(400).json({ success: false, message: 'Select the tenure.' });

  const FinanceApplication = mongoose.model('FinanceApplication');
  const app = new FinanceApplication({
    studentName,
    studentEmail,
    studentPhone,
    course,
    courseFee,
    financeAmount,
    tenureMonths,
    notes: String(b.notes || '').trim(),
    createdBy: req.admin._id,
    createdByName: req.admin.name,
  });
  await app.save();
  await fin.emailAndRecord(app);
  return res.status(200).json({ success: true, result: fin.toRow(app) });
}

async function list(req, res) {
  const filter = { removed: false, ...(await paymentScopeFilter(req.admin, req)) };
  const rows = await mongoose.model('FinanceApplication').find(filter).sort({ created: -1 }).limit(500).lean();
  return res.status(200).json({ success: true, result: rows.map(fin.toRow) });
}

async function scoped(req) {
  const filter = { _id: req.params.id, removed: false, ...(await paymentScopeFilter(req.admin, req)) };
  return mongoose.Types.ObjectId.isValid(req.params.id) ? mongoose.model('FinanceApplication').findOne(filter) : null;
}

async function get(req, res) {
  const app = await scoped(req);
  if (!app) return res.status(404).json({ success: false, message: 'Not found.' });
  return res.status(200).json({ success: true, result: { ...fin.toRow(app), notes: app.notes, kyc: app.kyc || null } });
}

async function resend(req, res) {
  const app = await scoped(req);
  if (!app) return res.status(404).json({ success: false, message: 'Not found.' });
  if (app.status === 'submitted') return res.status(409).json({ success: false, message: 'KYC is already submitted.' });
  await fin.emailAndRecord(app);
  if (!app.emailSent) return res.status(502).json({ success: false, message: app.emailError || 'Email not sent.' });
  return res.status(200).json({ success: true, result: fin.toRow(app) });
}

module.exports = { financeCreate: create, financeList: list, financeGet: get, financeResend: resend };
