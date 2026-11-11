const mongoose = require('mongoose');
const deropo = require('../../../../services/whatsapp/deropo');
const access = require('../../../../services/whatsapp/access');
const { departmentOfRole, LMS_PANEL_ROLES } = require('../../../../config/roles');

// /api/whatsapp/* — mounted behind adminAuth.isValidAuthToken (app.js).
// Every route checks WhatsApp access itself (services/whatsapp/access.js);
// admin-only routes check isWhatsAppAdmin. A user only ever reads/sends on
// their OWN chats; CRM admins can read everyone's (Live Chats) but never
// send from someone else's number.

const ok = (res, result, message) => res.status(200).json({ success: true, result, message });
const bad = (res, code, message) => res.status(code).json({ success: false, result: null, message });

const Device = () => mongoose.model('WhatsAppDevice');
const Chat = () => mongoose.model('WhatsAppChat');
const Message = () => mongoose.model('WhatsAppMessage');

const fullName = (a) => [a && a.name, a && a.surname].filter(Boolean).join(' ').trim();

function emit(userId, event, payload) {
  try {
    require('../../../../socket').emitWhatsApp(userId, event, payload);
  } catch (_) {
    /* sockets are a "refetch now" hint only */
  }
}

function deropoFail(res, err, fallback) {
  const code = err instanceof deropo.DeropoError ? (err.status === 503 ? 503 : err.status === 409 ? 409 : 502) : 500;
  return bad(res, code, err.message || fallback);
}

async function requireAccess(req, res) {
  if (await access.hasAccess(req.admin)) return true;
  bad(res, 403, 'You do not have WhatsApp access. Ask an admin to turn it on for you.');
  return false;
}

function requireAdmin(req, res) {
  if (access.isWhatsAppAdmin(req.admin)) return true;
  bad(res, 403, 'Only admins can do this.');
  return false;
}

// A chat the caller may READ: their own, or anyone's for an admin.
async function readableChat(req, res) {
  if (!mongoose.isValidObjectId(req.params.id)) {
    bad(res, 400, 'Invalid chat.');
    return null;
  }
  const chat = await Chat().findById(req.params.id).lean();
  if (!chat) {
    bad(res, 404, 'Chat not found.');
    return null;
  }
  if (String(chat.userId) !== String(req.admin._id) && !access.isWhatsAppAdmin(req.admin)) {
    bad(res, 403, 'This is not your chat.');
    return null;
  }
  return chat;
}

// ---------------------------------------------------------------- me / device

// GET /api/whatsapp/me — does this user get WhatsApp, and their device.
async function me(req, res) {
  const has = await access.hasAccess(req.admin);
  const device = has ? await Device().findOne({ userId: req.admin._id }).lean() : null;
  return ok(res, {
    hasAccess: has,
    isAdmin: access.isWhatsAppAdmin(req.admin),
    configured: deropo.configured(),
    device,
  });
}

// POST /api/whatsapp/device { phoneNumber } — create (or replace) my DeroPo device.
async function createDevice(req, res) {
  if (!(await requireAccess(req, res))) return;
  const phoneNumber = deropo.normaliseNumber(req.body && req.body.phoneNumber);
  if (phoneNumber.length < 11 || phoneNumber.length > 15) return bad(res, 400, 'Enter a valid WhatsApp number with country code.');
  const name = `${fullName(req.admin) || req.admin.email} (CRM)`;
  try {
    const created = await deropo.createDevice({ name, phoneNumber });
    const device = await Device().findOneAndUpdate(
      { userId: req.admin._id },
      {
        $set: {
          userName: fullName(req.admin),
          deviceId: created.deviceId,
          name,
          phoneNumber,
          status: created.status,
          lastCheckedAt: new Date(),
          lastError: null,
        },
        $unset: { connectedAt: 1 },
      },
      { upsert: true, new: true }
    ).lean();
    emit(req.admin._id, 'whatsapp:device', { userId: String(req.admin._id), status: device.status });
    return ok(res, device, 'Scan the QR code with WhatsApp on your phone.');
  } catch (err) {
    return deropoFail(res, err, 'Could not create the WhatsApp device.');
  }
}

// GET /api/whatsapp/device/qr — PNG proxied from DeroPo (token never reaches the browser).
async function deviceQr(req, res) {
  if (!(await requireAccess(req, res))) return;
  const device = await Device().findOne({ userId: req.admin._id }).lean();
  if (!device) return bad(res, 404, 'Connect a number first.');
  try {
    const { type, buffer } = await deropo.getQrImage(device.deviceId);
    res.set('Content-Type', type);
    res.set('Cache-Control', 'no-store');
    return res.send(buffer);
  } catch (err) {
    return deropoFail(res, err, 'QR code is not available.');
  }
}

async function refreshDevice(device) {
  const live = await deropo.getStatus(device.deviceId);
  const set = { status: live.status, lastCheckedAt: new Date(), lastError: null };
  if (live.phoneNumber) set.phoneNumber = deropo.normaliseNumber(live.phoneNumber);
  if (live.status === 'connected' && device.status !== 'connected') set.connectedAt = new Date();
  const updated = await Device().findByIdAndUpdate(device._id, { $set: set }, { new: true }).lean();
  if (updated.status !== device.status) {
    emit(device.userId, 'whatsapp:device', { userId: String(device.userId), status: updated.status });
  }
  return updated;
}

// GET /api/whatsapp/device/status — asks DeroPo now (the page polls this every 3s while the QR shows).
async function deviceStatus(req, res) {
  if (!(await requireAccess(req, res))) return;
  const device = await Device().findOne({ userId: req.admin._id }).lean();
  if (!device) return ok(res, null);
  try {
    return ok(res, await refreshDevice(device));
  } catch (err) {
    await Device().updateOne({ _id: device._id }, { $set: { lastError: err.message, lastCheckedAt: new Date() } });
    return deropoFail(res, err, 'Could not check the WhatsApp status.');
  }
}

// DELETE /api/whatsapp/device — forget my linked number in the CRM (chats stay).
async function removeDevice(req, res) {
  if (!(await requireAccess(req, res))) return;
  await Device().deleteOne({ userId: req.admin._id });
  emit(req.admin._id, 'whatsapp:device', { userId: String(req.admin._id), status: 'none' });
  return ok(res, null, 'WhatsApp number removed. Also remove "Linked devices" on your phone.');
}

// ---------------------------------------------------------------- chats

// GET /api/whatsapp/chats — my chats. Admins may pass ?userId= or ?department= (Live Chats).
async function listChats(req, res) {
  if (!(await requireAccess(req, res))) return;
  const { userId, department, q } = req.query;
  const filter = {};
  if ((userId || department) && !access.isWhatsAppAdmin(req.admin)) return bad(res, 403, 'Only admins can view other users’ chats.');
  if (userId) {
    if (!mongoose.isValidObjectId(userId)) return bad(res, 400, 'Invalid user.');
    filter.userId = userId;
  } else if (department) {
    filter.department = String(department);
  } else {
    filter.userId = req.admin._id;
  }
  if (q) {
    const rx = new RegExp(String(q).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    filter.$or = [{ customerName: rx }, { customerNumber: rx }];
  }
  const rows = await Chat().find(filter).sort({ lastMessageAt: -1 }).limit(300).lean();
  return ok(res, rows);
}

// POST /api/whatsapp/chats { number, name } — start (or reopen) a chat with a customer.
async function openChat(req, res) {
  if (!(await requireAccess(req, res))) return;
  const number = deropo.normaliseNumber(req.body && req.body.number);
  if (number.length < 11 || number.length > 15) return bad(res, 400, 'Enter a valid number with country code.');
  const name = String((req.body && req.body.name) || '').trim().slice(0, 120);
  const device = await Device().findOne({ userId: req.admin._id }).lean();
  const chat = await Chat().findOneAndUpdate(
    { userId: req.admin._id, customerNumber: number },
    {
      $setOnInsert: {
        userName: fullName(req.admin),
        department: departmentOfRole(req.admin.role),
        deviceId: device && device.deviceId,
      },
      ...(name ? { $set: { customerName: name } } : {}),
    },
    { upsert: true, new: true }
  ).lean();
  return ok(res, chat);
}

// GET /api/whatsapp/chats/:id/messages
async function chatMessages(req, res) {
  if (!(await requireAccess(req, res))) return;
  const chat = await readableChat(req, res);
  if (!chat) return;
  const rows = await Message().find({ chatId: chat._id }).sort({ at: -1 }).limit(500).lean();
  return ok(res, { chat, messages: rows.reverse() });
}

// POST /api/whatsapp/chats/:id/read — only the owner's reading clears unread.
async function markRead(req, res) {
  if (!(await requireAccess(req, res))) return;
  const chat = await readableChat(req, res);
  if (!chat) return;
  if (String(chat.userId) === String(req.admin._id) && chat.unread) {
    await Chat().updateOne({ _id: chat._id }, { $set: { unread: 0 } });
    emit(chat.userId, 'whatsapp:chat', { chatId: String(chat._id), userId: String(chat.userId) });
  }
  return ok(res, null);
}

// POST /api/whatsapp/chats/:id/send { message } — text from MY connected number.
async function send(req, res) {
  if (!(await requireAccess(req, res))) return;
  const chat = await readableChat(req, res);
  if (!chat) return;
  if (String(chat.userId) !== String(req.admin._id)) return bad(res, 403, 'Only the user who owns this chat can reply.');
  const text = String((req.body && req.body.message) || '').trim();
  if (!text) return bad(res, 400, 'Type a message.');
  if (text.length > 4000) return bad(res, 400, 'Message is too long (4000 characters max).');

  const device = await Device().findOne({ userId: req.admin._id }).lean();
  if (!device || device.status !== 'connected') return bad(res, 409, 'Your WhatsApp is not connected. Scan the QR code first.');

  const msg = await Message().create({
    chatId: chat._id,
    userId: chat.userId,
    deviceId: device.deviceId,
    customerNumber: chat.customerNumber,
    direction: 'outgoing',
    type: 'text',
    text,
    status: 'sending',
    at: new Date(),
  });

  let status = 'sent';
  let error = null;
  let providerMessageId = null;
  try {
    ({ providerMessageId } = await deropo.sendText({ deviceId: device.deviceId, number: chat.customerNumber, message: text }));
  } catch (err) {
    status = 'failed';
    error = err.message;
  }
  const saved = await Message().findByIdAndUpdate(msg._id, { $set: { status, error, providerMessageId } }, { new: true }).lean();
  await Chat().updateOne(
    { _id: chat._id },
    { $set: { lastMessage: text, lastMessageAt: saved.at, lastDirection: 'outgoing', deviceId: device.deviceId } }
  );
  emit(chat.userId, 'whatsapp:message', { chatId: String(chat._id), userId: String(chat.userId), department: chat.department });
  if (status === 'failed') return bad(res, 502, `Message not sent: ${error}`);
  return ok(res, saved);
}

// ---------------------------------------------------------------- admin

async function crmUsers() {
  const Admin = mongoose.model('Admin');
  return Admin.find({ removed: false, enabled: true, role: { $nin: LMS_PANEL_ROLES } })
    .select('name surname email role')
    .sort({ name: 1 })
    .lean();
}

// GET /api/whatsapp/admin/access — the config + every CRM user with their effective access.
async function getAccess(req, res) {
  if (!requireAdmin(req, res)) return;
  const [config, users, devices, chatCounts] = await Promise.all([
    access.loadConfig(),
    crmUsers(),
    Device().find({}).lean(),
    Chat().aggregate([{ $group: { _id: '$userId', chats: { $sum: 1 }, unread: { $sum: '$unread' } } }]),
  ]);
  const deviceBy = new Map(devices.map((d) => [String(d.userId), d]));
  const countBy = new Map(chatCounts.map((c) => [String(c._id), c]));
  const modeBy = new Map((config.users || []).map((u) => [String(u.userId), u.mode]));
  const rows = users.map((u) => {
    const id = String(u._id);
    const e = access.evaluate(config, u);
    const d = deviceBy.get(id);
    const c = countBy.get(id);
    return {
      _id: id,
      name: fullName(u) || u.email,
      email: u.email,
      role: u.role,
      department: departmentOfRole(u.role),
      mode: modeBy.get(id) || 'inherit',
      hasAccess: e.on,
      source: e.source,
      device: d ? { status: d.status, phoneNumber: d.phoneNumber, lastCheckedAt: d.lastCheckedAt } : null,
      chats: c ? c.chats : 0,
      unread: c ? c.unread : 0,
    };
  });
  return ok(res, {
    departments: access.sanitise(config).departments,
    departmentNames: access.ACCESS_DEPARTMENTS,
    departmentRoles: Object.fromEntries(
      access.ACCESS_DEPARTMENTS.map((d) => [d, require('../../../../config/roles').DEPARTMENT_ROLES[d] || []])
    ),
    users: rows,
    configured: deropo.configured(),
  });
}

// PUT /api/whatsapp/admin/access { departments, users:[{userId, mode}] }
async function saveAccess(req, res) {
  if (!requireAdmin(req, res)) return;
  const clean = access.sanitise(req.body || {});
  const WhatsAppAccess = mongoose.model('WhatsAppAccess');
  await WhatsAppAccess.updateOne(
    { key: 'global' },
    { $set: { departments: clean.departments, users: clean.users, updatedBy: req.admin._id } },
    { upsert: true }
  );
  // Every open CRM tab re-checks its WhatsApp access (sidebar item appears/disappears).
  try {
    require('../../../../socket').emitBroadcast('whatsapp:access', { at: Date.now() });
  } catch (_) {
    /* ignore */
  }
  return ok(res, clean, 'WhatsApp access saved.');
}

// POST /api/whatsapp/admin/devices/refresh — re-check every linked number with DeroPo.
async function refreshAllDevices(req, res) {
  if (!requireAdmin(req, res)) return;
  const devices = await Device().find({}).lean();
  let failed = 0;
  for (const d of devices) {
    try {
      await refreshDevice(d);
    } catch (err) {
      failed += 1;
      await Device().updateOne({ _id: d._id }, { $set: { lastError: err.message, lastCheckedAt: new Date() } });
    }
  }
  return ok(res, { checked: devices.length, failed });
}

module.exports = {
  me,
  createDevice,
  deviceQr,
  deviceStatus,
  removeDevice,
  listChats,
  openChat,
  chatMessages,
  markRead,
  send,
  getAccess,
  saveAccess,
  refreshAllDevices,
};
