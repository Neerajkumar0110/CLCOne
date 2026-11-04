// Which cards and sections of Sales 360° belong to the filters in use: pick one
// and only its data stays on the page; pick several and only what all of them
// apply to stays. No filter → null, meaning everything. Keys = SHOW_GROUPS ids.
// User, team, role and date narrow every section, so they aren't here.
const CALL_CARDS = ["calls", "connected", "talk", "avgtalk", "missed", "recordings"];
const SALES_CARDS = ["demos", "demoAttended", "demoMissed", "interested", "prospectCard", "future", "enrolled", "notInterested", "noResponse", "callback"];
const MONEY = ["paid", "pending", "money"];
const LEAD_LISTS = ["calls", "connected", "talk", "avgtalk", "recordings", "responses", "stages", "usedLeads", "activity", "callList"];
const STAGE_ONLY = {
  "Demo Booking": ["demos", "demoAttended", "demoMissed"],
  "Interested Leads": ["interested"],
  Prospects: ["prospectCard", "prospects"],
  "Future Prospect": ["future"],
  Enrolled: ["enrolled", ...MONEY],
  "Not Interested Leads": ["notInterested"],
  "No Response": ["noResponse"],
  Callback: ["callback"],
};
const SUB_CARD = { "Demo Booked": "demos", "Demo Attended": "demoAttended", "Demo Not Attended": "demoMissed" };
const DEMO_CARDS = STAGE_ONLY["Demo Booking"];

function scopeOf(key, value) {
  switch (key) {
    case "stage":
      return [...LEAD_LISTS, ...(STAGE_ONLY[value] || [])];
    case "sub":
      // a demo sub-status keeps its own card; any other leaves the stage's as they are
      return [...LEAD_LISTS, ...SALES_CARDS.filter((c) => !DEMO_CARDS.includes(c)), ...(SUB_CARD[value] ? [SUB_CARD[value]] : DEMO_CARDS), "prospects", ...MONEY];
    case "lifecycle":
      return [...LEAD_LISTS, ...SALES_CARDS, ...MONEY, "prospects"];
    case "overdue":
      return ["overdueTasks"];
    case "caseType":
    case "caseStatus":
      return ["cases"];
    case "outageKind":
      return ["outages"];
    case "prospect":
      return [...LEAD_LISTS, "prospectCard", "prospects"];
    case "source":
      return [...LEAD_LISTS, ...SALES_CARDS, ...MONEY, "prospects", "funnel"];
    case "payStatus":
      return MONEY;
    case "late":
      return ["policy", "days"];
    case "outcome":
    case "direction":
    case "recorded":
    case "disposition":
    case "callType":
    case "talkBand":
    case "campaign":
      return [...CALL_CARDS, "trend", "outcomes", "heat", "talkLength", "leaderboard", "usedLeads", "activity", "callList"];
    case "attendance":
    case "short":
    case "dayType":
      return key === "attendance" ? ["policy", "days"] : ["policy"];
    case "target":
      return ["targets"];
    case "dealStage":
      return ["deals", "dealValue", "dealsWon"];
    case "quoteStatus":
      return ["quotes", "quoteValue"];
    case "orderStatus":
    case "orderPayment":
      return ["orders", "orderValue"];
    case "path":
    case "types":
      return ["activity"];
    case "q":
      return [...LEAD_LISTS, ...CALL_CARDS, ...SALES_CARDS, "paid", "pending", "prospects", "overdueTasks", "cases", "deals", "dealValue", "dealsWon", "quotes", "quoteValue", "orders", "orderValue"];
    default:
      return null;
  }
}

export default function filterScope(fx) {
  let allowed = null;
  for (const [key, value] of Object.entries(fx)) {
    if (key === "show" || !(Array.isArray(value) ? value.length : value)) continue;
    const scope = scopeOf(key, value);
    if (!scope) continue;
    allowed = allowed ? new Set(scope.filter((x) => allowed.has(x))) : new Set(scope);
  }
  return allowed;
}
