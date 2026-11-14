const crypto = require('crypto');
const mongoose = require('mongoose');
const deropo = require('../../../../services/whatsapp/deropo');

// POST /api/whatsapp-webhook/:secret — PUBLIC (DeroPo calls it). Set this URL
// in the DeroPo dashboard as the incoming-message webhook:
//   https://<crm-domain>/api/whatsapp-webhook/<WHATSAPP_WEBHOOK_SECRET>
//
// DeroPo's payload format isn't documented to us, so read the common field
// names WhatsApp gateways use, and keep every raw body in WhatsAppWebhookLog
// so unmatched payloads can be mapped later.

const pick = (...vals) => vals.find((v) => v !== undefined && v !== null && v !== '');

function parse(body) {
  const b = body || {};
  const d = b.data && typeof b.data === 'object' ? b.data : {};
  const m = (d.message && typeof d.message === 'object' ? d.message : null) || (b.message && typeof b.message === 'object' ? b.message : null) || {};
  const deviceId = pick(b.device_id, b.deviceId, b.device, d.device_id, d.deviceId);
  const fromRaw = pick(b.from, b.sender, b.number, b.phone, d.from, d.sender, d.number, d.phone, m.from, d.remoteJid, m.remoteJid);
  // DeroPo (documented): { event, timestamp, data: { message_id, device_id, from, content, … } }
  const text = pick(
    d.content,
    b.content,
    typeof b.message === 'string' ? b.message : undefined,
    typeof d.message === 'string' ? d.message : undefined,
    b.text, b.body, d.text, d.body, m.text, m.body, m.conversation, m.caption
  );
  const id = pick(b.message_id, b.messageId, b.id, d.message_id, d.messageId, d.id, m.id);
  const fromMe = !!pick(b.fromMe, b.from_me, d.fromMe, d.from_me, m.fromMe);
  const name = pick(b.pushname, b.pushName, b.name, d.sender_name, d.contact_name, d.pushname, d.pushName, d.name, m.pushName);
  const ts = pick(d.received_at, d.timestamp, b.timestamp, m.timestamp);
  let at = new Date();
  if (ts) {
    const n = Number(ts);
    const t = Number.isFinite(n) ? new Date(n < 1e12 ? n * 1000 : n) : new Date(ts);
    if (!Number.isNaN(t.getTime())) at = t;
  }
  return {
    event: b.event ? String(b.event) : null,
    deviceId: deviceId != null ? String(deviceId) : null,
    from: fromRaw ? deropo.normaliseNumber(String(fromRaw).split('@')[0]) : null,
    text: text != null ? String(text) : null,
    providerMessageId: id != null ? String(id) : null,
    fromMe,
    name: name ? String(name).slice(0, 120) : null,
    at,
    isGroup: String(fromRaw || '').includes('@g.us'),
  };
}

function secretMatches(given) {
  const want = process.env.WHATSAPP_WEBHOOK_SECRET || '';
  if (!want) return false;
  const a = Buffer.from(String(given || ''));
  const b = Buffer.from(want);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

async function incoming(req, res) {
  if (!secretMatches(req.params.secret)) return res.status(404).json({ success: false });

  const Log = mongoose.model('WhatsAppWebhookLog');
  const log = await Log.create({ body: req.body });
  // Answer DeroPo straight away; store the message after.
  res.status(200).json({ success: true });

  try {
    const p = parse(req.body);
    const note = (msg) => Log.updateOne({ _id: log._id }, { $set: { note: msg } });
    // message_sent / delivered / read / failed are about OUR sends — only
    // message_received creates a chat message.
    if (p.event && p.event !== 'message_received') return note(`event ${p.event} — not stored`);
    if (!p.deviceId) return note('no device id');
    if (!p.from || !p.text) return note('no sender or text (maybe a status/ack event)');
    if (p.isGroup) return note('group message — ignored');

    const device = await mongoose.model('WhatsAppDevice').findOne({ deviceId: p.deviceId }).lean();
    if (!device) return note(`device ${p.deviceId} is not linked to any CRM user`);

    const Message = mongoose.model('WhatsAppMessage');
    if (p.providerMessageId && (await Message.exists({ providerMessageId: p.providerMessageId }))) {
      return note('duplicate');
    }

    const Admin = mongoose.model('Admin');
    const owner = await Admin.findById(device.userId).select('name surname role').lean();
    const { departmentOfRole } = require('../../../../config/roles');
    const direction = p.fromMe ? 'outgoing' : 'incoming';

    const chat = await mongoose.model('WhatsAppChat').findOneAndUpdate(
      { userId: device.userId, customerNumber: p.from },
      {
        $setOnInsert: {
          userName: owner ? [owner.name, owner.surname].filter(Boolean).join(' ') : device.userName,
          department: device.kind === 'business' ? 'Business' : owner ? departmentOfRole(owner.role) : undefined,
          ...(p.name && !p.fromMe ? { customerName: p.name } : {}),
        },
        $set: { deviceId: device.deviceId, lastMessage: p.text, lastMessageAt: p.at, lastDirection: direction },
        ...(direction === 'incoming' ? { $inc: { unread: 1 } } : {}),
      },
      { upsert: true, new: true }
    ).lean();

    await Message.create({
      chatId: chat._id,
      userId: device.userId,
      deviceId: device.deviceId,
      customerNumber: p.from,
      direction,
      type: 'text',
      text: p.text,
      status: direction === 'incoming' ? 'received' : 'sent',
      providerMessageId: p.providerMessageId,
      at: p.at,
    });
    await Log.updateOne({ _id: log._id }, { $set: { handled: true } });

    // Every incoming WhatsApp chat is a lead (user ask 2026-11-14: "sab lead
    // chahiye, name ho ya na ho") — one lead per number; an existing lead with
    // the same phone is linked, never duplicated.
    if (direction === 'incoming') {
      require('../../../../services/marketing/chatLeads')
        .upsertChatLead({ channel: 'whatsapp', conversationId: p.from, name: chat.customerName || p.name, phone: p.from, text: p.text, at: p.at })
        .catch((e) => console.error('[whatsapp] chat lead failed:', e.message));
    }

    try {
      require('../../../../socket').emitWhatsApp(device.userId, 'whatsapp:message', {
        chatId: String(chat._id),
        userId: String(device.userId),
        department: chat.department,
        incoming: direction === 'incoming',
        from: chat.customerName || p.from,
        text: p.text.slice(0, 120),
      });
    } catch (_) {
      /* ignore */
    }
  } catch (err) {
    await Log.updateOne({ _id: log._id }, { $set: { note: `error: ${err.message}` } }).catch(() => {});
  }
}

module.exports = { incoming, parse };
