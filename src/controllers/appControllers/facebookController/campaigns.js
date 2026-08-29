const mongoose = require('mongoose');
const graph = require('@/utils/metaGraphClient');
const { requireConnection, decryptedUserToken } = require('./_helpers');

// GET /api/facebook/campaigns
const listCampaigns = async (req, res) => {
  const FacebookCampaign = mongoose.model('FacebookCampaign');
  const result = await FacebookCampaign.find({ removed: false }).sort({ created: -1 }).exec();
  return res.status(200).json({ success: true, result, message: 'OK' });
};

// GET /api/facebook/campaigns/:id
const readCampaign = async (req, res) => {
  const FacebookCampaign = mongoose.model('FacebookCampaign');
  const result = await FacebookCampaign.findOne({ _id: req.params.id, removed: false }).exec();
  if (!result) return res.status(404).json({ success: false, result: null, message: 'Campaign not found' });
  return res.status(200).json({ success: true, result, message: 'OK' });
};

// POST /api/facebook/campaigns — created PAUSED on Meta, always. Never
// auto-activates (see "Never spend money automatically" in the plan).
const createCampaign = async (req, res) => {
  const conn = await requireConnection(res, { needAdAccount: true });
  if (!conn) return;

  const { name, objective, specialAdCategories } = req.body;
  if (!name) return res.status(400).json({ success: false, result: null, message: 'name is required.' });

  const FacebookCampaign = mongoose.model('FacebookCampaign');
  const doc = new FacebookCampaign({
    adAccountId: conn.adAccountId,
    name,
    objective: objective || 'OUTCOME_LEADS',
    specialAdCategory: (specialAdCategories && specialAdCategories[0]) || 'NONE',
  });

  try {
    const created = await graph.createCampaign({
      adAccountId: conn.adAccountId,
      userAccessToken: decryptedUserToken(conn),
      name,
      objective: objective || 'OUTCOME_LEADS',
      specialAdCategories,
    });
    doc.metaCampaignId = created.id;
    await doc.save();
    return res.status(200).json({ success: true, result: doc, message: 'Campaign created (PAUSED)' });
  } catch (err) {
    doc.lastError = err.message;
    await doc.save();
    return res.status(502).json({ success: false, result: null, message: err.message });
  }
};

// PATCH /api/facebook/campaigns/:id — local-only field updates. Renaming an
// already-created Meta campaign isn't exposed here to keep this in step with
// what the Marketing API actually supports cleanly.
const updateCampaign = async (req, res) => {
  const FacebookCampaign = mongoose.model('FacebookCampaign');
  const doc = await FacebookCampaign.findOne({ _id: req.params.id, removed: false }).exec();
  if (!doc) return res.status(404).json({ success: false, result: null, message: 'Campaign not found' });

  if (!doc.metaCampaignId && req.body.name) doc.name = req.body.name;
  if (req.body.objective !== undefined) doc.objective = req.body.objective;
  doc.updated = Date.now();
  await doc.save();

  return res.status(200).json({ success: true, result: doc, message: 'Campaign updated' });
};

// POST /api/facebook/campaigns/:id/publish — the ONLY path that flips a
// campaign ACTIVE. Requires the Meta call to actually succeed.
const publishCampaign = async (req, res) => {
  const conn = await requireConnection(res, { needAdAccount: true });
  if (!conn) return;

  const FacebookCampaign = mongoose.model('FacebookCampaign');
  const doc = await FacebookCampaign.findOne({ _id: req.params.id, removed: false }).exec();
  if (!doc) return res.status(404).json({ success: false, result: null, message: 'Campaign not found' });
  if (!doc.metaCampaignId) {
    return res.status(400).json({ success: false, result: null, message: 'Campaign was not created on Meta yet.' });
  }

  try {
    await graph.updateObjectStatus({
      objectId: doc.metaCampaignId,
      userAccessToken: decryptedUserToken(conn),
      status: 'ACTIVE',
    });
    doc.status = 'ACTIVE';
    doc.lastError = undefined;
    doc.updated = Date.now();
    await doc.save();
    return res.status(200).json({ success: true, result: doc, message: 'Campaign published' });
  } catch (err) {
    doc.lastError = err.message;
    await doc.save();
    return res.status(502).json({ success: false, result: null, message: err.message });
  }
};

module.exports = { listCampaigns, readCampaign, createCampaign, updateCampaign, publishCampaign };
