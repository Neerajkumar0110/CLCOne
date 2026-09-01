const { stageConfig } = require('../../../config/leadStages');

// Shared (stage, sub-status) rule check for lead create + update.
// `body` is the merged/effective lead payload (so an already-stored
// callBackAt still satisfies the Call Back rule on a sub-status-only edit).
// Returns an error string, or null when valid.
function validateStageRules(stage, subStatus, body = {}) {
  const cfg = stageConfig(stage);
  if (!cfg) return `Unknown lead stage "${stage}".`;
  if (!cfg.subStatuses.includes(subStatus)) {
    return `"${subStatus || '(none)'}" is not a valid sub-status for the "${stage}" stage.`;
  }
  if (cfg.requiresCallBack && !body.callBackAt) {
    return 'Callback date & time are mandatory for the "Call Back" stage.';
  }
  if (
    cfg.meetingSubStatuses &&
    cfg.meetingSubStatuses.includes(subStatus) &&
    !body.meetingAt
  ) {
    return `Meeting date & time are required when sub-status is "${subStatus}".`;
  }
  return null;
}

module.exports = { validateStageRules };
