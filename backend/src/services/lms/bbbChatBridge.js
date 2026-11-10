const net = require('net');
const mongoose = require('mongoose');

// BBB public chat → class board chat. A learner's embedded room hides BBB's
// own chat (the board's Chat tab is the class chat, and board messages are
// posted into BBB with sendChatMessage). This brings the other direction:
// whatever someone types in the full BBB client — usually the trainer in
// their own tab — lands in the board chat (LiveClassChat) too.
//
// The BBB server runs on this same box and publishes every meeting event on
// the local Redis channel "from-akka-apps-redis-channel" (the same feed
// bbb-webhooks reads). This only SUBSCRIBEs to it — a tiny RESP client, no
// new dependency — and reacts to GroupChatMessageBroadcastEvtMsg on the main
// public chat. Messages our own sendChatMessage posted come back with sender
// id "SYSTEM" and are skipped, so nothing loops. No Redis (e.g. a laptop) →
// it stays quiet and retries slowly.

const CHANNEL = 'from-akka-apps-redis-channel';
const HOST = process.env.BBB_REDIS_HOST || '127.0.0.1';
const PORT = Number(process.env.BBB_REDIS_PORT || 6379);
const seen = new Map(); // bbb msg id -> ms (dedupe within the process)

async function onChat(body, internalMeetingId) {
  const msg = body && body.msg;
  if (!msg || body.chatId !== 'MAIN-PUBLIC-GROUP-CHAT') return;
  if (!msg.sender || msg.sender.id === 'SYSTEM' || msg.correlationId === 'SYSTEM') return; // our own mirror
  const text = String(msg.message || '').trim();
  if (!text || seen.has(msg.id)) return;
  seen.set(msg.id, Date.now());
  if (seen.size > 2000) for (const [k, t] of seen) if (Date.now() - t > 3600000) seen.delete(k);

  const S = mongoose.model('LmsLiveSession');
  const session = await S.findOne({ removed: false, 'providerData.internalMeetingID': internalMeetingId, status: { $in: ['live', 'starting', 'ending'] } })
    .select('participants teacherCrmUser teacherName')
    .lean();
  if (!session) return;
  const name = String(msg.sender.name || '').trim();
  const isMod = msg.sender.role === 'MODERATOR';
  const p = (session.participants || []).find((x) => x.name && x.name.toLowerCase() === name.toLowerCase());
  const author = (p && p.crmUser) || (isMod && session.teacherCrmUser) || session.teacherCrmUser;
  if (!author) return;
  await mongoose.model('LiveClassChat').create({
    liveSession: session._id,
    author,
    authorName: name || session.teacherName || 'Trainer',
    authorRole: isMod || (p && p.role === 'teacher') ? 'teacher' : 'student',
    text: text.slice(0, 500),
    created: msg.timestamp ? new Date(msg.timestamp) : new Date(),
  });
}

function handle(payload) {
  if (!payload.includes('GroupChatMessageBroadcastEvtMsg')) return;
  let evt;
  try {
    evt = JSON.parse(payload);
  } catch (e) {
    return;
  }
  const core = evt && evt.core;
  if (!core || !core.header || core.header.name !== 'GroupChatMessageBroadcastEvtMsg') return;
  onChat(core.body, core.header.meetingId).catch((e) => console.error('[lms] bbb chat bridge:', e.message));
}

// minimal RESP reader for SUBSCRIBE pushes: *3\r\n$7\r\nmessage\r\n$<n>\r\n<channel>\r\n$<n>\r\n<payload>\r\n
function makeParser(onMessage) {
  let buf = Buffer.alloc(0);
  const readLine = (at) => {
    const i = buf.indexOf('\r\n', at);
    return i < 0 ? null : { line: buf.slice(at, i).toString(), next: i + 2 };
  };
  return (chunk) => {
    buf = Buffer.concat([buf, chunk]);
    for (;;) {
      const head = readLine(0);
      if (!head) return;
      if (head.line[0] !== '*') {
        buf = buf.slice(head.next); // +OK etc.
        continue;
      }
      const n = Number(head.line.slice(1));
      let pos = head.next;
      const parts = [];
      let complete = true;
      for (let k = 0; k < n; k += 1) {
        const h = readLine(pos);
        if (!h) {
          complete = false;
          break;
        }
        if (h.line[0] === ':') {
          parts.push(h.line.slice(1));
          pos = h.next;
          continue;
        }
        const len = Number(h.line.slice(1));
        if (buf.length < h.next + len + 2) {
          complete = false;
          break;
        }
        parts.push(buf.slice(h.next, h.next + len).toString());
        pos = h.next + len + 2;
      }
      if (!complete) return;
      buf = buf.slice(pos);
      if (parts[0] === 'message') onMessage(parts[2]);
    }
  };
}

function start() {
  let delay = 5000;
  const connect = () => {
    const sock = net.createConnection({ host: HOST, port: PORT });
    const parse = makeParser(handle);
    sock.on('connect', () => {
      delay = 5000;
      sock.write(`*2\r\n$9\r\nSUBSCRIBE\r\n$${CHANNEL.length}\r\n${CHANNEL}\r\n`);
      console.log('[lms] bbb chat bridge: listening to BBB public chat');
    });
    sock.on('data', parse);
    sock.on('error', () => {});
    sock.on('close', () => {
      setTimeout(connect, delay);
      delay = Math.min(delay * 2, 10 * 60000);
    });
  };
  connect();
}

module.exports = { start, _test: { makeParser, handle, onChat } };
