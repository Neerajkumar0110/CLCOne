// Default call dispositions. A `category` drives downstream automation:
//   sale        → CallLead → Completed
//   callback    → agent is prompted to schedule; CallLead → Callback
//   not-interested / no-contact / dnc → CallLead → Completed / DNC
// Later this can move to a DB collection; the API already returns it as
// data so the UI never hardcodes the list.
//
// `crmStage` is the Sales-pipeline (stage, subStatus) pair this outcome maps
// onto — the single source of truth for that mapping, read both by
// callingShared.advanceCrmLead (auto-dialer, unattended) and by the agent's
// in-call modal, which uses it to pre-select a stage the agent can still
// override by hand. Pairs must stay valid per config/leadStages.js.
const CALL_DISPOSITIONS = [
  { code: 'SALE', label: 'Sale / Converted', category: 'sale', final: true, crmStage: { stage: 'Interested', subStatus: 'Workshop Prospect' } },
  { code: 'INTERESTED', label: 'Interested — Follow up', category: 'callback', final: false, crmStage: { stage: 'Interested', subStatus: 'Workshop Prospect' } },
  { code: 'CALLBACK', label: 'Callback Requested', category: 'callback', final: false, crmStage: { stage: 'Call Back', subStatus: 'Call Back Requested' } },
  { code: 'NOT_INTERESTED', label: 'Not Interested', category: 'not-interested', final: true, crmStage: { stage: 'Not Interested', subStatus: 'Price Too High' } },
  { code: 'WRONG_NUMBER', label: 'Wrong Number', category: 'no-contact', final: true, crmStage: { stage: 'Invalid', subStatus: 'Wrong Number' } },
  { code: 'NO_ANSWER', label: 'No Answer', category: 'no-contact', final: false, crmStage: { stage: 'No Response', subStatus: 'No Response' } },
  { code: 'BUSY', label: 'Busy', category: 'no-contact', final: false, crmStage: { stage: 'No Response', subStatus: 'Ringing' } },
  { code: 'VOICEMAIL', label: 'Left Voicemail', category: 'no-contact', final: false, crmStage: { stage: 'No Response', subStatus: 'No Response' } },
  { code: 'LANG_BARRIER', label: 'Language Barrier', category: 'no-contact', final: true, crmStage: { stage: 'Invalid', subStatus: 'Did Not Enquire' } },
  { code: 'DNC', label: 'Do Not Call', category: 'dnc', final: true, crmStage: { stage: 'Not Interested', subStatus: 'Price Too High' } },
];

const BY_CODE = Object.fromEntries(CALL_DISPOSITIONS.map((d) => [d.code, d]));

module.exports = { CALL_DISPOSITIONS, BY_CODE };
