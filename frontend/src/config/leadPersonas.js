// Persona dropdown options for the in-call modal (components/ActiveCallModal)
// — captures who the candidate actually is, separate from the Lead pipeline
// Stage/Sub-status (config/leadStages.js).
//
// Frontend-only by design: unlike Stage/Sub-status (which the backend
// enforces via config/leadStages.js's stageConfig/resolveStageSub), these
// persona fields are plain free-text strings on the Lead model
// (backend/src/models/appModels/sales/Lead.js) — the dropdown constraint
// lives entirely here so adding/renaming an option never needs a backend
// deploy or risks rejecting a write.

// The business's Personas reference table, one entry per row of it. Persona,
// Age, Highest Qualification, Education and Pain Point are NOT independent
// lists — the table ties them together (a Working Professional who is a Tech
// Graduate is 21-35, a Non Tech Graduate one is 21-40; a Homemaker's Education
// follows 1:1 from their qualification). Keeping the rows verbatim here, and
// deriving everything else from them, means the table is the single place to
// edit when the business changes it.
//
// `highestQualification: ""` is the table's blank cell — Student / Fresher
// rows don't record one.
export const PERSONA_MATRIX = [
  // Student / Fresher — one age band, no qualification, four backgrounds.
  { persona: 'Student / Fresher', ageRange: '18-25', highestQualification: '', education: 'Tech. College Student', painPoint: 'Job into AI' },
  { persona: 'Student / Fresher', ageRange: '18-25', highestQualification: '', education: 'Non Tech. College Student', painPoint: 'Job into AI' },
  { persona: 'Student / Fresher', ageRange: '18-25', highestQualification: '', education: 'Tech. Graduate', painPoint: 'Job into AI' },
  { persona: 'Student / Fresher', ageRange: '18-25', highestQualification: '', education: 'Non Tech. Graduate', painPoint: 'Job into AI' },

  // Working Professional — the age band depends on the qualification.
  { persona: 'Working Professional', ageRange: '21-35', highestQualification: 'Tech Graduate', education: 'Tech Professional', painPoint: 'Upgradation for High CTC' },
  { persona: 'Working Professional', ageRange: '21-35', highestQualification: 'Tech Graduate', education: 'Non Tech Professional', painPoint: 'Upgradation for High CTC' },
  { persona: 'Working Professional', ageRange: '21-40', highestQualification: 'Non Tech Graduate', education: 'Tech Professional', painPoint: 'Upgradation for High CTC' },
  { persona: 'Working Professional', ageRange: '21-40', highestQualification: 'Non Tech Graduate', education: 'Non Tech Professional', painPoint: 'Upgradation for High CTC' },

  // Homemaker / Career Restart — Education follows 1:1 from the qualification.
  { persona: 'Homemaker / Career Restart', ageRange: '24-45', highestQualification: 'Tech Graduate', education: 'Technical Background', painPoint: 'Need a Opportunity for Earning' },
  { persona: 'Homemaker / Career Restart', ageRange: '24-45', highestQualification: 'Non Tech Graduate', education: 'Non Tech Background', painPoint: 'Need a Opportunity for Earning' },
  { persona: 'Homemaker / Career Restart', ageRange: '24-45', highestQualification: 'Non Graduate', education: 'No Background', painPoint: 'Need a Opportunity for Earning' },
];

// De-duplicated column values, in table order. Every dropdown offers the FULL
// list at all times — the matrix only drives which value gets pre-selected, so
// an agent is never blocked by a real customer who doesn't fit a row.
const column = (key) => [...new Set(PERSONA_MATRIX.map((r) => r[key]).filter(Boolean))];

export const PERSONAS = column('persona');
export const AGE_RANGES = column('ageRange');
export const HIGHEST_QUALIFICATIONS = column('highestQualification');
export const EDUCATIONS = column('education');
export const PAIN_POINTS = column('painPoint');

// Rows still consistent with what the agent has picked so far. An empty/absent
// value matches everything, so this narrows as the agent fills the card in.
export function matchingRows({ persona, highestQualification, education } = {}) {
  return PERSONA_MATRIX.filter(
    (r) =>
      (!persona || r.persona === persona) &&
      (!highestQualification || r.highestQualification === highestQualification) &&
      (!education || r.education === education),
  );
}

// The value every matching row agrees on, or "" when they disagree (or when
// nothing matches). Callers use this to pre-fill a field without ever
// overruling a choice the agent made deliberately — if the table can't name a
// single answer, it leaves the field alone.
export function suggest(field, selection) {
  const values = [...new Set(matchingRows(selection).map((r) => r[field]))];
  return values.length === 1 ? values[0] : '';
}

// Columns the table leaves blank for every persona — the agent fills these in
// freely from what the customer says, so there's nothing to cascade.
export const GENDERS = ['Male', 'Female', 'Other'];

export const PREFERRED_LANGUAGES = [
  'Hindi',
  'English',
  'Hinglish',
  'Tamil',
  'Telugu',
  'Kannada',
  'Malayalam',
  'Bengali',
  'Marathi',
  'Gujarati',
  'Punjabi',
  'Other',
];

export const COUNTRIES = ['India'];
