const mongoose = require('mongoose');

// Cached read/write of the single LmsSetting('live') row. Always returns a
// complete object (schema defaults fill any gap), so callers never guard.

let _cache = null;
let _cachedAt = 0;
const TTL_MS = 15000;

const DEFAULTS = {
  presentThresholdPct: 75,
  partialThresholdPct: 25,
  lateThresholdMin: 10,
  attendanceCountsToProgress: true,
  liveClassProgressWeightPct: 0,
  recordingEnabled: true,
  recordingAutoStart: true,
  recordingRetentionDays: 365,
  recordingAccess: 'enrolled',
  recordingAvailableImmediately: true,
  autoStartPolicy: 'manual',
  autoEndPolicy: 'grace',
  autoEndGraceMin: 20,
  studentMic: false,
  studentCamera: false,
  studentScreenShare: false,
  chatEnabled: true,
  notifyBeforeMins: [1440, 60, 15],
  notifyOnStart: true,
  notifyOnRecording: true,
};

async function get(force = false) {
  if (!force && _cache && Date.now() - _cachedAt < TTL_MS) return _cache;
  const LmsSetting = mongoose.model('LmsSetting');
  let row = await LmsSetting.findOne({ key: 'live' }).lean();
  if (!row) {
    row = (await LmsSetting.create({ key: 'live' })).toObject();
  }
  _cache = { ...DEFAULTS, ...row };
  _cachedAt = Date.now();
  return _cache;
}

async function update(patch = {}) {
  const LmsSetting = mongoose.model('LmsSetting');
  const allowed = Object.keys(DEFAULTS);
  const $set = { updated: new Date() };
  for (const k of allowed) if (patch[k] !== undefined) $set[k] = patch[k];
  const row = await LmsSetting.findOneAndUpdate({ key: 'live' }, { $set }, { new: true, upsert: true }).lean();
  _cache = { ...DEFAULTS, ...row };
  _cachedAt = Date.now();
  return _cache;
}

// classify a % into a status, honouring the configured thresholds
function statusFor(pct, { lateFlag = false } = {}) {
  const s = _cache || DEFAULTS;
  if (pct >= s.presentThresholdPct) return lateFlag ? 'LATE' : 'PRESENT';
  if (pct >= s.partialThresholdPct) return 'PARTIAL';
  return 'ABSENT';
}

module.exports = { get, update, statusFor, DEFAULTS };
