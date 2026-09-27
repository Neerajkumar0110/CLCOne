const { resolveScope, requestedNarrowing } = require('../../../../services/access/salesScope');

// PaymentRequest attributes each entry to whoever raised it via
// `createdByName` (denormalized display copy of `createdBy`) — same
// name-string convention as SalesDeal.owner / Lead.assignedUserName.
//
// Full-access callers (Owner/Super Admin/Admin/Sales Manager/Team Manager)
// see every payment request, optionally narrowed to one person (?agent=).
//
// Everyone else defaults to SELF ONLY — being on a team doesn't
// automatically widen this. Team-wide only kicks in with an explicit
// `?teamView=1` (the "My Team" toggle on the Payments page) — same rule as
// Lead Stages/Callbacks (see leadController/scope.js). There's no partial
// view: it's either just their own requests, or the whole team's, never one
// named teammate's on their own.
async function paymentScopeFilter(admin, req) {
  const { isFullAccess, teamMemberNames } = await resolveScope(admin);
  if (isFullAccess) {
    const { agent } = requestedNarrowing(req);
    if (agent) return { createdByName: agent };
    return {};
  }

  const wantsTeamView = !!(req && req.query && (req.query.teamView === '1' || req.query.teamView === 'true'));
  if (wantsTeamView) {
    return { createdByName: { $in: teamMemberNames } };
  }
  return { createdByName: admin.name };
}

module.exports = { paymentScopeFilter };
