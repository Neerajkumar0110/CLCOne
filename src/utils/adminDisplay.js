// Shared by pages/Communication (Team Chat) and apps/Header/NotificationBell
// so an admin's name/initials/avatar color render identically in both places.
const AVATAR_PALETTE = ["#2563EB", "#722ED1", "#13C2C2", "#FA8C16", "#EB2F96", "#52C41A", "#D97706", "#0891B2"];

export function initials(name) {
  return (name || "?")
    .split(" ")
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

export function colorForName(name) {
  const sum = (name || "").split("").reduce((s, c) => s + c.charCodeAt(0), 0);
  return AVATAR_PALETTE[sum % AVATAR_PALETTE.length];
}

export function displayName(admin) {
  if (!admin) return "";
  return admin.surname ? `${admin.name} ${admin.surname}` : admin.name;
}
