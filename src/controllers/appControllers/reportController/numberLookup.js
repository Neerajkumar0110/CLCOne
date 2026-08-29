const mongoose = require('mongoose');
const { MANAGEMENT_ROLES } = require('@/config/roles');

// GET /api/report/number-lookup?phone=<digits> — every call ever logged
// against that exact number, newest first. Management-only, same as
// report/summary.
const numberLookup = async (req, res) => {
  if (!MANAGEMENT_ROLES.includes(req.admin.role)) {
    return res.status(403).json({
      success: false,
      result: null,
      message: 'Reports are only available to Super Admin, Admin and Sales Manager.',
    });
  }

  const phone = (req.query.phone || '').replace(/\s+/g, '');
  if (!phone) {
    return res.status(400).json({
      success: false,
      result: null,
      message: 'phone query param is required',
    });
  }

  const Call = mongoose.model('Call');
  const calls = await Call.find({ removed: false, phone })
    .select('phone contactName calledBy team status duration created')
    .sort({ created: -1 })
    .lean();

  if (calls.length === 0) {
    return res.status(200).json({
      success: true,
      result: null,
      message: 'No call history found for this number',
    });
  }

  return res.status(200).json({
    success: true,
    result: {
      phone,
      contactName: calls.find((c) => c.contactName)?.contactName || null,
      calls,
    },
    message: 'Successfully found call history',
  });
};

module.exports = numberLookup;
