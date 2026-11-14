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

// Wrappers WhatsApp puts around the real message (disappearing, view-once, …).
const WRAPPERS = ['ephemeralMessage', 'viewOnceMessage', 'viewOnceMessageV2', 'viewOnceMessageV2Extension', 'documentWithCaptionMessage', 'editedMessage'];
// Messages that are not a customer writing anything — never a chat line.
const SYSTEM = ['protocolMessage', 'senderKeyDistributionMessage', 'reactionMessage', 'pollUpdateMessage', 'keepInChatMessage', 'messageContextInfo'];

function unwrap(m) {
  let cur = m;
  for (let i = 0; i < 5 && cur && typeof cur === 'object'; i += 1) {
    const w = WRAPPERS.find((k) => cur[k] && cur[k].message);
    if (!w) break;
    cur = cur[w].message;
  }
  return cur && typeof cur === 'object' ? cur : {};
}

// DeroPo's real payload (seen 2026-11-14, WhatsApp-Web style):
//   data.message = { conversation } | { extendedTextMessage: { text } } |
//   { imageMessage: { caption } } | { documentMessage: { fileName } } | …
// Returns { text, type, system } — system = true for setting/ack messages.
function messageText(raw) {
  const m = unwrap(raw);
  const keys = Object.keys(m).filter((k) => k !== 'messageContextInfo');
  if (keys.length && keys.every((k) => SYSTEM.includes(k))) return { text: null, type: keys[0], system: true };
  if (typeof m.conversation === 'string' && m.conversation) return { text: m.conversation, type: 'text' };
  const ext = m.extendedTextMessage;
  if (ext && ext.text) return { text: ext.text, type: 'text' };
  const media = (k, label, type) => {
    const x = m[k];
    if (!x) return null;
    const cap = x.caption || '';
    return { text: cap ? `${label} ${cap}` : label, type };
  };
  const hit =
    media('imageMessage', '📷 Photo', 'image') ||
    media('videoMessage', '🎬 Video', 'video') ||
    (m.audioMessage ? { text: m.audioMessage.ptt ? '🎤 Voice message' : '🎵 Audio', type: 'audio' } : null) ||
    (m.documentMessage
      ? { text: `📄 ${m.documentMessage.fileName || m.documentMessage.title || 'Document'}${m.documentMessage.caption ? ` — ${m.documentMessage.caption}` : ''}`, type: 'document' }
      : null) ||
    (m.stickerMessage ? { text: '🙂 Sticker', type: 'sticker' } : null) ||
    (m.locationMessage || m.liveLocationMessage
      ? (() => {
          const l = m.locationMessage || m.liveLocationMessage;
          const where = [l.name, l.address].filter(Boolean).join(', ');
          return { text: `📍 Location${where ? `: ${where}` : ''} (${l.degreesLatitude}, ${l.degreesLongitude})`, type: 'location' };
        })()
      : null) ||
    (m.contactMessage ? { text: `👤 Contact: ${m.contactMessage.displayName || ''}`.trim(), type: 'contact' } : null) ||
    (m.contactsArrayMessage ? { text: '👤 Contacts', type: 'contact' } : null) ||
    (m.buttonsResponseMessage ? { text: m.buttonsResponseMessage.selectedDisplayText || m.buttonsResponseMessage.selectedButtonId, type: 'text' } : null) ||
    (m.listResponseMessage ? { text: m.listResponseMessage.title || '(list reply)', type: 'text' } : null) ||
    (m.templateButtonReplyMessage ? { text: m.templateButtonReplyMessage.selectedDisplayText, type: 'text' } : null) ||
    (m.pollCreationMessage || m.pollCreationMessageV3 ? { text: `📊 Poll: ${(m.pollCreationMessage || m.pollCreationMessageV3).name || ''}`, type: 'poll' } : null);
  if (hit && hit.text) return hit;
  return { text: keys.length ? `[${keys[0].replace(/Message$/, '')}]` : null, type: keys[0] || 'unknown' };
}

// "Hello! Can I get more info on this?" from a click-to-WhatsApp ad carries
// the ad's title — keep it so the team knows which ad the chat came from.
function adInfo(raw) {
  const m = unwrap(raw);
  const inner = Object.values(m).find((v) => v && typeof v === 'object' && v.contextInfo) || {};
  const c = inner.contextInfo || {};
  const reply = c.externalAdReply || {};
  const fromAd = !!(c.conversionSource || reply.title || c.entryPointConversionSource === 'ctwa_ad');
  if (!fromAd && !inner.title) return null;
  return {
    title: String(reply.title || inner.title || "").trim() || null,
    app: c.entryPointConversionApp || null, // facebook | instagram
    source: c.conversionSource || c.entryPointConversionSource || null,
  };
}

function parse(body) {
  const b = body || {};
  const d = b.data && typeof b.data === 'object' ? b.data : {};
  const m = (d.message && typeof d.message === 'object' ? d.message : null) || (b.message && typeof b.message === 'object' ? b.message : null) || {};
  const deviceId = pick(b.device_id, b.deviceId, b.device, d.device_id, d.deviceId);
  const fromRaw = pick(b.from, b.sender, b.number, b.phone, d.from, d.sender, d.number, d.phone, m.from, d.remoteJid, m.remoteJid);
  const wa = messageText(m);
  // DeroPo (documented): { event, timestamp, data: { message_id, device_id, from, content, … } }
  const text = pick(
    d.content,
    b.content,
    typeof b.message === 'string' ? b.message : undefined,
    typeof d.message === 'string' ? d.message : undefined,
    wa.text,
    b.text, b.body, d.text, d.body, m.text, m.body, m.caption
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
  const jid = String(fromRaw || '');
  return {
    event: b.event ? String(b.event) : null,
    deviceId: deviceId != null ? String(deviceId) : null,
    from: fromRaw ? deropo.normaliseNumber(jid.split('@')[0]) : null,
    // "@lid" = WhatsApp's hidden id, not a phone number — chat yes, phone no.
    isLid: jid.endsWith('@lid'),
    text: text != null ? String(text) : null,
    type: wa.text && text === wa.text ? wa.type : 'text',
    system: !!wa.system && !d.content && !b.content,
    ad: adInfo(m),
    providerMessageId: id != null ? String(id) : null,
    fromMe,
    name: name ? String(name).slice(0, 120) : null,
    at,
    isGroup: jid.includes('@g.us') || !!d.group_id,
  };
}

function secretMatches(given) {
  const want = process.env.WHATSAPP_WEBHOOK_SECRET || '';
  if (!want) return false;
  const a = Buffer.from(String(given || ''));
  const b = Buffer.from(want);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// Store one webhook body as a chat message (+ lead). Used live and to replay
// stored logs. opts.quiet = no socket pushes (replay).
async function processLog(log, opts = {}) {
  const Log = mongoose.model('WhatsAppWebhookLog');
  {
    const p = parse(log.body);
    const note = (msg) => Log.updateOne({ _id: log._id }, { $set: { note: msg } });
    // message_sent / delivered / read / failed are about OUR sends — only
    // message_received creates a chat message.
    if (p.event && p.event !== 'message_received') return await note(`event ${p.event} — not stored`);
    if (!p.deviceId) return await note('no device id');
    if (p.isGroup) return await note('group message — ignored');
    if (p.system) return await note(`WhatsApp system message (${p.type}) — not a chat line`);
    if (!p.from || !p.text) return await note('no sender or text (maybe a status/ack event)');

    const device = await mongoose.model('WhatsAppDevice').findOne({ deviceId: p.deviceId }).lean();
    if (!device) return await note(`device ${p.deviceId} is not linked to any CRM user`);

    const Message = mongoose.model('WhatsAppMessage');
    if (p.providerMessageId && (await Message.exists({ providerMessageId: p.providerMessageId }))) {
      return await note('duplicate');
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
      type: p.type || 'text',
      text: p.text,
      status: direction === 'incoming' ? 'received' : 'sent',
      providerMessageId: p.providerMessageId,
      at: p.at,
    });
    await Log.updateOne({ _id: log._id }, { $set: { handled: true, note: null } });

    // Every incoming WhatsApp chat is a lead (user ask 2026-11-14: "sab lead
    // chahiye, name ho ya na ho") — one lead per number; an existing lead with
    // the same phone is linked, never duplicated.
    if (direction === 'incoming') {
      const adLine = p.ad && p.ad.title ? `[Ad${p.ad.app ? ` · ${p.ad.app}` : ''}: ${p.ad.title}] ` : '';
      const leadJob = require('../../../../services/marketing/chatLeads')
        .upsertChatLead({
          channel: 'whatsapp',
          conversationId: p.from,
          name: chat.customerName || p.name,
          phone: p.isLid ? undefined : p.from,
          text: adLine + p.text,
          at: p.at,
        })
        .catch((e) => console.error('[whatsapp] chat lead failed:', e.message));
      if (opts.quiet) await leadJob;
    } else if (!opts.quiet) {
      // typed on the phone itself → the Ad chat inbox shows it live too
      require('../../../../services/marketing/chatLeads').pingChat('whatsapp', p.from, p.text);
    }

    if (opts.quiet) return;
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
  }
}

async function incoming(req, res) {
  if (!secretMatches(req.params.secret)) return res.status(404).json({ success: false });

  const Log = mongoose.model('WhatsAppWebhookLog');
  const log = await Log.create({ body: req.body });
  // Answer DeroPo straight away; store the message after.
  res.status(200).json({ success: true });

  try {
    await processLog(log);
  } catch (err) {
    await Log.updateOne({ _id: log._id }, { $set: { note: `error: ${err.message}` } }).catch(() => {});
  } finally {
    // Live: the admin page's "DeroPo webhook" card updates the moment DeroPo
    // calls (test, status or message) — no refresh / polling needed.
    try {
      const fresh = await Log.findById(log._id).select('note handled body.event').lean();
      require('../../../../socket').emitWhatsApp(null, 'whatsapp:webhook', {
        at: new Date(),
        event: (fresh && fresh.body && fresh.body.event) || null,
        handled: !!(fresh && fresh.handled),
        note: (fresh && fresh.note) || null,
      });
    } catch (_) {
      /* no socket in scripts */
    }
  }
}

module.exports = { incoming, parse, processLog };
