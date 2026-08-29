const mongoose = require('mongoose');
const graph = require('../../../utils/metaGraphClient');
const { requireConnection, decryptedUserToken } = require('./_helpers');

// GET /api/facebook/ads?campaignId=<id>
const listAds = async (req, res) => {
  const FacebookAd = mongoose.model('FacebookAd');
  const filter = { removed: false };
  if (req.query.campaignId) filter.campaignId = req.query.campaignId;
  const result = await FacebookAd.find(filter).sort({ created: -1 }).exec();
  return res.status(200).json({ success: true, result, message: 'OK' });
};

// POST /api/facebook/ads — created PAUSED, always. Ties Ad Account + Ad Set +
// Creative together into the final Lead Ad.
const createAd = async (req, res) => {
  const conn = await requireConnection(res, { needAdAccount: true });
  if (!conn) return;

  const { name, campaignId, adSetId, creativeId } = req.body;
  if (!name || !campaignId || !adSetId || !creativeId) {
    return res.status(400).json({
      success: false,
      result: null,
      message: 'name, campaignId, adSetId and creativeId are required.',
    });
  }

  const FacebookAdSet = mongoose.model('FacebookAdSet');
  const FacebookAdCreative = mongoose.model('FacebookAdCreative');
  const [adSet, creative] = await Promise.all([
    FacebookAdSet.findOne({ _id: adSetId, removed: false }).exec(),
    FacebookAdCreative.findOne({ _id: creativeId, removed: false }).exec(),
  ]);

  if (!adSet || !adSet.metaAdSetId) {
    return res.status(400).json({ success: false, result: null, message: 'Ad Set was not found or not yet created on Meta.' });
  }
  if (!creative || !creative.metaCreativeId) {
    return res.status(400).json({ success: false, result: null, message: 'Ad Creative was not found or not yet created on Meta.' });
  }

  const FacebookAd = mongoose.model('FacebookAd');
  const doc = new FacebookAd({ adAccountId: conn.adAccountId, campaignId, adSetId, creativeId, name });

  try {
    const created = await graph.createAd({
      adAccountId: conn.adAccountId,
      userAccessToken: decryptedUserToken(conn),
      name,
      adSetId: adSet.metaAdSetId,
      creativeId: creative.metaCreativeId,
    });
    doc.metaAdId = created.id;
    await doc.save();
    return res.status(200).json({ success: true, result: doc, message: 'Ad created (PAUSED)' });
  } catch (err) {
    doc.lastError = err.message;
    await doc.save();
    return res.status(502).json({ success: false, result: null, message: err.message });
  }
};

// PATCH /api/facebook/ads/:id — local-only field updates.
const updateAd = async (req, res) => {
  const FacebookAd = mongoose.model('FacebookAd');
  const doc = await FacebookAd.findOne({ _id: req.params.id, removed: false }).exec();
  if (!doc) return res.status(404).json({ success: false, result: null, message: 'Ad not found' });

  if (!doc.metaAdId && req.body.name) doc.name = req.body.name;
  doc.updated = Date.now();
  await doc.save();

  return res.status(200).json({ success: true, result: doc, message: 'Ad updated' });
};

// POST /api/facebook/ads/:id/publish — the ONLY path that flips an ad ACTIVE.
const publishAd = async (req, res) => {
  const conn = await requireConnection(res, { needAdAccount: true });
  if (!conn) return;

  const FacebookAd = mongoose.model('FacebookAd');
  const doc = await FacebookAd.findOne({ _id: req.params.id, removed: false }).exec();
  if (!doc) return res.status(404).json({ success: false, result: null, message: 'Ad not found' });
  if (!doc.metaAdId) {
    return res.status(400).json({ success: false, result: null, message: 'Ad was not created on Meta yet.' });
  }

  try {
    await graph.updateObjectStatus({
      objectId: doc.metaAdId,
      userAccessToken: decryptedUserToken(conn),
      status: 'ACTIVE',
    });
    doc.status = 'ACTIVE';
    doc.lastError = undefined;
    doc.updated = Date.now();
    await doc.save();
    return res.status(200).json({ success: true, result: doc, message: 'Ad published' });
  } catch (err) {
    doc.lastError = err.message;
    await doc.save();
    return res.status(502).json({ success: false, result: null, message: err.message });
  }
};

module.exports = { listAds, createAd, updateAd, publishAd };
