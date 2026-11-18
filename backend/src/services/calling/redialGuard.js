const mongoose = require('mongoose');

// One customer, not too many automatic calls (user ask 2026-11-17: "bar bar
// kyu ja rhi hai" — WhatsApp ad leads were rung 6–9 times a day by the instant
// lead retries, the New Lead retries and every new chat message; they kept
// rejecting, and Busy/Rejected doubled).
//
// Checked right before the AUTO dialers ring a customer: the instant-lead
// dispatcher (instantLeads.js) and the Lead Pool (CloudCallProvider.
// dialLeadPoolNext). A user's own manual dial, a callback and inbound calls
// are never held back. Per IST day, counting every outbound call to the
// number (manual ones too):
//   - someone already spoke to them today          → no more auto calls today
//   - AUTO_MAX_PER_DAY calls already today         → no more today
//   - REJECT_STOP rejected / busy today            → no more today
//   - last call less than AUTO_MIN_GAP_MS ago      → wait until the gap is over
const AUTO_MAX_PER_DAY = Number(process.env.AUTO_DIAL_MAX_PER_DAY || 3);
const AUTO_MIN_GAP_MS = Number(process.env.AUTO_DIAL_MIN_GAP_MIN || 120) * 60 * 1000;
const REJECT_STOP = 2;
const IST = 5.5 * 3600 * 1000;

const last10 = (p) => String(p || '').replace(/\D/g, '').slice(-10);
const variants = (p) => [p, `91${p}`, `+91${p}`, `0${p}`];

function istDayStart(t = Date.now()) {
  const key = new Date(t + IST).toISOString().slice(0, 10);
  return new Date(`${key}T00:00:00+05:30`);
}
const nextDayStart = (t = Date.now()) => new Date(istDayStart(t).getTime() + 864e5);

// Rejected / busy as Plivo reported it (the carrier's hangup cause).
function wasRejected(r) {
  const p = r.providerRaw || {};
  const name = String(p.HangupCauseName || '');
  return !r.agentLegAnswered && (/reject|busy/i.test(name) || /busy|reject/i.test(String(p.HangupCause || '')));
}

// An agent has EVER spoken to this number (user ask 2026-11-18: "jis customer
// se ek bar call me baat ho jayegi usko dobara call nahi jana chahiye") — a
// call the customer answered and the agent joined, any day, either direction.
async function everSpoke(phone) {
  const p = last10(phone);
  if (p.length < 8) return false;
  const hit = await mongoose
    .model('CallRecord')
    .findOne({ phone: { $in: variants(p) }, answeredAt: { $ne: null }, agentLegAnswered: true })
    .select('_id')
    .lean();
  return !!hit;
}

// → { ok: true } or { ok: false, until: Date, reason, final? }
// final = never auto-dial this number again (already spoken to).
async function autoDialCheck(phone, now = Date.now()) {
  const p = last10(phone);
  if (p.length < 8) return { ok: true };
  if (await everSpoke(p)) return { ok: false, final: true, until: new Date(8.64e15), reason: 'already spoke' };
  const today = await mongoose
    .model('CallRecord')
    .find({ created: { $gte: istDayStart(now), $lte: new Date(now) }, direction: 'Outbound', phone: { $in: variants(p) } })
    .select('created agentLegAnswered providerRaw.HangupCauseName providerRaw.HangupCause status')
    .sort({ created: -1 })
    .lean();
  if (!today.length) return { ok: true };
  const tomorrow = nextDayStart(now);
  if (today.some((r) => r.agentLegAnswered)) return { ok: false, until: tomorrow, reason: 'spoke today' };
  if (today.length >= AUTO_MAX_PER_DAY) return { ok: false, until: tomorrow, reason: `${today.length} calls today` };
  if (today.filter(wasRejected).length >= REJECT_STOP) return { ok: false, until: tomorrow, reason: 'rejected / busy twice today' };
  const gapEnds = new Date(new Date(today[0].created).getTime() + AUTO_MIN_GAP_MS);
  if (gapEnds.getTime() > now) return { ok: false, until: gapEnds, reason: 'called less than 2 h ago' };
  return { ok: true };
}

module.exports = { autoDialCheck, everSpoke, istDayStart, nextDayStart, AUTO_MAX_PER_DAY, AUTO_MIN_GAP_MS };
