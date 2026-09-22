const mongoose = require('mongoose');

// KYC form a student fills right after paying (PaymentRequest.status ===
// 'paid') — one row per PaymentRequest. Document images are stored the same
// way every other upload in this app is (multer -> src/public/uploads/...,
// served back via the /public/* static route) — the fields below hold that
// stored path (e.g. "public/uploads/paymentkyc/aadhar-front-ab12c.jpg").
const schema = new mongoose.Schema(
  {
    removed: { type: Boolean, default: false },

    paymentRequest: { type: mongoose.Schema.ObjectId, ref: 'PaymentRequest', required: true, unique: true, index: true },

    name: { type: String, required: true },
    fatherName: { type: String, default: '' },
    motherName: { type: String, default: '' },
    state: { type: String, default: '' },
    city: { type: String, default: '' },
    district: { type: String, default: '' },
    pincode: { type: String, default: '' },
    address: { type: String, default: '' },

    aadharFront: { type: String, default: '' },
    aadharBack: { type: String, default: '' },
    panFront: { type: String, default: '' },
    panBack: { type: String, default: '' },
  },
  { timestamps: { createdAt: 'created', updatedAt: 'updated' } }
);

module.exports = mongoose.model('PaymentKyc', schema);
