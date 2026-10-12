// Default call dispositions — the one-tap outcomes an agent picks at the end
// of a call. Each one is a shortcut onto the Sales pipeline: `crmStage` is the
// (stage, subStatus) pair it pre-selects, and it must stay a valid pair per
// config/leadStages.js (the 12-stage taxonomy from the business's CRM Lead
// Stages sheet). validate() below fails loudly at boot if one ever drifts.
//
// The dispositions deliberately cover only the COMMON outcome per stage — the
// agent's in-call modal still shows the full Stage + Sub-status dropdowns, so
// every one of the 42 sub-statuses stays reachable; the chips just save the
// agent two dropdown trips on the 90% case.
//
// `category` drives downstream automation (services/calling/callingShared.js):
//   sale | interested | callback → bridged into a CRM Lead
//                                  (CRM_BRIDGE_CATEGORIES)
//   callback                     → CallLead → Callback, and the modal forces a
//                                  callback date & time before submit
//   dnc                          → CallLead → DNC, stamps dncAt
//   not-interested | no-contact  → CallLead → Completed, no CRM lead created
//
// `retired: true` keeps an old code resolvable for history (a CallLead still
// holding it in `lastDisposition`) without offering it as a chip any more —
// the API filters these out, see listDispositions.
//
// Later this can move to a DB collection; the API already returns it as data
// so the UI never hardcodes the list.
const { SUB_STATUSES_BY_STAGE } = require('../../config/leadStages');

const CALL_DISPOSITIONS = [
  // ── Enrolled ───────────────────────────────────────────────────────────
  // Payment mode is what actually varies here, so the agent picks the exact
  // Enrolled sub-status from the dropdown; the chip just gets them there.
  { code: 'ENROLLED', label: 'Enrolled / Registration Done', category: 'sale', final: true, crmStage: { stage: 'Enrolled', subStatus: 'Foundation Registration Done - One Time Payment' } },

  // ── Connected / progressing ────────────────────────────────────────────
  { code: 'QUALIFIED', label: 'Connected — Qualified', category: 'interested', final: false, crmStage: { stage: 'Connected Leads', subStatus: '1st Discussion Done - Qualified' } },
  { code: 'NOT_QUALIFIED', label: 'Connected — Not Qualified', category: 'interested', final: false, crmStage: { stage: 'Connected Leads', subStatus: '1st Discussion Done - Non Qualified' } },
  { code: 'DEMO_BOOKED', label: 'Demo Booked', category: 'interested', final: false, crmStage: { stage: 'Demo Booking', subStatus: 'Demo Booked' } },
  { code: 'DEMO_ATTENDED', label: 'Demo Attended', category: 'interested', final: false, crmStage: { stage: 'Demo Booking', subStatus: 'Demo Attended' } },
  { code: 'DEMO_NO_SHOW', label: 'Demo Not Attended', category: 'interested', final: false, crmStage: { stage: 'Demo Booking', subStatus: 'Demo Not Attended' } },
  { code: 'SUPP_CALL_DONE', label: 'Supp Call Done', category: 'interested', final: false, crmStage: { stage: 'Interested Leads', subStatus: 'Supp Call Done' } },
  { code: 'SCHOLARSHIP_TEST', label: 'Scholarship Test Given', category: 'interested', final: false, crmStage: { stage: 'Interested Leads', subStatus: 'Scholarship Test Given' } },
  { code: 'PROSPECT', label: 'Prospect / Opportunity', category: 'interested', final: false, crmStage: { stage: 'Prospects', subStatus: 'Opportunities' } },
  { code: 'FUTURE_PROSPECT', label: 'Future Prospect', category: 'interested', final: false, crmStage: { stage: 'Future Prospect', subStatus: 'After 1 month' } },

  // ── Callback ───────────────────────────────────────────────────────────
  { code: 'CALLBACK', label: 'Callback Requested', category: 'callback', final: false, crmStage: { stage: 'Callback', subStatus: 'Call back (Custom Date & Time)' } },

  // ── Not interested ─────────────────────────────────────────────────────
  // The four reasons agents hear most; the rest are in the dropdown.
  { code: 'NOT_INTERESTED', label: 'Not Interested', category: 'not-interested', final: true, crmStage: { stage: 'Not Interested Leads', subStatus: 'Reason Not Clear' } },
  { code: 'PRICE_TOO_HIGH', label: 'Price Too High', category: 'not-interested', final: true, crmStage: { stage: 'Not Interested Leads', subStatus: 'Price Too High' } },
  { code: 'JOINED_ELSEWHERE', label: 'Joined Somewhere else', category: 'not-interested', final: true, crmStage: { stage: 'Not Interested Leads', subStatus: 'Joined Somewhere else' } },
  { code: 'NOT_INTERESTED_DEMO', label: 'Not Interested for Demo', category: 'not-interested', final: true, crmStage: { stage: 'Not Interested Leads', subStatus: 'Not Interested for Demo' } },

  // ── Could not reach ────────────────────────────────────────────────────
  { code: 'NO_ANSWER', label: 'Not Reachable', category: 'no-contact', final: false, crmStage: { stage: 'No Response', subStatus: 'Not Reachable' } },
  { code: 'RINGING', label: 'Ringing — No Pickup', category: 'no-contact', final: false, crmStage: { stage: 'No Response', subStatus: 'Ringing' } },
  { code: 'SWITCHED_OFF', label: 'Switch off', category: 'no-contact', final: false, crmStage: { stage: 'No Response', subStatus: 'Switch off' } },

  // ── Invalid ────────────────────────────────────────────────────────────
  { code: 'WRONG_NUMBER', label: 'Wrong Number', category: 'no-contact', final: true, crmStage: { stage: 'Invalid Leads', subStatus: 'Wrong Number' } },
  { code: 'INVALID_NUMBER', label: 'Invalid Number', category: 'no-contact', final: true, crmStage: { stage: 'Invalid Leads', subStatus: 'Invalid Number' } },
  { code: 'NOT_IN_SERVICE', label: 'Number not in Service', category: 'no-contact', final: true, crmStage: { stage: 'Invalid Leads', subStatus: 'Number not in Service' } },
  { code: 'DOES_NOT_EXIST', label: 'Number Does not Exist', category: 'no-contact', final: true, crmStage: { stage: 'Invalid Leads', subStatus: 'Number Does not Exist' } },
  { code: 'INCOMING_NOT_AVAILABLE', label: 'Incoming Not Available', category: 'no-contact', final: false, crmStage: { stage: 'Invalid Leads', subStatus: 'Incoming Not Available' } },
  { code: 'DID_NOT_INQUIRE', label: 'Did not Inquire', category: 'no-contact', final: true, crmStage: { stage: 'Invalid Leads', subStatus: 'Did not Inquire' } },
  { code: 'LANG_BARRIER', label: 'Language Barrier', category: 'no-contact', final: true, crmStage: { stage: 'Invalid Leads', subStatus: 'Language Barrier' } },

  // ── Do not call ────────────────────────────────────────────────────────
  { code: 'DNC', label: 'Do Not Call', category: 'dnc', final: true, crmStage: { stage: 'Not Interested Leads', subStatus: 'Reason Not Clear' } },

  // ── Retired ────────────────────────────────────────────────────────────
  // Replaced by the codes above, kept only so a CallLead/CallRecord that
  // already stored one still resolves to a category and a stage when it's
  // read back. Never offered as a chip.
  { code: 'SALE', label: 'Sale / Converted', category: 'sale', final: true, retired: true, crmStage: { stage: 'Enrolled', subStatus: 'Foundation Registration Done - One Time Payment' } },
  { code: 'INTERESTED', label: 'Interested — Follow up', category: 'interested', final: false, retired: true, crmStage: { stage: 'Interested Leads', subStatus: 'Supp Call Done' } },
  { code: 'BUSY', label: 'Busy', category: 'no-contact', final: false, retired: true, crmStage: { stage: 'No Response', subStatus: 'Ringing' } },
  { code: 'VOICEMAIL', label: 'Left Voicemail', category: 'no-contact', final: false, retired: true, crmStage: { stage: 'No Response', subStatus: 'Not Reachable' } },
];

// The chips an agent is actually offered, in the order above.
const ACTIVE_DISPOSITIONS = CALL_DISPOSITIONS.filter((d) => !d.retired);

const BY_CODE = Object.fromEntries(CALL_DISPOSITIONS.map((d) => [d.code, d]));

// A `crmStage` naming a stage or sub-status that no longer exists would fail
// silently — resolveStageSub() would quietly reset the lead to "New Lead" —
// so check the whole catalogue against config/leadStages.js once at require
// time and refuse to boot on a mismatch.
(function validate() {
  const bad = CALL_DISPOSITIONS.filter(
    (d) => !(SUB_STATUSES_BY_STAGE[d.crmStage.stage] || []).includes(d.crmStage.subStatus),
  ).map((d) => `${d.code} -> ${d.crmStage.stage} / ${d.crmStage.subStatus}`);
  if (bad.length) {
    throw new Error(`dispositions.js: crmStage pair not in config/leadStages.js:\n  ${bad.join('\n  ')}`);
  }
})();

module.exports = { CALL_DISPOSITIONS, ACTIVE_DISPOSITIONS, BY_CODE };
