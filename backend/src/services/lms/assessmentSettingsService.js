const mongoose = require('mongoose');

// Cached read/write of the single LmsSetting('assessments') row — same shape
// as services/lms/settingsService.js's LmsSetting('live') row. Spec §10
// "Assessment engine" — qualifyThreshold/maxAttemptsPerType/cooldownDays were
// previously hardcoded constants duplicated independently in
// testController.js and adminController.js (already drifted: 3 separate
// re-derivations of the same 0.9), with no admin control at all.

let _cache = null;
let _cachedAt = 0;
const TTL_MS = 15000;

const DEFAULTS = {
  qualifyThreshold: 0.9,
  maxAttemptsPerType: 3,
  cooldownDays: 7,
};

async function get(force = false) {
  if (!force && _cache && Date.now() - _cachedAt < TTL_MS) return _cache;
  const LmsSetting = mongoose.model('LmsSetting');
  let row = await LmsSetting.findOne({ key: 'assessments' }).lean();
  if (!row) {
    row = (await LmsSetting.create({ key: 'assessments' })).toObject();
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
  const row = await LmsSetting.findOneAndUpdate({ key: 'assessments' }, { $set }, { new: true, upsert: true }).lean();
  _cache = { ...DEFAULTS, ...row };
  _cachedAt = Date.now();
  return _cache;
}

module.exports = { get, update, DEFAULTS };
