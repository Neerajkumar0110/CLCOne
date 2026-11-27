const mongoose = require('mongoose');

// Device / IP capture for login sessions (decision D-09 "Login / IP
// monitoring", Admin & Ops › Security). Every LoginActivity row now carries
// the IP, browser, OS and device type it came from, and is flagged when the
// user has not used that device (browser + OS + type) or that IP in the last
// 30 days — what the Security board lists as "new device / new IP".
// No external lookups: the IP is what nginx forwards, the rest is parsed
// from the User-Agent header.

const NEW_WINDOW_DAYS = 30;

function clientIp(headers = {}, fallback = '') {
  const xff = String(headers['x-forwarded-for'] || '').split(',')[0].trim();
  const ip = xff || String(headers['x-real-ip'] || '').trim() || String(fallback || '');
  return ip.replace(/^::ffff:/, '');
}

function parseUserAgent(ua = '') {
  const s = String(ua);
  let browser = 'Other';
  if (/Edg\//.test(s)) browser = 'Edge';
  else if (/OPR\/|Opera/.test(s)) browser = 'Opera';
  else if (/SamsungBrowser/.test(s)) browser = 'Samsung Internet';
  else if (/Firefox\//.test(s)) browser = 'Firefox';
  else if (/Chrome\//.test(s)) browser = 'Chrome';
  else if (/Safari\//.test(s)) browser = 'Safari';
  let os = 'Other';
  if (/Windows NT/.test(s)) os = 'Windows';
  else if (/Android/.test(s)) os = 'Android';
  else if (/iPhone|iPad|iPod/.test(s)) os = 'iOS';
  else if (/Mac OS X/.test(s)) os = 'macOS';
  else if (/Linux/.test(s)) os = 'Linux';
  const deviceType = /iPad|Tablet/.test(s) ? 'tablet' : /Mobi|Android|iPhone/.test(s) ? 'mobile' : 'desktop';
  return { browser, os, deviceType, device: `${browser} on ${os} (${deviceType})` };
}

// The socket.io connection reaches the API through nginx without the client
// IP, so every login showed the server's own address (::1) — LMS testing report
// #29. The last real IP seen on an authenticated /api request stands in.
const lastIp = new Map();
const LOOPBACK = /^(::1|127.0.0.1|::ffff:127.0.0.1|)$/;
function rememberIp(adminId, headers = {}, fallback = '') {
  const ip = clientIp(headers, fallback);
  if (adminId && ip && !LOOPBACK.test(ip)) lastIp.set(String(adminId), { ip, at: Date.now() });
}

// Fields to store on a new LoginActivity row for this connection.
async function describe(adminId, headers = {}, remoteAddress = '') {
  let ip = clientIp(headers, remoteAddress);
  if (LOOPBACK.test(ip)) {
    const seen = lastIp.get(String(adminId));
    if (seen && Date.now() - seen.at < 15 * 60 * 1000) ip = seen.ip;
  }
  const userAgent = String(headers['user-agent'] || '').slice(0, 400);
  const d = parseUserAgent(userAgent);
  const out = { ip, userAgent, browser: d.browser, os: d.os, deviceType: d.deviceType, device: d.device, newDevice: false, newIp: false };
  try {
    const since = new Date(Date.now() - NEW_WINDOW_DAYS * 86400000);
    const LA = mongoose.model('LoginActivity');
    const seenAny = await LA.exists({ admin: adminId, loginAt: { $gte: since }, device: { $exists: true } });
    if (seenAny) {
      // only flag once there is history with device data to compare against
      out.newDevice = !(await LA.exists({ admin: adminId, loginAt: { $gte: since }, device: d.device }));
      out.newIp = !!ip && !(await LA.exists({ admin: adminId, loginAt: { $gte: since }, ip }));
    }
  } catch (e) {
    // never block a login over monitoring
  }
  return out;
}

module.exports = { describe, clientIp, parseUserAgent, rememberIp, NEW_WINDOW_DAYS };
