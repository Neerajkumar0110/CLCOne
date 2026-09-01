// The calling module's models (CallCampaign, CallLead, CallRecord,
// CallCallback, AgentCallState) are driven ONLY through the scoped
// /api/calling/* endpoints (permission-gated, tier-scoped). The generic
// auto-CRUD routes that models/utils would otherwise expose have no
// scoping, so block every one of them here — same pattern as
// messageController.

const METHODS = ['create', 'read', 'update', 'delete', 'search', 'filter', 'summary', 'list', 'listAll'];

function blockedController(entity) {
  const blocked = (req, res) =>
    res.status(403).json({
      success: false,
      result: null,
      message: `Direct ${entity} access is disabled — use the /api/calling endpoints.`,
    });
  const obj = {};
  METHODS.forEach((m) => (obj[m] = blocked));
  return obj;
}

module.exports = {
  callCampaignController: blockedController('call campaign'),
  callLeadController: blockedController('call lead'),
  callRecordController: blockedController('call record'),
  callCallbackController: blockedController('call callback'),
  agentCallStateController: blockedController('agent state'),
};
