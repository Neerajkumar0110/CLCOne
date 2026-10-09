const mongoose = require('mongoose');
const { resolveHierarchyScope } = require('../../../../services/access/salesHierarchy');

// GET /api/payments/roster — every name selectable in the Finance "Payments"
// page's Individual dropdown (see pages/FinancePayments), independent of
// whether that person has actually created a payment yet. Deriving the
// dropdown from payment rows alone (the original approach) silently hid
// anyone who hasn't recorded a payment — a brand-new Sales Intern, say —
// even though a Sales Manager should be able to view-as them regardless.
//
// Same hierarchy rule as paymentScopeFilter's `?hierarchyScope=1` branch:
// full-access roles get the whole sales roster, everyone else gets just
// their own hierarchy scope (self + everyone reporting up to them).
async function roster(req, res) {
  const hierarchy = await resolveHierarchyScope(req.admin);

  if (hierarchy.isFullAccess) {
    const Admin = mongoose.model('Admin');
    const { SALES_ROLES } = require('../../../../config/roles');
    const people = await Admin.find({ role: { $in: SALES_ROLES }, removed: false })
      .select('name')
      .sort({ name: 1 })
      .lean();
    return res.status(200).json({ success: true, result: people.map((p) => p.name) });
  }

  return res.status(200).json({ success: true, result: [...hierarchy.names].sort() });
}

module.exports = roster;
