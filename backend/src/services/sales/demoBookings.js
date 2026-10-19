const crypto = require('crypto');
const mongoose = require('mongoose');
const { lmsConfig } = require('../../config/lms');
const { getMeetingProvider } = require('../lms/meeting');
const mailer = require('../lms/mailer');
const { escHtml: esc } = require('../../utils/emailFormat');

// Daily live demo — Mon–Sat, 6:00–7:00 PM IST, one BigBlueButton room per
// day. An agent marks a lead "Demo Booked" (call modal / Leads page) and
// picks the DAY; the customer, the agent and the agent's Team Leader each get
// an email with their own join link. The link opens the BBB room straight
// away — no CRM login, like a Google Meet link — but only on the booked day,
// from 10 minutes before 6 PM for as long as the demo is live.
// Customer doesn't show up → moved once to the next demo day with a fresh
// email (jobs/demoBookingTick.js → handleNoShows).

const SLOT_START = '18:00';
const SLOT_END = '19:00';
const EARLY_MIN = 10;
const IST_MS = 330 * 60000;

const istDate = (d = new Date()) => new Date(new Date(d).getTime() + IST_MS).toISOString().slice(0, 10);
const slotStart = (date) => new Date(`${date}T${SLOT_START}:00+05:30`);
const slotEnd = (date) => new Date(`${date}T${SLOT_END}:00+05:30`);
const dow = (date) => new Date(`${date}T12:00:00+05:30`).getUTCDay(); // 0 = Sunday
const addDays = (date, n) => istDate(new Date(new Date(`${date}T12:00:00+05:30`).getTime() + n * 86400000));
const isDemoDay = (date) => dow(date) !== 0;
function nextDemoDay(date) {
  let d = addDays(date, 1);
  while (!isDemoDay(d)) d = addDays(d, 1);
  return d;
}
const fmtDay = (date) =>
  new Date(`${date}T12:00:00+05:30`).toLocaleDateString('en-IN', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'Asia/Kolkata',
  });

// The demo day for an agent's pick: its IST date, pushed to Monday if it's a
// Sunday, and to the next demo day if today's demo is already over.
function demoDateFor(meetingAt) {
  const now = new Date();
  let date = istDate(meetingAt ? new Date(meetingAt) : now);
  if (date < istDate(now)) date = istDate(now);
  if (!isDemoDay(date)) date = nextDemoDay(date);
  if (slotEnd(date) <= now) date = nextDemoDay(date);
  return date;
}

const base = () => (lmsConfig.meeting.crmBaseUrl || 'https://clcone.careerlabconsulting.com').replace(/\/+$/, '');
const joinLink = (token) => `${base()}/api/demo/j/${token}`;
const newToken = () => crypto.randomBytes(18).toString('base64url');
const fullName = (a) => (a ? `${a.name || ''} ${a.surname || ''}`.trim() : '');

// Walk "Reports To" up from the agent to the first Team Leader.
async function teamLeaderOf(agentId) {
  const Admin = mongoose.model('Admin');
  let cur = await Admin.findById(agentId).select('reportsTo role').lean();
  for (let i = 0; cur && cur.reportsTo && i < 6; i += 1) {
    const up = await Admin.findById(cur.reportsTo).select('name surname email role reportsTo removed enabled').lean();
    if (!up) return null;
    if (up.role === 'Team Leader' && !up.removed) return up;
    cur = up;
  }
  return null;
}

// ── emails ───────────────────────────────────────────────────────────────
const btn = (url, label) =>
  `<p style="margin:18px 0"><a href="${esc(url)}" style="display:inline-block;background:#2f5fd0;color:#fff;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:700">${esc(label)}</a></p><p style="color:#889;font-size:12.5px;word-break:break-all">${esc(url)}</p>`;
const wrap = (inner) =>
  `<div style="font:15px/1.6 -apple-system,Segoe UI,Roboto,sans-serif;color:#17202c;max-width:560px;margin:0 auto">${inner}<p style="color:#889;font-size:12.5px;margin-top:22px">Career Lab Consulting</p></div>`;
const whenBox = (date) =>
  `<div style="border:1px solid #e3e8ef;border-radius:12px;padding:14px 18px;margin:14px 0"><p style="margin:0"><b>📅 ${esc(fmtDay(date))}</b></p><p style="margin:2px 0 0"><b>🕕 6:00 PM – 7:00 PM (IST)</b></p><p style="margin:8px 0 0;color:#556;font-size:13.5px">The link opens 10 minutes before the demo starts and works only on this day.</p></div>`;

function customerHtml(b, { rebooked }) {
  return wrap(`<h2 style="margin:0 0 6px">${rebooked ? 'We missed you — your demo is moved to the next session' : 'Your live demo is booked!'}</h2>
  <p style="color:#556;margin:0">Hi ${esc(b.name || 'there')}, ${
    rebooked
      ? "you couldn't join your live demo, so we've booked you into the next one."
      : `thank you for your time on the call${b.agentName ? ` with ${esc(b.agentName)}` : ''}. Here are your live demo details.`
  }</p>
  ${whenBox(b.date)}
  <p style="margin:0">Just click the button at the time of the demo — no app or login needed. Use Chrome on your laptop or phone and allow the microphone when asked.</p>
  ${btn(joinLink(b.tokens.customer), 'Join Live Demo')}`);
}

function staffHtml(b, who, { rebooked }) {
  return wrap(`<h2 style="margin:0 0 6px">${rebooked ? 'Demo no-show — moved to the next session' : 'Demo booked'}</h2>
  <p style="color:#556;margin:0">${
    who === 'leader' ? `${esc(b.agentName || 'Your team member')} booked a live demo for a customer.` : 'You booked a live demo for this customer.'
  }${rebooked ? ' The customer missed the last session, so they were moved to the next one automatically.' : ''}</p>
  <div style="border:1px solid #e3e8ef;border-radius:12px;padding:14px 18px;margin:14px 0">
    <p style="margin:0"><b>Customer</b>: ${esc(b.name || '—')}</p>
    <p style="margin:0"><b>Phone</b>: ${esc(b.phone || '—')}</p>
    <p style="margin:0"><b>Email</b>: ${esc(b.email || 'not on file — the customer did NOT get the link')}</p>
    <p style="margin:0"><b>Booked by</b>: ${esc(b.agentName || '—')}</p>
  </div>
  ${whenBox(b.date)}
  ${btn(joinLink(b.tokens[who]), 'Join Live Demo')}`);
}

async function sendEmails(b, { rebooked = false } = {}) {
  const subjectDay = fmtDay(b.date);
  const out = [];
  const send = async (kind, to, subject, html) => {
    if (!to) return;
    const r = await mailer.sendMail([to], { subject, html }).catch((e) => ({ sent: 0, error: e.message }));
    out.push({ kind, to: [to], sent: (r && r.sent) || 0, at: new Date() });
  };
  await send(
    rebooked ? 'customer-rebooked' : 'customer',
    b.email,
    rebooked ? `Your live demo is moved to ${subjectDay}, 6 PM` : `Your live demo — ${subjectDay}, 6:00 PM`,
    customerHtml(b, { rebooked })
  );
  await send('agent', b.agentEmail, `${rebooked ? 'Demo no-show, rebooked' : 'Demo booked'}: ${b.name || b.phone} — ${subjectDay}, 6 PM`, staffHtml(b, 'agent', { rebooked }));
  await send('leader', b.teamLeaderEmail, `${rebooked ? 'Demo no-show, rebooked' : 'Demo booked'} by ${b.agentName || 'team'}: ${b.name || b.phone} — ${subjectDay}`, staffHtml(b, 'leader', { rebooked }));
  return out;
}

// ── booking ──────────────────────────────────────────────────────────────
// Called after a lead is saved as "Demo Booked". One active booking per lead:
// same day again → nothing (no duplicate emails); a different day →
// rescheduled and re-emailed. Never throws into the caller's save.
async function bookDemo({ leadId, meetingAt, actor, callRecordId }) {
  const DemoBooking = mongoose.model('DemoBooking');
  const lead = await mongoose.model('Lead').findById(leadId).select('name phone email').lean();
  if (!lead) return null;
  const date = demoDateFor(meetingAt);

  let b = await DemoBooking.findOne({ lead: lead._id, status: 'booked', removed: false });
  if (b && b.date === date) return { booking: b, date, unchanged: true };

  const agent = actor && actor._id ? await mongoose.model('Admin').findById(actor._id).select('name surname email').lean() : null;
  const leader = agent ? await teamLeaderOf(agent._id) : null;
  if (!b) {
    b = new DemoBooking({
      lead: lead._id,
      tokens: { customer: newToken(), agent: newToken(), leader: newToken() },
      createdBy: agent && agent._id,
    });
  }
  Object.assign(b, {
    name: lead.name,
    email: lead.email || undefined,
    phone: lead.phone,
    date,
    agent: agent && agent._id,
    agentName: fullName(agent),
    agentEmail: agent && agent.email,
    teamLeader: leader && leader._id,
    teamLeaderName: fullName(leader),
    teamLeaderEmail: leader && leader.email,
    callRecord: callRecordId || b.callRecord,
    rebookCount: 0,
    updated: new Date(),
  });
  await b.save();
  await mongoose.model('Lead').updateOne({ _id: lead._id }, { $set: { meetingAt: slotStart(date) } });

  const sent = await sendEmails(b);
  b.emails.push(...sent);
  await b.save();
  return { booking: b, date, customerEmailed: sent.some((s) => s.kind === 'customer' && s.sent), noCustomerEmail: !b.email };
}

// Safe wrapper for controllers — a mail/BBB hiccup must not fail the save.
async function bookDemoSafe(args) {
  try {
    return await bookDemo(args);
  } catch (e) {
    console.error('[demo] booking failed:', e.message);
    return null;
  }
}

// ── room ─────────────────────────────────────────────────────────────────
async function roomFor(date) {
  const DemoRoom = mongoose.model('DemoRoom');
  let room = await DemoRoom.findOne({ date });
  if (!room) {
    room = await DemoRoom.findOneAndUpdate(
      { date },
      {
        $setOnInsert: {
          date,
          meetingId: `clc-demo-${date}`,
          moderatorPW: crypto.randomBytes(9).toString('hex'),
          attendeePW: crypto.randomBytes(9).toString('hex'),
        },
      },
      { upsert: true, new: true }
    );
  }
  return room;
}

// BBB `create` is idempotent for a meetingID that's already running.
async function ensureRoom(room) {
  const provider = getMeetingProvider();
  if (!provider._call) throw new Error('Live demo needs BigBlueButton configured.');
  const mins = Math.max(30, Math.round((slotEnd(room.date) - Date.now()) / 60000) + 60);
  await provider._call('create', {
    name: `Career Lab — Live Demo (${fmtDay(room.date)})`,
    meetingID: room.meetingId,
    moderatorPW: room.moderatorPW,
    attendeePW: room.attendeePW,
    record: 'false',
    welcome: 'Welcome to the Career Lab Consulting live demo.',
    logoutURL: 'https://careerlabconsulting.com',
    duration: String(mins),
    meta_source: 'clc-demo',
  });
}

async function isLive(date) {
  const room = await mongoose.model('DemoRoom').findOne({ date }).lean();
  if (!room) return false;
  const r = await getMeetingProvider().isRunning(room);
  return r === true;
}

async function joinUrl(date, { role, name, userId }) {
  const room = await roomFor(date);
  await ensureRoom(room);
  return getMeetingProvider().getJoinUrl(room, { role, fullName: name || 'Guest', userId });
}

// Can a link for `date` be used right now? open from 5:50 PM that day; after
// 7 PM only while the room is still live.
async function windowState(date) {
  const now = Date.now();
  if (now < slotStart(date).getTime() - EARLY_MIN * 60000) return 'early';
  if (now <= slotEnd(date).getTime()) return 'open';
  return (await isLive(date)) ? 'open' : 'over';
}

// ── no-shows ─────────────────────────────────────────────────────────────
async function setLeadSub(leadId, toSub, remarks) {
  const Lead = mongoose.model('Lead');
  const lead = await Lead.findById(leadId);
  if (!lead || lead.stage !== 'Demo Booking' || lead.subStatus === toSub) return;
  if (toSub === 'Demo Not Attended' && lead.subStatus !== 'Demo Booked') return;
  lead.stageHistory.push({
    fromStage: lead.stage,
    fromSubStatus: lead.subStatus,
    toStage: lead.stage,
    toSubStatus: toSub,
    changedByName: 'Live demo (auto)',
    remarks,
    at: new Date(),
  });
  lead.subStatus = toSub;
  await lead.save();
}

async function markAttended(b) {
  if (b.status !== 'booked') return;
  b.status = 'attended';
  b.attendedAt = new Date();
  await b.save();
  await setLeadSub(b.lead, 'Demo Attended', `Joined the live demo on ${b.date}`).catch(() => {});
}

// A booked customer whose demo day is over and who never joined: move them
// once to the next demo day (fresh email to all three), then give up.
async function handleNoShows() {
  const DemoBooking = mongoose.model('DemoBooking');
  const now = new Date();
  const today = istDate(now);
  const due = await DemoBooking.find({ status: 'booked', removed: false, date: { $lte: today } });
  let moved = 0;
  for (const b of due) {
    if (now.getTime() < slotEnd(b.date).getTime() + 15 * 60000) continue;
    if (b.date === today && (await isLive(b.date))) continue;
    if (b.rebookCount < 1) {
      let next = nextDemoDay(b.date);
      while (slotEnd(next) <= now) next = nextDemoDay(next);
      b.missedDates.push(b.date);
      b.date = next;
      b.rebookCount += 1;
      b.updated = new Date();
      await b.save();
      await mongoose.model('Lead').updateOne({ _id: b.lead }, { $set: { meetingAt: slotStart(next) } });
      const sent = await sendEmails(b, { rebooked: true });
      b.emails.push(...sent);
      await b.save();
      moved += 1;
    } else {
      b.missedDates.push(b.date);
      b.status = 'missed';
      b.updated = new Date();
      await b.save();
      await setLeadSub(b.lead, 'Demo Not Attended', `Missed the live demo twice (${b.missedDates.join(', ')})`).catch(() => {});
    }
  }
  return moved;
}

module.exports = {
  istDate,
  slotStart,
  slotEnd,
  isDemoDay,
  nextDemoDay,
  demoDateFor,
  fmtDay,
  joinLink,
  bookDemo,
  bookDemoSafe,
  joinUrl,
  windowState,
  isLive,
  markAttended,
  handleNoShows,
};
