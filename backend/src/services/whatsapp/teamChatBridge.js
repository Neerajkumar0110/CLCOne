const mongoose = require('mongoose');

// WhatsApp ↔ Team Chat, one conversation in both places (user ask 2026-11-24):
//  - a Teacher / Support user's WhatsApp chat with a student's number (sent
//    from the CRM, typed on the phone, or the student's WhatsApp reply) also
//    shows in Team Chat between that staff user and the student's LMS login;
//  - a Team Chat message between a student and a Teacher / Support user also
//    lands in that staff user's WhatsApp thread for the student, tagged
//    "Team Chat". Nothing is sent to WhatsApp from Team Chat.
// The staff side is always the WhatsApp number's owner (chat.userId).
// Bridged rows carry `via` so neither side mirrors them back (no loops).

const STAFF_ROLES = ['Teacher', 'Support'];
const M = (n) => mongoose.model(n);
const last10 = (n) => String(n || '').replace(/\D/g, '').slice(-10);
const rxEq = (s) => new RegExp(`^${String(s || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i');
const fullName = (a) => [a && a.name, a && a.surname].filter(Boolean).join(' ');

// roster phone (last 10) → roster email; rebuilt every 10 min
let phoneCache = { at: 0, map: new Map() };
async function phoneMap() {
  if (Date.now() - phoneCache.at < 10 * 60 * 1000) return phoneCache.map;
  const rows = await M('Student').find({ removed: { $ne: true } }).select('email phone altPhone').lean();
  const map = new Map();
  rows.forEach((s) => {
    [s.phone, s.altPhone].forEach((p) => {
      const k = last10(p);
      if (k.length === 10 && s.email && !map.has(k)) map.set(k, String(s.email).trim());
    });
  });
  phoneCache = { at: Date.now(), map };
  return map;
}

// the student's LMS login (Admin, role Student) for a WhatsApp number
async function studentByNumber(number) {
  const k = last10(number);
  if (k.length !== 10) return null;
  const email = (await phoneMap()).get(k);
  if (!email) return null;
  return M('Admin').findOne({ role: 'Student', removed: false, email: rxEq(email) }).select('name surname email role').lean();
}

async function staffById(id) {
  const a = await M('Admin').findOne({ _id: id, removed: false }).select('name surname role').lean();
  return a && STAFF_ROLES.includes(a.role) ? a : null;
}

// ---------- WhatsApp → Team Chat
// waMsg: the saved WhatsAppMessage (lean or doc)
async function waToTeamChat(waMsg, chat) {
  try {
    if (!waMsg || waMsg.via === 'teamchat') return;
    const staff = await staffById(chat.userId);
    if (!staff) return;
    const student = await studentByNumber(chat.customerNumber);
    if (!student) return;
    const Message = M('Message');
    if (waMsg.providerMessageId && (await Message.exists({ 'wa.providerMessageId': String(waMsg.providerMessageId) }))) return;
    const out = waMsg.direction === 'outgoing';
    const file = waMsg.media && waMsg.media.url && !waMsg.media.pending ? waMsg.media : null;
    // a file still downloading → its label, so the line is never empty
    const label = waMsg.media && !file ? (waMsg.type === 'image' ? '📷 Photo' : waMsg.type === 'audio' ? '🎤 Voice message' : '📄 ' + (waMsg.media.fileName || 'Document')) : '';
    const text = [label, String(waMsg.text || '').trim()].filter(Boolean).join(' ');
    if (!text && !file) return;
    const from = out ? staff._id : student._id;
    const to = out ? student._id : staff._id;
    const fileType = file ? (/^image\//.test(file.mime || '') ? 'image' : /^video\//.test(file.mime || '') ? 'video' : 'file') : null;
    const message = await new Message({
      conversationId: require('../../controllers/appControllers/operation/messageController/conversationIdFor')(from, to),
      from,
      to,
      text,
      ...(file ? { attachment: { url: String(file.url).replace(/^\/+/, ''), fileName: file.fileName || (fileType === 'image' ? 'Photo' : 'File'), mimeType: file.mime, fileType } } : {}),
      via: 'whatsapp',
      wa: { chatId: chat._id, messageId: waMsg._id, providerMessageId: waMsg.providerMessageId ? String(waMsg.providerMessageId) : undefined },
    }).save();
    require('../../socket').emitMessage(message);
  } catch (e) {
    console.error('[wa↔teamchat] to team chat failed:', e.message);
  }
}

// ---------- Team Chat → WhatsApp thread (record only, never sent)
async function teamChatToWa(message) {
  try {
    if (!message || message.via === 'whatsapp') return;
    const Admin = M('Admin');
    const [a, b] = await Promise.all([
      Admin.findOne({ _id: message.from, removed: false }).select('name surname role email').lean(),
      Admin.findOne({ _id: message.to, removed: false }).select('name surname role email').lean(),
    ]);
    if (!a || !b) return;
    const student = a.role === 'Student' ? a : b.role === 'Student' ? b : null;
    const staff = student === a ? b : a;
    if (!student || !STAFF_ROLES.includes(staff.role)) return;

    const roster = await M('Student').findOne({ email: rxEq(student.email), removed: { $ne: true } }).select('phone altPhone name').lean();
    const k = last10(roster && (roster.phone || roster.altPhone));
    if (k.length !== 10) return;

    const Chat = M('WhatsAppChat');
    let chat = await Chat.findOne({ userId: staff._id, customerNumber: { $in: [`91${k}`, k] } }).lean();
    if (!chat) {
      // a thread only for someone who has WhatsApp in the CRM
      const device = await M('WhatsAppDevice').findOne({ userId: staff._id }).select('deviceId').lean();
      if (!device) return;
      const { departmentOfRole } = require('../../config/roles');
      chat = await Chat.findOneAndUpdate(
        { userId: staff._id, customerNumber: `91${k}` },
        { $setOnInsert: { userName: fullName(staff), department: departmentOfRole(staff.role), deviceId: device.deviceId, customerName: (roster && roster.name) || fullName(student) } },
        { upsert: true, new: true }
      ).lean();
    }

    const incoming = String(message.from) === String(student._id);
    const att = message.attachment && message.attachment.url ? message.attachment : null;
    const text = String(message.text || '').trim();
    const preview = `${att ? `📎 ${att.fileName || 'File'}${text ? ' ' : ''}` : ''}${text}`;
    if (!preview) return;
    const at = message.created || new Date();
    const wa = await M('WhatsAppMessage').create({
      chatId: chat._id,
      userId: staff._id,
      deviceId: chat.deviceId,
      customerNumber: chat.customerNumber,
      direction: incoming ? 'incoming' : 'outgoing',
      type: att ? (att.fileType === 'image' ? 'image' : 'document') : 'text',
      text,
      status: incoming ? 'received' : 'sent',
      at,
      via: 'teamchat',
      teamMessageId: message._id,
      ...(att ? { media: { url: '/' + String(att.url).replace(/^\/+/, ''), mime: att.mimeType, fileName: att.fileName } } : {}),
    });
    await Chat.updateOne(
      { _id: chat._id },
      { $set: { lastMessage: `💬 ${preview}`.slice(0, 300), lastMessageAt: at, lastDirection: wa.direction }, ...(incoming ? { $inc: { unread: 1 } } : {}) }
    );
    require('../../socket').emitWhatsApp(staff._id, 'whatsapp:message', {
      chatId: String(chat._id),
      userId: String(staff._id),
      department: chat.department,
      incoming,
      from: chat.customerName || chat.customerNumber,
      text: preview.slice(0, 120),
    });
  } catch (e) {
    console.error('[wa↔teamchat] to WhatsApp thread failed:', e.message);
  }
}

// ---------- who a student may chat with: Support + their batch's teachers
// (+ anyone they already have a thread with)
async function studentContactIds(student) {
  const Admin = M('Admin');
  const ids = new Set();
  // Support + Admin + Super Admin are always reachable (2026-11-27)
  (await Admin.find({ role: { $in: ['Support', 'Admin', 'Super Admin'] }, removed: false, enabled: true }).select('_id').lean()).forEach((x) => ids.add(String(x._id)));
  const roster = await M('Student').findOne({ email: rxEq(student.email), removed: { $ne: true } }).select('batch').lean();
  if (roster && roster.batch) {
    const batches = await M('Batch').find({ removed: { $ne: true }, $or: [{ name: roster.batch }, { code: roster.batch }] }).select('name code trainer').lean();
    const names = [...new Set(batches.flatMap((b) => (Array.isArray(b.trainer) ? b.trainer : b.trainer ? [b.trainer] : [])).filter(Boolean))];
    if (names.length) {
      (await Admin.find({ role: 'Teacher', removed: false, name: { $in: names.map(rxEq) } }).select('_id').lean()).forEach((x) => ids.add(String(x._id)));
    }
    // every learner of the same batch (roster may store the batch by name or code)
    const keys = [...new Set([roster.batch, ...batches.flatMap((b) => [b.name, b.code])].filter(Boolean))];
    const mates = await M('Student').find({ batch: { $in: keys }, removed: { $ne: true } }).select('email').lean();
    const emails = [...new Set(mates.map((s) => String(s.email || '').trim()).filter(Boolean).flatMap((e) => [e, e.toLowerCase()]))];
    if (emails.length) {
      (await Admin.find({ role: 'Student', removed: false, enabled: true, email: { $in: emails } }).select('_id').lean()).forEach((x) => ids.add(String(x._id)));
    }
  }
  const me = String(student._id);
  const talked = await M('Message').distinct('from', { removed: false, to: student._id });
  talked.forEach((x) => ids.add(String(x)));
  ids.delete(me);
  return [...ids];
}

module.exports = { STAFF_ROLES, studentByNumber, waToTeamChat, teamChatToWa, studentContactIds };
