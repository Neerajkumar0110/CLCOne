const { FULL_ACCESS_ROLES } = require('../../../services/access/salesScope');
const n360 = require('../../../services/reports/number360');

// GET /api/reports/number-360?q=<phone | email | name> — Advanced Reporting
// → Number Lookup. Management-only, same as the rest of Advanced Reporting.
// A phone (any format) or a single email/name match returns the full
// profile; several name matches return { candidates } to pick from.
const number360 = async (req, res) => {
  if (!FULL_ACCESS_ROLES.includes(req.admin.role)) {
    return res.status(403).json({ success: false, result: null, message: 'Number Lookup is available to management only.' });
  }
  const q = String(req.query.q || '').trim();
  if (q.length < 3) return res.status(400).json({ success: false, result: null, message: 'Type a phone number, email or name.' });
  const result = await n360.build(q);
  return res.status(200).json({ success: true, result, message: 'ok' });
};

module.exports = { number360 };
