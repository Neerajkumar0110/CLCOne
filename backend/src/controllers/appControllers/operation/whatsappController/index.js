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
  // a linked phone brings its whole history (hundreds of chats) — list them all
  const rows = await Chat().find(filter).sort({ lastMessageAt: -1 }).limit(2000).lean();
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
  let rows = await Message().find({ chatId: chat._id }).sort({ at: -1 }).limit(500).lean();
  // photos / documents not yet on this server's disk: fetch them now
  if (await require('../../../../services/whatsapp/media').backfill(rows).catch(() => 0)) {
    rows = await Message().find({ chatId: chat._id }).sort({ at: -1 }).limit(500).lean();
  }
  return ok(res, { chat, messages: rows.reverse() });
}

// POST /api/whatsapp/chats/:id/read — only the owner's reading clears unread.
async function markRead(req, res) {
  if (!(await requireAccess(req, res))) return;
  const chat = await readableChat(req, res);
  if (!chat) return;
  const isOwner = String(chat.userId) === String(req.admin._id);
  const isBusinessChat = !isOwner && access.isWhatsAppAdmin(req.admin) && (await Device().exists({ userId: chat.userId, kind: 'business' }));
  if ((isOwner || isBusinessChat) && chat.unread) {
    await Chat().updateOne({ _id: chat._id }, { $set: { unread: 0 } });
    emit(chat.userId, 'whatsapp:chat', { chatId: String(chat._id), userId: String(chat.userId) });
  }
  return ok(res, null);
}

// POST /api/whatsapp/chats/:id/unread — "Mark as unread" (WhatsApp's own:
// a chat with nothing unread gets a 1), same rule as markRead.
async function markUnread(req, res) {
  if (!(await requireAccess(req, res))) return;
  const chat = await readableChat(req, res);
  if (!chat) return;
  const isOwner = String(chat.userId) === String(req.admin._id);
  const isBusinessChat = !isOwner && access.isWhatsAppAdmin(req.admin) && (await Device().exists({ userId: chat.userId, kind: 'business' }));
  if (!isOwner && !isBusinessChat) return bad(res, 403, 'Only the number’s owner can mark this chat unread.');
  if (!chat.unread) {
    await Chat().updateOne({ _id: chat._id }, { $set: { unread: 1 } });
    emit(chat.userId, 'whatsapp:chat', { chatId: String(chat._id), userId: String(chat.userId) });
  }
  return ok(res, null);
}

// POST /api/whatsapp/chats/read-all { userId? } — every chat of my number (or of
// a business number, for WhatsApp admins) marked read.
async function markAllRead(req, res) {
  if (!(await requireAccess(req, res))) return;
  let userId = req.admin._id;
  const asked = req.body && req.body.userId;
  if (asked && String(asked) !== String(req.admin._id)) {
    if (!mongoose.isValidObjectId(asked) || !access.isWhatsAppAdmin(req.admin) || !(await Device().exists({ userId: asked, kind: 'business' }))) {
      return bad(res, 403, 'You can only mark your own chats read.');
    }
    userId = asked;
  }
  const r = await Chat().updateMany({ userId, unread: { $gt: 0 } }, { $set: { unread: 0 } });
  if (r.modifiedCount) emit(userId, 'whatsapp:chat', { userId: String(userId) });
  return ok(res, { updated: r.modifiedCount });
}

// POST /api/whatsapp/chats/:id/send  multipart { message?, replyTo?, file? } —
// text, a photo / document and/or a reply, from the chat's own number.
async function send(req, res) {
  const { sendWhatsAppMessage, uploadedFile } = require('../../../../services/whatsapp/sendMessage');
  const file = uploadedFile(req);
  const dropFile = () => file && require('fs').unlink(file.path, () => {});
  if (!(await requireAccess(req, res))) return dropFile();
  const chat = await readableChat(req, res);
  if (!chat) return dropFile();
  // The chat's own number sends: the owner's personal number, or — for a
  // business number's chat — that business number (any WhatsApp admin).
  const device = await Device().findOne({ userId: chat.userId }).lean();
  const isBusiness = device && device.kind === 'business';
  if (String(chat.userId) !== String(req.admin._id) && !(isBusiness && access.isWhatsAppAdmin(req.admin))) {
    dropFile();
    return bad(res, 403, 'Only the user who owns this chat can reply.');
  }
  if (!device || device.status !== 'connected') {
    dropFile();
    return bad(res, 409, isBusiness ? 'This business number is not connected. Scan its QR code first.' : 'Your WhatsApp is not connected. Scan the QR code first.');
  }

  let out;
  try {
    out = await sendWhatsAppMessage({ req, chat, device, text: req.body && req.body.message, file, replyTo: req.body && req.body.replyTo });
  } catch (e) {
    if (e.status) return bad(res, e.status, e.message);
    throw e;
  }
  const { saved, status, error, preview } = out;
  emit(chat.userId, 'whatsapp:message', { chatId: String(chat._id), userId: String(chat.userId), department: chat.department });
  if (status === 'failed') return bad(res, 502, `Message not sent: ${error}`);
  // Ad chat inbox (owner / Super Admin) refreshes this conversation live.
  require('../../../../services/marketing/chatLeads').pingChat('whatsapp', chat.customerNumber, preview);
  return ok(res, saved);
}

// The InternX-AI curriculum PDF (Foundation + Elite, 2026 edition) — shipped with
// the code at src/public/curriculum/internx/. WhatsApp downloads it from the LIVE
// address, so a laptop can send it too once the live CRM has the file.
const CURRICULUM_PATH = '/public/curriculum/internx/InternX-AI-Curriculum-2026.pdf';
const CURRICULUM_NAME = 'InternX-AI Curriculum - Foundation & Elite (2026).pdf';
const LIVE_BASE = (process.env.PUBLIC_BASE_URL || process.env.ENQUIRY_FORM_BASE_URL || 'https://clcone.careerlabconsulting.com').replace(/\/+$/, '');

// POST /api/whatsapp/send-curriculum { phone, name?, leadId? } — from the caller's
// OWN linked WhatsApp to the number on the call: a short welcome with the
// customer's name (Auto-reply › call screen welcome), then the curriculum PDF.
async function sendCurriculum(req, res) {
  if (!(await requireAccess(req, res))) return;
  const autoReply = require('../../../../services/whatsapp/autoReply');
  const { sendWhatsAppMessage } = require('../../../../services/whatsapp/sendMessage');
  const b = req.body || {};
  const digits = String(b.phone || '').replace(/\D/g, '');
  const number = deropo.normaliseNumber(digits.length === 10 ? `91${digits}` : digits);
  if (number.length < 11 || number.length > 15) return bad(res, 400, 'This call has no valid phone number.');
  const device = await Device().findOne({ userId: req.admin._id }).lean();
  if (!device || device.status !== 'connected') return bad(res, 409, 'Your WhatsApp is not connected. Open the WhatsApp button in the header and scan the QR code first.');

  // the PDF must be reachable where WhatsApp fetches it — check before the welcome goes alone
  const pdfUrl = LIVE_BASE + CURRICULUM_PATH;
  let size = 0;
  try {
    const head = await fetch(pdfUrl, { method: 'HEAD', signal: AbortSignal.timeout(10000) });
    if (!head.ok || !/pdf/i.test(head.headers.get('content-type') || '')) throw new Error(`HTTP ${head.status}`);
    size = Number(head.headers.get('content-length') || 0);
  } catch (e) {
    return bad(res, 503, 'The curriculum PDF is not on the live CRM yet (it goes there with the next deploy). Nothing was sent.');
  }

  const name = String(b.name || '').trim().slice(0, 120);
  const realName = name && !/^unknown( number)?$/i.test(name) && !/^\+?\d[\d\s-]+$/.test(name) ? name : '';
  const cfg = await autoReply.loadConfig({ fresh: true });
  const welcome = autoReply.fill(cfg.callWelcomeText || autoReply.DEFAULTS.callWelcomeText, {
    name: realName ? autoReply.firstName({ name: realName }) : '',
    course: 'InternX-AI',
  });

  const chat = await Chat().findOneAndUpdate(
    { userId: req.admin._id, customerNumber: number },
    {
      $setOnInsert: { userName: fullName(req.admin), department: departmentOfRole(req.admin.role) },
      $set: { deviceId: device.deviceId },
    },
    { upsert: true, new: true }
  ).lean();
  if (!chat.customerName && realName) await Chat().updateOne({ _id: chat._id }, { $set: { customerName: realName } });

  const ping = () => emit(chat.userId, 'whatsapp:message', { chatId: String(chat._id), userId: String(chat.userId), department: chat.department });
  let first;
  let second;
  try {
    first = await sendWhatsAppMessage({ req, chat, device, text: welcome });
    ping();
    if (first.status === 'failed') return bad(res, 502, `Message not sent: ${first.error}`);
    second = await sendWhatsAppMessage({ req, chat, device, text: '', remote: { path: CURRICULUM_PATH, url: pdfUrl, mime: 'application/pdf', fileName: CURRICULUM_NAME, size } });
    ping();
  } catch (e) {
    if (e.status) return bad(res, e.status, e.message);
    throw e;
  }
  require('../../../../services/marketing/chatLeads').pingChat('whatsapp', number, second.preview);
  if (second.status === 'failed') return bad(res, 502, `The welcome message went, but the PDF did not: ${second.error}`);
  if (b.leadId && mongoose.isValidObjectId(b.leadId)) {
    await mongoose
      .model('Lead')
      .updateOne({ _id: b.leadId, waCurriculumAt: { $exists: false } }, { $set: { waCurriculumAt: new Date() } })
      .catch(() => null);
  }
  return ok(res, { chatId: chat._id, number });
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

// ---------------------------------------------------------------- business numbers
// Company WhatsApp numbers added from the admin page (not tied to one user).
// Every route below is admin-only.

async function businessDevice(req, res) {
  if (!requireAdmin(req, res)) return null;
  if (!mongoose.isValidObjectId(req.params.id)) {
    bad(res, 400, 'Invalid number.');
    return null;
  }
  const d = await Device().findOne({ _id: req.params.id, kind: 'business' }).lean();
  if (!d) bad(res, 404, 'Business number not found.');
  return d;
}

// GET /api/whatsapp/admin/webhook — the URL to paste into DeroPo › Profile ›
// Webhook Settings (admins only; it carries the secret), plus when DeroPo last
// called it, so the admin can see the webhook is really working.
async function webhookInfo(req, res) {
  if (!requireAdmin(req, res)) return;
  const secret = process.env.WHATSAPP_WEBHOOK_SECRET || '';
  const base = (process.env.WHATSAPP_WEBHOOK_BASE || 'https://clcone.careerlabconsulting.com').replace(/\/+$/, '');
  const Log = mongoose.model('WhatsAppWebhookLog');
  const [last, lastHandled, total24h] = await Promise.all([
    Log.findOne({}).sort({ _id: -1 }).select('createdAt note handled body.event').lean(),
    Log.findOne({ handled: true }).sort({ _id: -1 }).select('createdAt').lean(),
    Log.countDocuments({ _id: { $gte: mongoose.Types.ObjectId.createFromTime(Math.floor(Date.now() / 1000) - 86400) } }),
  ]);
  return ok(res, {
    ready: !!secret,
    url: secret ? `${base}/api/whatsapp-webhook/${secret}` : null,
    lastCallAt: last ? last.createdAt || last._id.getTimestamp() : null,
    lastNote: last ? last.note || (last.handled ? 'message stored' : last.body && last.body.event) : null,
    lastMessageAt: lastHandled ? lastHandled.createdAt || lastHandled._id.getTimestamp() : null,
    calls24h: total24h,
  });
}

// GET /api/whatsapp/admin/business — every business number + chat / unread counts.
async function listBusiness(req, res) {
  if (!requireAdmin(req, res)) return;
  const rows = await Device().find({ kind: 'business' }).sort({ createdAt: 1 }).lean();
  const counts = await Chat().aggregate([
    { $match: { userId: { $in: rows.map((r) => r.userId) } } },
    { $group: { _id: '$userId', chats: { $sum: 1 }, unread: { $sum: '$unread' } } },
  ]);
  const by = new Map(counts.map((c) => [String(c._id), c]));
  return ok(res, {
    configured: deropo.configured(),
    numbers: rows.map((r) => ({ ...r, chats: (by.get(String(r.userId)) || {}).chats || 0, unread: (by.get(String(r.userId)) || {}).unread || 0 })),
  });
}

// POST /api/whatsapp/admin/business { label, phoneNumber } — new DeroPo device → QR.
async function createBusiness(req, res) {
  if (!requireAdmin(req, res)) return;
  const phoneNumber = deropo.normaliseNumber(req.body && req.body.phoneNumber);
  if (phoneNumber.length < 11 || phoneNumber.length > 15) return bad(res, 400, 'Enter a valid WhatsApp number with country code.');
  const label = String((req.body && req.body.label) || '').trim().slice(0, 60) || 'Business WhatsApp';
  if (await Device().exists({ kind: 'business', phoneNumber })) return bad(res, 409, 'This number is already added — use "New QR" on it instead.');
  try {
    const created = await deropo.createDevice({ name: `${label} (CRM business)`, phoneNumber });
    const device = await Device().create({
      kind: 'business',
      userId: new mongoose.Types.ObjectId(),
      userName: label,
      label,
      createdBy: req.admin._id,
      deviceId: created.deviceId,
      name: `${label} (CRM business)`,
      phoneNumber,
      status: created.status,
      lastCheckedAt: new Date(),
    });
    emit(null, 'whatsapp:device', { business: true, id: String(device._id), status: device.status });
    return ok(res, device.toObject(), 'Scan the QR code with WhatsApp on the business phone.');
  } catch (err) {
    return deropoFail(res, err, 'Could not add the business number.');
  }
}

// POST /api/whatsapp/admin/business/:id/relink — fresh DeroPo device (new QR) for the same number.
async function relinkBusiness(req, res) {
  const d = await businessDevice(req, res);
  if (!d) return;
  try {
    const created = await deropo.createDevice({ name: d.name || `${d.label} (CRM business)`, phoneNumber: d.phoneNumber });
    const updated = await Device().findByIdAndUpdate(
      d._id,
      { $set: { deviceId: created.deviceId, status: created.status, lastCheckedAt: new Date(), lastError: null }, $unset: { connectedAt: 1 } },
      { new: true }
    ).lean();
    return ok(res, updated, 'Scan the new QR code.');
  } catch (err) {
    return deropoFail(res, err, 'Could not create a new QR code.');
  }
}

// GET /api/whatsapp/admin/business/:id/qr — PNG
async function businessQr(req, res) {
  const d = await businessDevice(req, res);
  if (!d) return;
  try {
    const { type, buffer } = await deropo.getQrImage(d.deviceId);
    res.set('Content-Type', type);
    res.set('Cache-Control', 'no-store');
    return res.send(buffer);
  } catch (err) {
    return deropoFail(res, err, 'QR code is not available.');
  }
}

// GET /api/whatsapp/admin/business/:id/status — ask DeroPo now
async function businessStatus(req, res) {
  const d = await businessDevice(req, res);
  if (!d) return;
  try {
    return ok(res, await refreshDevice(d));
  } catch (err) {
    await Device().updateOne({ _id: d._id }, { $set: { lastError: err.message, lastCheckedAt: new Date() } });
    return deropoFail(res, err, 'Could not check the WhatsApp status.');
  }
}

// PATCH /api/whatsapp/admin/business/:id { label }
async function renameBusiness(req, res) {
  const d = await businessDevice(req, res);
  if (!d) return;
  const label = String((req.body && req.body.label) || '').trim().slice(0, 60);
  if (!label) return bad(res, 400, 'Enter a name.');
  await Device().updateOne({ _id: d._id }, { $set: { label, userName: label } });
  await Chat().updateMany({ userId: d.userId }, { $set: { userName: label } });
  return ok(res, null, 'Renamed.');
}

// DELETE /api/whatsapp/admin/business/:id — forget the number in the CRM (chats stay readable).
async function removeBusiness(req, res) {
  const d = await businessDevice(req, res);
  if (!d) return;
  await Device().deleteOne({ _id: d._id });
  emit(null, 'whatsapp:device', { business: true, id: String(d._id), status: 'none' });
  return ok(res, null, 'Number removed from the CRM. Also remove it under "Linked devices" on that phone.');
}

// POST /api/whatsapp/admin/business/:id/chats { number, name } — start a chat from this business number.
async function openBusinessChat(req, res) {
  const d = await businessDevice(req, res);
  if (!d) return;
  const number = deropo.normaliseNumber(req.body && req.body.number);
  if (number.length < 11 || number.length > 15) return bad(res, 400, 'Enter a valid number with country code.');
  const name = String((req.body && req.body.name) || '').trim().slice(0, 120);
  const chat = await Chat().findOneAndUpdate(
    { userId: d.userId, customerNumber: number },
    { $setOnInsert: { userName: d.label, department: 'Business', deviceId: d.deviceId }, ...(name ? { $set: { customerName: name } } : {}) },
    { upsert: true, new: true }
  ).lean();
  return ok(res, chat);
}

// GET / PUT /api/whatsapp/admin/auto-reply — the ad-chat welcome + curriculum auto-reply (services/whatsapp/autoReply.js)
async function getAutoReply(req, res) {
  if (!requireAdmin(req, res)) return;
  const autoReply = require('../../../../services/whatsapp/autoReply');
  const cfg = await autoReply.loadConfig({ fresh: true });
  const Lead = mongoose.model('Lead');
  const since = new Date(Date.now() - 7 * 864e5);
  const [welcomes, curricula, forms] = await Promise.all([
    Lead.countDocuments({ waWelcomeAt: { $gte: since } }),
    Lead.countDocuments({ waCurriculumAt: { $gte: since } }),
    Lead.countDocuments({ enquiryAt: { $gte: since } }),
  ]);
  return res.status(200).json({ success: true, result: { config: cfg, defaults: autoReply.DEFAULTS, stats: { days: 7, welcomes, curricula, forms } }, message: 'ok' });
}
async function saveAutoReply(req, res) {
  if (!requireAdmin(req, res)) return;
  try {
    const cfg = await require('../../../../services/whatsapp/autoReply').saveConfig(req.body || {}, req.admin && req.admin.name);
    return res.status(200).json({ success: true, result: { config: cfg }, message: 'Saved' });
  } catch (e) {
    return bad(res, 400, e.message);
  }
}

module.exports = {
  getAutoReply,
  saveAutoReply,
  webhookInfo,
  listBusiness,
  createBusiness,
  relinkBusiness,
  businessQr,
  businessStatus,
  renameBusiness,
  removeBusiness,
  openBusinessChat,
  me,
  createDevice,
  deviceQr,
  deviceStatus,
  removeDevice,
  listChats,
  openChat,
  chatMessages,
  markRead,
  markUnread,
  markAllRead,
  sendCurriculum,
  send,
  getAccess,
  saveAccess,
  refreshAllDevices,
};
