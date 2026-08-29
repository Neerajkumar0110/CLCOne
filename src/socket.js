const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');

let io = null;
// adminId (string) -> count of open sockets, so having the app open in two
// tabs doesn't flicker the presence dot on/off as one tab reconnects.
const onlineCounts = new Map();

// Same session check as the REST JWT middleware (see createAuthMiddleware/
// isValidAuthToken.js) — a handshake token has to belong to a still-logged-in
// session, not just be a validly-signed JWT (e.g. after logout).
async function authenticate(token) {
  if (!token) return null;
  const verified = jwt.verify(token, process.env.JWT_SECRET);
  const Admin = mongoose.model('Admin');
  const AdminPassword = mongoose.model('AdminPassword');
  const [admin, adminPassword] = await Promise.all([
    Admin.findOne({ _id: verified.id, removed: false }).lean(),
    AdminPassword.findOne({ user: verified.id, removed: false }).lean(),
  ]);
  if (!admin || !adminPassword?.loggedSessions?.includes(token)) return null;
  return admin;
}

function initSocket(server) {
  const { Server } = require('socket.io');
  io = new Server(server, {
    cors: { origin: true, credentials: true },
  });

  // onlineCounts always starts empty on a fresh process, so any
  // LoginActivity left "open" (logoutAt: null) from before this boot is
  // necessarily stale — the process that would have closed it (via the
  // disconnect handler below) died first, e.g. a crash or restart mid-
  // session. Close those out now so they don't silently inflate "hours
  // today" forever (see the isToday && onlineIds.has(key) guard in
  // loginActivityController/summary.js, which is the other half of this).
  closeOrphanedLoginSessions();

  io.use(async (socket, next) => {
    try {
      const admin = await authenticate(socket.handshake.auth?.token);
      if (!admin) return next(new Error('Authentication failed'));
      socket.adminId = String(admin._id);
      socket.adminName = admin.name;
      next();
    } catch (err) {
      next(new Error('Authentication failed'));
    }
  });

  io.on('connection', (socket) => {
    const { adminId, adminName } = socket;
    socket.join(`user:${adminId}`);

    const wasOffline = !onlineCounts.get(adminId);
    onlineCounts.set(adminId, (onlineCounts.get(adminId) || 0) + 1);
    if (wasOffline) {
      io.emit('presence:update', { userId: adminId, online: true });
      startLoginSession(adminId, adminName);
    }
    // Lets a newly-connected client paint every currently-online user
    // immediately, instead of waiting on each of their next presence event.
    socket.emit('presence:snapshot', { userIds: [...onlineCounts.keys()] });

    socket.on('typing', ({ to }) => {
      if (to) socket.to(`user:${to}`).emit('typing', { from: adminId });
    });

    socket.on('disconnect', () => {
      const remaining = (onlineCounts.get(adminId) || 1) - 1;
      if (remaining <= 0) {
        onlineCounts.delete(adminId);
        io.emit('presence:update', { userId: adminId, online: false });
        endLoginSession(adminId);
      } else {
        onlineCounts.set(adminId, remaining);
      }
    });
  });
}

// Session tracking (backend/src/models/appModels/LoginActivity.js) — a
// session starts when an admin's FIRST socket connects (not every tab) and
// ends when their LAST socket disconnects, so a session's duration reflects
// real continuous time in the app. Never awaited by the connect/disconnect
// handlers above — a DB hiccup here shouldn't affect presence/chat.
async function closeOrphanedLoginSessions() {
  try {
    const LoginActivity = mongoose.model('LoginActivity');
    const now = new Date();
    const orphans = await LoginActivity.find({ logoutAt: null });
    await Promise.all(
      orphans.map((s) => {
        s.logoutAt = now;
        s.durationSeconds = Math.max(0, Math.round((now - s.loginAt) / 1000));
        return s.save();
      })
    );
  } catch (err) {
    console.error('closeOrphanedLoginSessions failed:', err.message);
  }
}

async function startLoginSession(adminId, adminName) {
  try {
    const LoginActivity = mongoose.model('LoginActivity');
    await new LoginActivity({ admin: adminId, adminName, loginAt: new Date() }).save();
  } catch (err) {
    console.error('startLoginSession failed:', err.message);
  }
}

async function endLoginSession(adminId) {
  try {
    const LoginActivity = mongoose.model('LoginActivity');
    const openSession = await LoginActivity.findOne({ admin: adminId, logoutAt: null }).sort({ loginAt: -1 });
    if (!openSession) return;
    const now = new Date();
    openSession.logoutAt = now;
    openSession.durationSeconds = Math.max(0, Math.round((now - openSession.loginAt) / 1000));
    await openSession.save();
  } catch (err) {
    console.error('endLoginSession failed:', err.message);
  }
}

// Pushed to both participants — the sender's other open tabs get it too, so
// every window stays in sync without each one re-fetching the thread.
function emitMessage(message) {
  if (!io) return;
  io.to(`user:${message.from}`).to(`user:${message.to}`).emit('message:new', message);
}

function getOnlineUserIds() {
  return [...onlineCounts.keys()];
}

// Tells the sender "the person you were messaging in this conversation just
// read it" — pushed to the reader's counterpart so an open thread on their
// screen can flip single ticks to double ticks live, without a refresh.
// See messageController/thread.js.
function emitRead({ conversationId, senderId, readerId, readAt }) {
  if (!io) return;
  io.to(`user:${senderId}`).emit('message:read', { conversationId, readerId, readAt });
}

// Pushed to whichever admin the notification is for — see backend/src/notify.js.
function emitNotification(notification) {
  if (!io) return;
  io.to(`user:${notification.recipient}`).emit('notification:new', notification);
}

module.exports = { initSocket, emitMessage, emitRead, emitNotification, getOnlineUserIds };
