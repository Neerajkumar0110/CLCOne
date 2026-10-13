const { CRM_ADMIN_ROLES } = require('../../config/roles');

// B2B / B2C lock for dashboards (business decision 2026-10-12): a user whose
// Business Segment is set (Add/Edit User — "B2B Segment" / "B2C Segment")
// only ever sees their own segment's dashboard data — no "All", no other
// segment. Owner/Super Admin/Admin are never locked and keep the full
// ALL | B2B | B2C view.
//
// Returns 'B2B' | 'B2C' | null (null = not locked).
function lockedBusinessType(admin) {
  if (!admin || CRM_ADMIN_ROLES.includes(admin.role)) return null;
  if (admin.businessSegment === 'B2B Segment') return 'B2B';
  if (admin.businessSegment === 'B2C Segment') return 'B2C';
  return null;
}

// Express middleware for the dashboard endpoints: a locked caller's
// ?businessType= is overwritten with their own segment, so leaving it out
// (= "All") or asking for the other segment can't widen what they see. The
// same goes for the manual entry rows they can write (marketing metrics,
// sales cost rows) — those are stamped with their segment. Team
// classification (PATCH /sales-dashboard/team/:id) is deliberately untouched.
function enforceBusinessLock(req, res, next) {
  const locked = lockedBusinessType(req.admin);
  if (locked) {
    if (req.method === 'GET') req.query.businessType = locked;
    else if (req.body && /^\/(metrics|cost)(\/|$)/.test(req.path)) req.body.businessType = locked;
  }
  next();
}

module.exports = { lockedBusinessType, enforceBusinessLock };
