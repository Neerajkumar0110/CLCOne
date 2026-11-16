const mongoose = require('mongoose');

// WhatsApp auto-reply (user ask 2026-11-16): a click-to-WhatsApp ad opens the
// chat with "Hello! Can I get more info on this?" → answer at once with a
// convincing message + the customer's own enquiry-form link; the moment the
// form is submitted → send the curriculum in the same chat.
//
// Config lives in the Setting collection (category 'whatsapp', key
// 'whatsapp_autoreply') and is edited in Messenger › WhatsApp › Auto-reply.
// Each customer gets the welcome once and the curriculum once (Lead.waWelcomeAt
// / Lead.waCurriculumAt, claimed atomically so two webhooks can't double-send).
// DeroPo's /api/send is text-only, so the curriculum goes as a link.

const KEY = { settingCategory: 'whatsapp', settingKey: 'whatsapp_autoreply' };

const DEFAULTS = {
  enabled: true,
  // a message containing any of these (case-insensitive) is a "tell me more"
  triggers: ['can i get more info', 'more info on this', 'want to know more', 'more details', 'interested'],
  // the first message of a chat that came from an ad always counts
  anyAdChat: true,
  welcomeText:
    'Hi{name}! 👋 Thank you for your interest in *Career Lab Consulting*.\n\n' +
    'We help students, freshers and working professionals build a career in *AI & Data Science* — live classes with mentors, real industry projects and placement support.\n\n' +
    '📝 Please fill this *2-minute form* so our counsellor can suggest the right program for *your* background:\n{formLink}\n\n' +
    'As soon as you submit it, we will send you the complete *curriculum* right here on WhatsApp. 📚',
  curriculumText:
    'Thank you{name}! ✅ We have received your details.\n\n' +
    '📚 Here is the curriculum{program}:\n{curriculumLink}\n\n' +
    'Our counsellor will call you{callTime} to guide you on the next steps. Feel free to reply here with any question.',
  defaultCurriculumUrl: '',
  curriculumLinks: [], // [{ program, url }] — program names as on the enquiry form
  // a phone number from the form with no WhatsApp chat yet: message it from the business number too (they ticked consent)
  sendToFormOnly: false,
};

let cache = { at: 0, cfg: null };
async function loadConfig({ fresh = false } = {}) {
  if (!fresh && cache.cfg && Date.now() - cache.at < 30000) return cache.cfg;
  const row = await mongoose.model('Setting').findOne({ ...KEY, removed: false }).lean();
  const cfg = { ...DEFAULTS, ...((row && row.settingValue) || {}) };
  cache = { at: Date.now(), cfg };
  return cfg;
}

async function saveConfig(input, by) {
  const cur = await loadConfig({ fresh: true });
  const s = (v, max) => String(v == null ? '' : v).slice(0, max);
  const url = (v) => {
    const u = s(v, 500).trim();
    return /^https?:\/\/\S+$/i.test(u) ? u : '';
  };
  const next = {
    enabled: input.enabled != null ? !!input.enabled : cur.enabled,
    triggers: Array.isArray(input.triggers)
      ? input.triggers.map((t) => s(t, 120).trim().toLowerCase()).filter(Boolean).slice(0, 30)
      : cur.triggers,
    anyAdChat: input.anyAdChat != null ? !!input.anyAdChat : cur.anyAdChat,
    welcomeText: input.welcomeText != null ? s(input.welcomeText, 3000) : cur.welcomeText,
    curriculumText: input.curriculumText != null ? s(input.curriculumText, 3000) : cur.curriculumText,
    defaultCurriculumUrl: input.defaultCurriculumUrl != null ? url(input.defaultCurriculumUrl) : cur.defaultCurriculumUrl,
    curriculumLinks: Array.isArray(input.curriculumLinks)
      ? input.curriculumLinks.map((l) => ({ program: s(l && l.program, 120).trim(), url: url(l && l.url) })).filter((l) => l.program && l.url).slice(0, 40)
      : cur.curriculumLinks,
    sendToFormOnly: input.sendToFormOnly != null ? !!input.sendToFormOnly : cur.sendToFormOnly,
    updatedBy: by || undefined,
    updatedAt: new Date(),
  };
  if (!next.welcomeText.includes('{formLink}')) throw new Error('The welcome message must contain {formLink} — that is where the form link goes.');
  if (!next.curriculumText.includes('{curriculumLink}')) throw new Error('The curriculum message must contain {curriculumLink}.');
  await mongoose.model('Setting').updateOne({ ...KEY }, { $set: { settingValue: next, removed: false, valueType: 'Object', isPrivate: true } }, { upsert: true });
  cache = { at: 0, cfg: null };
  return loadConfig({ fresh: true });
}

function curriculumFor(cfg, program) {
  const hit = program && (cfg.curriculumLinks || []).find((l) => l.program.toLowerCase() === String(program).toLowerCase());
  return (hit && hit.url) || cfg.defaultCurriculumUrl || '';
}

const fill = (tpl, vars) => String(tpl || '').replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null ? vars[k] : ''));
const firstName = (lead) => {
  const n = String((lead && lead.name) || '').trim();
  if (!n || /^(Messenger|Instagram|WhatsApp) user$/i.test(n)) return '';
  return ` ${n.split(/\s+/)[0]}`;
};

function formLink(lead) {
  const { chatToken } = require('../../controllers/corePublicControllers/enquiryForm');
  const base = (process.env.ENQUIRY_FORM_BASE_URL || process.env.PUBLIC_APP_URL || 'https://clcone.careerlabconsulting.com').replace(/\/+$/, '');
  return `${base}/public/enquiry?${new URLSearchParams({ c: chatToken(lead._id), utm_source: 'WhatsApp', utm_medium: 'auto-reply' })}`;
}

// Send one text from a CRM WhatsApp number and record it like any other
// outgoing message (Messenger › WhatsApp + the Ad chat inbox show it live).
async function sendFrom({ number, preferDeviceId, text, lead, kind }) {
  const deropo = require('./deropo');
  const Device = mongoose.model('WhatsAppDevice');
  const Chat = mongoose.model('WhatsAppChat');
  const Message = mongoose.model('WhatsAppMessage');

  let device = preferDeviceId ? await Device.findOne({ deviceId: preferDeviceId }).lean() : null;
  if (!device || device.status !== 'connected') {
    const chats = await Chat.find({ customerNumber: number }).select('deviceId').lean();
    const ids = chats.map((c) => c.deviceId).filter(Boolean);
    device =
      (await Device.findOne({ deviceId: { $in: ids }, status: 'connected' }).sort({ kind: 1 }).lean()) ||
      (await Device.findOne({ kind: 'business', status: 'connected' }).lean());
  }
  if (!device) throw new Error('no connected WhatsApp number');

  const chat = await Chat.findOneAndUpdate(
    { userId: device.userId, customerNumber: number },
    { $setOnInsert: { userName: device.userName, department: device.kind === 'business' ? 'Business' : undefined }, $set: { deviceId: device.deviceId } },
    { upsert: true, new: true }
  ).lean();
  const msg = await Message.create({ chatId: chat._id, userId: device.userId, deviceId: device.deviceId, customerNumber: number, direction: 'outgoing', type: 'text', text, status: 'sending', at: new Date() });
  let providerMessageId = null;
  try {
    ({ providerMessageId } = await deropo.sendText({ deviceId: device.deviceId, number, message: text }));
  } catch (e) {
    await Message.updateOne({ _id: msg._id }, { $set: { status: 'failed', error: e.message } });
    throw e;
  }
  await Message.updateOne({ _id: msg._id }, { $set: { status: 'sent', providerMessageId } });
  await Chat.updateOne({ _id: chat._id }, { $set: { lastMessage: text, lastMessageAt: msg.at, lastDirection: 'outgoing' } });
  try {
    const socket = require('../../socket');
    socket.emitWhatsApp(chat.userId, 'whatsapp:message', { chatId: String(chat._id), userId: String(chat.userId), department: chat.department });
    if (lead) {
      socket.emitLeadEvent('lead:chat', { kind: 'sent', id: String(lead._id), name: lead.name, channel: 'whatsapp', text: `Auto-reply (${kind}): ${text.slice(0, 100)}`, at: new Date(), by: 'Auto-reply' });
    }
  } catch (_) {
    /* no socket in scripts */
  }
  return { providerMessageId, device: device.label || device.phoneNumber };
}

// An incoming WhatsApp message (webhook, after its lead was saved).
async function onIncoming({ lead, deviceId, number, text, ad }) {
  try {
    if (!lead || !number) return null;
    const cfg = await loadConfig();
    if (!cfg.enabled) return null;
    const t = String(text || '').toLowerCase();
    const hit = (cfg.triggers || []).some((k) => k && t.includes(k)) || (cfg.anyAdChat && !!ad);
    if (!hit) return null;
    // claim it: only one welcome per lead, ever
    const Lead = mongoose.model('Lead');
    const claimed = await Lead.updateOne({ _id: lead._id, waWelcomeAt: { $exists: false } }, { $set: { waWelcomeAt: new Date() } });
    if (!claimed.modifiedCount) return null;
    const fresh = await Lead.findById(lead._id).select('name').lean();
    const body = fill(cfg.welcomeText, { name: firstName(fresh || lead), formLink: formLink(lead) });
    return await sendFrom({ number, preferDeviceId: deviceId, text: body, lead, kind: 'welcome' });
  } catch (e) {
    console.error('[whatsapp auto-reply] welcome failed:', e.message);
    return null;
  }
}

const CALL_WORDS = { 'Morning (10–1)': ' in the morning', 'Afternoon (1–5)': ' in the afternoon', 'Evening (5–8)': ' in the evening', 'Any time': ' shortly' };

// The enquiry form was submitted (corePublicControllers/enquiryForm.js).
async function onEnquiry(lead, { program, callTime, consent } = {}) {
  try {
    if (!lead) return null;
    const cfg = await loadConfig();
    if (!cfg.enabled) return null;
    const link = curriculumFor(cfg, program);
    if (!link) return null;
    // which WhatsApp chat: the one this lead came from, else (if allowed) their form number
    let number = null;
    if (lead.chatChannel === 'whatsapp' && lead.chatConversationId) number = lead.chatConversationId.split(':').slice(1).join(':');
    if (!number && lead.phone) {
      const n = `91${String(lead.phone).replace(/\D/g, '').slice(-10)}`;
      const hasChat = await mongoose.model('WhatsAppChat').exists({ customerNumber: n });
      if (hasChat || (cfg.sendToFormOnly && consent)) number = n;
    }
    if (!number) return null;
    const Lead = mongoose.model('Lead');
    const claimed = await Lead.updateOne({ _id: lead._id, waCurriculumAt: { $exists: false } }, { $set: { waCurriculumAt: new Date() } });
    if (!claimed.modifiedCount) return null;
    const body = fill(cfg.curriculumText, {
      name: firstName(lead),
      program: program && !/not sure/i.test(program) ? ` for *${program}*` : '',
      curriculumLink: link,
      callTime: CALL_WORDS[callTime] || ' shortly',
    });
    return await sendFrom({ number, text: body, lead, kind: 'curriculum' });
  } catch (e) {
    console.error('[whatsapp auto-reply] curriculum failed:', e.message);
    return null;
  }
}

module.exports = { loadConfig, saveConfig, curriculumFor, onIncoming, onEnquiry, DEFAULTS, fill, formLink };
