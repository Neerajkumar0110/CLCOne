// WhatsApp chat history → CRM, when a number is linked.
//
// Right after a number is linked (QR scan), the phone sends its chat history to
// the new linked device as protocolMessage HISTORY_SYNC_NOTIFICATION webhooks:
// either inline (initialHistBootstrapInlinePayload, base64) or as an encrypted
// file (directPath + mediaKey, HKDF info "WhatsApp History Keys"). Both are
// zlib-compressed protobuf "HistorySync" messages:
//
//   HistorySync { 2: conversations[], 7: pushnames[], 15: phoneNumberToLidMappings[] }
//   Conversation { 1: jid, 2: messages[] (HistorySyncMsg { 1: WebMessageInfo }), 6: unreadCount, 13: name }
//   WebMessageInfo { 1: key { 1: remoteJid, 2: fromMe, 3: id }, 2: message, 3: timestamp (s), 4: status }
//   Pushname { 1: jid, 2: name }   LidMapping { 1: phone jid, 2: lid jid }
//
// Field numbers were checked against real payloads (2026-11-21). Messages are
// turned into the same JSON shape the live webhook carries, so the webhook's
// own parser (text, photo / document, quoted reply) reads them. Group chats,
// status updates and channels are skipped; history never creates leads or
// auto-replies. Photos / documents download later, when the chat is opened.

const crypto = require('crypto');
const zlib = require('zlib');
const mongoose = require('mongoose');

// ── protobuf wire format ────────────────────────────────────────────────────
function varint(buf, pos) {
  let r = 0n;
  let shift = 0n;
  for (;;) {
    if (pos >= buf.length) throw new Error('varint past end');
    const b = buf[pos++];
    r |= BigInt(b & 0x7f) << shift;
    if (!(b & 0x80)) break;
    shift += 7n;
    if (shift > 70n) throw new Error('varint too long');
  }
  return [r, pos];
}
function pb(buf) {
  const out = {};
  let pos = 0;
  while (pos < buf.length) {
    let key;
    [key, pos] = varint(buf, pos);
    const f = Number(key >> 3n);
    const wt = Number(key & 7n);
    if (!f) throw new Error('field 0');
    let v;
    if (wt === 0) [v, pos] = varint(buf, pos);
    else if (wt === 1) {
      v = { f64: buf.subarray(pos, pos + 8) };
      pos += 8;
    } else if (wt === 5) {
      v = { f32: buf.subarray(pos, pos + 4) };
      pos += 4;
    } else if (wt === 2) {
      let len;
      [len, pos] = varint(buf, pos);
      len = Number(len);
      if (pos + len > buf.length) throw new Error('length past end');
      v = buf.subarray(pos, pos + len);
      pos += len;
    } else throw new Error(`wire type ${wt}`);
    (out[f] = out[f] || []).push(v);
  }
  return out;
}
const tryPb = (b) => {
  try {
    return Buffer.isBuffer(b) ? pb(b) : null;
  } catch {
    return null;
  }
};
const str = (o, f) => (o && o[f] && Buffer.isBuffer(o[f][0]) ? o[f][0].toString('utf8') : undefined);
const num = (o, f) => (o && o[f] && typeof o[f][0] === 'bigint' ? Number(o[f][0]) : undefined);
const b64 = (o, f) => (o && o[f] && Buffer.isBuffer(o[f][0]) && o[f][0].length ? o[f][0].toString('base64') : undefined);
const dbl = (o, f) => (o && o[f] && o[f][0] && o[f][0].f64 ? o[f][0].f64.readDoubleLE(0) : undefined);
const sub = (o, f) => (o && o[f] ? tryPb(o[f][0]) : null);
const clean = (obj) => Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined && v !== null && v !== ''));

// The longest readable text inside a message we don't map field by field
// (business templates, button replies, …).
function bestText(buf, depth = 0) {
  let best = '';
  const o = tryPb(buf);
  if (!o || depth > 6) return best;
  for (const vals of Object.values(o)) {
    for (const v of vals) {
      if (!Buffer.isBuffer(v) || !v.length) continue;
      const t = v.toString('utf8');
      const readable = !t.includes('�') && !/[\u0000-\u0008\u000E-\u001F]/.test(t) && /[\p{L}]/u.test(t) && !/^[A-Za-z0-9+/=_-]{20,}$/.test(t) && !/^https?:\/\/\S+$/.test(t);
      if (readable && t.length > best.length) best = t;
      const inner = bestText(v, depth + 1);
      if (inner.length > best.length) best = inner;
    }
  }
  return best;
}

function contextInfo(o) {
  if (!o) return undefined;
  return clean({ stanzaId: str(o, 1), participant: str(o, 2), quotedMessage: o[3] ? messageJson(o[3][0]) : undefined });
}

// protobuf Message → the webhook's JSON shape (camelCase, bytes as base64)
function messageJson(buf, depth = 0) {
  const m = tryPb(buf);
  if (!m || depth > 4) return {};
  const out = {};
  if (str(m, 1)) out.conversation = str(m, 1);
  const img = sub(m, 3);
  if (img) out.imageMessage = clean({ url: str(img, 1), mimetype: str(img, 2), caption: str(img, 3), fileLength: num(img, 5), height: num(img, 6), width: num(img, 7), mediaKey: b64(img, 8), directPath: str(img, 11), jpegThumbnail: b64(img, 16), contextInfo: contextInfo(sub(img, 17)) });
  const contact = sub(m, 4);
  if (contact) out.contactMessage = clean({ displayName: str(contact, 1) });
  const loc = sub(m, 5);
  if (loc) out.locationMessage = clean({ degreesLatitude: dbl(loc, 1), degreesLongitude: dbl(loc, 2), name: str(loc, 3), address: str(loc, 4) });
  const ext = sub(m, 6);
  if (ext) out.extendedTextMessage = clean({ text: str(ext, 1), contextInfo: contextInfo(sub(ext, 17)) });
  const doc = sub(m, 7);
  if (doc) out.documentMessage = clean({ url: str(doc, 1), mimetype: str(doc, 2), title: str(doc, 3), fileLength: num(doc, 5), pageCount: num(doc, 6), mediaKey: b64(doc, 7), fileName: str(doc, 8), directPath: str(doc, 10), jpegThumbnail: b64(doc, 16), contextInfo: contextInfo(sub(doc, 17)), caption: str(doc, 20) });
  const aud = sub(m, 8);
  if (aud) out.audioMessage = clean({ url: str(aud, 1), mimetype: str(aud, 2), fileLength: num(aud, 4), seconds: num(aud, 5), ptt: num(aud, 6) ? true : undefined, mediaKey: b64(aud, 7), directPath: str(aud, 9), contextInfo: contextInfo(sub(aud, 17)) });
  const vid = sub(m, 9);
  if (vid) out.videoMessage = clean({ url: str(vid, 1), mimetype: str(vid, 2), fileLength: num(vid, 4), seconds: num(vid, 5), mediaKey: b64(vid, 6), caption: str(vid, 7), height: num(vid, 9), width: num(vid, 10), directPath: str(vid, 13), jpegThumbnail: b64(vid, 16), contextInfo: contextInfo(sub(vid, 17)) });
  if (m[2]) out.senderKeyDistributionMessage = {};
  if (m[12]) out.protocolMessage = {};
  if (m[46]) out.reactionMessage = {};
  const sticker = sub(m, 26);
  if (sticker) out.stickerMessage = clean({ url: str(sticker, 1), mediaKey: b64(sticker, 4), mimetype: str(sticker, 5), height: num(sticker, 6), width: num(sticker, 7), directPath: str(sticker, 8) });
  const arr = sub(m, 13);
  if (arr) out.contactsArrayMessage = clean({ displayName: str(arr, 1) });
  // wrappers around the real message
  for (const [f, name] of [[37, 'viewOnceMessage'], [40, 'ephemeralMessage'], [53, 'documentWithCaptionMessage'], [55, 'viewOnceMessageV2'], [58, 'editedMessage']]) {
    const w = sub(m, f);
    if (w && w[1]) out[name] = { message: messageJson(w[1][0], depth + 1) };
  }
  // anything else with readable text (templates, button / list replies, polls…)
  if (!Object.keys(out).length) {
    const known = new Set([35]);
    const rest = Object.keys(m).filter((k) => !known.has(Number(k)));
    if (rest.length) {
      const t = bestText(buf);
      if (t) out.conversation = t;
    }
  }
  return out;
}

// ── the HistorySync payload of one notification ─────────────────────────────
async function payloadOf(n) {
  let raw;
  if (n.initialHistBootstrapInlinePayload) raw = Buffer.from(n.initialHistBootstrapInlinePayload, 'base64');
  else if (n.directPath && n.mediaKey) {
    const r = await fetch(`https://mmg.whatsapp.net${n.directPath}`, { signal: AbortSignal.timeout(60000) });
    if (!r.ok) throw new Error(`history file HTTP ${r.status}`);
    const enc = Buffer.from(await r.arrayBuffer());
    const keys = Buffer.from(crypto.hkdfSync('sha256', Buffer.from(n.mediaKey, 'base64'), Buffer.alloc(32), Buffer.from('WhatsApp History Keys'), 112));
    const body = enc.subarray(0, enc.length - 10);
    const mac = crypto.createHmac('sha256', keys.subarray(48, 80)).update(Buffer.concat([keys.subarray(0, 16), body])).digest().subarray(0, 10);
    if (!crypto.timingSafeEqual(mac, enc.subarray(enc.length - 10))) throw new Error('history file MAC check failed');
    const d = crypto.createDecipheriv('aes-256-cbc', keys.subarray(16, 48), keys.subarray(0, 16));
    raw = Buffer.concat([d.update(body), d.final()]);
  } else return null;
  return pb(zlib.inflateSync(raw));
}

const STATUS = { 0: 'failed', 1: 'sending', 2: 'sent', 3: 'delivered', 4: 'read', 5: 'read' };
const userOf = (jid) => String(jid || '').split('@')[0].split(':')[0];

// Import one HISTORY_SYNC_NOTIFICATION for a linked device. Safe to run twice
// (messages are matched on WhatsApp's message id).
async function importNotification(device, notification) {
  const deropo = require('./deropo');
  const media = require('./media');
  const { messageText, quotedOf, captionOf } = require('../../controllers/appControllers/operation/whatsappController/webhook');
  const hs = await payloadOf(notification);
  if (!hs) return { chats: 0, messages: 0, note: 'no history payload' };

  const Chat = mongoose.model('WhatsAppChat');
  const Message = mongoose.model('WhatsAppMessage');
  const Device = mongoose.model('WhatsAppDevice');

  // hidden-number (@lid) → phone number, kept on the device for live messages too
  const lidMap = {};
  for (const b of hs[15] || []) {
    const x = tryPb(b);
    const pn = userOf(str(x, 1));
    const lid = userOf(str(x, 2));
    if (pn && lid) lidMap[lid] = pn;
  }
  if (Object.keys(lidMap).length) {
    const set = Object.fromEntries(Object.entries(lidMap).map(([l, p]) => [`lidMap.${l}`, p]));
    await Device.updateOne({ _id: device._id }, { $set: set });
  }
  const known = { ...(device.lidMap || {}), ...lidMap };
  const numberOf = (jid) => {
    const u = userOf(jid);
    return String(jid).endsWith('@lid') ? known[u] || u : u;
  };
  // contact names: they come in their own PUSH_NAME packet (no chats in it), so
  // they are kept on the device and also put on chats that already exist
  const pushed = {};
  for (const b of hs[7] || []) {
    const x = tryPb(b);
    const id = str(x, 1);
    const name = (str(x, 2) || '').trim();
    if (!id || !name || /@(g\.us|broadcast|newsletter)$/.test(id)) continue;
    pushed[userOf(id)] = name;
    const n = deropo.normaliseNumber(numberOf(id));
    if (n) pushed[n] = name;
  }
  if (Object.keys(pushed).length) {
    await Device.updateOne({ _id: device._id }, { $set: Object.fromEntries(Object.entries(pushed).map(([k, v]) => [`nameMap.${k}`, v])) });
  }
  const names = { ...(device.nameMap || {}), ...pushed };
  // a name saved earlier under an @lid id, now that its phone number is known
  for (const [lid, pn] of Object.entries(known)) if (names[lid] && !names[pn]) names[pn] = names[lid];
  if (Object.keys(pushed).length) {
    const unnamed = await Chat.find({ userId: device.userId, $or: [{ customerName: null }, { customerName: '' }] }).select('_id customerNumber').lean();
    const ops = unnamed.filter((c) => names[c.customerNumber]).map((c) => ({ updateOne: { filter: { _id: c._id }, update: { $set: { customerName: names[c.customerNumber] } } } }));
    if (ops.length) await Chat.bulkWrite(ops, { ordered: false });
  }

  const Admin = mongoose.model('Admin');
  const owner = await Admin.findById(device.userId).select('name surname role').lean();
  const { departmentOfRole } = require('../../config/roles');
  let chats = 0;
  let messages = 0;
  let rejected = 0;

  for (const cb of hs[2] || []) {
    const c = tryPb(cb);
    const jid = str(c, 1) || '';
    if (!/@(s\.whatsapp\.net|lid)$/.test(jid) || /^0@|status@/.test(jid)) continue; // groups, status, channels
    const number = deropo.normaliseNumber(numberOf(jid));
    if (!number) continue;
    const rows = [];
    for (const hb of c[2] || []) {
      const w = tryPb(tryPb(hb) && tryPb(hb)[1] ? tryPb(hb)[1][0] : null);
      if (!w || !w[2]) continue;
      const key = sub(w, 1) || {};
      const id = str(key, 3);
      const fromMe = num(key, 2) === 1;
      const json = messageJson(w[2][0]);
      const t = messageText(json);
      if (t.system || !t.text) continue;
      const md = media.mediaOf(require('./media').unwrapMsg(json));
      const q = quotedOf(json);
      const ts = num(w, 3);
      rows.push({
        id,
        doc: {
          userId: device.userId,
          deviceId: device.deviceId,
          customerNumber: number,
          direction: fromMe ? 'outgoing' : 'incoming',
          type: md ? md.kind : t.type || 'text',
          text: md ? captionOf(json) : t.text,
          status: fromMe ? STATUS[num(w, 4)] || 'sent' : 'received',
          providerMessageId: id,
          at: ts ? new Date(ts * 1000) : new Date(),
          ...(md ? { media: { ...md.info, pending: false }, mediaSrc: md.src } : {}),
          ...(q ? { quoted: { text: q.text, type: q.type, providerMessageId: q.providerMessageId } } : {}),
        },
        preview: t.text,
      });
    }
    if (!rows.length) continue;
    rows.sort((a, b) => a.doc.at - b.doc.at);
    const last = rows[rows.length - 1];
    const name = str(c, 13) || names[userOf(jid)] || names[number] || undefined;
    const existing = await Chat.findOne({ userId: device.userId, customerNumber: number }).lean();
    const chat =
      existing ||
      (await Chat.create({
        userId: device.userId,
        userName: owner ? [owner.name, owner.surname].filter(Boolean).join(' ') : device.userName,
        department: device.kind === 'business' ? 'Business' : owner ? departmentOfRole(owner.role) : undefined,
        customerNumber: number,
        customerName: name,
        deviceId: device.deviceId,
        lastMessage: last.preview,
        lastMessageAt: last.doc.at,
        lastDirection: last.doc.direction,
        unread: Math.max(0, Math.min(num(c, 6) || 0, 999)), // WhatsApp's unread count on the phone
      }));
    if (existing) {
      const set = {};
      if (!existing.customerName && name) set.customerName = name;
      if (!existing.lastMessageAt || existing.lastMessageAt < last.doc.at) Object.assign(set, { lastMessage: last.preview, lastMessageAt: last.doc.at, lastDirection: last.doc.direction });
      if (Object.keys(set).length) await Chat.updateOne({ _id: existing._id }, { $set: set });
    }
    const ids = rows.map((r) => r.id).filter(Boolean);
    const have = new Set((await Message.find({ customerNumber: number, providerMessageId: { $in: ids } }).select('providerMessageId').lean()).map((x) => x.providerMessageId));
    const fresh = rows.filter((r) => !r.id || !have.has(r.id)).map((r) => ({ ...r.doc, chatId: chat._id }));
    if (fresh.length) {
      // insertMany(ordered:false) silently drops documents that fail validation — count them
      const inserted = await Message.insertMany(fresh, { ordered: false });
      rejected += fresh.length - inserted.length;
      // quoted replies → the quoted message, when it is in this chat
      const byPid = new Map();
      (await Message.find({ customerNumber: number, providerMessageId: { $in: fresh.map((f) => f.quoted && f.quoted.providerMessageId).filter(Boolean) } }).select('_id providerMessageId direction').lean()).forEach((x) => byPid.set(x.providerMessageId, x));
      const ops = inserted
        .filter((x) => x.quoted && x.quoted.providerMessageId && byPid.has(x.quoted.providerMessageId))
        .map((x) => {
          const hit = byPid.get(x.quoted.providerMessageId);
          return { updateOne: { filter: { _id: x._id }, update: { $set: { 'quoted.messageId': hit._id, 'quoted.fromCustomer': hit.direction === 'incoming' } } } };
        });
      if (ops.length) await Message.bulkWrite(ops, { ordered: false });
      messages += inserted.length;
      chats += 1;
    }
  }
  return { chats, messages, rejected };
}

module.exports = { importNotification, messageJson, pb };
