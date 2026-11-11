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

// Fields to store on a new LoginActivity row for this connection.
async function describe(adminId, headers = {}, remoteAddress = '') {
  const ip = clientIp(headers, remoteAddress);
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

module.exports = { describe, clientIp, parseUserAgent, NEW_WINDOW_DAYS };
