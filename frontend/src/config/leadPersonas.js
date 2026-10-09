// Persona/qualification dropdown options for the in-call modal
// (components/ActiveCallModal) — captures who the candidate actually is,
// separate from the Lead pipeline Stage/Sub-status (config/leadStages.js).
//
// Frontend-only by design: unlike Stage/Sub-status (which the backend
// enforces via config/leadStages.js's stageConfig/resolveStageSub), these
// persona fields are plain free-text strings on the Lead model
// (backend/src/models/appModels/sales/Lead.js) — the dropdown constraint
// lives entirely here so adding/renaming an option never needs a backend
// deploy or risks rejecting a write.

export const PERSONAS = ["Student / Fresher", "Working Professional", "Homemaker / Career Restart"];

// Options for the "Education" dropdown, filtered by which Persona is picked
// first — mirrors the Personas reference table (college/degree background
// for a Student, work background for a Homemaker; a Working Professional's
// background is captured via Highest Qualification + Profile instead).
export const EDUCATION_BY_PERSONA = {
  "Student / Fresher": ["Tech. College Student", "Non Tech. College Student", "Tech. Graduate", "Non Tech. Graduate"],
  "Working Professional": [],
  "Homemaker / Career Restart": ["Technical Background", "Non Tech Background", "No Background"],
};

export const HIGHEST_QUALIFICATIONS = [
  "Tech Graduate",
  "Non Tech Graduate",
  "Non Graduate",
  "Post Graduate",
  "Diploma",
  "12th / Below",
];

export const GENDERS = ["Male", "Female", "Other"];

// Mainly relevant for "Working Professional".
export const PROFILES = ["Tech Professional", "Non Tech Professional"];

export const PAIN_POINTS = ["Job into AI", "Upgradation for High CTC", "Need a Opportunity for Earning"];

// Suggests a Pain Point once a Persona is picked — the agent can still
// override it from the dropdown.
export const PAIN_POINT_BY_PERSONA = {
  "Student / Fresher": "Job into AI",
  "Working Professional": "Upgradation for High CTC",
  "Homemaker / Career Restart": "Need a Opportunity for Earning",
};

export const PREFERRED_LANGUAGES = [
  "Hindi",
  "English",
  "Hinglish",
  "Tamil",
  "Telugu",
  "Kannada",
  "Malayalam",
  "Bengali",
  "Marathi",
  "Gujarati",
  "Punjabi",
  "Other",
];

export const COUNTRIES = ["India"];
