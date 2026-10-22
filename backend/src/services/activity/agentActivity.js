const mongoose = require('mongoose');

// Records one pool / break event (models/appModels/operation/AgentActivity).
// Best-effort: a logging hiccup must never break the action being logged.
const nameOf = (a) => (a ? `${a.name || ''} ${a.surname || ''}`.trim() || a.agentName || '' : '');

async function logActivity(agent, kind, { by = null, detail } = {}) {
  try {
    if (!agent || !agent._id) return;
    await mongoose.model('AgentActivity').create({
      agent: agent._id,
      agentName: nameOf(agent),
      kind,
      at: new Date(),
      by: by && by._id ? by._id : undefined,
      byName: by ? nameOf(by) : 'System',
      detail,
    });
  } catch (e) {
    console.error('[activity] log failed:', e.message);
  }
}

module.exports = { logActivity };
