const mongoose = require('mongoose');

// WhatsApp chats ↔ CRM leads, matched on the phone number (last 10 digits,
// same as Lead.phoneNormalized). User ask 2026-11-24:
//   1) a number the CRM already has → the chat shows the lead's name
//   2) the lead's assigned agent sees (and can answer) that number's chats in
//      their own WhatsApp inbox; admins see everything as before.

const last10 = (n) => String(n || '').replace(/\D/g, '').slice(-10);
const PLACEHOLDER = /^((Messenger|Instagram|WhatsApp) user|unknown( number)?|no name|n\/a|-+)$/i;
const realName = (s) => {
  const v = String(s || '').trim();
  return v && !PLACEHOLDER.test(v) && !/^[+\d\s()-]+$/.test(v) ? v : '';
};

// number (last 10) → { name, assignedUser } of the CRM lead with that phone
async function leadsForNumbers(numbers) {
  const keys = [...new Set((numbers || []).map(last10).filter((k) => k.length === 10))];
  if (!keys.length) return new Map();
  const rows = await mongoose
    .model('Lead')
    .find({ removed: false, phoneNormalized: { $in: keys } })
    .select('name phoneNormalized assignedUser updated')
    .sort({ updated: -1 })
    .lean();
  const out = new Map();
  rows.forEach((l) => {
    if (!out.has(l.phoneNormalized)) out.set(l.phoneNormalized, { name: realName(l.name), assignedUser: l.assignedUser ? String(l.assignedUser) : null, leadId: String(l._id) });
  });
  return out;
}

// numbers (as WhatsApp writes them: 91XXXXXXXXXX) of the leads assigned to this user
async function assignedNumbers(adminId) {
  const keys = await mongoose
    .model('Lead')
    .distinct('phoneNormalized', { removed: false, assignedUser: adminId, phoneNormalized: { $nin: [null, ''] } });
  const out = [];
  keys.filter((k) => String(k).length === 10).forEach((k) => out.push(`91${k}`, String(k)));
  return out;
}

async function isAssignedTo(adminId, customerNumber) {
  const k = last10(customerNumber);
  if (k.length !== 10) return false;
  return !!(await mongoose.model('Lead').exists({ removed: false, assignedUser: adminId, phoneNormalized: k }));
}

// put the CRM lead's name on chats whose name is missing / only a push name
async function applyLeadNames(chats) {
  const map = await leadsForNumbers(chats.map((c) => c.customerNumber));
  const ops = [];
  for (const c of chats) {
    const hit = map.get(last10(c.customerNumber));
    if (hit && hit.name && c.customerName !== hit.name) {
      c.customerName = hit.name;
      ops.push({ updateOne: { filter: { _id: c._id }, update: { $set: { customerName: hit.name } } } });
    }
    if (hit) c.leadId = hit.leadId;
  }
  if (ops.length) await mongoose.model('WhatsAppChat').bulkWrite(ops, { ordered: false }).catch(() => {});
  return chats;
}

module.exports = { last10, realName, leadsForNumbers, assignedNumbers, isAssignedTo, applyLeadNames };
