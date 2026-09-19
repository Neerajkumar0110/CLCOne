const mongoose = require('mongoose');

const paymentSchema = new mongoose.Schema({
  removed: {
    type: Boolean,
    default: false,
  },

  // Admin lives in coreDb and Client in salesDb, Payment in financeDb —
  // mongoose-autopopulate can't follow a ref across databases (it would
  // throw MissingSchemaError), so these stay plain unpopulated refs. See
  // services/finance/hydrateClientAndAdmin.js for the manual two-step
  // lookup that replaces it. `invoice` below stays autopopulate: true since
  // Invoice is also in financeDb — same-database populate is unaffected.
  createdBy: { type: mongoose.Schema.ObjectId, ref: 'Admin', required: true },
  number: {
    type: Number,
    required: true,
  },
  client: {
    type: mongoose.Schema.ObjectId,
    ref: 'Client',
    required: true,
  },
  invoice: {
    type: mongoose.Schema.ObjectId,
    ref: 'Invoice',
    required: true,
    autopopulate: true,
  },
  date: {
    type: Date,
    default: Date.now,
    required: true,
  },
  amount: {
    type: Number,
    required: true,
  },
  currency: {
    type: String,
    default: 'NA',
    uppercase: true,
    required: true,
  },
  ref: {
    type: String,
  },
  description: {
    type: String,
  },
  updated: {
    type: Date,
    default: Date.now,
  },
  created: {
    type: Date,
    default: Date.now,
  },
});
paymentSchema.plugin(require('mongoose-autopopulate'));
module.exports = mongoose.model('Payment', paymentSchema);
