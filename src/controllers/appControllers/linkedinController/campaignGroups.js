const mongoose = require('mongoose');
const client = require('@/utils/linkedinAdsClient');
const { requireConnection, decryptedAccessToken } = require('./_helpers');

// GET /api/linkedin/campaign-groups
const listCampaignGroups = async (req, res) => {
  const LinkedInCampaignGroup = mongoose.model('LinkedInCampaignGroup');
  const result = await LinkedInCampaignGroup.find({ removed: false }).sort({ created: -1 }).exec();
  return res.status(200).json({ success: true, result, message: 'OK' });
};

// GET /api/linkedin/campaign-groups/:id
const readCampaignGroup = async (req, res) => {
  const LinkedInCampaignGroup = mongoose.model('LinkedInCampaignGroup');
  const result = await LinkedInCampaignGroup.findOne({ _id: req.params.id, removed: false }).exec();
  if (!result) return res.status(404).json({ success: false, result: null, message: 'Campaign Group not found' });
  return res.status(200).json({ success: true, result, message: 'OK' });
};

// POST /api/linkedin/campaign-groups — created PAUSED on LinkedIn, always.
// Never auto-activates (mirrors "Never spend money automatically" in
// facebookController/campaigns.js's createCampaign exactly — this is the
// top of LinkedIn's hierarchy the way FacebookCampaign is the top of Meta's).
const createCampaignGroup = async (req, res) => {
  const conn = await requireConnection(res, { needAdAccount: true });
  if (!conn) return;

  const { name, totalBudget } = req.body;
  if (!name) return res.status(400).json({ success: false, result: null, message: 'name is required.' });

  const LinkedInCampaignGroup = mongoose.model('LinkedInCampaignGroup');
  const doc = new LinkedInCampaignGroup({
    adAccountId: conn.adAccountId,
    name,
    totalBudget,
  });

  try {
    const created = await client.createCampaignGroup({
      adAccountId: conn.adAccountId,
      accessToken: decryptedAccessToken(conn),
      name,
      totalBudget,
    });
    // LinkedIn's Restli create returns the new entity's URN/id in a Location
    // header and/or an `id` field depending on version — the client passes
    // through whatever the API gave us as `created.id`.
    doc.linkedinCampaignGroupId = created.id;
    await doc.save();
    return res.status(200).json({ success: true, result: doc, message: 'Campaign Group created (PAUSED)' });
  } catch (err) {
    doc.lastError = err.message;
    await doc.save();
    return res.status(502).json({ success: false, result: null, message: err.message });
  }
};

// PATCH /api/linkedin/campaign-groups/:id — local-only field updates.
// Renaming an already-created LinkedIn campaign group isn't exposed here to
// keep this in step with what the Marketing API actually supports cleanly
// (mirrors facebookController/campaigns.js's updateCampaign).
const updateCampaignGroup = async (req, res) => {
  const LinkedInCampaignGroup = mongoose.model('LinkedInCampaignGroup');
  const doc = await LinkedInCampaignGroup.findOne({ _id: req.params.id, removed: false }).exec();
  if (!doc) return res.status(404).json({ success: false, result: null, message: 'Campaign Group not found' });

  if (!doc.linkedinCampaignGroupId && req.body.name) doc.name = req.body.name;
  if (req.body.totalBudget !== undefined) doc.totalBudget = req.body.totalBudget;
  doc.updated = Date.now();
  await doc.save();

  return res.status(200).json({ success: true, result: doc, message: 'Campaign Group updated' });
};

// POST /api/linkedin/campaign-groups/:id/publish — the ONLY path that flips
// a campaign group ACTIVE.
const publishCampaignGroup = async (req, res) => {
  const conn = await requireConnection(res, { needAdAccount: true });
  if (!conn) return;

  const LinkedInCampaignGroup = mongoose.model('LinkedInCampaignGroup');
  const doc = await LinkedInCampaignGroup.findOne({ _id: req.params.id, removed: false }).exec();
  if (!doc) return res.status(404).json({ success: false, result: null, message: 'Campaign Group not found' });
  if (!doc.linkedinCampaignGroupId) {
    return res.status(400).json({ success: false, result: null, message: 'Campaign Group was not created on LinkedIn yet.' });
  }

  try {
    await client.updateObjectStatus({
      path: `/adAccounts/${doc.adAccountId}/adCampaignGroups/${doc.linkedinCampaignGroupId}`,
      accessToken: decryptedAccessToken(conn),
      status: 'ACTIVE',
    });
    doc.status = 'ACTIVE';
    doc.lastError = undefined;
    doc.updated = Date.now();
    await doc.save();
    return res.status(200).json({ success: true, result: doc, message: 'Campaign Group published' });
  } catch (err) {
    doc.lastError = err.message;
    await doc.save();
    return res.status(502).json({ success: false, result: null, message: err.message });
  }
};

module.exports = { listCampaignGroups, readCampaignGroup, createCampaignGroup, updateCampaignGroup, publishCampaignGroup };
