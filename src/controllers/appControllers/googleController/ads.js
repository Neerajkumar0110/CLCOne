const mongoose = require('mongoose');
const graph = require('@/utils/googleAdsClient');
const { requireConnection, getFreshAccessToken } = require('./_helpers');

// GET /api/google/ads?campaignId=<id>
const listAds = async (req, res) => {
  const GoogleAd = mongoose.model('GoogleAd');
  const filter = { removed: false };
  if (req.query.campaignId) filter.campaignId = req.query.campaignId;
  const result = await GoogleAd.find(filter).sort({ created: -1 }).exec();
  return res.status(200).json({ success: true, result, message: 'OK' });
};

// POST /api/google/ads — created PAUSED, always. A Responsive Search Ad tied
// to an Ad Group. Google has no separate "Ad Creative" object the way Meta
// does — headlines/descriptions are submitted directly here, unlike
// facebookController/creatives.js + ads.js being two steps.
const createAd = async (req, res) => {
  const conn = await requireConnection(res, { needCustomer: true });
  if (!conn) return;

  const { name, campaignId, adGroupId, headlines, descriptions, finalUrls } = req.body;
  if (!campaignId || !adGroupId || !headlines || !descriptions || !finalUrls) {
    return res.status(400).json({
      success: false,
      result: null,
      message: 'campaignId, adGroupId, headlines, descriptions and finalUrls are required.',
    });
  }
  if (headlines.length < 3 || descriptions.length < 2) {
    return res.status(400).json({
      success: false,
      result: null,
      message: 'Google requires at least 3 headlines and 2 descriptions for a Responsive Search Ad.',
    });
  }

  const GoogleAdGroup = mongoose.model('GoogleAdGroup');
  const adGroup = await GoogleAdGroup.findOne({ _id: adGroupId, removed: false }).exec();
  if (!adGroup || !adGroup.googleAdGroupResourceName) {
    return res.status(400).json({ success: false, result: null, message: 'Ad Group was not found or not yet created on Google Ads.' });
  }

  const GoogleAd = mongoose.model('GoogleAd');
  const doc = new GoogleAd({
    customerId: conn.customerId,
    campaignId,
    adGroupId,
    name: name || 'Untitled Ad',
    headlines,
    descriptions,
    finalUrls,
  });

  try {
    const accessToken = await getFreshAccessToken(conn);
    const created = await graph.createAdGroupAd({
      customerId: conn.customerId,
      accessToken,
      loginCustomerId: conn.loginCustomerId,
      adGroupResourceName: adGroup.googleAdGroupResourceName,
      headlines,
      descriptions,
      finalUrls,
    });
    doc.googleAdResourceName = created.resourceName;
    await doc.save();
    return res.status(200).json({ success: true, result: doc, message: 'Ad created (PAUSED)' });
  } catch (err) {
    doc.lastError = err.message;
    await doc.save();
    return res.status(502).json({ success: false, result: null, message: err.message });
  }
};

// PATCH /api/google/ads/:id — local-only field updates.
const updateAd = async (req, res) => {
  const GoogleAd = mongoose.model('GoogleAd');
  const doc = await GoogleAd.findOne({ _id: req.params.id, removed: false }).exec();
  if (!doc) return res.status(404).json({ success: false, result: null, message: 'Ad not found' });

  if (!doc.googleAdResourceName && req.body.name) doc.name = req.body.name;
  doc.updated = Date.now();
  await doc.save();

  return res.status(200).json({ success: true, result: doc, message: 'Ad updated' });
};

// POST /api/google/ads/:id/publish — the ONLY path that flips an ad ENABLED.
const publishAd = async (req, res) => {
  const conn = await requireConnection(res, { needCustomer: true });
  if (!conn) return;

  const GoogleAd = mongoose.model('GoogleAd');
  const doc = await GoogleAd.findOne({ _id: req.params.id, removed: false }).exec();
  if (!doc) return res.status(404).json({ success: false, result: null, message: 'Ad not found' });
  if (!doc.googleAdResourceName) {
    return res.status(400).json({ success: false, result: null, message: 'Ad was not created on Google Ads yet.' });
  }

  try {
    const accessToken = await getFreshAccessToken(conn);
    await graph.updateResourceStatus({
      customerId: conn.customerId,
      accessToken,
      loginCustomerId: conn.loginCustomerId,
      resourcePath: 'adGroupAds',
      resourceName: doc.googleAdResourceName,
      status: 'ENABLED',
    });
    doc.status = 'ENABLED';
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
