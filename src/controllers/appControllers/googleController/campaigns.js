const mongoose = require('mongoose');
const graph = require('../../../utils/googleAdsClient');
const { requireConnection, getFreshAccessToken } = require('./_helpers');

// GET /api/google/campaigns
const listCampaigns = async (req, res) => {
  const GoogleCampaign = mongoose.model('GoogleCampaign');
  const result = await GoogleCampaign.find({ removed: false }).sort({ created: -1 }).exec();
  return res.status(200).json({ success: true, result, message: 'OK' });
};

// GET /api/google/campaigns/:id
const readCampaign = async (req, res) => {
  const GoogleCampaign = mongoose.model('GoogleCampaign');
  const result = await GoogleCampaign.findOne({ _id: req.params.id, removed: false }).exec();
  if (!result) return res.status(404).json({ success: false, result: null, message: 'Campaign not found' });
  return res.status(200).json({ success: true, result, message: 'OK' });
};

// POST /api/google/campaigns — created PAUSED on Google Ads, always. Never
// auto-activates (see "Never spend money automatically" in the plan).
// Google requires a CampaignBudget resource to exist before the campaign
// itself, so this creates both in sequence.
const createCampaign = async (req, res) => {
  const conn = await requireConnection(res, { needCustomer: true });
  if (!conn) return;

  const { name, advertisingChannelType, dailyBudgetMicros } = req.body;
  if (!name) return res.status(400).json({ success: false, result: null, message: 'name is required.' });
  if (!dailyBudgetMicros) {
    return res.status(400).json({ success: false, result: null, message: 'dailyBudgetMicros is required.' });
  }

  const GoogleCampaign = mongoose.model('GoogleCampaign');
  const doc = new GoogleCampaign({
    customerId: conn.customerId,
    name,
    advertisingChannelType: advertisingChannelType || 'SEARCH',
    dailyBudgetMicros,
  });

  try {
    const accessToken = await getFreshAccessToken(conn);

    const budget = await graph.createCampaignBudget({
      customerId: conn.customerId,
      accessToken,
      loginCustomerId: conn.loginCustomerId,
      name: `${name} Budget`,
      amountMicros: dailyBudgetMicros,
    });
    doc.campaignBudgetResourceName = budget.resourceName;

    const created = await graph.createCampaign({
      customerId: conn.customerId,
      accessToken,
      loginCustomerId: conn.loginCustomerId,
      name,
      advertisingChannelType: doc.advertisingChannelType,
      campaignBudgetResourceName: budget.resourceName,
    });
    doc.googleCampaignResourceName = created.resourceName;

    await doc.save();
    return res.status(200).json({ success: true, result: doc, message: 'Campaign created (PAUSED)' });
  } catch (err) {
    doc.lastError = err.message;
    await doc.save();
    return res.status(502).json({ success: false, result: null, message: err.message });
  }
};

// PATCH /api/google/campaigns/:id — local-only field updates. Renaming an
// already-created Google campaign isn't exposed here to keep this in step
// with what the Ads API mutate surface actually supports cleanly.
const updateCampaign = async (req, res) => {
  const GoogleCampaign = mongoose.model('GoogleCampaign');
  const doc = await GoogleCampaign.findOne({ _id: req.params.id, removed: false }).exec();
  if (!doc) return res.status(404).json({ success: false, result: null, message: 'Campaign not found' });

  if (!doc.googleCampaignResourceName && req.body.name) doc.name = req.body.name;
  doc.updated = Date.now();
  await doc.save();

  return res.status(200).json({ success: true, result: doc, message: 'Campaign updated' });
};

// POST /api/google/campaigns/:id/publish — the ONLY path that flips a
// campaign ENABLED. Requires the Google Ads mutate call to actually succeed.
const publishCampaign = async (req, res) => {
  const conn = await requireConnection(res, { needCustomer: true });
  if (!conn) return;

  const GoogleCampaign = mongoose.model('GoogleCampaign');
  const doc = await GoogleCampaign.findOne({ _id: req.params.id, removed: false }).exec();
  if (!doc) return res.status(404).json({ success: false, result: null, message: 'Campaign not found' });
  if (!doc.googleCampaignResourceName) {
    return res.status(400).json({ success: false, result: null, message: 'Campaign was not created on Google Ads yet.' });
  }

  try {
    const accessToken = await getFreshAccessToken(conn);
    await graph.updateResourceStatus({
      customerId: conn.customerId,
      accessToken,
      loginCustomerId: conn.loginCustomerId,
      resourcePath: 'campaigns',
      resourceName: doc.googleCampaignResourceName,
      status: 'ENABLED',
    });
    doc.status = 'ENABLED';
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
