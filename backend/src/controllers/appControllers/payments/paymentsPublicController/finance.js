const mongoose = require('mongoose');

// Public finance KYC form (no CRM login — the unguessable publicToken in the
// emailed link is the credential), mounted under /api/payments/public/finance.
//   GET  /:token          name/course/amount + whether already submitted
//   POST /:token/upload   one image (multer → public/uploads/financekyc)
//   POST /:token/kyc      the whole form, once

const find = (token) => mongoose.model('FinanceApplication').findOne({ publicToken: String(token || ''), removed: false });

async function status(req, res) {
  const app = await find(req.params.token);
  if (!app) return res.status(404).json({ success: false, message: 'Link not found.' });
  return res.status(200).json({
    success: true,
    result: {
      studentName: app.studentName,
      studentEmail: app.studentEmail,
      studentPhone: app.studentPhone,
      course: app.course,
      courseFee: app.courseFee,
      financeAmount: app.financeAmount,
      tenureMonths: app.tenureMonths,
      submitted: app.status === 'submitted',
    },
  });
}

async function upload(req, res) {
  const app = await find(req.params.token);
  if (!app) return res.status(404).json({ success: false, message: 'Link not found.' });
  if (app.status === 'submitted') return res.status(409).json({ success: false, message: 'Form already submitted.' });
  if (!req.file) return res.status(400).json({ success: false, message: 'No file received.' });
  return res.status(200).json({ success: true, result: { path: req.body.file } });
}

const s = (v) => String(v == null ? '' : v).trim();
const digits = (v) => s(v).replace(/\D/g, '');

async function submit(req, res) {
  const b = req.body || {};
  const bank = b.bank || {};

  const required = {
    name: 'Full name',
    dob: 'Date of birth',
    gender: 'Gender',
    fatherName: "Father's name",
    motherName: "Mother's name",
    mobile: 'Mobile number',
    whatsapp: 'WhatsApp number',
    state: 'State',
    district: 'District',
    city: 'City',
    pincode: 'Pin code',
    address: 'Address',
    aadharNumber: 'Aadhaar number',
    panNumber: 'PAN number',
  };
  const miss = Object.keys(required).find((k) => !s(b[k]));
  if (miss) return res.status(400).json({ success: false, message: `${required[miss]} is required.` });
  const bankReq = {
    accountHolder: 'Account holder name',
    bankName: 'Bank name',
    accountNumber: 'Account number',
    ifsc: 'IFSC code',
    branch: 'Branch',
    accountType: 'Account type',
    registeredMobile: 'Bank-registered mobile',
  };
  const bMiss = Object.keys(bankReq).find((k) => !s(bank[k]));
  if (bMiss) return res.status(400).json({ success: false, message: `${bankReq[bMiss]} is required.` });
  const docMiss = ['aadharFront', 'aadharBack', 'panFront'].find((k) => !s(b[k]));
  if (docMiss) return res.status(400).json({ success: false, message: 'Please upload Aadhaar (both sides) and PAN.' });

  if (digits(b.aadharNumber).length !== 12) return res.status(400).json({ success: false, message: 'Aadhaar number must be 12 digits.' });
  if (!/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(s(b.panNumber).toUpperCase())) return res.status(400).json({ success: false, message: 'Enter a valid PAN (e.g. ABCDE1234F).' });
  if (!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(s(bank.ifsc).toUpperCase())) return res.status(400).json({ success: false, message: 'Enter a valid IFSC (e.g. SBIN0001234).' });
  for (const [k, label] of [
    [b.mobile, 'Mobile number'],
    [b.whatsapp, 'WhatsApp number'],
    [bank.registeredMobile, 'Bank-registered mobile'],
  ]) {
    if (digits(k).length < 10) return res.status(400).json({ success: false, message: `${label} must be 10 digits.` });
  }
  if (!/^\d{6}$/.test(digits(b.pincode))) return res.status(400).json({ success: false, message: 'Pin code must be 6 digits.' });
  if (!/^\d{6,18}$/.test(digits(bank.accountNumber))) return res.status(400).json({ success: false, message: 'Enter a valid bank account number.' });

  const kyc = {
    name: s(b.name),
    dob: s(b.dob),
    gender: s(b.gender),
    fatherName: s(b.fatherName),
    motherName: s(b.motherName),
    email: s(b.email).toLowerCase(),
    mobile: digits(b.mobile).slice(-10),
    whatsapp: digits(b.whatsapp).slice(-10),
    alternateMobile: digits(b.alternateMobile).slice(-10),
    state: s(b.state),
    district: s(b.district),
    city: s(b.city),
    pincode: digits(b.pincode),
    address: s(b.address),
    occupation: s(b.occupation),
    monthlyIncome: s(b.monthlyIncome),
    aadharNumber: digits(b.aadharNumber),
    panNumber: s(b.panNumber).toUpperCase(),
    aadharFront: s(b.aadharFront),
    aadharBack: s(b.aadharBack),
    panFront: s(b.panFront),
    photo: s(b.photo),
    bankProof: s(b.bankProof),
    bank: {
      accountHolder: s(bank.accountHolder),
      bankName: s(bank.bankName),
      accountNumber: digits(bank.accountNumber),
      ifsc: s(bank.ifsc).toUpperCase(),
      branch: s(bank.branch),
      accountType: s(bank.accountType),
      registeredMobile: digits(bank.registeredMobile).slice(-10),
    },
  };

  // Atomic claim — a double submit can't write twice.
  const app = await mongoose
    .model('FinanceApplication')
    .findOneAndUpdate(
      { publicToken: String(req.params.token || ''), removed: false, status: { $ne: 'submitted' } },
      { $set: { status: 'submitted', kycSubmittedAt: new Date(), kyc } },
      { new: true }
    );
  if (!app) return res.status(409).json({ success: false, message: 'This form has already been submitted.' });

  try {
    const socket = require('../../../../socket');
    if (socket.emitBroadcast) socket.emitBroadcast('payments:updated', { id: String(app._id), kind: 'finance', status: 'submitted' });
  } catch (e) {
    /* realtime is best-effort */
  }
  return res.status(200).json({ success: true, result: { submitted: true } });
}

module.exports = { financeStatus: status, financeUpload: upload, financeSubmit: submit };
