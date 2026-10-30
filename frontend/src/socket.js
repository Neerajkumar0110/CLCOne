import { io } from 'socket.io-client';
import { BASE_URL } from '@/config/serverApiConfig';
import storePersist from '@/redux/storePersist';

// One shared Socket.IO connection for the whole app, authenticated the same
// way backend/src/socket.js expects (a still-logged-in session's JWT in the
// handshake). backend/src/socket.js is a no-op on Vercel serverless (no
// persistent io) but live on the VPS process — callers should treat socket
// events as a "refetch now" signal on top of the REST endpoints, which stay
// the source of truth, not as the only way data arrives.
let socket = null;

export function getSocket() {
  const token = storePersist.get('auth')?.current?.token;
  if (!token) return null;
  if (socket) return socket;

  socket = io(BASE_URL, {
    auth: { token },
    transports: ['websocket', 'polling'],
    reconnection: true,
  });
  // One login per user (backend issueSession.js): someone logged in with
  // this account somewhere else → this session is over. If this browser is
  // the one that logged in again (another tab), it already holds the new
  // token — just reload onto it instead of logging out.
  socket.on('auth:session-replaced', () => {
    const current = storePersist.get('auth')?.current?.token;
    if (current && current !== token) {
      window.location.reload();
      return;
    }
    window.localStorage.removeItem('auth');
    window.localStorage.removeItem('isLogout');
    window.alert('You have been logged out because your account was just logged in on another device or browser.');
    window.location.href = '/logout';
  });
  return socket;
}

export function disconnectSocket() {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
}
