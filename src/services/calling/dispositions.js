// Default call dispositions. A `category` drives downstream automation:
//   sale        → CallLead → Completed
//   callback    → agent is prompted to schedule; CallLead → Callback
//   not-interested / no-contact / dnc → CallLead → Completed / DNC
// Later this can move to a DB collection; the API already returns it as
// data so the UI never hardcodes the list.
const CALL_DISPOSITIONS = [
  { code: 'SALE', label: 'Sale / Converted', category: 'sale', final: true },
  { code: 'INTERESTED', label: 'Interested — Follow up', category: 'callback', final: false },
  { code: 'CALLBACK', label: 'Callback Requested', category: 'callback', final: false },
  { code: 'NOT_INTERESTED', label: 'Not Interested', category: 'not-interested', final: true },
  { code: 'WRONG_NUMBER', label: 'Wrong Number', category: 'no-contact', final: true },
  { code: 'NO_ANSWER', label: 'No Answer', category: 'no-contact', final: false },
  { code: 'BUSY', label: 'Busy', category: 'no-contact', final: false },
  { code: 'VOICEMAIL', label: 'Left Voicemail', category: 'no-contact', final: false },
  { code: 'LANG_BARRIER', label: 'Language Barrier', category: 'no-contact', final: true },
  { code: 'DNC', label: 'Do Not Call', category: 'dnc', final: true },
];

const BY_CODE = Object.fromEntries(CALL_DISPOSITIONS.map((d) => [d.code, d]));

module.exports = { CALL_DISPOSITIONS, BY_CODE };
