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

    kycSubmitted: { type: Boolean, default: false },
    kycSubmittedAt: Date,

    emailSent: { type: Boolean, default: false },
    emailSentAt: Date,
    emailError: { type: String, default: '' },

    createdBy: { type: mongoose.Schema.ObjectId, ref: 'Admin' },
    createdByName: { type: String, default: '' },
  },
  { timestamps: { createdAt: 'created', updatedAt: 'updated' } }
);

module.exports = mongoose.model('PaymentRequest', schema);
