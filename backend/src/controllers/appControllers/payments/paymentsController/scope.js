const { resolveScope, requestedNarrowing } = require('../../../../services/access/salesScope');
const { resolveHierarchyScope, namesForAgent } = require('../../../../services/access/salesHierarchy');

// PaymentRequest attributes each entry to whoever raised it via
// `createdByName` (denormalized display copy of `createdBy`) — same
// name-string convention as SalesDeal.owner / Lead.assignedUserName.
//
// Two scoping modes share this one function, selected by the caller —
// changing the default here would silently change the Sales "create a
// payment link" hub (pages/Payments) for every agent, which was never asked
// for, so that page keeps getting the original flat-Team rule unless it
// opts in.
//
// - Default (pages/Payments, the link-creation hub): full-access sees
//   everyone (optionally narrowed to one literal name via ?agent=);
//   everyone else defaults to SELF ONLY, widening to their whole literal
//   Team only with an explicit `?teamView=1` (the "My Team" toggle) — same
//   rule as Lead Stages/Callbacks (see leadController/scope.js).
//
// - `?hierarchyScope=1` (Finance's oversight page, pages/FinancePayments)
//   instead follows the sales org chart (Admin.reportsTo — see
//   services/access/salesHierarchy.js, same as Performance/Targets/Reports):
//   full-access may narrow to one individual via `?agent=`, which expands to
//   that person's own hierarchy scope (self + everyone reporting up to
//   them, however deep), not just their single row; everyone else is always
//   scoped to themselves + everyone reporting up to them — no toggle
//   needed, and picking one of their own people (?agent=) narrows further
//   to just that person's row.
async function paymentScopeFilter(admin, req) {
  const useHierarchy = !!(req && req.query && (req.query.hierarchyScope === '1' || req.query.hierarchyScope === 'true'));

  if (useHierarchy) {
    const hierarchy = await resolveHierarchyScope(admin);
    const agent = req.query.agent;
    if (hierarchy.isFullAccess) {
      if (agent) return { createdByName: { $in: await namesForAgent(agent) } };
      return {};
    }
    if (agent && hierarchy.names.includes(agent)) {
      return { createdByName: agent };
    }
    return { createdByName: { $in: hierarchy.names } };
  }

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
