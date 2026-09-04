// The "System" dimension for the Sales B2B/B2C dashboard.
//
// A System = businessType × region × systemType, attached to each Team
// (Team.businessType / Team.region / Team.systemType). Every Lead / Call /
// Deal inherits its System from the team it belongs to.
//
// Dashboard filter row 1  →  businessType + region  ("B2B System India" …)
// Dashboard filter row 2  →  systemType + region    ("Human System USA" …)
//                            "Combined System" = no systemType filter

const BUSINESS_TYPES = ['B2B', 'B2C'];
const REGIONS = ['India', 'USA'];
const SYSTEM_TYPES = ['Human', 'AI'];

// Row-1 presets (businessType + region).
const BUSINESS_FILTERS = [
  { key: 'all', label: 'All Business' },
  { key: 'b2b-india', label: 'B2B System India', businessType: 'B2B', region: 'India' },
  { key: 'b2c-india', label: 'B2C System India', businessType: 'B2C', region: 'India' },
  { key: 'b2b-usa', label: 'B2B System USA', businessType: 'B2B', region: 'USA' },
  { key: 'b2c-usa', label: 'B2C System USA', businessType: 'B2C', region: 'USA' },
];

// Row-2 presets (systemType + region; "combined" clears systemType).
const SYSTEM_FILTERS = [
  { key: 'combined', label: 'Combined System' },
  { key: 'human-india', label: 'Human System India', systemType: 'Human', region: 'India' },
  { key: 'human-usa', label: 'Human System USA', systemType: 'Human', region: 'USA' },
  { key: 'ai-india', label: 'AI System India', systemType: 'AI', region: 'India' },
  { key: 'ai-usa', label: 'AI System USA', systemType: 'AI', region: 'USA' },
];

function systemLabel({ businessType, region, systemType }) {
  const parts = [];
  if (systemType) parts.push(`${systemType} System`);
  else if (businessType) parts.push(`${businessType} System`);
  else parts.push('All Systems');
  if (region) parts.push(region);
  return parts.join(' ');
}

// Build the Mongo filter for Team from query params. Any of the three may
// be blank → that dimension is not constrained.
function teamSystemFilter(q = {}) {
  const f = {};
  if (BUSINESS_TYPES.includes(q.businessType)) f.businessType = q.businessType;
  if (REGIONS.includes(q.region)) f.region = q.region;
  if (SYSTEM_TYPES.includes(q.systemType)) f.systemType = q.systemType;
  return f;
}

// Every distinct System that actually has a team, for the "Combined" view.
function distinctSystemsFromTeams(teams) {
  const seen = new Map();
  for (const t of teams) {
    const key = `${t.businessType || '-'}|${t.region || '-'}|${t.systemType || '-'}`;
    if (!seen.has(key)) {
      seen.set(key, {
        key,
        businessType: t.businessType || null,
        region: t.region || null,
        systemType: t.systemType || null,
        label: systemLabel(t),
        teams: [],
      });
    }
    seen.get(key).teams.push(t.name);
  }
  return [...seen.values()];
}

module.exports = {
  BUSINESS_TYPES,
  REGIONS,
  SYSTEM_TYPES,
  BUSINESS_FILTERS,
  SYSTEM_FILTERS,
  systemLabel,
  teamSystemFilter,
  distinctSystemsFromTeams,
};
