const mongoose = require('mongoose');
const Schema = mongoose.Schema;
const { ROLES, FINANCE_SUB_ROLES } = require('../../config/roles');

const adminSchema = new Schema({
  removed: {
    type: Boolean,
    default: false,
  },
  enabled: {
    type: Boolean,
    default: false,
  },

  email: {
    type: String,
    lowercase: true,
    trim: true,
    required: true,
  },
  name: { type: String, required: true },
  surname: { type: String },
  photo: {
    type: String,
    trim: true,
  },
  created: {
    type: Date,
    default: Date.now,
  },
  role: {
    type: String,
    default: 'owner',
    enum: ROLES,
  },
  // Only meaningful when role === 'Finance' — picks which finance position
  // ("Finance Manager" / "Finance Executive" / "Finance Support") this user holds.
  subRole: {
    type: String,
    enum: FINANCE_SUB_ROLES,
  },
});

module.exports = mongoose.model('Admin', adminSchema);
