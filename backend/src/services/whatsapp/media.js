// WhatsApp media for the Ad chat inbox / Messenger › WhatsApp.
//
// Incoming: DeroPo's webhook carries WhatsApp's own media block
// ({ url, directPath, mediaKey, mimetype, fileName, … }). The file at `url` is
// encrypted with `mediaKey` (WhatsApp's standard scheme: HKDF-SHA256 → AES-256-CBC,
// last 10 bytes = MAC) and the link expires after ~2 weeks, so we download and
// decrypt it once, keep it under src/public/uploads/whatsapp/ and serve it at
// /public/uploads/whatsapp/<random name>.
//
// Outgoing: DeroPo's /api/send takes a public URL (variables.imageUrl /
// documentUrl), so a file attached in the inbox is stored the same way and its
// public link is handed to DeroPo.
//
// File names are 24 random hex characters — not guessable, never listed.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '../../public/uploads/whatsapp');
const URL_PREFIX = '/public/uploads/whatsapp/';
const MAX_BYTES = 25 * 1024 * 1024;

const INFO = {
  image: 'WhatsApp Image Keys',
  sticker: 'WhatsApp Image Keys',
  video: 'WhatsApp Video Keys',
  audio: 'WhatsApp Audio Keys',
  document: 'WhatsApp Document Keys',
};

const EXT = {
  'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif',
  'video/mp4': '.mp4', 'video/3gpp': '.3gp', 'audio/ogg': '.ogg', 'audio/mpeg': '.mp3', 'audio/mp4': '.m4a', 'audio/aac': '.aac',
  'application/pdf': '.pdf', 'application/msword': '.doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
  'application/vnd.ms-excel': '.xls', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
  'application/vnd.ms-powerpoint': '.ppt', 'application/vnd.openxmlformats-officedocument.presentationml.presentation': '.pptx',
  'text/plain': '.txt', 'text/csv': '.csv', 'application/zip': '.zip',
};

function extOf(mime, fileName) {
  const fromName = fileName ? path.extname(String(fileName)).toLowerCase() : '';
  if (/^\.[a-z0-9]{1,5}$/.test(fromName)) return fromName;
  const m = String(mime || '').split(';')[0].trim().toLowerCase();
  return EXT[m] || '.bin';
}

function save(buffer, mime, fileName) {
  fs.mkdirSync(DIR, { recursive: true });
  const name = crypto.randomBytes(12).toString('hex') + extOf(mime, fileName);
  fs.writeFileSync(path.join(DIR, name), buffer);
  return URL_PREFIX + name;
}

// Copy an uploaded file (multer, inbox attach) into the WhatsApp media folder.
function saveFile(srcPath, mime, fileName) {
  return save(fs.readFileSync(srcPath), mime, fileName);
}

function decrypt(buf, mediaKeyB64, kind) {
  const keys = Buffer.from(crypto.hkdfSync('sha256', Buffer.from(mediaKeyB64, 'base64'), Buffer.alloc(32), Buffer.from(INFO[kind] || INFO.document), 112));
  const iv = keys.subarray(0, 16);
  const cipherKey = keys.subarray(16, 48);
  const macKey = keys.subarray(48, 80);
  const body = buf.subarray(0, buf.length - 10);
  const mac = buf.subarray(buf.length - 10);
  const want = crypto.createHmac('sha256', macKey).update(Buffer.concat([iv, body])).digest().subarray(0, 10);
  if (!crypto.timingSafeEqual(mac, want)) throw new Error('media MAC check failed');
  const d = crypto.createDecipheriv('aes-256-cbc', cipherKey, iv);
  return Buffer.concat([d.update(body), d.final()]);
}

// The WhatsApp media block of a webhook message → { kind, src, info } or null.
const KINDS = [['imageMessage', 'image'], ['videoMessage', 'video'], ['audioMessage', 'audio'], ['documentMessage', 'document'], ['stickerMessage', 'sticker']];
function mediaOf(msg) {
  if (!msg || typeof msg !== 'object') return null;
  for (const [k, kind] of KINDS) {
    const x = msg[k];
    if (x && (x.url || x.directPath) && x.mediaKey) {
      const thumb = typeof x.jpegThumbnail === 'string' && x.jpegThumbnail.length < 40000 ? `data:image/jpeg;base64,${x.jpegThumbnail}` : undefined;
      return {
        kind,
        src: { kind, url: x.url, directPath: x.directPath, mediaKey: x.mediaKey, mime: x.mimetype },
        info: {
          mime: x.mimetype ? String(x.mimetype).split(';')[0] : undefined,
          fileName: x.fileName || x.title || undefined,
          size: x.fileLength ? Number(x.fileLength) : undefined,
          width: x.width || undefined,
          height: x.height || undefined,
          seconds: x.seconds || undefined,
          pages: x.pageCount || undefined,
          voice: kind === 'audio' ? !!x.ptt : undefined,
          thumb,
          pending: true,
        },
      };
    }
  }
  return null;
}

// Download + decrypt one incoming file → { url, size } (saved locally).
async function fetchIncoming(src) {
  const urls = [src.url, src.directPath ? `https://mmg.whatsapp.net${src.directPath}` : null].filter(Boolean);
  let lastErr = null;
  for (const u of urls) {
    try {
      const r = await fetch(u, { signal: AbortSignal.timeout(30000) });
      if (!r.ok) throw new Error(`WhatsApp media HTTP ${r.status}`);
      const len = Number(r.headers.get('content-length') || 0);
      if (len > MAX_BYTES) throw new Error('file is larger than 25 MB');
      const enc = Buffer.from(await r.arrayBuffer());
      const plain = decrypt(enc, src.mediaKey, src.kind);
      return { url: save(plain, src.mime, src.fileName), size: plain.length };
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error('no media link');
}

// Is this server holding the file behind a /public/uploads/whatsapp/ link?
// (A laptop and the VPS share one database but not one disk.)
function hasLocal(url) {
  if (!url || !String(url).startsWith(URL_PREFIX)) return false;
  return fs.existsSync(path.join(DIR, path.basename(String(url))));
}

// Fill in media.url for one stored message (and tell the inbox). Safe to call
// twice: a message whose file is on this server is left alone. mediaSrc is
// kept, so another server (or a lost file) can fetch it again while
// WhatsApp's link still works.
async function downloadFor(messageId) {
  const mongoose = require('mongoose');
  const Message = mongoose.model('WhatsAppMessage');
  const m = await Message.findById(messageId).select('+mediaSrc media customerNumber userId chatId direction').lean();
  if (!m || !m.mediaSrc || (m.media && hasLocal(m.media.url))) return m;
  try {
    const got = await fetchIncoming({ ...m.mediaSrc, fileName: m.media && m.media.fileName });
    await Message.updateOne({ _id: m._id }, { $set: { 'media.url': got.url, 'media.size': got.size, 'media.pending': false }, $unset: { 'media.error': 1 } });
  } catch (e) {
    await Message.updateOne({ _id: m._id }, { $set: { 'media.pending': false, 'media.error': String(e.message || e).slice(0, 200) } });
  }
  try {
    require('../../socket').emitWhatsApp(m.userId, 'whatsapp:message', { chatId: String(m.chatId), userId: String(m.userId), media: true });
    require('../marketing/chatLeads').pingChat('whatsapp', m.customerNumber, null);
  } catch (_) {
    /* scripts have no socket */
  }
  return Message.findById(messageId).lean();
}

// Messages stored before media support: find their webhook body (kept 30 days)
// by WhatsApp message id and fetch the file now. Used lazily by the inbox.
async function backfill(messages) {
  const mongoose = require('mongoose');
  const Message = mongoose.model('WhatsAppMessage');
  const Log = mongoose.model('WhatsAppWebhookLog');
  const MEDIA_TYPES = ['image', 'document', 'video', 'audio', 'sticker'];
  // incoming files whose copy is not on this server's disk
  const missing = messages.filter((m) => m.direction === 'incoming' && MEDIA_TYPES.includes(m.type) && m.media && m.media.url && !hasLocal(m.media.url)).slice(0, 6);
  for (const m of missing) {
    // eslint-disable-next-line no-await-in-loop
    const src = await Message.findById(m._id).select('+mediaSrc').lean();
    // eslint-disable-next-line no-await-in-loop
    if (src && src.mediaSrc) await downloadFor(m._id);
    // eslint-disable-next-line no-await-in-loop
    else await Message.updateOne({ _id: m._id }, { $unset: { 'media.url': 1 } });
  }
  // files whose WhatsApp pointer we already hold (history import, live webhook):
  // fetch the newest few now, in parallel
  const noFile = messages.filter((m) => MEDIA_TYPES.includes(m.type) && !(m.media && (m.media.url || m.media.error)));
  const withSrc = noFile.length
    ? new Set((await Message.find({ _id: { $in: noFile.map((m) => m._id) }, mediaSrc: { $exists: true } }).select('_id').lean()).map((x) => String(x._id)))
    : new Set();
  const direct = noFile.filter((m) => withSrc.has(String(m._id))).slice(-8);
  await Promise.all(direct.map((m) => downloadFor(m._id).catch(() => null)));
  const todo = noFile.filter((m) => !withSrc.has(String(m._id)) && m.direction === 'incoming' && m.providerMessageId).slice(0, 6);
  for (const m of todo) {
    // eslint-disable-next-line no-await-in-loop
    const log = await Log.findOne({ 'body.data.message_id': m.providerMessageId }).lean();
    const md = log && log.body && log.body.data && mediaOf(unwrapMsg(log.body.data.message));
    if (!md) {
      // eslint-disable-next-line no-await-in-loop
      await Message.updateOne({ _id: m._id }, { $set: { 'media.error': 'The file is no longer available.' } });
      continue;
    }
    // eslint-disable-next-line no-await-in-loop
    // the old "📷 Photo …" / "📄 name — …" line becomes just the caption
    const inner = unwrapMsg(log.body.data.message);
    const x = inner.imageMessage || inner.videoMessage || inner.documentMessage || {};
    const caption = x.caption ? String(x.caption) : '';
    // eslint-disable-next-line no-await-in-loop
    await Message.updateOne({ _id: m._id }, { $set: { media: md.info, mediaSrc: md.src, ...(/^(📷|📄|🎬|🎤|🎵)/.test(m.text || '') ? { text: caption } : {}) } });
    // eslint-disable-next-line no-await-in-loop
    await downloadFor(m._id);
  }
  return todo.length + missing.length + direct.length;
}

const WRAPPERS = ['ephemeralMessage', 'viewOnceMessage', 'viewOnceMessageV2', 'viewOnceMessageV2Extension', 'documentWithCaptionMessage', 'editedMessage'];
function unwrapMsg(m) {
  let cur = m;
  for (let i = 0; i < 5 && cur && typeof cur === 'object'; i += 1) {
    const w = WRAPPERS.find((k) => cur[k] && cur[k].message);
    if (!w) break;
    cur = cur[w].message;
  }
  return cur && typeof cur === 'object' ? cur : {};
}

// The CRM's public address, so DeroPo can fetch a file we send.
function publicBase(req) {
  const host = req.get('x-forwarded-host') || req.get('host') || '';
  const local = /localhost|127\.0\.0\.1/.test(host);
  return (process.env.PUBLIC_BASE_URL || process.env.ENQUIRY_FORM_BASE_URL || `${local ? 'http' : 'https'}://${host}`).replace(/\/+$/, '');
}

module.exports = { hasLocal, mediaOf, fetchIncoming, downloadFor, backfill, saveFile, publicBase, decrypt, unwrapMsg, MAX_BYTES };
