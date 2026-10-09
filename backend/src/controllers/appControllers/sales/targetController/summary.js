const mongoose = require('mongoose');
const { resolveHierarchyScope } = require('../../../../services/access/salesHierarchy');
const { hydrateClientAndAdmin } = require('../../../../services/finance/hydrateClientAndAdmin');

function currentPeriod() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function monthBounds(period) {
  const [y, m] = period.split('-').map(Number);
  return { start: new Date(y, m - 1, 1), end: new Date(y, m, 1) };
}

// GET /api/performance/targets?period=YYYY-MM — monthly target vs. actual for
// every person in the caller's sales-hierarchy scope (see
// services/access/salesHierarchy.js), same scoping rule as
// performanceController/summary.js. "Achieved" is always computed live from
// Call/Payment for that month, never stored — see Target.js's header comment.
const summary = async (req, res) => {
  const Admin = mongoose.model('Admin');
  const Target = mongoose.model('Target');
  const Call = mongoose.model('Call');
  const Payment = mongoose.model('Payment');

  const period = /^\d{4}-\d{2}$/.test(req.query.period || '') ? req.query.period : currentPeriod();
  const { start, end } = monthBounds(period);

  const hierarchy = await resolveHierarchyScope(req.admin);

  let people;
  if (hierarchy.isFullAccess) {
    people = await Admin.find({ removed: false, role: { $in: require('../../../../config/roles').SALES_ROLES } })
      .select('name role')
      .lean();
  } else if (hierarchy.people) {
    people = hierarchy.people;
  } else {
    // legacy — names only, look up role for display
    const rows = await Admin.find({ name: { $in: hierarchy.names || [] }, removed: false }).select('name role').lean();
    people = rows;
  }

  const ids = people.map((p) => p._id).filter(Boolean);
  const names = people.map((p) => p.name);

  const [calls, rawPaymentsUnhydrated, targetRows] = await Promise.all([
    Call.find({ removed: false, created: { $gte: start, $lt: end }, calledBy: { $in: names } })
      .select('status calledBy')
      .lean(),
    Payment.find({ removed: false, created: { $gte: start, $lt: end } }).select('amount createdBy created').lean(),
    ids.length
      ? Target.find({ removed: false, period, admin: { $in: ids } }).lean()
      : Promise.resolve([]),
  ]);
  const payments = await hydrateClientAndAdmin(rawPaymentsUnhydrated, { adminSelect: 'name' });
  const targetByAdmin = Object.fromEntries(targetRows.map((t) => [String(t.admin), t]));

  const rows = people.map((p) => {
    const myCalls = calls.filter((c) => c.calledBy === p.name);
    const myPayments = payments.filter((pay) => pay.createdBy?.name === p.name);
    const t = p._id ? targetByAdmin[String(p._id)] : null;
    return {
      admin: p._id || null,
      name: p.name,
      role: p.role || null,
      depth: p.depth || 0,
      targetCalls: t?.targetCalls ?? null,
      achievedCalls: myCalls.length,
      targetDeals: t?.targetDeals ?? null,
      achievedDeals: myPayments.length,
      targetRevenue: t?.targetRevenue ?? null,
      achievedRevenue: myPayments.reduce((s, pay) => s + (pay.amount || 0), 0),
    };
  });

  return res.status(200).json({
    success: true,
    result: { period, canSetTargets: hierarchy.isFullAccess || !!(hierarchy.people && hierarchy.people.length > 1), rows },
    message: 'ok',
  });
};

module.exports = summary;
