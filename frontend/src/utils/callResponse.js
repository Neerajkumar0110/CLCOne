// A lead's saved call responses (lead.callHistory) sometimes carry the call
// provider's raw hangup code as the remark (USER_BUSY, NO_ANSWER …), and an
// older backend path labelled such calls "Connected" when no disposition was
// picked — a busy line then read as a connected call. This turns each entry
// into what actually happened, for display only (the stored row is unchanged).

const CODES = {
  USER_BUSY: ['Busy', "Customer's line was busy"],
  NO_ANSWER: ['No answer', 'Rang, nobody picked up'],
  NO_USER_RESPONSE: ['No answer', 'Rang, nobody picked up'],
  ALLOTTED_TIMEOUT: ['No answer', 'Rang until the time-out'],
  ORIGINATOR_CANCEL: ['Not answered', 'Call cut before the customer answered'],
  CALL_REJECTED: ['Rejected', 'Customer rejected the call'],
  SUBSCRIBER_ABSENT: ['Switched off', 'Phone switched off or out of coverage'],
  UNALLOCATED_NUMBER: ['Invalid number', 'Number does not exist'],
  INVALID_NUMBER_FORMAT: ['Invalid number', 'Number format is wrong'],
  NORMAL_TEMPORARY_FAILURE: ['Not reachable', 'Network could not reach the phone'],
  RECOVERY_ON_TIMER_EXPIRE: ['Not reachable', 'Network could not reach the phone'],
  NETWORK_OUT_OF_ORDER: ['Not reachable', 'Network could not reach the phone'],
  NORMAL_CLEARING: [null, ''],
};

// "Connected" (or no outcome) is only ever the fallback label, so a provider
// code that says the call never connected wins over it. A label someone chose
// (a real disposition such as "Not Interested") is kept as it is.
const FALLBACK = ['', 'connected'];

export function cleanResponse(r) {
  if (!r) return r;
  const code = String(r.notes || '').trim().toUpperCase();
  const hit = CODES[code];
  if (!hit) return r;
  const [label, remark] = hit;
  const outcome = label && FALLBACK.includes(String(r.outcome || '').trim().toLowerCase()) ? label : r.outcome;
  return { ...r, outcome, notes: remark || undefined };
}

export const cleanResponses = (list) => (Array.isArray(list) ? list.map(cleanResponse) : []);

// A provider hangup code shown as plain words (anything else unchanged).
export const codeText = (notes) => {
  const hit = CODES[String(notes || '').trim().toUpperCase()];
  return hit ? hit[1] : notes;
};
