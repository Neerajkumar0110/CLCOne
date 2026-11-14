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
      .select('name phone email stage subStatus chatChannel chatConversationId chatLastMessage chatLastAt chatStartedAt metaAdId assigned source')
      .lean(),
    Lead.countDocuments(filter),
  ]);
  return res.status(200).json({ success: true, result: { total, rows }, message: 'ok' });
};

// GET /api/facebook/chats/:leadId/messages — the whole conversation, live.
const chatMessages = async (req, res) => {
  if (!allowed(req, res)) return;
  if (!mongoose.isValidObjectId(req.params.leadId)) return res.status(400).json({ success: false, result: null, message: 'Bad lead id.' });
  const Lead = mongoose.model('Lead');
  const lead = await Lead.findOne({ _id: req.params.leadId, removed: false }).select('name chatConversationId chatChannel pageId').lean();
  if (!lead || !lead.chatConversationId) return res.status(404).json({ success: false, result: null, message: 'Not a chat lead.' });
  const [channel, userId] = [lead.chatChannel, lead.chatConversationId.split(':').slice(1).join(':')];

  if (channel === 'whatsapp') {
    // WhatsApp messages are stored by the DeroPo webhook (WhatsAppMessage).
    const msgs = await mongoose
      .model('WhatsAppMessage')
      .find({ customerNumber: userId })
      .sort({ at: 1 })
      .limit(500)
      .select('direction text at')
      .lean();
    return res.status(200).json({
      success: true,
      result: { lead, messages: msgs.map((m) => ({ text: m.text, at: m.at, fromCustomer: m.direction === 'incoming' })) },
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
        fields: 'id,link,messages.limit(200){message,from,created_time,attachments{mime_type,name,image_data{url},file_url}}',
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
          type: a.mime_type,
          url: (a.image_data && a.image_data.url) || a.file_url,
        })),
      }))
      .sort((a, b) => new Date(a.at) - new Date(b.at));
    return res.status(200).json({
      success: true,
      result: { lead, link: conv && conv.link ? `https://business.facebook.com${conv.link}` : null, messages },
      message: 'ok',
    });
  } catch (e) {
    return res.status(502).json({ success: false, result: null, message: `Meta: ${e.message}` });
  }
};

module.exports = { listChats, chatMessages };
