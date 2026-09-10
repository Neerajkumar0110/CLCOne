const mongoose = require('mongoose');

// One entry point for LMS real-time + in-app notifications.
//   notify(userIds, {...})  -> Notification rows (module 'LMS') + socket push
//   broadcast(event, data)  -> io.emit (all connected clients)
//   toUsers(ids, event, d)  -> io.to(user:<id>) per id
//
// The socket layer is a no-op on Vercel serverless (no persistent io) — the
// panels also poll GET /api/lms/my/updates, so notifications still arrive.
// Every call here is best-effort and never throws.

let socket = {};
try {
  socket = require('../../socket');
} catch (e) {
  /* socket module unavailable (e.g. test harness) */
}

async function notify(userIds, { type, title, body, link, actorName } = {}) {
  try {
    const ids = [...new Set([].concat(userIds || []).map(String).filter((x) => x && x !== 'undefined'))];
    if (!ids.length || !title) return { created: 0 };
    const Notification = mongoose.model('Notification');
    let docs = [];
    try {
      docs = await Notification.insertMany(
        ids.map((id) => ({
          recipient: id,
          module: 'LMS',
          type: type || 'lms.update',
          title,
          body: (body || '').slice(0, 240),
          link: link || '/learn',
          actorName,
        })),
        { ordered: false }
      );
    } catch (e) {
      /* dup / validation — ignore */
    }
    for (const d of docs) {
      if (socket.emitNotification) socket.emitNotification(d.toObject ? d.toObject() : d);
    }
    return { created: docs.length };
  } catch (e) {
    return { created: 0, error: e.message };
  }
}

function broadcast(event, payload) {
  try {
    if (socket.emitLmsBroadcast) socket.emitLmsBroadcast(event, payload);
  } catch (e) {
    /* noop */
  }
}

function toUsers(userIds, event, payload) {
  try {
    if (socket.emitLmsToUsers) socket.emitLmsToUsers(userIds, event, payload);
  } catch (e) {
    /* noop */
  }
}

module.exports = { notify, broadcast, toUsers };
