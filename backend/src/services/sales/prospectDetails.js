// Lead details CLC-POL-001 section 12 asks for that the CRM has a field for —
// a prospect needs them before it is verified.
const REQUIRED_LEAD = { name: 'Name', phone: 'Phone', email: 'Email', city: 'City', education: 'Education', college: 'College / organisation', persona: 'Employment status', profile: 'Designation', techBackground: 'Technical background', programInterest: 'Program interest', painPoint: 'Career objective', howSoonToStart: 'Availability', budgetRange: 'Financial readiness', source: 'Source', consent: 'Communication consent', remarks: 'Remarks', nextFollowUpAt: 'Next follow-up' };
const missingDetails = (l) => Object.entries(REQUIRED_LEAD).filter(([k]) => !l[k]).map(([, label]) => label);

// Where a lead stands as a prospect → null | 'pending' | 'verified' | 'rejected'.
function prospectStatus(l) {
  const done = l.prospectVerification && l.prospectVerification.status;
  if (done) return done;
  return l.stage === 'Prospects' ? 'pending' : null;
}

// Who has spoken to a prospect: one row per person with their calls on this
// number. Everyone it was sent to is listed even with no call yet, so "not
// called" shows up on both sides. calls: CallRecords of this lead's number.
function prospectCallStats(lead, calls, ownerId) {
  const people = new Map();
  const add = (id, name, reviewer) => {
    const key = String(id);
    if (!people.has(key)) people.set(key, { agent: key, name: name || '—', reviewer: false, owner: key === String(ownerId), calls: 0, connected: 0, talkSec: 0, lastAt: null });
    const p = people.get(key);
    if (name && p.name === '—') p.name = name;
    if (reviewer) p.reviewer = true;
    return p;
  };
  for (const h of lead.prospectHandoffs || []) add(h.to, h.toName, true);
  const v = lead.prospectVerification;
  if (v && v.by) add(v.by, v.byName, true);
  for (const c of calls) {
    if (!c.agent) continue;
    const p = add(c.agent, c.agentName, false);
    p.calls += 1;
    if (c.answeredAt && c.agentLegAnswered !== false && c.duration > 0) {
      p.connected += 1;
      p.talkSec += c.duration;
    }
    if (!p.lastAt || new Date(c.created) > new Date(p.lastAt)) p.lastAt = c.created;
  }
  return [...people.values()].sort((a, b) => Number(b.owner) - Number(a.owner) || Number(b.reviewer) - Number(a.reviewer) || b.talkSec - a.talkSec);
}

module.exports = { REQUIRED_LEAD, missingDetails, prospectStatus, prospectCallStats };
