const crypto = require('crypto');
const mongoose = require('mongoose');

// Feature flags (Figma 4E). On the QA server (LMS_ENV=qa) a flag follows its
// "QA" switch; in production it is on for `rollout`% of users (stable hash of
// user + flag) within its audience (all | role:<Role> | batch:<name>).
// A flag that doesn't exist counts as ON — features never vanish by accident.

const DEFAULTS = [
  ['learner_360_v2', 'Learner 360° report with gauge, radar, PDF'],
  ['project_deadline_timer', 'Live countdown, auto-lock, auto-disqualify'],
  ['engagement_heatmap', 'Practice tracker + heatmap'],
  ['recruiter_share_link', 'Public recruiter profile link'],
];

const isQa = () => process.env.LMS_ENV === 'qa';
const bucket = (uid, key) => parseInt(crypto.createHash('md5').update(`${uid}:${key}`).digest('hex').slice(0, 8), 16) % 100;

let cache = null;
let at = 0;
async function all() {
  if (cache && Date.now() - at < 30000) return cache;
  const F = mongoose.model('LmsFeatureFlag');
  if (!(await F.estimatedDocumentCount())) {
    await F.insertMany(DEFAULTS.map(([key, description]) => ({ key, description, qa: true, rollout: 100, audience: 'all' })), { ordered: false }).catch(() => {});
  }
  cache = await F.find({ removed: false }).lean();
  at = Date.now();
  return cache;
}
const bust = () => {
  cache = null;
};

async function enabledFor(flag, admin, batch) {
  if (!flag) return true;
  if (isQa()) return !!flag.qa;
  if (!flag.rollout) return false;
  const aud = String(flag.audience || 'all');
  if (aud.startsWith('role:') && admin && admin.role !== aud.slice(5)) return false;
  if (aud.startsWith('batch:')) {
    if (!batch) return false;
    if (String(batch).toLowerCase() !== aud.slice(6).toLowerCase()) return false;
  }
  return bucket(admin ? admin._id : 'anon', flag.key) < flag.rollout;
}

// { key: true|false } for this user
async function forUser(admin) {
  const flags = await all();
  let batch = null;
  if (flags.some((f) => String(f.audience || '').startsWith('batch:')) && admin && admin.email) {
    const row = await mongoose
      .model('Student')
      .findOne({ email: new RegExp(`^${String(admin.email).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i'), removed: { $ne: true } })
      .select('batch')
      .lean()
      .catch(() => null);
    batch = row && row.batch;
  }
  const out = {};
  for (const f of flags) out[f.key] = await enabledFor(f, admin, batch);
  return out;
}

module.exports = { all, bust, forUser, enabledFor, bucket, isQa, DEFAULTS };
