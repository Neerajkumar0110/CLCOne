const mongoose = require('mongoose');
const { CRM_ADMIN_ROLES } = require('../../../config/roles');

// Admin settings for the saved per-platform ad templates autoLaunchCampaign.js
// uses — see that file's header comment for the full picture. Reading is
// open to any logged-in admin (so a non-manager can at least see what's
// configured); saving/uploading is manager-only since it's what actually
// controls real ad spend. Marketing, not Sales — built from CRM_ADMIN_ROLES,
// not MANAGEMENT_ROLES, so Sales Manager (no Marketing access) can't touch it.
const isManager = (a) => !!(a && CRM_ADMIN_ROLES.includes(a.role));

const PLATFORMS = ['facebook', 'google', 'linkedin'];

// GET /api/marketing/ad-templates — one row per platform, creating an empty
// (disabled) default for any platform nobody has configured yet, so the
// frontend always has exactly 3 rows to render.
const list = async (req, res) => {
  const AdCampaignTemplate = mongoose.model('AdCampaignTemplate');
  const rows = await AdCampaignTemplate.find({ removed: false }).lean();
  const byPlatform = Object.fromEntries(rows.map((r) => [r.platform, r]));
  const result = PLATFORMS.map((p) => byPlatform[p] || { platform: p, enabled: false });
  return res.status(200).json({ success: true, result, message: 'OK' });
};

// PATCH /api/marketing/ad-templates/:platform — manager only. Upserts the
// whole template document for that platform.
const upsert = async (req, res) => {
  if (!isManager(req.admin)) return res.status(403).json({ success: false, result: null, message: 'Managers only.' });
  const { platform } = req.params;
  if (!PLATFORMS.includes(platform)) {
    return res.status(400).json({ success: false, result: null, message: 'Invalid platform.' });
  }

  const AdCampaignTemplate = mongoose.model('AdCampaignTemplate');
  const b = req.body || {};
  // Never let the request body clobber bookkeeping/identity fields directly.
  delete b.platform;
  delete b.lastRunAt;
  delete b.lastRunStatus;
  delete b.lastRunError;
  delete b.lastRunSteps;
  delete b._id;

  const doc = await AdCampaignTemplate.findOneAndUpdate(
    { platform },
    { $set: { ...b, updated: new Date() }, $setOnInsert: { platform, created: new Date() } },
    { upsert: true, new: true }
  );
  return res.status(200).json({ success: true, result: doc, message: 'Template saved.' });
};

// POST /api/marketing/ad-templates/:platform/media (multipart: file) —
// manager only. Stores the creative image/video this platform's auto-launch
// will use (Facebook + LinkedIn only — Google's integration here is
// text-only, see the model's header comment).
const uploadMedia = async (req, res) => {
  if (!isManager(req.admin)) return res.status(403).json({ success: false, result: null, message: 'Managers only.' });
  const { platform } = req.params;
  if (!['facebook', 'linkedin'].includes(platform)) {
    return res.status(400).json({ success: false, result: null, message: 'That platform has no creative media.' });
  }
  if (!req.upload) return res.status(400).json({ success: false, result: null, message: 'No file uploaded.' });

  const AdCampaignTemplate = mongoose.model('AdCampaignTemplate');
  // Same convention the manual Campaign Setup UI uses (CaptureForm.jsx) —
  // the browser knows the real MIME type, so it sends mediaType explicitly
  // rather than the server guessing from the file extension.
  const mediaType = req.body.mediaType === 'video' ? 'video' : 'image';
  const doc = await AdCampaignTemplate.findOneAndUpdate(
    { platform },
    {
      $set: {
        mediaFilePath: req.upload.filePath,
        mediaFileName: req.upload.fileName,
        mediaType,
        updated: new Date(),
      },
      $setOnInsert: { platform, created: new Date() },
    },
    { upsert: true, new: true }
  );
  return res.status(200).json({ success: true, result: doc, message: 'Media uploaded.' });
};

module.exports = { list, upsert, uploadMedia };
