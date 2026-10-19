const mongoose = require('mongoose');
const crypto = require('crypto');

// A candidate who wants to pay the course fee through FINANCE (EMI via a
// finance partner) rather than a direct Razorpay payment. Raised from the
// Sales Payments page with "Request type: Finance": no payment link — the
// candidate is emailed a link to the finance KYC form (pages/Payments/
// FinanceKycForm.jsx) collecting identity docs + full bank details.
//
// Deliberately NOT a PaymentRequest: ~30 places (EMI reminders, finance hold,
// LMS student panels, deal sync, stats) treat every PaymentRequest as money
// to collect, and a finance application isn't one.
const kycSchema = new mongoose.Schema(
  {
    name: String,
    dob: String,
    gender: String,
    fatherName: String,
    motherName: String,
    email: String,
    mobile: String,
    whatsapp: String,
    alternateMobile: String,
    state: String,
    district: String,
    city: String,
    pincode: String,
    address: String,
    occupation: String,
    monthlyIncome: String,
    aadharNumber: String,
    panNumber: String,
    // Uploaded images (multer → public/uploads/financekyc/...)
    aadharFront: String,
    aadharBack: String,
    panFront: String,
    photo: String,
    bankProof: String, // cancelled cheque / passbook first page (optional)
    bank: {
      accountHolder: String,
      bankName: String,
      accountNumber: String,
      ifsc: String,
      branch: String,
      accountType: String,
      registeredMobile: String,
    },
  },
  { _id: false }
);

const schema = new mongoose.Schema(
  {
    removed: { type: Boolean, default: false },
    publicToken: { type: String, required: true, unique: true, index: true, default: () => crypto.randomBytes(20).toString('hex') },

    studentName: { type: String, required: true },
    studentEmail: { type: String, required: true, index: true },
    studentPhone: { type: String, default: '', trim: true },
    course: { type: String, default: '' },
    courseFee: { type: Number }, // total fee incl. GST
    financeAmount: { type: Number }, // amount to be financed
    tenureMonths: { type: Number },
    notes: { type: String, default: '' },

    status: { type: String, enum: ['sent', 'submitted'], default: 'sent', index: true },
    kycSubmittedAt: Date,
    kyc: kycSchema,

    emailSent: { type: Boolean, default: false },
    emailSentAt: Date,
    emailError: { type: String, default: '' },

    createdBy: { type: mongoose.Schema.ObjectId, ref: 'Admin' },
    createdByName: { type: String, default: '' },
  },
  { timestamps: { createdAt: 'created', updatedAt: 'updated' } }
);

module.exports = mongoose.model('FinanceApplication', schema);
