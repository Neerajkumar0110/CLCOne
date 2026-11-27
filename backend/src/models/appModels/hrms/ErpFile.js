const mongoose = require('mongoose');

// Leave attachments (doctor's note etc., ≤ 5 MB) — kept in the database so
// they need no disk on the server. Only the owner and ERP admins can read one.
const schema = new mongoose.Schema({
  admin: { type: mongoose.Schema.ObjectId, ref: 'Admin', required: true },
  name: String,
  mime: String,
  size: Number,
  data: Buffer,
  created: { type: Date, default: Date.now },
});

module.exports = mongoose.model('ErpFile', schema);
