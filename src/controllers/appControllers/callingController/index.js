// Calling / call-center controller — mock-first, VICIdial-ready. All
// telephony goes through services/calling (getProvider()), never inline.
const meta = require('./meta');
const dashboard = require('./dashboard');
const campaigns = require('./campaigns');
const importLeads = require('./importLeads');
const dialer = require('./dialer');
const agentActions = require('./agentActions');
const history = require('./history');
const callbacks = require('./callbacks');
const recordings = require('./recordings');
const reports = require('./reports');
const manualDial = require('./manualDial');

module.exports = {
  status: meta.status,
  meta: meta.meta,
  dashboard,

  campaignList: campaigns.list,
  campaignRead: campaigns.read,
  campaignCreate: campaigns.create,
  campaignUpdate: campaigns.update,
  campaignAction: campaigns.action,
  campaignRemove: campaigns.remove,

  leadImport: importLeads.importLeads,
  leadCreate: importLeads.createLead,
  leadList: importLeads.listLeads,

  dialerState: dialer.state,
  dialerPresence: dialer.presence,
  dialerDialNext: dialer.dialNext,

  agentActive: agentActions.active,
  agentAnswer: agentActions.answer,
  agentHold: agentActions.hold,
  agentMute: agentActions.mute,
  agentNote: agentActions.note,
  agentHangup: agentActions.hangup,
  agentTransfer: agentActions.transfer,
  agentDisposition: agentActions.disposition,
  agentScheduleCallback: agentActions.scheduleCallback,

  manualDial: manualDial.dial,
  manualEnd: manualDial.end,

  historyList: history.list,

  callbackList: callbacks.list,
  callbackCreate: callbacks.create,
  callbackUpdate: callbacks.update,

  recordingList: recordings.list,
  recordingRead: recordings.read,
  recordingStream: recordings.stream,

  reportSummary: reports.summary,
};
