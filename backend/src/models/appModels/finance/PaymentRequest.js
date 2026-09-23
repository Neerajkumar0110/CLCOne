const mongoose = require('mongoose');
const crypto = require('crypto');

// One student fee-collection request: admin fills name/email/course/amount,
// the CRM creates a Razorpay Payment Link + QR and emails it. `publicToken`
// is the unguessable id used in the emailed link and the public KYC form —
// never the Mongo _id, so a payment can't be enumerated by incrementing ids.
const schema = new mongoose.Schema(
  {
    removed: { type: Boolean, default: false },

    publicToken: { type: String, required: true, unique: true, index: true, default: () => crypto.randomBytes(20).toString('hex') },

    studentName: { type: String, required: true },
    studentEmail: { type: String, required: true, index: true },
    studentPhone: { type: String, default: '', trim: true },
    course: { type: String, default: '' },
    amount: { type: Number, required: true }, // rupees (not paise)
    currency: { type: String, default: 'INR' },
    notes: { type: String, default: '' },

    // Razorpay Payment Link
    razorpayPaymentLinkId: { type: String, index: true },
    razorpayShortUrl: { type: String, default: '' },
    razorpayPaymentId: { type: String, default: '' },

    status: {
      type: String,
      enum: ['created', 'paid', 'expired', 'cancelled', 'failed'],
      default: 'created',
      index: true,
    },
    paidAt: Date,

    // EMI / installment plan — only populated when `course` matches a known
    // fee plan (see services/payments/courseCatalog.js). installmentCount is
    // 1 for a plain one-off payment. All installments of one enrollment
    // share `planGroupId`; `planTotal` (incl. GST) is copied onto every one
    // of them so "remaining balance" can be computed without a join.
    planGroupId: { type: String, index: true },
    installmentNo: { type: Number, default: 1 },
    installmentCount: { type: Number, default: 1 },
    planTotal: { type: Number },
    // Set once this installment is paid, when more installments remain —
    // "second installment due one month from the day this one was paid".
    nextInstallmentDueAt: Date,

    // Set only on an installment that was itself spawned to collect a due
    // EMI (see jobs/financeEmiTick.js) — copied from the predecessor's
    // nextInstallmentDueAt. Drives the 10/7/5/daily reminder schedule and
    // the 24h-overdue auto-block; a plan's very first installment and any
    // plain one-off payment have no dueAt and are never reminded/blocked.
    dueAt: Date,
    // Calendar-day dedup for the reminder job — at most one reminder email
    // per day even though the tick runs more often than that.
    lastReminderSentAt: Date,
    // Full history of every reminder email actually sent for this
    // installment (jobs/financeEmiTick.js) — shown in the Finance hub's
    // payment detail modal so an admin can see exactly who was reminded and
    // when, not just "a reminder went out at some point".
    reminderLog: [
      {
        _id: false,
        sentAt: { type: Date, required: true },
        daysUntilDue: { type: Number, required: true },
      },
    ],

    kycSubmitted: { type: Boolean, default: false },
    kycSubmittedAt: Date,

    // Set once the KYC submission auto-creates (or matches) an LMS Student
    // roster row for this candidate — see services/payments/studentProvision.js.
    student: { type: mongoose.Schema.ObjectId, ref: 'Student' },

    emailSent: { type: Boolean, default: false },
    emailSentAt: Date,
    emailError: { type: String, default: '' },

    createdBy: { type: mongoose.Schema.ObjectId, ref: 'Admin' },
    createdByName: { type: String, default: '' },
  },
  { timestamps: { createdAt: 'created', updatedAt: 'updated' } }
);

module.exports = mongoose.model('PaymentRequest', schema);
