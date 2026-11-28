const crypto = require('crypto');
const mongoose = require('mongoose');
const E = require('../../../../services/hr/erpAttendance');

// /api/erp-agent — the CLC Desktop Agent (desktop-agent/).
//   POST /register  (normal CRM login token) → { deviceToken } bound to that employee
//   POST /beat      (X-Device-Token)          → system idle + power state + events
// The agent sends only: seconds since the last keyboard / mouse input, the
// power state (on / locked / sleep / off) and power events. No keys, no
// screens, no app names.
const ok = (res, result, message = 'ok') => res.status(200).json({ success: true, result, message });
const bad = (res, message, status = 400) => res.status(status).json({ success: false, result: null, message });
const sha = (t) => crypto.createHash('sha256').update(String(t)).digest('hex');
const EVENTS = ['boot', 'unlock', 'lock', 'sleep', 'wake', 'shutdown', 'agent_start', 'agent_stop'];
const POWER_OF = { boot: 'on', unlock: 'on', wake: 'on', agent_start: 'on', lock: 'locked', sleep: 'sleep', shutdown: 'off', agent_stop: 'off' };

const register = async (req, res) => {
  if (!E.isTrackedRole(req.admin.role)) return bad(res, 'Staff accounts only.', 403);
  const r = await bindDevice(req.admin._id, req.body || {});
  return r.error ? bad(res, r.error) : ok(res, r, 'Agent connected.');
};

async function bindDevice(adminId, b) {
  const deviceId = String(b.deviceId || '').slice(0, 80);
  if (!/^[A-Za-z0-9-]{8,80}$/.test(deviceId)) return { error: 'Bad device id.' };
  const token = crypto.randomBytes(32).toString('hex');
  const D = mongoose.model('ErpDevice');
  const dev = await D.findOneAndUpdate(
    { deviceId, admin: adminId },
    {
      $set: { hostname: String(b.hostname || '').slice(0, 80), os: String(b.os || '').slice(0, 60), agentVersion: String(b.version || '').slice(0, 20), tokenHash: sha(token), revoked: false, lastSeenAt: new Date(), power: 'on', powerSince: new Date() },
      $setOnInsert: { installedAt: new Date() },
    },
    { upsert: true, new: true }
  );
  // the same laptop can't stay bound to someone else
  await D.updateMany({ deviceId, admin: { $ne: adminId } }, { $set: { revoked: true } });
  await mongoose.model('ErpDeviceEvent').create({ device: dev._id, admin: adminId, dayKey: E.todayKey(), at: new Date(), kind: 'agent_start', detail: 'connected' });
  return { deviceToken: token, device: { _id: dev._id, hostname: dev.hostname } };
}

// POST /api/attendance-erp/me/agent/pair-code (employee, logged in) → 6-digit code, 10 min
const pairCode = async (req, res) => {
  if (!E.isTrackedRole(req.admin.role)) return bad(res, 'Staff accounts only.', 403);
  const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
  const expires = new Date(Date.now() + 10 * 60000);
  await mongoose.model('ErpProfile').updateOne({ admin: req.admin._id }, { $set: { pairCode: sha(code), pairExpires: expires } }, { upsert: true });
  return ok(res, { code, expiresAt: expires }, 'Type this code into the CLC Desktop Agent.');
};

// POST /api/erp-agent-public/pair { code, deviceId, hostname, os, version } (the agent, no login)
const pair = async (req, res) => {
  const b = req.body || {};
  const code = String(b.code || '').replace(/\D/g, '');
  if (code.length !== 6) return bad(res, 'Enter the 6-digit code from the Employee Portal.');
  const P = mongoose.model('ErpProfile');
  const p = await P.findOneAndUpdate({ pairCode: sha(code), pairExpires: { $gt: new Date() } }, { $unset: { pairCode: '', pairExpires: '' } });
  if (!p) return bad(res, 'Code is wrong or has expired. Get a new one in the Employee Portal › Desktop agent.', 403);
  const admin = await mongoose.model('Admin').findOne({ _id: p.admin, removed: false, enabled: true }).select('name surname role').lean();
  if (!admin || !E.isTrackedRole(admin.role)) return bad(res, 'Account not allowed.', 403);
  const r = await bindDevice(admin._id, b);
  return r.error ? bad(res, r.error) : ok(res, { ...r, employee: E.fullName(admin) }, `Connected to ${E.fullName(admin)}.`);
};

// POST /beat { idleSec, kbAgoSec, mouseAgoSec, power, events: [{ kind, at }], clientTime }
const beat = async (req, res) => {
  const token = req.headers['x-device-token'];
  if (!token) return bad(res, 'No device token.', 401);
  const dev = await mongoose.model('ErpDevice').findOne({ tokenHash: sha(token), revoked: false });
  if (!dev) return bad(res, 'Unknown or revoked device.', 401);
  const admin = await mongoose.model('Admin').findOne({ _id: dev.admin, removed: false, enabled: true }).select('name surname role email').lean();
  if (!admin) return bad(res, 'Account disabled.', 403);
  const b = req.body || {};
  const now = new Date();
  const S = await E.getSettings();
  const window = S.heartbeatSec + 5;
  const idleSec = Math.max(0, Number(b.idleSec) || 0);
  const kbAgo = b.kbAgoSec == null ? null : Math.max(0, Number(b.kbAgoSec));
  const msAgo = b.mouseAgoSec == null ? null : Math.max(0, Number(b.mouseAgoSec));
  // power events (deduplicated by kind + minute)
  const evs = (Array.isArray(b.events) ? b.events : []).filter((e) => e && EVENTS.includes(e.kind)).slice(0, 50);
  const Ev = mongoose.model('ErpDeviceEvent');
  for (const e of evs) {
    const at = e.at && !Number.isNaN(new Date(e.at).getTime()) && Math.abs(new Date(e.at) - now) < 7 * 864e5 ? new Date(e.at) : now;
    const exists = await Ev.exists({ device: dev._id, kind: e.kind, at: { $gte: new Date(at.getTime() - 30000), $lte: new Date(at.getTime() + 30000) } });
    if (!exists) await Ev.create({ device: dev._id, admin: dev.admin, dayKey: E.todayKey(at), at, kind: e.kind });
    dev.power = POWER_OF[e.kind] || dev.power;
    dev.powerSince = at;
  }
  if (b.power && ['on', 'locked', 'sleep', 'off'].includes(b.power) && b.power !== dev.power) {
    dev.power = b.power;
    dev.powerSince = now;
  }
  if (b.clientTime) {
    const skew = Math.round((new Date(b.clientTime) - now) / 1000);
    if (!Number.isNaN(skew)) dev.clockSkewSec = skew;
  }
  dev.lastSeenAt = now;
  dev.idleSec = idleSec;
  dev.lastInputAt = new Date(now.getTime() - idleSec * 1000);
  if (kbAgo != null) dev.lastKbAt = new Date(now.getTime() - kbAgo * 1000);
  if (msAgo != null) dev.lastMouseAt = new Date(now.getTime() - msAgo * 1000);
  if (b.version) dev.agentVersion = String(b.version).slice(0, 20);
  await dev.save();
  // feed the attendance engine — input only while unlocked and awake
  const awake = dev.power === 'on';
  const input = awake && idleSec < window;
  const kb = awake && kbAgo != null ? kbAgo < window : false;
  const mouse = awake && msAgo != null ? msAgo < window : input && !kb;
  if (dev.power !== 'off') await E.heartbeat(admin, { kb, mouse, input, agoMs: idleSec * 1000 }, { source: 'agent', now });
  return ok(res, { power: dev.power, heartbeatSec: S.heartbeatSec });
};

// GET /api/erp-agent-public/download/:os — the installer. AGENT_DOWNLOAD_URL
// (e.g. a release link) wins; else the file in AGENT_INSTALLER_DIR (default
// backend/downloads, kept out of git). Public: the installer holds no secret —
// a laptop is only counted after the signed-in employee connects it.
const download = async (req, res) => {
  const os = req.params.os === 'mac' ? 'mac' : 'win';
  if (process.env.AGENT_DOWNLOAD_URL) return res.redirect(process.env.AGENT_DOWNLOAD_URL.replace('{os}', os));
  const path = require('path');
  const fsx = require('fs');
  const dir = process.env.AGENT_INSTALLER_DIR || path.join(__dirname, '../../../../../downloads');
  const file = path.join(dir, os === 'mac' ? 'CLC-Desktop-Agent.dmg' : 'CLC-Desktop-Agent-Setup.exe');
  if (!fsx.existsSync(file)) return res.status(404).json({ success: false, result: null, message: 'The desktop agent installer is not uploaded yet. Ask HR.' });
  return res.download(file, path.basename(file));
};

module.exports = {
  download, register, beat, pairCode, pair };
