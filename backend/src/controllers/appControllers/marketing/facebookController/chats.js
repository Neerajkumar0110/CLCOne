const mongoose = require('mongoose');
const graph = require('../../../../utils/metaGraphClient');
const { decryptedPageToken } = require('./_helpers');
const { SUPER_ADMIN_ROLES } = require('../../../../config/roles');

// Ad chat inbox (user ask 2026-11-14): owner + Super Admin read every
// connected chat — the list of chat leads and each full conversation, read
// live from Meta so nothing is copied into the CRM except the lead itself.

function allowed(req, res) {
  if (req.admin && SUPER_ADMIN_ROLES.includes(req.admin.role)) return true;
  res.status(403).json({ success: false, result: null, message: 'Only the owner and Super Admin can read the ad chats.' });
  return false;
}

// GET /api/facebook/chats?q=&channel=&limit=
const listChats = async (req, res) => {
  if (!allowed(req, res)) return;
  const Lead = mongoose.model('Lead');
  const q = String(req.query.q || '').trim();
  const filter = { removed: false, chatConversationId: { $exists: true, $ne: null } };
  if (['messenger', 'instagram', 'whatsapp'].includes(req.query.channel)) filter.chatChannel = req.query.channel;
  if (q) {
    const rx = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    filter.$or = [{ name: rx }, { phone: rx }, { email: rx }, { chatLastMessage: rx }];
  }
  const limit = Math.min(Number(req.query.limit) || 300, 1000);
  const [rows, total] = await Promise.all([
    Lead.find(filter)
      .sort({ chatLastAt: -1 })
      .limit(limit)
      .select('name phone email stage subStatus chatChannel chatConversationId chatLastMessage chatLastAt chatStartedAt chatReadAt chatRepliedAt metaAdId assigned source')
      .lean(),
    Lead.countDocuments(filter),
  ]);
  // unread = the customer wrote after an owner / Super Admin last opened it
  rows.forEach((r) => {
    r.unread = !!r.chatLastAt && (!r.chatReadAt || new Date(r.chatLastAt) > new Date(r.chatReadAt));
  });
  // unread + total per channel — the header's Messenger / WhatsApp /
  // Instagram icons show these counts (user ask 2026-11-15).
  const perChannel = await Lead.aggregate([
    { $match: { removed: false, chatConversationId: { $exists: true, $ne: null } } },
    {
      $group: {
        _id: '$chatChannel',
        total: { $sum: 1 },
        unread: { $sum: { $cond: [{ $gt: ['$chatLastAt', { $ifNull: ['$chatReadAt', new Date(0)] }] }, 1, 0] } },
      },
    },
  ]);
  const byChannel = { messenger: { total: 0, unread: 0 }, instagram: { total: 0, unread: 0 }, whatsapp: { total: 0, unread: 0 } };
  perChannel.forEach((c) => {
    if (byChannel[c._id]) byChannel[c._id] = { total: c.total, unread: c.unread };
  });
  const unread = perChannel.reduce((s, c) => s + c.unread, 0);
  return res.status(200).json({ success: true, result: { total, unread, byChannel, rows }, message: 'ok' });
};

// The customer's "contact info" for the inbox's side panel (user ask
// 2026-11-16: "jo customer ne profile lagaya hai sab kuch show ho"). Meta's
// User Profile API (photo) needs App Review we don't have, and DeroPo sends
// no WhatsApp name / photo — so this is everything the CRM does know: the
// lead, who has it, the ad the chat came from, and the chat's numbers.
async function chatProfile(leadId, channel, userId) {
  const lead = await mongoose
    .model('Lead')
    .findById(leadId)
    .select('name phone email stage subStatus source city state persona education created assignedUser chatStartedAt chatRepliedAt chatAd metaAdId nextFollowUpAt')
    .populate({ path: 'assignedUser', select: 'name surname' })
    .lean();
  if (!lead) return null;
  const profile = {
    name: lead.name,
    phone: lead.phone || null,
    email: lead.email || null,
    stage: lead.stage,
    subStatus: lead.subStatus,
    source: lead.source,
    city: [lead.city, lead.state].filter(Boolean).join(', ') || null,
    persona: lead.persona,
    education: lead.education,
    assignedTo: lead.assignedUser ? [lead.assignedUser.name, lead.assignedUser.surname].filter(Boolean).join(' ') : null,
    createdAt: lead.created,
    startedAt: lead.chatStartedAt,
    repliedAt: lead.chatRepliedAt,
    nextFollowUp: lead.nextFollowUpAt,
    ad: lead.chatAd || null,
    adId: lead.metaAdId || null,
  };
  if (channel === 'whatsapp') {
    profile.whatsappNumber = userId;
    // "@lid" senders: WhatsApp hides their phone number — the id is not dialable
    profile.hiddenNumber = !lead.phone;
    const chats = await mongoose.model('WhatsAppChat').find({ customerNumber: userId }).select('deviceId').lean();
    const devices = await mongoose
      .model('WhatsAppDevice')
      .find({ deviceId: { $in: chats.map((c) => c.deviceId).filter(Boolean) } })
      .select('label phoneNumber kind status')
      .lean();
    profile.ourNumbers = devices.map((d) => ({ label: d.label || d.phoneNumber, number: d.phoneNumber, business: d.kind === 'business', connected: d.status === 'connected' }));
  }
  return profile;
}

// GET /api/facebook/chats/:leadId/messages — the whole conversation, live.
const chatMessages = async (req, res) => {
  if (!allowed(req, res)) return;
  if (!mongoose.isValidObjectId(req.params.leadId)) return res.status(400).json({ success: false, result: null, message: 'Bad lead id.' });
  const Lead = mongoose.model('Lead');
  const lead = await Lead.findOne({ _id: req.params.leadId, removed: false }).select('name phone chatConversationId chatChannel pageId chatLastAt chatReadAt').lean();
  // opening the chat marks it read (for every owner / Super Admin)
  if (lead) await Lead.updateOne({ _id: lead._id }, { $set: { chatReadAt: new Date() } });
  if (!lead || !lead.chatConversationId) return res.status(404).json({ success: false, result: null, message: 'Not a chat lead.' });
  const [channel, userId] = [lead.chatChannel, lead.chatConversationId.split(':').slice(1).join(':')];

  if (channel === 'whatsapp') {
    // WhatsApp messages are stored by the DeroPo webhook (WhatsAppMessage).
    const msgs = await mongoose
      .model('WhatsAppMessage')
      .find({ customerNumber: userId })
      .sort({ at: 1 })
      .limit(500)
      .select('direction text at status type')
      .lean();
    return res.status(200).json({
      success: true,
      result: {
        lead,
        profile: await chatProfile(lead._id, channel, userId).catch(() => null),
        messages: msgs.map((m) => ({ text: m.text, at: m.at, fromCustomer: m.direction === 'incoming', status: m.status, type: m.type })),
      },
      message: 'ok',
    });
  }

  const FacebookConnection = mongoose.model('FacebookConnection');
  const conn =
    (lead.pageId && (await FacebookConnection.findOne({ removed: false, pageId: lead.pageId }).exec())) ||
    (await FacebookConnection.findOne({ removed: false, status: 'connected', pageId: { $nin: [null, ''] } }).sort({ active: -1 }).exec());
  const token = decryptedPageToken(conn);
  if (!token) return res.status(400).json({ success: false, result: null, message: 'No connected Facebook Page.' });

  try {
    const r = await graph.graphRequest(`/${conn.pageId}/conversations`, {
      params: {
        platform: channel === 'instagram' ? 'instagram' : 'messenger',
        user_id: userId,
        fields: 'id,link,messages.limit(200){message,from,created_time,attachments{mime_type,name,image_data{url,preview_url},video_data{url,preview_url},file_url}}',
        access_token: token,
      },
    });
    const conv = (r.data || [])[0];
    const raw = (conv && conv.messages && conv.messages.data) || [];
    const messages = raw
      .map((m) => ({
        text: m.message || '',
        at: m.created_time,
        fromCustomer: m.from ? String(m.from.id) === String(userId) : false,
        fromName: m.from && m.from.name,
        attachments: ((m.attachments && m.attachments.data) || []).map((a) => ({
          name: a.name,
          type: a.mime_type || (a.image_data ? 'image' : a.video_data ? 'video' : ''),
          url: (a.image_data && a.image_data.url) || (a.video_data && a.video_data.url) || a.file_url,
          preview: (a.image_data && (a.image_data.preview_url || a.image_data.url)) || (a.video_data && a.video_data.preview_url) || null,
        })),
      }))
      .sort((a, b) => new Date(a.at) - new Date(b.at));
    return res.status(200).json({
      success: true,
      result: {
        lead,
        profile: await chatProfile(lead._id, channel, userId).catch(() => null),
        link: conv && conv.link ? `https://business.facebook.com${conv.link}` : null,
        messages,
        window: windowOf(lead),
      },
      message: 'ok',
    });
  } catch (e) {
    return res.status(502).json({ success: false, result: null, message: `Meta: ${e.message}` });
  }
};

// ── Replying from the CRM (Messenger Send API) ───────────────────────────
// Meta's rules: a normal reply is allowed for 24 h after the customer's last
// message (messaging_type RESPONSE); up to 7 days with the HUMAN_AGENT tag
// (needs the human_agent permission); after that the window is closed.
const HOUR = 3600e3;

async function chatContext(req, res) {
  if (!allowed(req, res)) return null;
  if (!mongoose.isValidObjectId(req.params.leadId)) {
    res.status(400).json({ success: false, result: null, message: 'Bad lead id.' });
    return null;
  }
  const lead = await mongoose.model('Lead').findOne({ _id: req.params.leadId, removed: false }).exec();
  if (!lead || !lead.chatConversationId) {
    res.status(404).json({ success: false, result: null, message: 'Not a chat lead.' });
    return null;
  }
  const channel = lead.chatChannel;
  const userId = lead.chatConversationId.split(':').slice(1).join(':');
  if (channel === 'whatsapp') return { lead, channel, userId };
  const FacebookConnection = mongoose.model('FacebookConnection');
  const conn =
    (lead.pageId && (await FacebookConnection.findOne({ removed: false, pageId: lead.pageId }).exec())) ||
    (await FacebookConnection.findOne({ removed: false, status: 'connected', pageId: { $nin: [null, ''] } }).sort({ active: -1 }).exec());
  const token = decryptedPageToken(conn);
  if (!token) {
    res.status(400).json({ success: false, result: null, message: 'No connected Facebook Page.' });
    return null;
  }
  return { lead, channel, userId, conn, token };
}

function windowOf(lead) {
  const last = lead.chatLastAt ? new Date(lead.chatLastAt).getTime() : 0;
  const age = Date.now() - last;
  return {
    lastCustomerAt: lead.chatLastAt || null,
    open: age < 24 * HOUR,
    humanAgent: age >= 24 * HOUR && age < 7 * 24 * HOUR,
    endsAt: last ? new Date(last + 24 * HOUR) : null,
    humanAgentEndsAt: last ? new Date(last + 7 * 24 * HOUR) : null,
  };
}

function attachmentType(mime = '') {
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  return 'file';
}

// WhatsApp reply from the Ad chat inbox (user ask 2026-11-15): sent from the
// WhatsApp number the customer wrote to (a connected business number first),
// stored in the same WhatsAppChat / WhatsAppMessage as Messenger › WhatsApp.
async function sendWhatsApp(req, res, lead, number, text, hadFile) {
  if (hadFile) return res.status(400).json({ success: false, result: null, message: 'WhatsApp replies from here are text only for now — type the message.' });
  if (!text) return res.status(400).json({ success: false, result: null, message: 'Type a message.' });
  const deropo = require('../../../../services/whatsapp/deropo');
  const Device = mongoose.model('WhatsAppDevice');
  const Chat = mongoose.model('WhatsAppChat');
  const Message = mongoose.model('WhatsAppMessage');

  const chats = await Chat.find({ customerNumber: number }).sort({ lastMessageAt: -1 }).lean();
  const devices = await Device.find({ userId: { $in: chats.map((c) => c.userId) } }).lean();
  const devOf = (c) => devices.find((d) => String(d.userId) === String(c.userId));
  const rank = (c) => {
    const d = devOf(c);
    return (d && d.status === 'connected' ? 2 : 0) + (d && d.kind === 'business' ? 1 : 0);
  };
  const chat = chats.slice().sort((a, b) => rank(b) - rank(a))[0];
  const device = chat && devOf(chat);
  if (!chat || !device) return res.status(404).json({ success: false, result: null, message: 'No WhatsApp number in the CRM has a chat with this customer.' });
  if (device.status !== 'connected') return res.status(409).json({ success: false, result: null, message: 'That WhatsApp number is not connected — scan its QR in Messenger › WhatsApp.' });

  const body = text.slice(0, 4000);
  const msg = await Message.create({ chatId: chat._id, userId: chat.userId, deviceId: device.deviceId, customerNumber: number, direction: 'outgoing', type: 'text', text: body, status: 'sending', at: new Date() });
  let status = 'sent';
  let error = null;
  let providerMessageId = null;
  try {
    ({ providerMessageId } = await deropo.sendText({ deviceId: device.deviceId, number, message: body }));
  } catch (e) {
    status = 'failed';
    error = e.message;
  }
  await Message.updateOne({ _id: msg._id }, { $set: { status, error, providerMessageId } });
  if (status === 'failed') return res.status(502).json({ success: false, result: null, message: `WhatsApp message not sent: ${error}` });
  await Chat.updateOne({ _id: chat._id }, { $set: { lastMessage: body, lastMessageAt: msg.at, lastDirection: 'outgoing', unread: 0 } });
  await mongoose.model('Lead').updateOne({ _id: lead._id }, { $set: { chatRepliedAt: new Date(), chatReadAt: new Date() } });
  try {
    const socket = require('../../../../socket');
    socket.emitWhatsApp(chat.userId, 'whatsapp:message', { chatId: String(chat._id), userId: String(chat.userId), department: chat.department });
    socket.emitLeadEvent('lead:chat', { kind: 'sent', id: String(lead._id), name: lead.name, channel: 'whatsapp', text: `You: ${body.slice(0, 120)}`, at: new Date(), by: req.admin && req.admin.name });
  } catch (_) {
    /* no socket in scripts */
  }
  return res.status(200).json({ success: true, result: { sent: [providerMessageId] }, message: `Sent from ${device.label || device.phoneNumber}` });
}

// POST /api/facebook/chats/:leadId/send   multipart: text?, file?
const sendChat = async (req, res) => {
  const fs = require('fs');
  const path = require('path');
  const filePath = req.upload ? path.join(process.cwd(), 'src', req.upload.filePath) : null;
  const cleanup = () => {
    if (filePath) fs.unlink(filePath, () => {});
  };
  const ctx = await chatContext(req, res);
  if (!ctx) return cleanup();
  const { lead, channel, userId, conn, token } = ctx;
  const text = String((req.body && req.body.text) || '').trim();
  if (!text && !filePath) {
    cleanup();
    return res.status(400).json({ success: false, result: null, message: 'Type a message or attach a file.' });
  }

  try {
    if (channel === 'whatsapp') {
      cleanup();
      return await sendWhatsApp(req, res, lead, userId, text, !!filePath);
    }
    const win = windowOf(lead);
    if (!win.open && !win.humanAgent) {
      cleanup();
      return res.status(409).json({
        success: false,
        result: { window: win },
        message: 'Meta allows replies only within 7 days of the customer’s last message — this chat is older. Wait for them to write again.',
      });
    }
    const typing = win.open ? { messaging_type: 'RESPONSE' } : { messaging_type: 'MESSAGE_TAG', tag: 'HUMAN_AGENT' };
    const sent = [];
    if (filePath) {
      const form = new FormData();
      form.append('recipient', JSON.stringify({ id: userId }));
      form.append('messaging_type', typing.messaging_type);
      if (typing.tag) form.append('tag', typing.tag);
      form.append('message', JSON.stringify({ attachment: { type: attachmentType(req.file && req.file.mimetype), payload: { is_reusable: false } } }));
      form.append('filedata', new Blob([fs.readFileSync(filePath)], { type: (req.file && req.file.mimetype) || 'application/octet-stream' }), (req.file && req.file.originalname) || req.upload.fileName);
      form.append('access_token', token);
      sent.push(await graph.graphRequest(`/${conn.pageId}/messages`, { method: 'POST', body: form, isForm: true }));
    }
    if (text) {
      sent.push(
        await graph.graphRequest(`/${conn.pageId}/messages`, {
          method: 'POST',
          params: { access_token: token },
          body: { recipient: { id: userId }, ...typing, message: { text: text.slice(0, 2000) } },
        })
      );
    }
    cleanup();
    await mongoose.model('Lead').updateOne({ _id: lead._id }, { $set: { chatRepliedAt: new Date(), chatReadAt: new Date() } });
    try {
      require('../../../../socket').emitLeadEvent('lead:chat', {
        kind: 'sent',
        id: String(lead._id),
        name: lead.name,
        channel,
        source: lead.source,
        hasPhone: !!lead.phone,
        text: text ? `You: ${text.slice(0, 120)}` : 'You sent a file',
        at: new Date(),
        by: req.admin && req.admin.name,
      });
    } catch (_) {
      /* no socket in scripts */
    }
    return res.status(200).json({ success: true, result: { sent: sent.map((s) => s.message_id) }, message: 'Sent' });
  } catch (e) {
    cleanup();
    let msg = e.message;
    if (/outside of allowed window|10\b.*window/i.test(msg)) msg = `Meta: the 24-hour reply window is closed for this chat. (${e.message})`;
    else if (/role|standard access|not authorized|permission/i.test(msg)) msg = `Meta refused the send — the app may need App Review (pages_messaging advanced access) to message customers. (${e.message})`;
    return res.status(502).json({ success: false, result: null, message: msg });
  }
};

// POST /api/facebook/chats/:leadId/action  { action: typing_on | typing_off | mark_seen }
const chatAction = async (req, res) => {
  const ctx = await chatContext(req, res);
  if (!ctx) return;
  const action = String((req.body && req.body.action) || '');
  if (!['typing_on', 'typing_off', 'mark_seen'].includes(action)) return res.status(400).json({ success: false, result: null, message: 'Bad action.' });
  if (ctx.channel === 'whatsapp') return res.status(200).json({ success: true, result: null, message: 'skipped' });
  try {
    await graph.graphRequest(`/${ctx.conn.pageId}/messages`, {
      method: 'POST',
      params: { access_token: ctx.token },
      body: { recipient: { id: ctx.userId }, sender_action: action },
    });
    return res.status(200).json({ success: true, result: null, message: 'ok' });
  } catch (e) {
    // typing / seen are cosmetic — never an error the user has to see
    return res.status(200).json({ success: false, result: null, message: e.message });
  }
};

// GET /api/facebook/chats/:leadId/form-link — this chat's own link to the
// enquiry form (public/enquiry?c=<signed lead id>): answers join THIS lead,
// even when WhatsApp hid the customer's number.
const chatFormLink = async (req, res) => {
  if (!allowed(req, res)) return;
  if (!mongoose.isValidObjectId(req.params.leadId)) return res.status(400).json({ success: false, result: null, message: 'Bad lead id.' });
  const lead = await mongoose.model('Lead').findOne({ _id: req.params.leadId, removed: false }).select('_id chatChannel').lean();
  if (!lead) return res.status(404).json({ success: false, result: null, message: 'Lead not found.' });
  const { chatToken } = require('../../../corePublicControllers/enquiryForm');
  const host = req.get('x-forwarded-host') || req.get('host') || '';
  const local = /localhost|127\.0\.0\.1/.test(host);
  const base = (process.env.ENQUIRY_FORM_BASE_URL || `${local ? 'http' : 'https'}://${host}`).replace(/\/+$/, '');
  const qs = new URLSearchParams({ c: chatToken(lead._id), utm_source: { whatsapp: 'WhatsApp', instagram: 'Instagram', messenger: 'Facebook' }[lead.chatChannel] || 'Chat', utm_medium: 'chat' });
  return res.status(200).json({ success: true, result: { url: `${base}/public/enquiry?${qs}` }, message: 'ok' });
};

module.exports = { listChats, chatMessages, sendChat, chatAction, windowOf, chatProfile, chatFormLink };
