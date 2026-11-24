// One outgoing WhatsApp message — text, a photo / document (with the text as
// its caption) and/or a reply to an earlier message. Used by Messenger ›
// WhatsApp (whatsappController.send) and the Ad chat inbox (chats.js).
//
// Reply: DeroPo's /api/send has no reply-to field, so WhatsApp receives the
// quoted line as a "> quote" block above the text; the CRM keeps `quoted` and
// draws a real quote bubble.
// File: stored under /public/uploads/whatsapp/ and handed to DeroPo as a public
// URL (DeroPo downloads it) — so it only works where the CRM is reachable from
// the internet, never from a laptop.

const fs = require('fs');
const mongoose = require('mongoose');
const deropo = require('./deropo');
const media = require('./media');

const MAX_FILE = 16 * 1024 * 1024;

class SendError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const label = (m) => (m.type === 'image' ? '📷 Photo' : m.type === 'audio' ? '🎤 Voice message' : `📄 ${(m.media && m.media.fileName) || 'Document'}`);

// file = { path, mimetype, originalname, size } (multer) — deleted here either way.
// remote = { path, url, mime, fileName, size } — a file already served at a
// public URL (e.g. the curriculum PDF): DeroPo fetches `url`, the CRM shows `path`.
async function sendWhatsAppMessage({ req, chat, device, text, file, replyTo, remote }) {
  const Message = mongoose.model('WhatsAppMessage');
  const drop = () => file && file.path && fs.unlink(file.path, () => {});
  const body = String(text || '').trim();
  try {
    if (!body && !file && !remote) throw new SendError(400, 'Type a message or attach a file.');
    if (body.length > 4000) throw new SendError(400, 'Message is too long (4000 characters max).');
    if (file && file.size > MAX_FILE) throw new SendError(400, 'WhatsApp files can be up to 16 MB.');
    if (!device || device.status !== 'connected') throw new SendError(409, 'This WhatsApp number is not connected. Scan its QR code first.');

    let quoted;
    if (replyTo && mongoose.isValidObjectId(replyTo)) {
      const q = await Message.findOne({ _id: replyTo, customerNumber: chat.customerNumber }).select('direction text type media providerMessageId').lean();
      if (q) {
        const qText = q.media && (!q.text || /^(📷|📄|🎬|🎤|🎵)/.test(q.text)) ? `${label(q)}${q.text && !/^(📷|📄|🎬|🎤|🎵)/.test(q.text) ? ` ${q.text}` : ''}` : q.text || '';
        quoted = { messageId: q._id, providerMessageId: q.providerMessageId, text: String(qText).slice(0, 500), fromCustomer: q.direction === 'incoming', type: q.type };
      }
    }
    const quoteBlock = quoted && quoted.text ? `${quoted.text.split('\n').slice(0, 3).map((l) => `> ${l.slice(0, 160)}`).join('\n')}\n\n` : '';
    const outgoing = quoteBlock + body;

    let kind = 'text';
    let fileMedia;
    if (file) {
      const mime = String(file.mimetype || '');
      kind = /^image\/(jpeg|png|webp)$/.test(mime) ? 'image' : /^audio\//.test(mime) ? 'audio' : 'document';
      fileMedia = { url: media.saveFile(file.path, mime, file.originalname), mime, fileName: file.originalname, size: file.size };
    } else if (remote) {
      kind = 'document';
      fileMedia = { url: remote.path, mime: remote.mime, fileName: remote.fileName, size: remote.size };
    }
    drop();

    const msg = await Message.create({
      chatId: chat._id,
      userId: chat.userId,
      deviceId: device.deviceId,
      customerNumber: chat.customerNumber,
      direction: 'outgoing',
      type: kind,
      text: body,
      status: 'sending',
      at: new Date(),
      ...(fileMedia ? { media: fileMedia } : {}),
      ...(quoted ? { quoted } : {}),
    });

    let status = 'sent';
    let error = null;
    let providerMessageId = null;
    try {
      if (fileMedia) {
        const url = remote ? remote.url : media.publicBase(req) + fileMedia.url;
        if (!remote && /localhost|127\.0\.0\.1/.test(url)) throw new Error('files can only be sent from the live CRM (WhatsApp cannot reach a laptop address)');
        ({ providerMessageId } = await deropo.sendMedia({ deviceId: device.deviceId, number: chat.customerNumber, type: kind, url, caption: outgoing, fileName: fileMedia.fileName }));
      } else {
        ({ providerMessageId } = await deropo.sendText({ deviceId: device.deviceId, number: chat.customerNumber, message: outgoing }));
      }
    } catch (e) {
      status = 'failed';
      error = e.message;
    }
    const saved = await Message.findByIdAndUpdate(
      msg._id,
      { $set: { status, error, providerMessageId: providerMessageId != null ? String(providerMessageId) : null, statusAt: new Date() } },
      { new: true }
    ).lean();
    const preview = fileMedia ? `${label(saved)}${body ? ` ${body}` : ''}` : body;
    if (status !== 'failed') {
      await mongoose
        .model('WhatsAppChat')
        .updateOne({ _id: chat._id }, { $set: { lastMessage: preview, lastMessageAt: saved.at, lastDirection: 'outgoing', deviceId: device.deviceId } });
      // Teacher/Support → a student's number: the same message in Team Chat
      require('./teamChatBridge').waToTeamChat(saved, chat);
    }
    return { saved, status, error, preview };
  } catch (e) {
    drop();
    throw e;
  }
}

// multer's upload on req → the file shape above (or null)
function uploadedFile(req) {
  if (!req.upload) return null;
  const path = require('path');
  return {
    path: path.join(process.cwd(), 'src', req.upload.filePath),
    mimetype: req.file && req.file.mimetype,
    originalname: (req.file && req.file.originalname) || req.upload.fileName,
    size: (req.file && req.file.size) || 0,
  };
}

module.exports = { sendWhatsAppMessage, uploadedFile, SendError };
