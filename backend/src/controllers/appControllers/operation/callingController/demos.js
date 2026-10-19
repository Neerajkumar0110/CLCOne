const mongoose = require('mongoose');
const demo = require('../../../../services/sales/demoBookings');
const { CRM_ADMIN_ROLES } = require('../../../../config/roles');

// Live demo (services/sales/demoBookings.js) — the CRM side.
//   GET /api/calling/demos       — Admin / Super Admin: bookings by day
//   GET /api/calling/demos/join  — Admin, Super Admin, Team Manager, Sales
//                                   Manager: today's room as host
const JOIN_ROLES = [...CRM_ADMIN_ROLES, 'Team Manager', 'Sales Manager'];
const isAdmin = (req) => CRM_ADMIN_ROLES.includes(req.admin && req.admin.role);

const list = async (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ success: false, result: null, message: 'Admin only.' });
  const today = demo.istDate();
  const from = /^\d{4}-\d{2}-\d{2}$/.test(req.query.from || '') ? req.query.from : demo.istDate(Date.now() - 7 * 86400000);
  const to = /^\d{4}-\d{2}-\d{2}$/.test(req.query.to || '') ? req.query.to : demo.istDate(Date.now() + 14 * 86400000);
  const rows = await mongoose
    .model('DemoBooking')
    .find({ removed: false, date: { $gte: from, $lte: to } })
    .sort({ date: 1, created: 1 })
    .select('-tokens.agent -tokens.leader')
    .lean();
  const items = rows.map((b) => ({
    _id: b._id,
    lead: b.lead,
    name: b.name,
    phone: b.phone,
    email: b.email,
    date: b.date,
    status: b.status,
    agentName: b.agentName,
    teamLeaderName: b.teamLeaderName,
    rebookCount: b.rebookCount,
    missedDates: b.missedDates,
    attendedAt: b.attendedAt,
    customerLink: b.tokens && b.tokens.customer ? demo.joinLink(b.tokens.customer) : null,
    emails: (b.emails || []).map((e) => ({ kind: e.kind, sent: e.sent, at: e.at })),
    created: b.created,
  }));
  const isDay = demo.isDemoDay(today);
  return res.status(200).json({
    success: true,
    result: {
      today,
      todayIsDemoDay: isDay,
      todayWindow: isDay ? await demo.windowState(today).catch(() => 'over') : 'none',
      todayLive: isDay ? await demo.isLive(today).catch(() => false) : false,
      nextDemoDay: isDay && demo.slotEnd(today) > new Date() ? today : demo.nextDemoDay(today),
      items,
    },
    message: 'ok',
  });
};

// Managers can open the room any time on a demo day (to set it up early);
// customers' links stay gated to 5:50 PM.
const join = async (req, res) => {
  if (!JOIN_ROLES.includes(req.admin && req.admin.role)) {
    return res.status(403).json({ success: false, result: null, message: 'Not allowed.' });
  }
  const today = demo.istDate();
  if (!demo.isDemoDay(today)) {
    return res.status(400).json({ success: false, result: null, message: 'No live demo on Sunday.' });
  }
  const name = `${req.admin.name || ''} ${req.admin.surname || ''}`.trim() || 'Host';
  const url = await demo.joinUrl(today, { role: 'moderator', name: `${name} (Career Lab)`, userId: req.admin._id });
  return res.status(200).json({ success: true, result: { url }, message: 'ok' });
};

// For the Calls page "Join live demo" button (managers): is it time?
const status = async (req, res) => {
  const today = demo.istDate();
  const canJoin = JOIN_ROLES.includes(req.admin && req.admin.role);
  const isDay = demo.isDemoDay(today);
  const win = isDay ? await demo.windowState(today).catch(() => 'over') : 'none';
  return res.status(200).json({
    success: true,
    result: { canJoin, isAdmin: isAdmin(req), today, window: win },
    message: 'ok',
  });
};

module.exports = { list, join, status };
