const mongoose = require('mongoose');

// Ad chats → CRM leads (user ask 2026-11-14: "mujhe sab lead chahiye, name ho
// ya na ho, sab ko show karna hai").
//
// Meta's Messages campaigns (click-to-Messenger / click-to-WhatsApp /
// Instagram DM) don't produce lead-form leads — the person just starts a
// chat. Every such conversation becomes ONE lead here, keyed by
// chatConversationId = "<channel>:<conversation id>", with whatever we know:
// a name if Meta gives one, a phone if it's WhatsApp or the person typed a
// number in the chat. No name → "Messenger user" / "Instagram user"; no phone
// → the lead still shows in Leads (New Lead stage); the dialer simply skips
// it (leadPoolSyncTick only queues leads with a phone) until a number turns up.
//
// Same phone already in the CRM → the existing lead is linked (chat fields
// filled), never duplicated — same rule as facebookController/webhook.js.

const LABEL = { messenger: 'Facebook Messenger', instagram: 'Instagram DM', whatsapp: 'WhatsApp' };
const COLOR = { messenger: '#0084FF', instagram: '#E1306C', whatsapp: '#25D366' };
const FRESH_MS = 2 * 60 * 60 * 1000; // same window as Facebook form leads

// First Indian mobile number in a text ("98765 43210", "+91-9876543210", …).
function phoneFromText(text) {
  if (!text) return null;
  // digit runs that may contain spaces / dashes / dots ("98765 43210")
  const runs = String(text).match(/\+?\d[\d\s.-]{8,18}\d/g) || [];
  for (const run of runs) {
    let d = run.replace(/\D/g, '');
    if (d.length === 12 && d.startsWith('91')) d = d.slice(2);
    else if (d.length === 11 && d.startsWith('0')) d = d.slice(1);
    if (d.length === 10 && /^[6-9]/.test(d)) return d;
  }
  return null;
}

function emailFromText(text) {
  const m = String(text || '').match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return m ? m[0].toLowerCase() : null;
}

/**
 * Create or update the lead for one chat.
 * @param {object} o
 *   channel: 'messenger' | 'instagram' | 'whatsapp'
 *   conversationId: Meta conversation id / WhatsApp number
 *   name, phone, email: optional
 *   text: latest message (customer side) — also scanned for a phone / email
 *   at: time of that message; startedAt: first message time (optional)
 *   pageId, adAccountId: Meta tracing (optional)
 * @returns {Promise<{lead, created: boolean, linked: boolean}>}
 */
async function upsertChatLead(o) {
  const Lead = mongoose.model('Lead');
  const channel = o.channel;
  if (!LABEL[channel] || !o.conversationId) throw new Error('chat lead needs channel + conversationId');
  const key = `${channel}:${o.conversationId}`;
  const at = o.at ? new Date(o.at) : new Date();
  const text = o.text ? String(o.text).slice(0, 500) : undefined;
  const phone = o.phone || phoneFromText(o.texts ? o.texts.join('\n') : text);
  const email = o.email || emailFromText(o.texts ? o.texts.join('\n') : text);
  const name = o.name && String(o.name).trim() ? String(o.name).trim().slice(0, 120) : null;

  const chatSet = { chatLastAt: at, ...(text ? { chatLastMessage: text } : {}) };

  // 1) This conversation already has its lead → refresh it.
  const existing = await Lead.findOne({ chatConversationId: key }).exec();
  if (existing) {
    const set = { ...chatSet };
    if (!existing.phone && phone) {
      set.phone = phone;
      // A number just turned up in a fresh chat → instant call like a form lead.
      if (Date.now() - at.getTime() < FRESH_MS && !(existing.instantDispatch && existing.instantDispatch.status)) {
        set.instantDispatch = { status: 'pending', at: new Date() };
      }
    }
    if (!existing.email && email) set.email = email;
    if (name && /^(Messenger|Instagram|WhatsApp) user$/.test(existing.name || '')) set.name = name;
    if (existing.chatLastAt && existing.chatLastAt >= at && !set.phone && !set.email && !set.name) return { lead: existing, created: false, linked: false };
    Object.assign(existing, set);
    await existing.save();
    return { lead: existing, created: false, linked: false };
  }

  // 2) Same person (phone) already in the CRM → link, don't duplicate.
  const phoneKey = phone && Lead.normalizePhone ? Lead.normalizePhone(phone) : '';
  if (phoneKey && phoneKey.length >= 10) {
    const same = await Lead.findOne({ removed: false, phoneNormalized: phoneKey }).exec();
    if (same) {
      const set = { ...chatSet };
      if (!same.chatConversationId) Object.assign(set, { chatConversationId: key, chatChannel: channel, chatStartedAt: o.startedAt || at });
      await Lead.updateOne({ _id: same._id }, { $set: set }).catch(() => {});
      return { lead: same, created: false, linked: true };
    }
  }

  // 3) New lead.
  const fresh = Date.now() - at.getTime() < FRESH_MS;
  const lead = new Lead({
    name: name || `${channel === 'messenger' ? 'Messenger' : channel === 'instagram' ? 'Instagram' : 'WhatsApp'} user`,
    phone: phone || undefined,
    email: email || undefined,
    message: text,
    source: LABEL[channel],
    status: 'New',
    color: COLOR[channel],
    chatConversationId: key,
    chatChannel: channel,
    chatStartedAt: o.startedAt || at,
    ...chatSet,
    pageId: o.pageId,
    adAccountId: o.adAccountId,
    metaPlatform: channel === 'whatsapp' ? 'whatsapp' : channel === 'instagram' ? 'ig' : 'fb',
    ...(fresh && phone ? { instantDispatch: { status: 'pending', at: new Date() } } : {}),
  });
  try {
    await lead.save();
  } catch (e) {
    if (e.code === 11000) {
      const raced = await Lead.findOne({ chatConversationId: key }).exec();
      return { lead: raced, created: false, linked: false };
    }
    throw e;
  }
  return { lead, created: true, linked: false };
}

module.exports = { upsertChatLead, phoneFromText, emailFromText, LABEL };
