// The Sales One Place menu — shared by the /sales-v3 shell and the CRM sidebar
// (agents see these tabs right under Sales).
export const SUPER_ADMIN_ROLES = ["owner", "Super Admin"];

// Icons — the same paths the design's sidebar uses.
export const D = {
  chart: "M3 3v18h18M8 17V9M13 17V5M18 17v-3",
  list: "M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01",
  zap: "M13 2L3 14h9l-1 8 10-12h-9l1-8z",
  phone: "M22 16.9v3a2 2 0 0 1-2.2 2A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7l.7 2.8a2 2 0 0 1-.5 2.1L8 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4l2.8.7a2 2 0 0 1 1.7 2z",
  user: "M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M12 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8z",
  clock: "M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zM12 6v6l4 2",
  chat: "M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z",
  hist: "M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5M12 7v5l3 2",
  play: "M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zM10 8l6 4-6 4z",
  team: "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM22 21v-2a4 4 0 0 0-3-3.9",
  wallet: "M19 7V5a2 2 0 0 0-2-2H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-3a2 2 0 0 0 0 4h3v3a1 1 0 0 1-1 1H5a2 2 0 0 1-2-2V5",
  video: "M23 7l-7 5 7 5zM14 5H3a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2z",
  rep: "M3 3v18h18M7 14l4-4 4 4 5-6",
  funnel: "M22 3H2l8 9.5V19l4 2v-8.5z",
  coin: "M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zM15 9h-4.5a1.5 1.5 0 0 0 0 3h3a1.5 1.5 0 0 1 0 3H9",
  doc: "M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6",
  cap: "M22 10L12 5 2 10l10 5 10-5zM6 12v5c3 2 9 2 12 0v-5",
  gauge: "M12 14l4-4M3.3 19a10 10 0 1 1 17.4 0",
  rocket: "M5 19c-1.5 1.3-2 3-2 3s1.7-.5 3-2M12 15l-3-3a22 22 0 0 1 2-3.9A12.9 12.9 0 0 1 22 2c0 2.7-.8 7.5-6 11a22.4 22.4 0 0 1-4 2z",
};

export const ADMIN = ["owner", "Super Admin", "Admin"];
export const MANAGEMENT = ["owner", "Super Admin", "Admin", "Sales Manager", "Team Manager"];

// [key, label, icon, module ('Sales' | 'Calling'), extra rule]
// extra rule: "admin" = ADMIN only, "superAdmin" = SUPER_ADMIN_ROLES only,
// "management" = MANAGEMENT only (hidden from sales agents, user ask 2026-11-20).
export const GROUPS = [
  ["Daily work", [
    ["dashboard", "Dashboard", "chart", "Sales"],
    ["leads", "Leads", "list", "Sales"],
    ["auto", "Auto Dialer", "zap", "Calling"],
    ["dialer", "Dialer", "phone", "Calling"],
    ["agent", "Agent Screen", "user", "Calling"],
    ["callbacks", "Callbacks", "clock", "Calling"],
    ["chats", "Ad Chats", "chat", "Sales", "superAdmin"],
  ]],
  ["Records & team", [
    ["history", "Call History", "hist", "Calling"],
    ["recordings", "Recordings", "play", "Calling"],
    ["team", "Team & Attendance", "team", "Sales"],
    ["payments", "Payments", "wallet", "Sales"],
    ["demos", "Live Demos", "video", "Calling", "admin"],
    ["reports", "Call Reports", "rep", "Calling", "admin"],
  ]],
  ["More", [
    ["pipeline", "Pipeline", "funnel", "Sales"],
    ["deals", "Deals", "coin", "Sales"],
    ["quotes", "Quotes", "doc", "Sales"],
    ["candidates", "Candidates", "cap", "Sales", "management"],
    ["callsdash", "Calls Dashboard", "gauge", "Calling", "management"],
    ["campaigns", "Campaigns", "rocket", "Calling", "management"],
  ]],
];
// Agent side of the design: "My …" names.
export const MY = { dashboard: "My Day", team: "My Attendance" };

// The groups this role can see.
export function visibleGroups(canView, role) {
  const allowed = (mod, rule) => canView(mod) && (rule !== "admin" || ADMIN.includes(role)) && (rule !== "management" || MANAGEMENT.includes(role)) && (rule !== "superAdmin" || SUPER_ADMIN_ROLES.includes(role));
  return GROUPS.map(([name, items]) => [name, items.filter(([, , , mod, rule]) => allowed(mod, rule))]).filter(([, items]) => items.length);
}
